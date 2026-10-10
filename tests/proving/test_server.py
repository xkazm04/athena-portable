"""The trigger page's server, offline (README §9; ADR 0037).

No provider and no real run: the runner's ``spawn`` seam starts a small Python script that
behaves like ``python -m athena.proving`` from the outside — it names its run directory on the
first line, appends ledger rows, writes ``report.json`` and exits with the CLI's code. What is
checked is the server's own law: the bearer token and its constant-time comparison, one run at a
time, the daily cap read from the runs' records, SSE framing, an announced listing bound, a hostile
payload that stays inert, and no secret in any response.
"""

from __future__ import annotations

import http.client
import json
import os
import re
import subprocess
import sys
import threading
from collections.abc import Iterator, Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from athena.proving.roles import HOSTED_ENV
from athena.proving.server import app as app_module
from athena.proving.server.app import ProvingServer, build_handler, page_html
from athena.proving.server.runner import (
    MAX_CALL_EVENTS,
    TOKEN_ENV,
    Runner,
    day_spend,
    sse_frame,
)
from athena.proving.server.runs import RunIndex

KEY = "nb-test-key-0123456789abcdef"
TOKEN = "judge-token-0123456789"
NOW = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)
HOSTILE = '</pre><script>alert("pwned")</script><img src=x onerror=alert(1)>'

FAKE_RUN = r"""
import json, os, pathlib, sys, time
root, run_id, gate, code = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3], int(sys.argv[4])
hostile = sys.argv[5]
run = root / run_id
run.mkdir(parents=True, exist_ok=True)
print(f"gauntlet run -> {run.as_posix()}", flush=True)
print("generating: the key is " + os.environ.get("NEBIUS_API_KEY", ""), flush=True)
print("judge token in child env: " + str("PROVING_JUDGE_TOKEN" in os.environ), flush=True)
print("api key in child env: " + str("ANTHROPIC_API_KEY" in os.environ), flush=True)
rows = [
    {"role": "attacker", "engine": "nemotron", "model": "nvidia/x", "cost_usd": 0.01,
     "is_error": False, "excerpt": "model output " + os.environ.get("NEBIUS_API_KEY", "")},
    {"role": "athena:athena-nemotron", "engine": "nebius", "model": "nvidia/x", "cost_usd": 0.02,
     "is_error": True, "error_reason": "engine_error", "attack": "a1", "verdict": "error"},
]
with (run / "ledger.jsonl").open("a", encoding="utf-8") as handle:
    for row in rows:
        handle.write(json.dumps(row) + "\n")
gate_path = pathlib.Path(gate) if gate != "-" else None
while gate_path is not None and not gate_path.exists():
    time.sleep(0.02)
report = {
    "run_id": run_id, "prototype": "gauntlet", "claim": "c",
    "started_at": "2026-10-07T12:00:00+00:00",
    "wall_s": 1.0, "rows": [{"key": "athena-nemotron", "engine": "nebius", "model": "nvidia/x",
    "planned": 1, "driven": 1, "verdicts": {"held": 1, "breached": 0, "error": 0}}],
    "attacks": [{"id": "a1", "surface": "page_state", "generator": "nemotron", "model": "nvidia/x",
    "target_tool": "ledger.send", "goal": "g", "payload": hostile,
    "runs": [{"row": "athena-nemotron", "verdict": "held", "pressure": True}]}],
    "proof": {"breaches_zero": {"pass": True, "breached": 0, "driven": 1, "held": 1, "errors": 0},
    "pressure": {"athena-nemotron": {"nemotron": {"driven": 1, "pressure": 1}}}},
    "cost_usd": {"nemotron": 0.03, "claude": 0.0},
    "notes": ["key " + os.environ.get("NEBIUS_API_KEY", "")],
}
(run / "report.json").write_text(json.dumps(report), encoding="utf-8")
sys.exit(code)
"""


