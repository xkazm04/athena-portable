"""WP-V: the readers' request shapes and the run, offline (a fake HTTP post, a fake CLI runner)."""

from __future__ import annotations

import json
import struct
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from athena.adopt.documents import DOCUMENT_SYSTEM, DOCUMENT_TOOLS, document_prompt
from athena.contracts.adopt import Tier
from athena.harness.tokenfactory import SUPER_VL_MODEL, HttpReply
from athena.proving.adopt_tiers.scenarios import SCENARIOS_DIR, load_scenario
from athena.proving.budget import CLAUDE, NEMOTRON, Budget
from athena.proving.docread.__main__ import main
from athena.proving.docread.corpus import MAX_EDGE, Unit
from athena.proving.docread.read import (
    ClaudeDocRole,
    claude_tier,
    doc_slots,
    read_claude,
    read_vl,
)
from athena.proving.docread.run import Config, open_run, run_read, run_score
from athena.proving.docread.score import Reading
from athena.proving.roles import ProcessResult, RoleCaller
from athena.proving.runlog import RunLog

S = load_scenario(SCENARIOS_DIR / "easy-data-broker.json")
UNIT = Unit(S.id, "letter", "clean", "l.png", "l.png", ("f-former-name", "t-family"))


def _png(width: int, height: int) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", width, height)
    )


def _caller() -> RoleCaller:
    return RoleCaller(Budget(caps={NEMOTRON: 1.0, CLAUDE: 1.0}), RunLog())


def _vl_body(content: str, *, finish: str = "stop") -> bytes:
    return json.dumps(
        {
            "model": SUPER_VL_MODEL,
            "choices": [{"message": {"content": content}, "finish_reason": finish}],
            "usage": {"prompt_tokens": 2000, "completion_tokens": 40},
        }
    ).encode()


class Post:
    def __init__(self, body: bytes, status: int = 200) -> None:
        self.body, self.status = body, status
        self.sent: list[dict[str, Any]] = []

    def __call__(
        self, url: str, headers: Mapping[str, str], body: bytes, timeout: float
    ) -> HttpReply:
        self.sent.append({"url": url, "headers": dict(headers), "body": json.loads(body)})
        return HttpReply(status=self.status, body=self.body)


