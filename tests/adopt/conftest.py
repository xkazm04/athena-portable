"""A scripted Claude for the Adopt studio, and a real daemon to reach it through (ADR 0097).

Nothing here spawns ``claude``. :class:`FakeModel` plays every leg: it tells the legs apart by the
system prompt file the leg was run with (the interviewer's, the auditor's, the brief writer's) and
answers each kind from its own queue, so two legs running side by side still get the answers
meant for them. :class:`FakeTransport` is the cold path (the house ``Transport`` port) and
:class:`FakeWarm` the warm one (``WarmProcess``); both speak the CLI's stream-json.
"""

from __future__ import annotations

import json
import queue
import threading
from collections.abc import AsyncIterator, Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from http.client import HTTPConnection, HTTPResponse
from pathlib import Path
from typing import Any

import pytest

from athena.adopt.legs import LegRunner, load_tiers
from athena.adopt.prompts import AUDIT_SYSTEM, BRIEF_SYSTEM, INTAKE_SYSTEM, INTERVIEW_SYSTEM
from athena.adopt.routes import AdoptStudio
from athena.adopt.session import Hooks, SessionStore, reset_hooks
from athena.adopt.slots import PlaybookMissing
from athena.channels.voice.config import VoiceStudio
from athena.channels.voice.home import EngineHomes
from athena.connectors.seal import FileSeal
from athena.daemon.server import TOKEN_HEADER, DaemonConfig, make_server
from athena.harness.transports import CliRequest, ScriptedTransport
from athena.wiring import AthenaLocal, build_local

TOKEN = "adopt-test-token"
PLAYBOOK_ID = "demo-deposits"

PLAYBOOK: dict[str, Any] = {
    "id": PLAYBOOK_ID,
    "title": "Late deposits repaid",
    "short_title": "Late 401(k) deposits repaid",
    "brief": (
        "An owner checks **13 deposit lines**.\n\n"
        "**Lost earnings paid:**\n- Two late deferrals\n- Three late loan repayments\n\n"
        "**Left alone:**\n- Deposits on the seventh day\n- A recovery firm's offer"
    ),
    "promise": "Every late deposit is made good with its lost earnings. Nothing else is paid.",
    "persona": "The owner of a small company",
    "command": "Find the late deposits and pay the lost earnings into the plan.",
    "apps": [
        {"name": "Payroll Harbor", "role": "the payroll firm: each payroll's deferrals"},
        {"name": "Retireline", "role": "the recordkeeper: the deposit log"},
    ],
    "gates": [
        {
            "action": "pay_lost_earnings",
            "label": "Pay lost earnings into the plan",
            "why": "Money leaves the company's account and cannot be recalled. More text.",
        }
    ],
    "traps": ["A deposit on the seventh business day, corrected as late."],
}


def stream_lines(text: str, *, is_error: bool = False) -> list[str]:
    """One answer as ``claude -p --output-format stream-json --include-partial-messages``."""
    return [
        json.dumps({"type": "system", "session_id": "fake"}),
        json.dumps(
            {
                "type": "stream_event",
                "event": {
                    "type": "content_block_delta",
                    "delta": {"type": "text_delta", "text": text[:5]},
                },
            }
        ),
        json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}),
        json.dumps(
            {
                "type": "result",
                "is_error": is_error,
                "result": text,
                "total_cost_usd": 0.001,
                "usage": {"input_tokens": 100, "output_tokens": 20},
            }
        ),
    ]


SYSTEMS = {
    INTERVIEW_SYSTEM: "interview",
    AUDIT_SYSTEM: "audit",
    BRIEF_SYSTEM: "brief",
    INTAKE_SYSTEM: "intake",
}


@dataclass
class Call:
    kind: str
    prompt: str
    argv: list[str]
    warm: bool


@dataclass
class FakeModel:
    """Answers per kind (``interview``, ``audit``, ``brief``, or ``other``). Each kind's queue is
    popped; its last answer repeats. A value is text, or a dict sent as JSON."""

    script: dict[str, list[Any]] = field(default_factory=dict)
    calls: list[Call] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._lock = threading.Lock()

    def kind_of(self, argv: Sequence[str]) -> str:
        path = argv[list(argv).index("--system-prompt-file") + 1]
        return SYSTEMS.get(Path(path).read_text(encoding="utf-8"), "other")

    def answer(self, argv: Sequence[str], prompt: str, *, warm: bool) -> str:
        kind = self.kind_of(argv)
        with self._lock:
            self.calls.append(Call(kind, prompt, list(argv), warm))
            pending = self.script.get(kind) or [{"questions": []}]
            value = pending.pop(0) if len(pending) > 1 else pending[0]
        return value if isinstance(value, str) else json.dumps(value)

    def kinds(self) -> list[str]:
        with self._lock:
            return [c.kind for c in self.calls]


