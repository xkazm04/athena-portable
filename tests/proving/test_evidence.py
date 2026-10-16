"""A benched playbook's evidence: the narration, the plan, the tools and the index (ADR 0055).

Nothing here speaks, records or encodes: the narration is pure, ``--dry`` runs no tool, and
:func:`verify` is read against indexes written by hand into a copy of a shipped playbook, and the
storyboard's encoder is driven by a stand-in for ffmpeg that writes a file of a chosen size. The
committed indexes are held to schema 1 or 2, their thumbnails and stills to the size bounds, and
the whole storyboard to its budget.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from athena.channels.voice.home import EXE_SUFFIX, EngineHomes
from athena.proving.playbooks import evidence
from athena.proving.playbooks.__main__ import main
from athena.proving.playbooks.evidence import (
    MAX_SECONDS,
    MIN_SECONDS,
    SCHEMA,
    STORY_MAX_BYTES,
    STORY_TOTAL_MAX_BYTES,
    THUMB_MAX_BYTES,
    EvidenceError,
    Tools,
    choose_voice,
    clause,
    encode_still,
    estimate_seconds,
    find_tools,
    fixture_for,
    narration,
    sample_turns,
    sha256,
    story_caption,
    verify,
    write_story,
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
    """A repository of one shipped playbook, its bench kept and its evidence (index, thumbnail,
    storyboard) dropped.

    The library's taxonomy comes along: a playbook is loaded against the one beside it.
    """
    target = tmp_path / "playbooks" / playbook_id
    shutil.copytree(SHIPPED / playbook_id, target)
    shutil.copyfile(SHIPPED / "taxonomy.json", tmp_path / "playbooks" / "taxonomy.json")
    for name in ("evidence.json", "thumb.jpg"):
        (target / name).unlink(missing_ok=True)
    shutil.rmtree(target / "story", ignore_errors=True)
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


def test_a_run_that_approved_its_cards_never_says_they_waited_unsigned() -> None:
    """``bench --approve all`` approves every card and runs it on the page, and bench.json says so
    in ``approve``. The film's closing words must not say nothing was sent."""
    showcase = _json(SHIPPED / "lien-desk" / "playbook.json")
    bench = _json(SHIPPED / "lien-desk" / "bench.json")
    assert bench["approve"] == "none"
    unsigned = "Every card she filed waited for a person's signature, and nothing was sent."
    assert narration(showcase, bench).endswith(unsigned)

    approved = narration(showcase, {**bench, "approve": "all"})
    assert "nothing was sent" not in approved and "waited for a person's signature" not in approved
    assert approved.endswith(
        "This run approved every card she filed, so each one ran once on the simulated portal; "
        "nothing reached a real person."
    )


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
    # Schema 1, the index as it was before the storyboard: it must keep verifying as it is.
    index = {
        "schema": 1,
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
def test_every_committed_index_has_a_small_thumbnail_and_a_small_storyboard(
    index_path: Path,
) -> None:
    index = _json(index_path)
    playbook_id = index_path.parent.name
    assert index["schema"] in (1, SCHEMA)
    if index["schema"] >= 2:
        story = index["story"]
        assert 3 <= len(story) <= 6
        assert [s["path"] for s in story] == [
            f"playbooks/{playbook_id}/story/{i:02d}.webp" for i in range(1, len(story) + 1)
        ]
        assert (story[0]["caption"], story[0]["turn"]) == ("The abstract", None)
        assert (story[-1]["caption"], story[-1]["turn"]) == ("What she filed", None)
        turns = [s["turn"] for s in story[1:-1]]
        bench = _json(index_path.parent / "bench.json")
        # A stale index may show an earlier run (ADR 0055); only a current one must match the trace.
        if index["bench_run_at"] == bench["run_at"]:
            assert turns == sample_turns(len(bench["trace"]))
        for s in story[1:-1]:
            assert s["caption"].startswith(f"Turn {s['turn']} - "), s["caption"]
        for s in story:
            file = REPO / s["path"]
            assert file.is_file(), f"{s['path']} is committed beside its index"
            assert file.stat().st_size == s["bytes"] <= STORY_MAX_BYTES
            assert sha256(file) == s["sha256"]
        on_disk = sorted(p.name for p in (index_path.parent / "story").glob("*.webp"))
        assert on_disk == [Path(s["path"]).name for s in story], "no still left over"
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


def test_the_whole_storyboard_stays_inside_its_budget() -> None:
    total = sum(p.stat().st_size for p in SHIPPED.glob("*/story/*.webp"))
    assert total <= STORY_TOTAL_MAX_BYTES, f"{total:,} bytes of stills"


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


# --- the storyboard --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("count", "turns"),
    [(0, []), (1, [1]), (2, [1, 2]), (3, [1, 2, 3]), (4, [1, 2, 3, 4]), (9, [1, 4, 6, 9])],
)
def test_turns_are_sampled_evenly_with_the_first_and_the_last(count: int, turns: list[int]) -> None:
    assert sample_turns(count) == turns