class FakeSpawn:
    """Starts the fake run instead of the CLI, recording what it was asked to start."""

    def __init__(self, script: Path, run_id: str, gate: Path | None, code: int = 0) -> None:
        self.script, self.run_id, self.gate, self.code = script, run_id, gate, code
        self.calls: list[tuple[list[str], dict[str, str]]] = []

    def __call__(self, argv: Sequence[str], env: Mapping[str, str], cwd: Path) -> Any:
        self.calls.append((list(argv), dict(env)))
        out = argv[argv.index("--out") + 1]
        return subprocess.Popen(
            [
                sys.executable,
                str(self.script),
                out,
                self.run_id,
                str(self.gate) if self.gate else "-",
                str(self.code),
                HOSTILE,
            ],
            env=dict(env),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )


@pytest.fixture
def script(tmp_path: Path) -> Path:
    path = tmp_path / "fake_run.py"
    path.write_text(FAKE_RUN, encoding="utf-8")
    return path


def _environ(token: str | None = TOKEN) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in (TOKEN_ENV, HOSTED_ENV)}
    env["NEBIUS_API_KEY"] = KEY
    if token is not None:
        env[TOKEN_ENV] = token
    return env


class Served:
    def __init__(self, runner: Runner) -> None:
        self.runner = runner
        self.server = ProvingServer(
            ("127.0.0.1", 0), build_handler(runner, RunIndex(runner.runs_root))
        )
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> tuple[int, dict[str, str], str]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        conn.request(method, path, body=body, headers=dict(headers or {}))
        res = conn.getresponse()
        text = res.read().decode("utf-8")
        conn.close()
        return res.status, {k.lower(): v for k, v in res.getheaders()}, text

    def post_run(
        self, token: str | None = TOKEN, payload: Mapping[str, Any] | None = None
    ) -> tuple[int, dict[str, Any]]:
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        body = json.dumps(dict(payload or {"kind": "gauntlet", "preset": "small"})).encode()
        status, _, text = self.request("POST", "/runs", body, headers)
        return status, json.loads(text)

    def close(self) -> None:
        self.runner.stop()
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def make(tmp_path: Path, script: Path) -> Iterator[Any]:
    served: list[Served] = []

    def build(
        *,
        token: str | None = TOKEN,
        gate: Path | None = None,
        code: int = 0,
        run_id: str = "20261007T120000Z",
        daily: Mapping[str, float] | None = None,
        claude_cli: bool = False,
    ) -> tuple[Served, FakeSpawn]:
        spawn = FakeSpawn(script, run_id, gate, code)
        runner = Runner(
            tmp_path / "runs",
            spawn=spawn,
            environ=_environ(token),
            clock=lambda: NOW,
            claude_cli=claude_cli,
            daily_caps=dict(daily or {"nemotron": 3.0, "claude": 15.0}),
        )
        s = Served(runner)
        served.append(s)
        return s, spawn

    yield build
    for s in served:
        s.close()


def _frames(text: str) -> list[dict[str, Any]]:
    """Parse an SSE body strictly: every frame is ``id``, ``event``, one ``data`` line."""
    frames = []
    for block in text.split("\n\n"):
        if not block.strip() or block.startswith(":"):
            continue
        lines = block.split("\n")
        assert len(lines) == 3, block
        assert lines[0].startswith("id: ") and lines[1].startswith("event: ")
        assert lines[2].startswith("data: ")
        frames.append(
            {
                "id": int(lines[0][4:]),
                "event": lines[1][7:],
                "data": json.loads(lines[2][6:]),
            }
        )
    return frames


def _finish(s: Served) -> None:
    job = s.runner.current
    assert job is not None
    with job.cond:
        job.cond.wait_for(lambda: job.done, timeout=20)
    assert job.done


# --- the token -------------------------------------------------------------------------------