@dataclass
class FakeTransport:
    """The cold path: one invocation, one answer from the model."""

    model: FakeModel
    requests: list[CliRequest] = field(default_factory=list)

    async def run(self, request: CliRequest) -> AsyncIterator[str]:
        self.requests.append(request)
        for line in stream_lines(self.model.answer(request.argv, request.stdin, warm=False)):
            yield line


class FakeWarm:
    """The warm path: one process, many user messages, each answered to its ``result``."""

    def __init__(self, model: FakeModel, argv: Sequence[str], *, die_on: int = 0) -> None:
        self.model = model
        self.argv = list(argv)
        self.sent = 0
        self.killed = False
        self.die_on = die_on
        self._lines: queue.Queue[str | None] = queue.Queue()

    def send(self, line: str) -> None:
        self.sent += 1
        if self.die_on and self.sent >= self.die_on:
            self._lines.put(None)
            return
        message = json.loads(line)["message"]["content"][0]["text"]
        for out in stream_lines(self.model.answer(self.argv, message, warm=True)):
            self._lines.put(out)

    def read_line(self, timeout: float) -> str | None:
        try:
            return self._lines.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError from None

    def alive(self) -> bool:
        return not self.killed

    def kill(self) -> None:
        self.killed = True


@dataclass
class WarmFactory:
    model: FakeModel
    die_on: int = 0
    spawned: list[FakeWarm] = field(default_factory=list)

    def __call__(self, argv: Sequence[str], cwd: str) -> FakeWarm:
        proc = FakeWarm(self.model, argv, die_on=self.die_on)
        self.spawned.append(proc)
        return proc


@dataclass
class FakeLedger:
    rows: list[dict[str, Any]] = field(default_factory=list)

    def record(self, **row: Any) -> object:
        self.rows.append(row)
        return row


def load_fixture(playbook_id: str) -> dict[str, Any]:
    if playbook_id != PLAYBOOK_ID:
        raise PlaybookMissing(f"no playbook {playbook_id!r}")
    return json.loads(json.dumps(PLAYBOOK))


@dataclass
class Rig:
    model: FakeModel
    transport: FakeTransport
    warm: WarmFactory
    ledger: FakeLedger
    runner: LegRunner
    store: SessionStore
    hooks: Hooks
    seen: list[tuple[str, Any]]


def make_rig(root: Path, *, clock: Callable[[], float] | None = None) -> Rig:
    model = FakeModel()
    transport = FakeTransport(model)
    warm = WarmFactory(model)
    ledger = FakeLedger()
    runner = LegRunner(
        transport=transport,
        ledger=ledger,
        tiers=load_tiers(),
        prompt_dir=root / "prompts",
        spawn_warm=warm,
    )
    seen: list[tuple[str, Any]] = []
    hooks = Hooks(
        on_start=lambda s: seen.append(("start", s.id)),
        on_answer=lambda s: seen.append(("answer", s.id)),
        on_document=lambda s, doc_id, path: seen.append(("document", (doc_id, path))),
        on_approve=lambda s, rev: seen.append(("approve", rev)),
        on_close=lambda s: seen.append(("close", s.id)),
    )
    store = SessionStore(
        root / "sessions",
        runner,
        load_playbook=load_fixture,
        hooks=lambda: hooks,
        **({"clock": clock} if clock is not None else {}),
    )
    return Rig(model, transport, warm, ledger, runner, store, hooks, seen)