def test_a_sample_never_repeats_a_turn_and_never_takes_more_than_four() -> None:
    for count in range(1, 40):
        picked = sample_turns(count)
        assert len(picked) == len(set(picked)) == min(count, 4)
        assert picked[0] == 1 and picked[-1] == count


def test_a_turn_caption_is_the_portal_and_the_first_clause_of_what_was_said() -> None:
    trace: list[dict[str, Any]] = [
        {"portal": "Office", "user": "Lien desk for the week. Start here in the office."},
        {
            "portal": "Procore",
            "user": "",
            "continued": True,
            "said": "I have all **five** jobs; next",
        },
        {"portal": "GCPay", "user": "", "said": ""},
    ]
    assert story_caption(None, trace, result=False) == "The abstract"
    assert story_caption(None, trace, result=True) == "What she filed"
    assert story_caption(1, trace, result=False) == "Turn 1 - Office: Lien desk for the week"
    assert story_caption(2, trace, result=False) == "Turn 2 - Procore, Athena: I have all five jobs"
    assert story_caption(3, trace, result=False) == "Turn 3 - GCPay"


def test_a_long_clause_is_cut_at_a_word_with_an_ellipsis() -> None:
    long = "Deal with every waiver request across the four portals " * 3
    cut = clause(long)
    assert len(cut) <= 80 and cut.endswith("…")
    assert long.startswith(cut[:-1]) and long[len(cut) - 1] == " ", "cut between two words"
    assert clause("Serve C.H. Robinson the $6.5M notice. Then stop") == (
        "Serve C.H. Robinson the $6.5M notice"
    )
    assert clause("Read the rules — all of them") == "Read the rules"


def _fake_ffmpeg(monkeypatch: pytest.MonkeyPatch, size_at: dict[int, int]) -> list[str]:
    """ffmpeg that writes ``size_at[quality]`` bytes (a default otherwise); returns the filters."""
    filters: list[str] = []

    def run(argv: list[str], _what: str, **_kwargs: Any) -> str:
        quality = int(argv[argv.index("-quality") + 1])
        filters.append(argv[argv.index("-vf") + 1])
        Path(argv[-1]).write_bytes(b"w" * size_at.get(quality, STORY_MAX_BYTES + 5_000))
        return ""

    monkeypatch.setattr(evidence, "_run", run)
    return filters


