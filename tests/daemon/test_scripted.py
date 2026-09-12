"""``athena serve --script``: a daemon whose engine is a recorded transcript (README §3.5).

The shell's ``ATHENA_SMOKE=turn`` run needs one turn that is the same turn every time — the same
AUTO call on the page, the same gated proposal, the same card — and a real CLI cannot promise
that. So the daemon grows one dev flag: ``--script`` replays a file through the
:class:`~athena.harness.transports.ScriptedTransport` that ``tests/daemon/`` already runs every
gated turn on, and everything else about the turn stays the real thing (ADR 0007).

Two claims are made here. The first is that a **real daemon** boots on a real socket with the flag
and streams the recorded round over ``POST /run`` — spawned as a subprocess, because a transport
swapped in-process would prove the transport and not the flag. The second is that the transcript
the desktop shell ships is well formed and still addresses the tools the scratch page registers,
so a rename on either side is a red test here rather than a dead smoke run.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Sequence
from http.client import HTTPConnection
from pathlib import Path

import pytest

from athena.daemon.server import TOKEN_HEADER
from athena.harness.op_grammar import Op, parse_turn
from athena.harness.transports import rounds_from_transcript

from .conftest import APP_ID, PAGE_ORIGIN, claude_round, manifest_body, op

#: ``serve()`` behind a ``-c``, exactly as ``test_ready.py`` spawns one.
_ENTRY = "import sys; from athena.daemon import serve; sys.exit(serve())"

#: The transcript the desktop shell replays, repo-relative from this file.
SHELL_SCRIPT = Path(__file__).resolve().parents[2] / "apps/desktop/scratch/gated-round.jsonl"


def write_transcript(path: Path, rounds: Sequence[Sequence[str]]) -> Path:
    """A recorded transcript on disk: one round per blank-line-separated block."""
    path.write_text("\n\n".join("\n".join(lines) for lines in rounds) + "\n", encoding="utf-8")
    return path


class Daemon:
    """One spawned ``athena serve``, with the two requests a turn takes."""

    def __init__(self, process: subprocess.Popen[str], ready: dict[str, str], token: str) -> None:
        self.process = process
        self.url = ready["url"]
        self.token = token
        host, _, port = self.url.removeprefix("http://").partition(":")
        self.host = host
        self.port = int(port)

    def request(self, path: str, *, method: str = "GET", body: object = None) -> tuple[int, str]:
        headers = {TOKEN_HEADER: self.token}
        payload = None
        if body is not None:
            payload = json.dumps(body)
            headers["Content-Type"] = "application/json"
        connection = HTTPConnection(self.host, self.port, timeout=30)
        try:
            connection.request(method, path, body=payload, headers=headers)
            reply = connection.getresponse()
            return reply.status, reply.read().decode("utf-8")
        finally:
            connection.close()

    def frames(self, **body: object) -> list[dict[str, object]]:
        """One ``POST /run``, as the decoded SSE frames it streamed."""
        status, text = self.request("/run", method="POST", body=body)
        assert status == 200, text
        out: list[dict[str, object]] = []
        for block in text.split("\n\n"):
            for line in block.split("\n"):
                if line.startswith("data: "):
                    out.append(json.loads(line[len("data: ") :]))
        return out


@pytest.fixture
def scripted(tmp_path: Path) -> object:
    """A factory: hand it rounds, get a listening daemon replaying them."""
    spawned: list[subprocess.Popen[str]] = []

    def start(rounds: Sequence[Sequence[str]]) -> Daemon:
        script = write_transcript(tmp_path / "script.jsonl", rounds)
        token_file = tmp_path / "daemon.json"
        process = subprocess.Popen(
            [
                sys.executable,
                "-c",
                _ENTRY,
                "--port",
                "0",
                "--brain",
                str(tmp_path / "brain"),
                "--token-file",
                str(token_file),
                "--script",
                str(script),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            cwd=str(tmp_path),
        )
        spawned.append(process)
        assert process.stdout is not None
        ready = json.loads(process.stdout.readline())
        assert ready["ok"] is True, ready
        token = json.loads(token_file.read_text(encoding="utf-8"))["token"]
        return Daemon(process, ready, token)

    try:
        yield start
    finally:
        for process in spawned:
            # Never a ``with`` block: exiting one waits for a process that is serving forever.
            process.terminate()
            process.wait(timeout=30)
            for pipe in (process.stdout, process.stderr):
                if pipe is not None:
                    pipe.close()


def test_a_daemon_boots_on_a_script_and_streams_the_recorded_round(scripted) -> None:  # type: ignore[no-untyped-def]
    """The whole claim of the flag: no binary, no login, and a turn that reaches the page.

    ``chase`` is ``reversible`` with internal side effects, so the manifest's own flags make it
    AUTO; a host tool has no executor in the lane, so the gate allowing it is a ``tool.call`` with
    no ``tool.result`` beside it — the wire's way of saying "the page runs this one" (ADR 0010).
    """
    daemon = scripted([claude_round(f"On it.\n{op(f'host.{APP_ID}.chase', invoice='INV-101')}")])

    status, body = daemon.request("/manifest", method="POST", body=manifest_body())
    assert status == 200, body

    frames = daemon.frames(message="Chase INV-101.", origin=PAGE_ORIGIN)
    kinds = [frame["kind"] for frame in frames]
    calls = [frame for frame in frames if frame["kind"] == "tool.call"]

    assert kinds[-1] == "turn.finished"
    assert [call["name"] for call in calls] == [f"host.{APP_ID}.chase"]
    assert [call["params"] for call in calls] == [{"invoice": "INV-101"}]
    assert not [frame for frame in frames if frame["kind"] == "tool.result"]


def test_the_second_round_is_the_second_turn_and_a_gated_call_becomes_a_card(scripted) -> None:  # type: ignore[no-untyped-def]
    """One round per invocation, in order — and the gate is the real one behind the fixture.

    ``pay`` leaves the building, so no recorded transcript can talk it into executing: the class
    falls out of the manifest's flags, the gate files an approval row, and the turn stops on the
    user (README §3.3).
    """
    daemon = scripted(
        [
            claude_round(f"Reading.\n{op(f'host.{APP_ID}.chase', invoice='INV-101')}"),
            claude_round(f"Now the payment.\n{op(f'host.{APP_ID}.pay', invoice='INV-101')}"),
        ]
    )
    status, body = daemon.request("/manifest", method="POST", body=manifest_body())
    assert status == 200, body

    first = daemon.frames(message="Chase INV-101.", origin=PAGE_ORIGIN)
    assert [f["name"] for f in first if f["kind"] == "tool.call"] == [f"host.{APP_ID}.chase"]

    second = daemon.frames(
        message="Continue with the results of the calls you made.",
        origin=PAGE_ORIGIN,
        tool_results=[
            {
                "call_id": str(next(f for f in first if f["kind"] == "tool.call")["call_id"]),
                "name": f"host.{APP_ID}.chase",
                "ok": True,
                "output": "drafted",
                "error": None,
                "tier": 1,
                "ms": 4,
            }
        ],
    )
    cards = [frame for frame in second if frame["kind"] == "decision.requested"]
    assert len(cards) == 1
    assert cards[0]["action"] == f"host.{APP_ID}.pay"
    assert cards[0]["params"] == {"invoice": "INV-101"}
    assert sorted(option["id"] for option in cards[0]["options"]) == ["approve", "decline"]  # type: ignore[union-attr]

    # The row is really in the inbox, which is what the panel's decline then answers.
    status, listed = daemon.request("/decisions")
    assert status == 200
    assert json.loads(listed)["pending"][0]["id"] == cards[0]["id"]


def test_health_reports_the_engine_probe_or_says_it_has_not_answered(scripted) -> None:  # type: ignore[no-untyped-def]
    """``engines`` is a list of three-state probes, or ``None``. Never an empty list meaning both.

    The probe spawns a binary, so it runs on a thread beside the server and ``/health`` answers
    with whatever is known *now* — which on a fast machine is either answer, and both are correct.
    """
    daemon = scripted([claude_round("Nothing to do.")])
    status, body = daemon.request("/health")
    assert status == 200
    engines = json.loads(body)["engines"]
    assert engines is None or all(
        row["state"] in {"found", "not_found", "not_logged_in"} and row["id"] and row["detail"]
        for row in engines
    )


# --- the transcript the shell ships --------------------------------------------------------------


def test_the_shells_recorded_round_calls_one_auto_tool_then_proposes_one_gated_one() -> None:
    """``apps/desktop/scratch/gated-round.jsonl`` is the smoke's premise, so it is checked here.

    The two names are the scratch page's own tools under the catalog's namespace. A rename on
    either side — the page's meta tag, the tool, the transcript — fails this rather than producing
    a smoke run that says ``unknown_ref`` in the shell and nowhere a test can see it.
    """
    assert SHELL_SCRIPT.is_file(), SHELL_SCRIPT
    rounds = rounds_from_transcript(SHELL_SCRIPT.read_text(encoding="utf-8"))
    assert len(rounds) == 3, "one AUTO round, one GATED round, and one that ends the chore"

    actions: list[str] = []
    for lines in rounds:
        for line in lines:
            record = json.loads(line)
            if record.get("type") != "assistant":
                continue
            for part in record["message"]["content"]:
                parsed = parse_turn(part["text"])
                assert not parsed.errors, parsed.errors
                actions.extend(item.action for item in parsed.ops if isinstance(item, Op))

    assert actions == ["host.scratchbox.invoice_list", "host.scratchbox.invoice_send"]