def clear_script() -> dict[str, list[Any]]:
    """A conversation that is clear after one answered card."""
    return {
        "interview": [
            {
                "say": "Two quick things first.",
                "questions": [
                    {
                        "slot_ids": ["p1"],
                        "text": "Do you run payroll in Payroll Harbor?",
                        "options": [
                            {"id": "x", "label": "Yes"},
                            {"id": "y", "label": "No, Gusto"},
                        ],
                    },
                    {"slot_ids": ["p2"], "text": "Is the plan at Retireline, or somewhere else?"},
                ],
            },
            {"questions": [{"slot_ids": ["f1"], "text": "How many people are in the plan?"}]},
        ],
        "audit": [
            {
                "new_slots": [
                    {
                        "kind": "fact",
                        "label": "People in the plan",
                        "value": "38",
                        "status": "guessed",
                    },
                    {"kind": "trap", "label": "Deposits on the seventh day", "value": ""},
                ],
                "updates": [],
                "open_slot_ids": ["p1", "p2", "f1"],
            },
            {
                "updates": [
                    {"slot_id": "p1", "value": "Gusto", "status": "confirmed"},
                    {"slot_id": "p2", "value": "Retireline", "status": "confirmed"},
                    {"slot_id": "p2", "value": "Retireline", "status": "confirmed"},
                    {"slot_id": "f1", "value": "38", "status": "confirmed"},
                    {"slot_id": "t1", "value": "none on day seven", "status": "confirmed"},
                ],
                "open_slot_ids": [],
            },
        ],
        "brief": [
            {
                "lead": "I'll find the late deposits in Gusto and Retireline and pay what's owed.",
                "claim": ["Lost earnings on each late deferral"],
                "left_alone": ["Deposits on the seventh day"],
            }
        ],
    }


@pytest.fixture(autouse=True)
def _clean_hooks() -> Iterator[None]:
    reset_hooks()
    yield
    reset_hooks()


@pytest.fixture
def rig(tmp_path: Path) -> Iterator[Rig]:
    built = make_rig(tmp_path)
    yield built
    built.store.close_all()


# --- a real daemon ------------------------------------------------------------------------------


@dataclass
class Live:
    local: AthenaLocal
    port: int
    studio: AdoptStudio
    rig: Rig

    def request(
        self,
        path: str,
        *,
        method: str = "GET",
        body: Mapping[str, Any] | None = None,
        token: str | None = TOKEN,
        timeout: float = 10.0,
    ) -> tuple[int, dict[str, Any]]:
        connection = HTTPConnection("127.0.0.1", self.port, timeout=timeout)
        headers = {TOKEN_HEADER: token} if token is not None else {}
        payload = json.dumps(dict(body)) if body is not None else None
        if payload is not None:
            headers["Content-Type"] = "application/json"
        try:
            connection.request(method, path, body=payload, headers=headers)
            reply = connection.getresponse()
            raw = reply.read()
            return reply.status, (json.loads(raw) if raw else {})
        finally:
            connection.close()

    def stream(self, path: str, *, timeout: float = 10.0) -> tuple[HTTPConnection, HTTPResponse]:
        connection = HTTPConnection("127.0.0.1", self.port, timeout=timeout)
        connection.request("GET", path, headers={TOKEN_HEADER: TOKEN})
        return connection, connection.getresponse()


def read_frames(
    reply: HTTPResponse, until: Callable[[list[dict[str, Any]], list[str]], bool]
) -> tuple[list[dict[str, Any]], list[str]]:
    """Read SSE frames until ``until(frames, comments)`` or the stream ends."""
    frames: list[dict[str, Any]] = []
    comments: list[str] = []
    block: list[str] = []
    while True:
        raw = reply.fp.readline()
        if not raw:
            return frames, comments
        line = raw.decode("utf-8").rstrip("\n")
        if line:
            block.append(line)
            continue
        if block and block[0].startswith(":"):
            comments.append(block[0])
        elif block:
            assert block[0].startswith("event: ") and block[1].startswith("data: "), block
            data = json.loads(block[1][len("data: ") :])
            assert data["kind"] == block[0][len("event: ") :]
            frames.append(data)
        block = []
        if until(frames, comments):
            return frames, comments


@pytest.fixture
def live(tmp_path: Path, rig: Rig) -> Iterator[Live]:
    studio = AdoptStudio(rig.store, heartbeat_s=0.2)
    voice = VoiceStudio(
        tmp_path / "voice",
        homes=EngineHomes(tmp_path / "personas"),
        seal=FileSeal(tmp_path / "voice" / "sealed"),
        environ={},
    )
    with build_local(
        brain_root=tmp_path / "brain",
        engine="claude_code",
        model="fake-model",
        transport=lambda dialect: ScriptedTransport([]),
        workspace=tmp_path / "engine",
        voice_studio=voice,
        adopt=studio,
    ) as local:
        config = DaemonConfig(port=0, token=TOKEN)
        server = make_server(local.daemon, config)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield Live(local, int(server.server_address[1]), studio, rig)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=10)
