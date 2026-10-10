"""A benched playbook's evidence: the narration, the plan, the tools and the index (ADR 0055).

Nothing here speaks, records or encodes: the narration is pure, ``--dry`` runs no tool, and
:func:`verify` is read against indexes written by hand into a copy of a shipped playbook. The
committed indexes are held to schema 1 and their thumbnails to the size bound.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from athena.channels.voice.home import EXE_SUFFIX, EngineHomes
from athena.proving.playbooks.__main__ import main
from athena.proving.playbooks.evidence import (
    MAX_SECONDS,
    MIN_SECONDS,
    SCHEMA,
    THUMB_MAX_BYTES,
    EvidenceError,
    choose_voice,
    estimate_seconds,
    find_tools,
    fixture_for,
    narration,
    sha256,
    verify,
)
from athena.proving.playbooks.spec import load_all, load_playbook

REPO = Path(__file__).resolve().parents[2]
SHIPPED = REPO / "playbooks"


def _json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def _benched() -> list[Path]:
    return sorted(d for d in SHIPPED.iterdir() if (d / "bench.json").is_file())


def _copy(tmp_path: Path, playbook_id: str = "lien-desk") -> Path:
    """A repository of one shipped playbook, its bench kept and its evidence dropped."""
    target = tmp_path / "playbooks" / playbook_id
    shutil.copytree(SHIPPED / playbook_id, target)
    for name in ("evidence.json", "thumb.jpg"):
        (target / name).unlink(missing_ok=True)
    return target


# --- the narration ---------------------------------------------------------------------------


@pytest.mark.parametrize("root", _benched(), ids=lambda p: p.name)
def test_every_benched_playbook_narrates_inside_its_bounds(root: Path) -> None:
    showcase, bench = _json(root / "playbook.json"), _json(root / "bench.json")
    text = narration(showcase, bench)
    assert text == narration(showcase, bench), "the same run always says the same words"
    assert MIN_SECONDS + 5 <= estimate_seconds(text) <= MAX_SECONDS - 5
    score, verdict = bench["score"], bench["verdict"]
    assert str(showcase["title"]) in text
    assert f"found {score['found']} of {score['eligible']}" in text
    assert f"The verdict: {verdict['word']}." in text
    assert "walked past" in text or "no trap" in text
    assert "\n" not in text and "$" not in text, "figures are spelt as they are said"


def test_the_narration_says_the_chore_the_money_the_traps_and_the_time() -> None:
    text = narration(
        _json(SHIPPED / "lien-desk" / "playbook.json"), _json(SHIPPED / "lien-desk" / "bench.json")
    )
    assert text.startswith("The subcontractor's lien desk. This is a chore for a 6-million-dollar")
    assert "416,700 dollars of the 416,700 dollars" in text
    assert "The world held 12 traps, and she walked past 12." in text
    assert "She took 4 minutes. By hand, the same chore takes 25 hours" in text


def test_a_short_run_says_why_it_fell_short() -> None:
    showcase = {"title": "Late parcels", "persona": "A small online shop", "economics": {}}
    bench = {
        "wall_s": 1640,
        "verdict": {
            "word": "short",
            "minutes": 27.3,
            "reasons": ["took 27.3 min, expected at most 25", "1 false claims, allowed 0"],
        },
        "score": {
            "found": 3,
            "eligible": 4,
            "value_found_usd": 455.5,
            "value_total_usd": 612,
            "false_claims": 1,
            "traps_total": 7,
            "traps_filed": 1,
            "trap_ledger": [{"key": "DP-124", "filed": True}],
        },
    }
    text = narration(showcase, bench)
    assert "This is a chore for a small online shop." in text
    assert "455 dollars and 50 cents of the 612 dollars" in text
    assert "She made 1 false claim." in text
    assert "She fell for 1: DP-124." in text
    assert "The verdict: short. Took 27.3 min, expected at most 25; 1 false claims" in text


def test_a_fixture_opens_the_playbook_it_names() -> None:
    assert fixture_for("lien-desk") == "shipped:lien-desk"


# --- the command -----------------------------------------------------------------------------


def test_dry_prints_the_plan_and_runs_no_tool(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _copy(tmp_path)

    def refuse(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("--dry ran a tool")

    monkeypatch.setattr(subprocess, "run", refuse)
    monkeypatch.setattr(subprocess, "Popen", refuse)
    code = main(["--dir", str(tmp_path / "playbooks"), "evidence", "lien-desk", "--dry"])
    out = capsys.readouterr().out
    assert code == 0
    assert (
        "capture: node examples/journey/scripts/capture-playbook.mjs --fixture shipped:lien-desk"
        in out
    )
    assert "evidence/lien-desk/evidence.mp4" in out
    assert "playbooks/lien-desk/evidence.json" in out
    assert not (tmp_path / "evidence").exists()


def test_a_playbook_with_no_bench_is_refused(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    (_copy(tmp_path) / "bench.json").unlink()
    code = main(["--dir", str(tmp_path / "playbooks"), "evidence", "lien-desk", "--dry"])
    assert code == 2
    assert "has no bench.json" in capsys.readouterr().err


def test_one_playbook_or_all_and_not_both(tmp_path: Path) -> None:
    _copy(tmp_path)
    base = str(tmp_path / "playbooks")
    assert main(["--dir", base, "evidence"]) == 2
    assert main(["--dir", base, "evidence", "lien-desk", "--all"]) == 2


def test_a_missing_tool_is_named() -> None:
    def nowhere(_name: str) -> str | None:
        return None

    with pytest.raises(EvidenceError, match="ffmpeg is missing"):
        find_tools({}, which=nowhere)
    with pytest.raises(EvidenceError, match="ffprobe is missing"):
        find_tools({"FFMPEG": "C:/nowhere/ffmpeg.exe"}, which=nowhere)
    with pytest.raises(EvidenceError, match="node is missing"):
        find_tools({"FFMPEG": "ffmpeg", "FFPROBE": "ffprobe"}, which=nowhere)
    tools = find_tools({"FFMPEG": "ff", "FFPROBE": "fp"}, which=lambda n: f"/bin/{n}")
    assert (tools.ffmpeg, tools.ffprobe, tools.node) == ("ff", "fp", "/bin/node")


def test_piper_speaks_only_when_kokoro_is_missing(tmp_path: Path) -> None:
    homes = EngineHomes(root=tmp_path)
    with pytest.raises(EvidenceError, match=r"kokoro is missing .* and so is piper"):
        choose_voice(homes, check=False)
    homes.tts_bin.mkdir(parents=True)
    (homes.tts_bin / f"piper{EXE_SUFFIX}").write_bytes(b"")
    model = homes.tts / "piper" / "en_US-amy-medium"
    model.mkdir(parents=True)
    (model / "en_US-amy-medium.onnx").write_bytes(b"")
    assert choose_voice(homes, check=False).engine == "piper"
    (homes.tts_bin / f"sherpa-onnx-offline-tts{EXE_SUFFIX}").write_bytes(b"")
    kokoro = homes.kokoro_dir
    (kokoro / "espeak-ng-data").mkdir(parents=True)
    for name in ("model.onnx", "voices.bin", "tokens.txt"):
        (kokoro / name).write_bytes(b"")
    voice = choose_voice(homes, check=False)
    assert (voice.engine, voice.voice) == ("kokoro", "af_heart")


# --- verify ----------------------------------------------------------------------------------


def _index(root: Path, run_at: str) -> None:
    showcase, bench = _json(root / "playbook.json"), _json(root / "bench.json")
    thumb = root / "thumb.jpg"
    thumb.write_bytes(b"\xff\xd8 a still \xff\xd9")
    index = {
        "schema": SCHEMA,
        "playbook": root.name,
        "captured_at": "2026-10-09T10:00:00Z",
        "bench_run_at": run_at,
        "narration": {
            "text": narration(showcase, bench),
            "engine": "kokoro",
            "voice": "af_heart",
            "duration_s": 70.0,
        },
        "video": {"path": f"evidence/{root.name}/evidence.mp4", "duration_s": 70.0, "bytes": 1},
        "thumbnail": {
            "path": f"playbooks/{root.name}/thumb.jpg",
            "bytes": thumb.stat().st_size,
            "sha256": sha256(thumb),
        },
    }
    (root / "evidence.json").write_text(json.dumps(index), encoding="utf-8")


def test_verify_says_current_stale_or_missing_against_the_bench(tmp_path: Path) -> None:
    root = _copy(tmp_path)
    repo = tmp_path
    [missing] = verify([load_playbook(root)], repo)
    assert (missing.state, missing.ok) == ("missing", False)
    run_at = str(_json(root / "bench.json")["run_at"])
    _index(root, run_at)
    [current] = verify([load_playbook(root)], repo)
    assert (current.state, current.notes, current.ok) == ("current", (), True)
    _index(root, "2026-10-01T00:00:00Z")
    [stale] = verify([load_playbook(root)], repo)
    assert (stale.state, stale.ok) == ("stale", False)


def test_verify_rehashes_the_media_that_is_here(tmp_path: Path) -> None:
    root = _copy(tmp_path)
    _index(root, str(_json(root / "bench.json")["run_at"]))
    film = tmp_path / "evidence" / root.name / "evidence.mp4"
    film.parent.mkdir(parents=True)
    film.write_bytes(b"not the film that was indexed")
    [standing] = verify([load_playbook(root)], tmp_path)
    assert standing.notes == (f"evidence/{root.name}/evidence.mp4 does not match its sha256",)
    (root / "thumb.jpg").unlink()
    [standing] = verify([load_playbook(root)], tmp_path)
    assert f"playbooks/{root.name}/thumb.jpg is missing" in standing.notes


def test_verify_exits_nonzero_until_every_benched_playbook_is_current(tmp_path: Path) -> None:
    root = _copy(tmp_path)
    base = str(tmp_path / "playbooks")
    assert main(["--dir", base, "evidence", "--all", "--verify"]) == 1
    _index(root, str(_json(root / "bench.json")["run_at"]))
    assert main(["--dir", base, "evidence", "--all", "--verify"]) == 0


def test_check_does_not_fail_a_playbook_that_has_no_evidence_yet(tmp_path: Path) -> None:
    _copy(tmp_path)
    assert main(["--dir", str(tmp_path / "playbooks"), "check"]) == 0


# --- the committed indexes -------------------------------------------------------------------


def _repo_relative(path: str) -> bool:
    return (
        bool(path)
        and not Path(path).is_absolute()
        and ":" not in path
        and "\\" not in path
        and (".." not in Path(path).parts)
    )


@pytest.mark.parametrize(
    "index_path", sorted(SHIPPED.glob("*/evidence.json")), ids=lambda p: p.parent.name
)
def test_every_committed_index_is_schema_1_with_a_small_thumbnail(index_path: Path) -> None:
    index = _json(index_path)
    playbook_id = index_path.parent.name
    assert index["schema"] == SCHEMA
    assert index["playbook"] == playbook_id
    assert index["bench_run_at"], "an index names the bench run it filmed"
    for key in ("text", "engine", "voice", "duration_s", "sha256"):
        assert key in index["narration"], key
    assert index["narration"]["engine"] in ("kokoro", "piper")
    video, thumb = index["video"], index["thumbnail"]
    assert video["path"] == f"evidence/{playbook_id}/evidence.mp4"
    assert thumb["path"] == f"playbooks/{playbook_id}/thumb.jpg"
    for path in (video["path"], thumb["path"]):
        assert _repo_relative(path), path
    file = REPO / thumb["path"]
    assert file.is_file(), f"{thumb['path']} is committed beside its index"
    assert file.stat().st_size == thumb["bytes"] < THUMB_MAX_BYTES
    assert sha256(file) == thumb["sha256"]


def test_the_shipped_playbooks_still_load_with_their_evidence_beside_them() -> None:
    assert len(load_all(SHIPPED)) >= 9


def test_verify_catches_a_rescore_that_kept_the_run_at_but_changed_what_is_said(
    tmp_path: Path,
) -> None:
    root = _copy(tmp_path)
    _index(root, str(_json(root / "bench.json")["run_at"]))
    bench = _json(root / "bench.json")
    bench["rescored_at"] = "2026-10-10T00:00:00Z"
    bench["score"]["false_claims"] = 1
    (root / "bench.json").write_text(json.dumps(bench), encoding="utf-8")
    [standing] = verify([load_playbook(root)], tmp_path)
    assert standing.state == "current"
    assert standing.notes == ("the narration no longer says what the record says: film it again",)
    assert not standing.ok


@pytest.mark.parametrize("name", ["bench.json", "evidence.json"])
@pytest.mark.parametrize("body", ["{not json", "[1, 2]"])
def test_verify_reports_a_malformed_record_instead_of_raising(
    tmp_path: Path, name: str, body: str
) -> None:
    root = _copy(tmp_path)
    _index(root, str(_json(root / "bench.json")["run_at"]))
    (root / name).write_text(body, encoding="utf-8")
    [standing] = verify([load_playbook(root)], tmp_path)
    assert (standing.state, standing.ok) == ("unreadable", False)
    [note] = standing.notes
    assert note.startswith(f"{name} ")


def test_verify_still_reports_the_other_playbooks_and_exits_nonzero(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    other = next(p.name for p in _benched() if p.name != "lien-desk")
    broken = _copy(tmp_path)
    good = _copy(tmp_path, other)
    _index(good, str(_json(good / "bench.json")["run_at"]))
    _index(broken, str(_json(broken / "bench.json")["run_at"]))
    (broken / "bench.json").write_text("{not json", encoding="utf-8")
    standings = verify([load_playbook(broken), load_playbook(good)], tmp_path)
    assert [s.state for s in standings] == ["unreadable", "current"]
    assert main(["--dir", str(tmp_path / "playbooks"), "evidence", "--all", "--verify"]) == 1
    out = capsys.readouterr().out
    assert "lien-desk: unreadable" in out and f"{other}: " in out