def test_a_still_steps_down_in_quality_until_it_fits(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fake_ffmpeg(monkeypatch, {48: STORY_MAX_BYTES})
    tools = Tools(ffmpeg="ffmpeg", ffprobe="ffprobe", node="node")
    out = tmp_path / "01.webp"
    assert encode_still(tools, tmp_path / "still-01.png", out) == (STORY_MAX_BYTES, 48, None)
    assert out.stat().st_size == STORY_MAX_BYTES


def test_a_still_too_heavy_at_its_full_height_is_cut_shorter(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    filters = _fake_ffmpeg(monkeypatch, {})
    sizes = iter([STORY_MAX_BYTES + 1] * 9 + [20_000])

    def run(argv: list[str], _what: str, **_kwargs: Any) -> str:
        filters.append(argv[argv.index("-vf") + 1])
        Path(argv[-1]).write_bytes(b"w" * next(sizes))
        return ""

    monkeypatch.setattr(evidence, "_run", run)
    tools = Tools(ffmpeg="ffmpeg", ffprobe="ffprobe", node="node")
    size, quality, height = encode_still(tools, tmp_path / "s.png", tmp_path / "s.webp")
    assert (size, quality, height) == (20_000, 36, 440)
    assert "crop=960:'min(ih,440)'" in filters[-1] and "crop" not in filters[0]


def test_an_oversize_still_fails_and_leaves_no_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fake_ffmpeg(monkeypatch, {})
    tools = Tools(ffmpeg="ffmpeg", ffprobe="ffprobe", node="node")
    out = tmp_path / "01.webp"
    with pytest.raises(EvidenceError, match="no WebP under 24,000 bytes even at quality 30"):
        encode_still(tools, tmp_path / "still-01.png", out)
    assert not out.exists()


def _story(root: Path) -> list[dict[str, Any]]:
    """Three stills written by hand into ``root/story`` and their entries."""
    story = []
    for i, (caption, turn) in enumerate(
        [("The abstract", None), ("Turn 1 - Office: Lien desk", 1), ("What she filed", None)],
        start=1,
    ):
        still = root / "story" / f"{i:02d}.webp"
        still.parent.mkdir(exist_ok=True)
        still.write_bytes(b"RIFF a still %d" % i)
        story.append(
            {
                "path": f"playbooks/{root.name}/story/{still.name}",
                "caption": caption,
                "turn": turn,
                "bytes": still.stat().st_size,
                "sha256": sha256(still),
            }
        )
    return story


def test_the_storyboard_rewrites_the_index_to_schema_2_and_keeps_every_other_key(
    tmp_path: Path,
) -> None:
    root = _copy(tmp_path)
    _index(root, str(_json(root / "bench.json")["run_at"]))
    before = _json(root / "evidence.json")
    assert before["schema"] == 1
    story = _story(root)
    write_story(load_playbook(root), tmp_path, story)
    after = _json(root / "evidence.json")
    assert after["schema"] == SCHEMA == 2
    assert after["story"] == story
    assert {k: v for k, v in after.items() if k not in ("schema", "story")} == {
        k: v for k, v in before.items() if k != "schema"
    }
    assert list(after)[: len(before)] == list(before), "the keys keep their order"
    assert b"\r\n" not in (root / "evidence.json").read_bytes()
    [standing] = verify([load_playbook(root)], tmp_path)
    assert (standing.state, standing.notes) == ("current", ())


def test_a_storyboard_needs_an_index_to_join(tmp_path: Path) -> None:
    root = _copy(tmp_path)
    with pytest.raises(EvidenceError, match=r"has no evidence\.json"):
        write_story(load_playbook(root), tmp_path, _story(root))


def test_verify_holds_the_storyboard_to_its_bytes_and_hashes(tmp_path: Path) -> None:
    root = _copy(tmp_path)
    _index(root, str(_json(root / "bench.json")["run_at"]))
    write_story(load_playbook(root), tmp_path, _story(root))
    (root / "story" / "02.webp").write_bytes(b"RIFF a still 9")
    (root / "story" / "03.webp").unlink()
    [standing] = verify([load_playbook(root)], tmp_path)
    assert standing.notes == (
        f"playbooks/{root.name}/story/02.webp does not match its sha256",
        f"playbooks/{root.name}/story/03.webp is missing",
    )
    index = _json(root / "evidence.json")
    del index["story"]
    (root / "evidence.json").write_text(json.dumps(index), encoding="utf-8")
    [standing] = verify([load_playbook(root)], tmp_path)
    assert standing.notes == ("a schema 2 index has no story",)


def test_stills_only_dry_prints_the_storyboard_plan_and_runs_no_tool(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _copy(tmp_path)

    def refuse(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("--dry ran a tool")

    monkeypatch.setattr(subprocess, "run", refuse)
    base = str(tmp_path / "playbooks")
    assert main(["--dir", base, "evidence", "lien-desk", "--stills-only", "--dry"]) == 0
    out = capsys.readouterr().out
    assert "--stills --fixture shipped:lien-desk --turns 1,5,9,13" in out
    assert "playbooks/lien-desk/story/01..06.webp" in out
    assert "schema 2, story added, the rest kept" in out