def test_vl_sends_an_image_part_and_reads_the_strict_json(tmp_path: Path) -> None:
    (tmp_path / "l.png").write_bytes(_png(992, 1404))
    post = Post(_vl_body('```json\n{"f-former-name": "Priya Iyer", "t-family": ""}\n```'))
    reading = read_vl(_caller(), S, UNIT, tmp_path, post=post, api_key="k")
    assert reading.values == {"f-former-name": "Priya Iyer"}  # a blank is no value
    assert reading.cost_usd is not None and reading.cost_usd > 0
    sent = post.sent[0]["body"]
    assert sent["model"] == SUPER_VL_MODEL
    assert sent["chat_template_kwargs"] == {"enable_thinking": False}
    parts = sent["messages"][1]["content"]
    assert [p["type"] for p in parts] == ["text", "image_url"]
    assert parts[1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert "f-former-name" in parts[0]["text"]
    assert post.sent[0]["headers"]["Authorization"] == "Bearer k"
    assert "Bearer" not in json.dumps(sent)  # the key travels in the header only


def test_vl_thinking_flag_omits_the_off_switch(tmp_path: Path) -> None:
    (tmp_path / "l.png").write_bytes(_png(992, 1404))
    post = Post(_vl_body("{}"))
    read_vl(_caller(), S, UNIT, tmp_path, thinking=True, post=post, api_key="k")
    assert "chat_template_kwargs" not in post.sent[0]["body"]


def test_vl_refuses_to_send_a_picture_over_the_edge_limit(tmp_path: Path) -> None:
    (tmp_path / "l.png").write_bytes(_png(MAX_EDGE + 1, 900))
    post = Post(_vl_body("{}"))
    reading = read_vl(_caller(), S, UNIT, tmp_path, post=post, api_key="k")
    assert post.sent == [] and reading.values is None and reading.error_reason == "engine_error"


def test_vl_bad_json_is_scored_empty_not_void(tmp_path: Path) -> None:
    (tmp_path / "l.png").write_bytes(_png(992, 1404))
    reading = read_vl(
        _caller(), S, UNIT, tmp_path, post=Post(_vl_body("I see a letter.")), api_key="k"
    )
    assert reading.values == {} and reading.bad_answer


def test_vl_http_failure_and_length_stop_are_void(tmp_path: Path) -> None:
    (tmp_path / "l.png").write_bytes(_png(992, 1404))
    assert read_vl(_caller(), S, UNIT, tmp_path, post=Post(b"", 429), api_key="k").values is None
    cut = Post(_vl_body('{"f-former-name": "Pri', finish="length"))
    assert read_vl(_caller(), S, UNIT, tmp_path, post=cut, api_key="k").values is None


def _claude_runner(findings: list[dict[str, Any]], calls: list[dict[str, Any]]):  # type: ignore[no-untyped-def]
    def run(argv: Sequence[str], stdin: str, timeout: float, cwd: str | None) -> ProcessResult:
        assert cwd is not None
        calls.append(
            {
                "argv": list(argv),
                "stdin": stdin,
                "cwd": cwd,
                "files": sorted(
                    p.relative_to(cwd).as_posix() for p in Path(cwd).rglob("*") if p.is_file()
                ),
            }
        )
        record = {
            "result": json.dumps({"summary": "a letter", "findings": findings}),
            "total_cost_usd": 0.12,
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
        return ProcessResult(0, json.dumps(record))

    return run


def test_claude_control_is_the_documents_lane_read_only(tmp_path: Path) -> None:
    (tmp_path / "l.png").write_bytes(_png(10, 10))
    calls: list[dict[str, Any]] = []
    findings = [
        {"text": "former name", "slot_ids": ["f-former-name"], "value": "Priya Iyer"},
        {"text": "again", "slot_ids": ["f-former-name"], "value": "someone else"},
    ]
    tier = Tier(model="claude-sonnet-5-5", effort="low")
    runner = _claude_runner(findings, calls)
    reading = read_claude(_caller(), S, UNIT, tmp_path, tier, run=runner, executable="claude")
    assert reading.values == {"f-former-name": "Priya Iyer"}  # the first value for a slot wins
    assert reading.cost_usd == 0.12
    call = calls[0]
    argv = call["argv"]
    assert argv[argv.index("--tools") + 1] == ",".join(DOCUMENT_TOOLS) == "Read"
    assert argv[argv.index("--allowedTools") + 1] == "Read"
    assert argv[argv.index("--model") + 1] == "claude-sonnet-5-5"
    assert argv[argv.index("--effort") + 1] == "low"
    assert argv[argv.index("--output-format") + 1] == "json"
    # exactly the lane's prompt, and the one document (alone) in the working dir
    assert call["stdin"] == document_prompt(S.playbook, doc_slots(S), "docs/d1-l.png")
    assert call["files"] == ["docs/d1-l.png"]
    assert DOCUMENT_SYSTEM  # imported, not copied


def test_claude_role_takes_the_research_tier_from_tiers_json() -> None:
    tier = claude_tier()
    assert tier.model.startswith("claude-")
    assert ClaudeDocRole(Path("x"), "docs/x", tier).model == tier.model


def test_claude_failure_is_void() -> None:
    def broken(argv: Sequence[str], stdin: str, timeout: float, cwd: str | None) -> ProcessResult:
        raise TimeoutError

    import tempfile

    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "l.png").write_bytes(_png(10, 10))
        tier = Tier("claude-sonnet-5-5", "low")
        reading = read_claude(_caller(), S, UNIT, Path(d), tier, run=broken)
    assert reading.values is None and reading.error_reason == "timeout"


# --- the run -------------------------------------------------------------------------------


def test_dry_run_end_to_end_writes_a_report_without_none(tmp_path: Path, capsys: Any) -> None:
    code = main(["all", "--dry", "--out", str(tmp_path)])
    assert code == 0
    (run_dir,) = list(tmp_path.iterdir())
    report = json.loads((run_dir / "docread" / "report.json").read_text())
    assert report["dry"] is True and report["run_id"] == run_dir.name
    assert report["proof"]["verdict"] in {"PASS", "KILL", "MIXED"}
    assert report["paired"]["vl"]["units"] == 90 and "models" in report and "cost_usd" in report
    assert "null" not in (run_dir / "docread" / "report.json").read_text()
    assert (run_dir / "docread" / "report.md").read_text().startswith("# docread")
    assert (run_dir / "docread" / "corpus" / "easy-data-broker" / "letter.html").is_file()


def test_read_resumes_and_skips_what_is_answered(tmp_path: Path) -> None:
    config = Config(scenarios=("easy-data-broker",), dry=True, out=str(tmp_path))
    run = open_run(config)
    run_read(run, echo=lambda _s: None)
    first = run.answers.read_text().splitlines()
    run_read(run, echo=lambda _s: None)
    assert run.answers.read_text().splitlines() == first
    report = run_score(run)
    assert report["paired"]["claude"]["units"] == 10


def test_live_read_needs_a_key_and_a_cli(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.delenv("NEBIUS_API_KEY", raising=False)
    monkeypatch.chdir(tmp_path)
    run = tmp_path / "r"
    assert main(["read", "--run", str(run), "--reader", "vl"]) == 2


def test_a_dry_runs_answers_are_never_scored_as_a_measurement(tmp_path: Path) -> None:
    dry = Config(scenarios=("easy-data-broker",), degradations=("clean",), dry=True)
    run = open_run(Config(**{**dry.__dict__, "out": str(tmp_path)}))
    run_read(run, echo=lambda _s: None)
    # `score --run <dir>` without --dry: the fixture answers still make a dry report.
    rescored = open_run(Config(**{**dry.__dict__, "dry": False, "run": str(run.root.parent)}))
    report = run_score(rescored, tier=Tier("claude-sonnet-5-5", "low"))
    assert report["dry"] is True
    assert "effort" not in report["models"].get("claude", "")


def test_a_live_read_does_not_take_a_dry_answer_as_done(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setenv("NEBIUS_API_KEY", "k")  # the post below is a fake; nothing leaves
    dry = Config(
        scenarios=("easy-data-broker",), degradations=("clean",), readers=("vl",), dry=True
    )
    run = open_run(Config(**{**dry.__dict__, "out": str(tmp_path)}))
    run_read(run, echo=lambda _s: None)
    post = Post(_vl_body("{}"))
    live = open_run(
        Config(**{**dry.__dict__, "dry": False, "run": str(run.root.parent)}), post=post
    )
    for unit in live.units:
        (live.corpus / unit.image).parent.mkdir(parents=True, exist_ok=True)
        (live.corpus / unit.image).write_bytes(_png(800, 1100))
    run_read(live, echo=lambda _s: None)
    assert len(post.sent) == len(live.units) == 3
    assert run_score(live)["dry"] is False


def test_a_resumed_read_keeps_the_spend_its_ledger_already_holds(
    tmp_path: Path, monkeypatch: Any
) -> None:
    monkeypatch.setenv("NEBIUS_API_KEY", "k")  # the post below is a fake; nothing leaves
    config = Config(
        scenarios=("easy-data-broker",),
        degradations=("clean",),
        readers=("vl",),
        nemotron_cap=0.5,
        out=str(tmp_path),
    )
    post = Post(_vl_body("{}"))
    run = open_run(config, post=post)
    for unit in run.units:
        (run.corpus / unit.image).parent.mkdir(parents=True, exist_ok=True)
        (run.corpus / unit.image).write_bytes(_png(800, 1100))
    # An earlier session of this run already spent more than the cap, then was killed.
    row = {"role": "docread.vl", "engine": NEMOTRON, "model": SUPER_VL_MODEL, "cost_usd": 0.6}
    (run.root / "ledger.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
    budget, _ = run_read(run, echo=lambda _s: None)
    assert post.sent == []
    assert budget.spent(NEMOTRON) >= 0.6


def test_the_report_names_the_claude_model_that_answered(tmp_path: Path) -> None:
    config = Config(
        scenarios=("easy-data-broker",),
        degradations=("clean",),
        readers=("claude",),
        out=str(tmp_path),
    )
    run = open_run(config)
    answered = Reading("claude", run.units[0].id, {}, model="claude-sonnet-5-5", cost_usd=0.01)
    run.answers.write_text(json.dumps(answered.to_json()) + "\n", encoding="utf-8")
    # tiers.json has moved on since the read: the report must not name today's tier.
    moved = run_score(run, tier=Tier("claude-opus-9", "high"))["models"]["claude"]
    assert moved.startswith("claude-sonnet-5-5") and "claude-opus-9" in moved
    assert "effort high" not in moved
    same = run_score(run, tier=Tier("claude-sonnet-5-5", "low"))["models"]["claude"]
    assert same == "claude-sonnet-5-5 (effort low, Read only)"