def test_triggering_needs_the_bearer_token(make: Any) -> None:
    s, spawn = make()
    assert s.post_run(token=None)[0] == 401
    assert s.post_run(token="wrong-token-wrong")[0] == 401
    status, _, _ = s.request(
        "POST",
        "/runs",
        b'{"kind": "gauntlet"}',
        {"Authorization": f"Basic {TOKEN}", "Content-Type": "application/json"},
    )
    assert status == 401
    # a non-ASCII header is refused, not a crash
    status, _, _ = s.request(
        "POST", "/runs", b"{}", {"Authorization": "Bearer töken".encode().decode("latin-1")}
    )
    assert status == 401
    assert spawn.calls == []


def test_the_token_is_compared_in_constant_time_even_when_absent(
    make: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[tuple[bytes, bytes]] = []
    real = app_module.secrets.compare_digest

    def spy(a: bytes, b: bytes) -> bool:
        seen.append((a, b))
        return real(a, b)

    monkeypatch.setattr(app_module.secrets, "compare_digest", spy)
    s, _ = make()
    assert s.post_run(token=None)[0] == 401
    assert s.post_run(token="nope-nope-nope")[0] == 401
    assert seen == [(b"", TOKEN.encode()), (b"nope-nope-nope", TOKEN.encode())]


def test_without_a_configured_token_triggering_is_off(make: Any) -> None:
    s, spawn = make(token=None)
    status, body = s.post_run(token="anything-at-all")
    assert status == 403 and body["error"] == "triggering_off"
    _, _, text = s.request("GET", "/status")
    assert json.loads(text)["triggering"] is False
    assert spawn.calls == []


def test_a_bad_or_oversized_body_is_refused(make: Any) -> None:
    s, spawn = make()
    assert s.post_run(payload={"kind": "nope"})[0] == 400
    assert s.post_run(payload={"kind": "gauntlet", "claude": "yes"})[0] == 400
    big = json.dumps({"kind": "gauntlet", "pad": "x" * 10_000}).encode()
    status, _, _ = s.request(
        "POST",
        "/runs",
        big,
        {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    assert status == 400
    assert spawn.calls == []


# --- one run at a time, and the money ------------------------------------------------------------


def test_one_run_at_a_time(make: Any, tmp_path: Path) -> None:
    gate = tmp_path / "release"
    s, spawn = make(gate=gate)
    status, body = s.post_run()
    assert status == 202, body
    assert body["run_id"] == "20261007T120000Z"
    assert body["events"] == "/runs/20261007T120000Z/events"
    status, body = s.post_run()
    assert status == 409 and body["error"] == "busy"
    assert len(spawn.calls) == 1
    _, _, listing = s.request("GET", "/runs")
    assert json.loads(listing)["runs"][0]["status"] == "running"
    gate.write_text("go")
    _finish(s)
    _, _, listing = s.request("GET", "/runs")
    assert json.loads(listing)["runs"][0]["status"] == "done"


def test_the_command_carries_the_presets_and_the_servers_caps(make: Any) -> None:
    s, spawn = make(claude_cli=True)
    assert s.post_run(payload={"kind": "gauntlet", "preset": "small", "claude": True})[0] == 202
    _finish(s)
    argv, env = spawn.calls[0]
    assert argv[1:4] == ["-m", "athena.proving", "gauntlet"]
    assert "--n" in argv and argv[argv.index("--n") + 1] == "2"
    assert argv[argv.index("--nemotron-cap") + 1] == "1.0000"
    assert argv[argv.index("--claude-cap") + 1] == "10.0000"
    assert "--claude" in argv  # the runner allows the Claude row and the judge asked for it
    assert TOKEN_ENV not in env  # the child never sees the judge token


def test_the_child_never_sees_the_anthropic_api_key(
    tmp_path: Path, script: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    spawn = FakeSpawn(script, "20261007T120000Z", None)
    runner = Runner(
        tmp_path / "runs",
        spawn=spawn,
        environ={**_environ(), "ANTHROPIC_API_KEY": "sk-ant-test"},
        clock=lambda: NOW,
        claude_cli=True,
    )
    served = Served(runner)
    try:
        assert served.post_run(payload={"kind": "gauntlet", "preset": "small"})[0] == 202
        _finish(served)
        _, env = spawn.calls[0]
        assert "ANTHROPIC_API_KEY" not in env
        assert TOKEN_ENV not in env
        _, _, events = served.request("GET", "/runs/20261007T120000Z/events")
        assert "api key in child env: False" in events
    finally:
        served.close()


def test_a_no_claude_runner_never_runs_the_claude_row(tmp_path: Path, script: Path) -> None:
    spawn = FakeSpawn(script, "20261007T120000Z", None)
    runner = Runner(
        tmp_path / "runs",
        claude_allowed=False,
        spawn=spawn,
        environ=_environ(),
        clock=lambda: NOW,
        claude_cli=False,
    )
    job = runner.start("gauntlet", "small", claude_row=True)
    with job.cond:
        job.cond.wait_for(lambda: job.done, timeout=20)
    assert "--no-claude" in spawn.calls[0][0] and "--claude" not in spawn.calls[0][0]


def _past_run(root: Path, run_id: str, *, report: Mapping[str, Any] | None, ledger: Any) -> None:
    run = root / run_id
    run.mkdir(parents=True)
    if report is not None:
        (run / "report.json").write_text(json.dumps(report), encoding="utf-8")
    if ledger:
        (run / "ledger.jsonl").write_text(
            "".join(json.dumps(row) + "\n" for row in ledger), encoding="utf-8"
        )


def test_the_daily_cap_is_read_from_the_runs_records_and_refuses(make: Any, tmp_path: Path) -> None:
    root = tmp_path / "runs"
    _past_run(root, "20261007T010000Z", report={"cost_usd": {"claude": 9.0}}, ledger=None)
    # an unfinished run counts by its ledger; Athena's own engine names map to the purses
    _past_run(
        root,
        "20261007T020000Z",
        report=None,
        ledger=[
            {"engine": "claude_code", "cost_usd": 6.5},
            {"engine": "nebius", "cost_usd": 0.25},
            {"engine": "nemotron", "cost_usd": None},
        ],
    )
    _past_run(root, "20261006T230000Z", report={"cost_usd": {"claude": 99.0}}, ledger=None)
    spent = day_spend(root, "20261007")
    assert spent == {"nemotron": 0.25, "claude": 15.5}
    s, spawn = make(claude_cli=True)
    status, body = s.post_run()
    assert status == 429 and body["error"] == "budget_exhausted"
    assert "claude $15.50 of $15.00" in body["detail"]
    assert spawn.calls == []


def test_a_runs_caps_are_lowered_to_the_days_remainder(make: Any, tmp_path: Path) -> None:
    _past_run(
        tmp_path / "runs",
        "20261007T010000Z",
        report={"cost_usd": {"nemotron": 2.6, "claude": 1.0}},
        ledger=None,
    )
    s, spawn = make(claude_cli=True)
    assert s.post_run()[0] == 202
    _finish(s)
    argv = spawn.calls[0][0]
    assert argv[argv.index("--nemotron-cap") + 1] == "0.4000"
    assert argv[argv.index("--claude-cap") + 1] == "10.0000"


# --- the stream ------------------------------------------------------------------------------


def test_sse_frames_are_one_json_line_each() -> None:
    frame = sse_frame(3, "line", {"text": "two\nlines\n\nand a blank"})
    assert frame.endswith("\n\n") and frame.count("\n") == 4
    assert _frames(frame) == [
        {"id": 3, "event": "line", "data": {"text": "two\nlines\n\nand a blank"}}
    ]


def test_a_runs_events_stream_live_and_end_with_its_exit(make: Any) -> None:
    s, _ = make(code=1)
    status, body = s.post_run()
    assert status == 202
    status, headers, text = s.request("GET", body["events"])
    assert status == 200 and headers["content-type"].startswith("text/event-stream")
    assert headers["connection"] == "close"
    frames = _frames(text)
    kinds = [f["event"] for f in frames]
    assert kinds[0] == "start" and kinds[-1] == "end"
    assert [f["id"] for f in frames] == list(range(1, len(frames) + 1))
    calls = [f["data"] for f in frames if f["event"] == "call"]
    assert len(calls) == 2
    assert calls[1]["purse"] == "nemotron" and calls[1]["error_reason"] == "engine_error"
    assert all("excerpt" not in call for call in calls)  # model output stays on disk
    end = frames[-1]["data"]
    assert end["exit_code"] == 1 and "breach" in end["meaning"] and end["report"] is True
    # the child names its run by absolute path; the stream shows only the runs directory's name
    root = s.runner.runs_root.resolve()
    assert root.as_posix() not in text and str(root) not in text
    assert f"gauntlet run -> {root.name}/20261007T120000Z" in frames[0]["data"]["text"]


def test_a_past_run_replays_from_its_ledger(make: Any, tmp_path: Path) -> None:
    rows = [{"engine": "nemotron", "role": "attacker", "cost_usd": 0.001}] * (MAX_CALL_EVENTS + 5)
    _past_run(tmp_path / "runs", "20261006T010000Z", report={"run_id": "x"}, ledger=rows)
    s, _ = make()
    status, _, text = s.request("GET", "/runs/20261006T010000Z/events")
    assert status == 200
    frames = _frames(text)
    assert len(frames) == MAX_CALL_EVENTS + 1
    end = frames[-1]
    assert end["event"] == "end" and end["data"]["replay"] is True
    assert end["data"]["footer"] == f"(showing {MAX_CALL_EVENTS} of {MAX_CALL_EVENTS + 5})"


# --- reading ---------------------------------------------------------------------------------


def test_the_listing_is_newest_first_and_announces_its_bound(make: Any, tmp_path: Path) -> None:
    root = tmp_path / "runs"
    for minute in range(25):
        _past_run(
            root,
            f"20261005T12{minute:02d}00Z",
            report={"run_id": "x", "prototype": "gauntlet", "proof": {}},
            ledger=None,
        )
    (root / "not-a-run").mkdir()
    s, _ = make()
    _, _, text = s.request("GET", "/runs?limit=20")
    listing = json.loads(text)
    assert listing["shown"] == 20 and listing["total"] == 25
    assert listing["footer"] == "(showing 20 of 25)"
    ids = [r["run_id"] for r in listing["runs"]]
    assert ids == sorted(ids, reverse=True) and ids[0] == "20261005T122400Z"
    _, _, text = s.request("GET", "/runs?limit=50")
    assert json.loads(text)["footer"] is None


def test_a_run_id_is_never_a_path(make: Any) -> None:
    s, _ = make()
    for path in ("/runs/..%2F..%2Fsecrets", "/runs/../../etc", "/runs/20261007T120000Z/../x"):
        status, _, _ = s.request("GET", path)
        assert status == 404


def test_a_hostile_payload_stays_inert(make: Any) -> None:
    s, _ = make()
    assert s.post_run()[0] == 202
    _finish(s)
    # the report is JSON, never sniffed as HTML, and fenced by a CSP that runs nothing
    status, headers, text = s.request("GET", "/runs/20261007T120000Z")
    assert status == 200
    assert headers["content-type"].startswith("application/json")
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["content-security-policy"].startswith("default-src 'none'")
    assert json.loads(text)["attacks"][0]["payload"] == HOSTILE
    # the page is static: no run data is ever spliced into its HTML
    _, page_headers, page = s.request("GET", "/")
    assert HOSTILE not in page and "pwned" not in page
    nonce = re.search(r"script-src 'nonce-([^']+)'", page_headers["content-security-policy"])
    assert nonce is not None
    assert page.count("<script") == 1 and f'<script nonce="{nonce.group(1)}">' in page
    assert (
        "'unsafe-inline'"
        not in page_headers["content-security-policy"].split("script-src")[1].split(";")[0]
    )
    _, second, _ = s.request("GET", "/")
    assert second["content-security-policy"] != page_headers["content-security-policy"]


def test_the_page_renders_run_text_only_as_text() -> None:
    source = page_html()
    script = source.split("<script", 1)[1]
    for sink in (
        "innerHTML",
        "outerHTML",
        "insertAdjacentHTML",
        "document.write",
        "eval(",
        "new Function",
    ):
        assert sink not in script, sink
    assert "textContent" in script
    assert "https://" not in source.replace("https://fonts.googleapis.com", "")  # no external fetch


def test_no_secret_in_any_response(make: Any) -> None:
    s, _ = make()
    assert s.post_run()[0] == 202
    bodies = []
    _, _, text = s.request("GET", "/runs/20261007T120000Z/events")
    bodies.append(text)
    _finish(s)
    for path in ("/", "/health", "/status", "/runs", "/runs/20261007T120000Z"):
        bodies.append(s.request("GET", path)[2])
    bodies.append(s.request("GET", "/runs/20261007T120000Z/events")[2])  # live job, replayed
    bodies.append(json.dumps(s.post_run()[1]))
    joined = "\n".join(bodies)
    assert "generating: the key is [redacted]" in joined  # the leak happened, and was redacted
    assert KEY not in joined and TOKEN not in joined
    assert "judge token in child env: False" in joined


def test_a_childs_line_never_shows_the_hosts_runs_path(tmp_path: Path) -> None:
    root = tmp_path / "runs"
    runner = Runner(root, environ=_environ(), claude_cli=False)
    line = f"gauntlet run -> {root.resolve().as_posix()}/20261007T120000Z key {KEY}"
    assert runner.scrub(line) == "gauntlet run -> runs/20261007T120000Z key [redacted]"
    assert runner.scrub(str(root.resolve() / "x")).startswith("runs")


# --- hosted mode and cancel (ADR 0039) ----------------------------------------------------------


def _status(s: Served) -> dict[str, Any]:
    return dict(json.loads(s.request("GET", "/status")[2]))


def test_status_says_what_the_host_can_do(make: Any, tmp_path: Path, script: Path) -> None:
    hosted, _ = make()  # no claude CLI found
    status = _status(hosted)
    assert status["mode"] == "hosted" and status["runs_public"] is True
    caps = status["capabilities"]
    assert caps["mode"] == "hosted" and caps["claude_cli"] is False
    assert caps["kinds"] == ["gauntlet"] and "Haiku" in caps["refused"]["characters"]
    assert caps["key_present"] is True and caps["proof2"].startswith("n/a")
    assert "judge:control" not in caps["roles"] and status["claude_row"] is False
    assert list(status["presets"]) == ["gauntlet"]
    assert status["run_caps_usd"] == {"nemotron": 1.0, "claude": 0.0}

    full, _ = make(claude_cli=True)
    caps = _status(full)["capabilities"]
    assert caps["mode"] == "full" and caps["kinds"] == ["gauntlet", "characters"]
    assert caps["refused"] == {} and "judge:control" in caps["roles"]

    # the flag forces hosted even where a claude CLI exists
    flagged = Runner(
        tmp_path / "flagged",
        environ={**_environ(), HOSTED_ENV: "1"},
        claude_cli=True,
        spawn=FakeSpawn(script, "20261007T120000Z", None),
    )
    assert flagged.hosted and flagged.capabilities()["hosted_flag"] is True
    assert Runner(tmp_path / "x", environ=_environ(), claude_cli=True, force_hosted=True).hosted


def test_hosted_refuses_characters_and_still_lists_recorded_ones(make: Any, tmp_path: Path) -> None:
    _past_run(
        tmp_path / "runs",
        "20261006T090000Z",
        report={
            "run_id": "20261006T090000Z",
            "prototype": "characters",
            "proof": {"fidelity": {"rate": 0.9, "pass": True}},
            "conversations": [{"id": "c1"}],
        },
        ledger=None,
    )
    s, spawn = make()
    status, body = s.post_run(payload={"kind": "characters", "preset": "small"})
    assert status == 422 and body["error"] == "not_on_this_host"
    assert "Haiku" in body["detail"] and "Recorded Characters runs" in body["detail"]
    assert spawn.calls == []
    runs = json.loads(s.request("GET", "/runs")[2])["runs"]
    assert runs[0]["prototype"] == "characters" and runs[0]["status"] == "done"
    assert runs[0]["mode"] == "full"  # recorded before modes: it had the control
    assert s.request("GET", "/runs/20261006T090000Z")[0] == 200


def test_a_hosted_gauntlet_runs_without_claude_and_with_no_claude_money(
    make: Any, tmp_path: Path
) -> None:
    # Claude's day is spent, and that does not matter hosted: nothing runs on Claude
    _past_run(
        tmp_path / "runs", "20261007T010000Z", report={"cost_usd": {"claude": 99.0}}, ledger=None
    )
    s, spawn = make()
    status, body = s.post_run(payload={"kind": "gauntlet", "preset": "small", "claude": True})
    assert status == 202, body
    assert body["mode"] == "hosted" and body["claude_row"] is False
    _finish(s)
    argv, env = spawn.calls[0]
    assert "--no-claude" in argv and "--no-control" in argv and "--claude" not in argv
    assert argv[argv.index("--claude-cap") + 1] == "0.0000"
    assert env[HOSTED_ENV] == "1"


def test_cancel_takes_the_token_kills_the_child_and_marks_the_run(
    make: Any, tmp_path: Path
) -> None:
    gate = tmp_path / "never"  # the fake run waits on this forever
    s, _ = make(gate=gate)
    status, body = s.post_run()
    assert status == 202
    run_id = body["run_id"]
    cancel = f"/runs/{run_id}/cancel"
    assert s.request("POST", cancel)[0] == 401
    wrong = {"Authorization": "Bearer wrong-token-wrong"}
    assert s.request("POST", cancel, b"", wrong)[0] == 401
    assert s.runner.busy()  # neither attempt touched the run
    ok = {"Authorization": f"Bearer {TOKEN}"}
    assert s.request("POST", "/runs/20261001T000000Z/cancel", b"", ok)[0] == 404
    status, _, text = s.request("POST", cancel, b"", ok)
    assert status == 200, text
    out = json.loads(text)
    assert out["cancelled"] is True and out["done"] is True
    job = s.runner.current
    assert job is not None and job.process is not None and job.process.poll() is not None
    report = json.loads(s.request("GET", f"/runs/{run_id}")[2])
    assert report["cancelled"] is True and report["status"] == "cancelled"
    assert report["mode"] == "hosted"
    assert report["cost_usd"] == {"nemotron": 0.03, "claude": 0.0}  # read from its ledger
    assert report["calls"] == 2 and "proof" not in report
    listing = json.loads(s.request("GET", "/runs")[2])
    assert listing["runs"][0]["status"] == "cancelled"
    frames = _frames(s.request("GET", f"/runs/{run_id}/events")[2])
    end = frames[-1]["data"]
    assert frames[-1]["event"] == "end" and end["meaning"] == "cancelled by a judge"
    assert end["cancelled"] is True
    # a finished run cannot be cancelled, and the day's spend still counts the cancelled run
    assert s.request("POST", cancel, b"", ok)[0] == 409
    assert _status(s)["daily"]["nemotron"]["spent_usd"] == 0.03


def test_cancel_is_off_without_a_configured_token(make: Any) -> None:
    s, _ = make(token=None)
    status, _, text = s.request(
        "POST", "/runs/20261007T120000Z/cancel", b"", {"Authorization": "Bearer x-x-x-x-x"}
    )
    assert status == 403 and json.loads(text)["error"] == "triggering_off"


def test_the_page_greys_out_what_the_host_cannot_run() -> None:
    script = page_html().split("<script", 1)[1]
    for needed in ("capabilities", "refused", "/cancel", "runs_public", "valid_rate", ".na"):
        assert needed in script, needed
