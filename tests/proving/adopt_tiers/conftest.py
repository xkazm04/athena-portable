"""A scripted Claude for the adopt tier bench (ADR 0097). Nothing here spawns ``claude``.

:class:`FakeModel` tells legs apart by the system prompt file each was run with — the studio's
interviewer, auditor and brief writer, and the bench's persona and judge — and answers each kind
from its own queue (the last answer repeats). Every prompt is kept, so a test can read exactly what
a leg was told (the judge's blindness is read that way).
"""

from __future__ import annotations

import json
import queue
import threading
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from athena.adopt.prompts import AUDIT_SYSTEM, BRIEF_SYSTEM, INTERVIEW_SYSTEM
from athena.adopt.session import reset_hooks
from athena.harness.transports import CliRequest
from athena.proving.adopt_tiers.score import JUDGE_SYSTEM
from athena.proving.adopt_tiers.simulate import PERSONA_SYSTEM, Rig
from athena.proving.runlog import RunLog

SYSTEMS = {
    INTERVIEW_SYSTEM: "interview",
    AUDIT_SYSTEM: "audit",
    BRIEF_SYSTEM: "brief",
    PERSONA_SYSTEM: "persona",
    JUDGE_SYSTEM: "judge",
}


def stream_lines(text: str) -> list[str]:
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
                "is_error": False,
                "result": text,
                "total_cost_usd": 0.001,
                "usage": {"input_tokens": 100, "output_tokens": 20},
            }
        ),
    ]


@dataclass
class Call:
    kind: str
    prompt: str
    argv: list[str]


@dataclass
class FakeModel:
    script: dict[str, list[Any]] = field(default_factory=dict)
    calls: list[Call] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._lock = threading.Lock()

    def answer(self, argv: Sequence[str], prompt: str) -> str:
        path = argv[list(argv).index("--system-prompt-file") + 1]
        kind = SYSTEMS.get(Path(path).read_text(encoding="utf-8"), "other")
        with self._lock:
            self.calls.append(Call(kind, prompt, list(argv)))
            pending = self.script.get(kind) or ["{}"]
            value = pending.pop(0) if len(pending) > 1 else pending[0]
        return value if isinstance(value, str) else json.dumps(value)

    def prompts(self, kind: str) -> list[str]:
        with self._lock:
            return [c.prompt for c in self.calls if c.kind == kind]

    def argvs(self, kind: str) -> list[list[str]]:
        with self._lock:
            return [c.argv for c in self.calls if c.kind == kind]


@dataclass
class FakeTransport:
    model: FakeModel

    async def run(self, request: CliRequest) -> AsyncIterator[str]:
        for line in stream_lines(self.model.answer(request.argv, request.stdin)):
            yield line


class FakeWarm:
    def __init__(self, model: FakeModel, argv: Sequence[str]) -> None:
        self.model = model
        self.argv = list(argv)
        self.killed = False
        self._lines: queue.Queue[str | None] = queue.Queue()

    def send(self, line: str) -> None:
        text = json.loads(line)["message"]["content"][0]["text"]
        for out in stream_lines(self.model.answer(self.argv, text)):
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


def make_rig(run_dir: Path, model: FakeModel, **kw: Any) -> Rig:
    return Rig(
        run_dir=run_dir,
        transport=lambda: FakeTransport(model),
        spawn_warm=lambda argv, cwd: FakeWarm(model, argv),
        runlog=RunLog(run_dir / "ledger.jsonl"),
        **kw,
    )


# --- a conversation about easy-lease-end that clears after one card ---------------------------

LEASE_CARD = {
    "say": "A few things first.",
    "questions": [
        {
            "slot_ids": ["p1"],
            "text": "Do Torvane's letters come to Postwren, or somewhere else?",
            "options": [{"id": "a", "label": "Postwren"}, {"id": "b", "label": "Gmail"}],
        },
        {"slot_ids": ["p2"], "text": "Is the return inspection in Linestone Inspect?"},
    ],
}

LEASE_DERIVE = {
    "new_slots": [
        {"kind": "fact", "label": "When the car was returned", "value": ""},
        {"kind": "fact", "label": "Photos of the car before it was returned", "value": ""},
        {"kind": "trap", "label": "Whether the mileage charge is right", "value": ""},
    ],
    "updates": [],
    "open_slot_ids": ["p1", "p2", "f1"],
}

LEASE_CLEAR = {
    "updates": [
        {"slot_id": "p1", "value": "Gmail", "status": "confirmed"},
        {"slot_id": "p2", "value": "Linestone Inspect", "status": "confirmed"},
        {"slot_id": "p3", "value": "Google Photos", "status": "confirmed"},
        {"slot_id": "p4", "value": "Torvane Finance", "status": "confirmed"},
        {"slot_id": "f1", "value": "12 September 2026", "status": "confirmed"},
        {"slot_id": "f2", "value": "Yes, every panel", "status": "confirmed"},
        {"slot_id": "t1", "value": "About 1,900 over; fair", "status": "confirmed"},
    ],
    "open_slot_ids": [],
}

PERSONA_ANSWERS = {
    "answers": [
        {"question_id": "r1q1", "choice_ids": ["b"], "text": ""},
        {"question_id": "r1q2", "choice_ids": [], "text": "Yes, Linestone Inspect."},
    ]
}

JUDGE_ANSWER = {"bundled": 4, "plain": 5, "no_repeats": 5, "unresearchable": 4, "note": "Good."}


def clearing_script() -> dict[str, list[Any]]:
    return {
        "interview": [LEASE_CARD, {"questions": []}],
        "audit": [LEASE_DERIVE, LEASE_CLEAR],
        "brief": [{"lead": "I'll dispute what the lease does not support.", "claim": ["x"]}],
        "persona": [PERSONA_ANSWERS],
        "judge": [JUDGE_ANSWER],
    }


@pytest.fixture(autouse=True)
def _clean_hooks() -> Any:
    reset_hooks()
    yield
    reset_hooks()
