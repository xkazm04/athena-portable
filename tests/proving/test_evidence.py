"""A benched playbook's evidence: the narration, the plan, the tools and the index (ADR 0055, 0137).

Nothing here records or encodes: the narration is pure, ``--dry`` runs no tool, :func:`verify` is
read against indexes written by hand into a copy of a shipped playbook, the storyboard's encoder is
driven by a stand-in for ffmpeg that writes a file of a chosen size, and the speech step by a
stand-in for Kokoro. The committed indexes are held to schema 1, 2 or 3 (schema 3: five stills
under the size bound, no thumbnail), and the whole storyboard to its budget.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import wave
from pathlib import Path
from typing import Any

import pytest

from athena.channels.voice import ether
from athena.channels.voice.home import EXE_SUFFIX, EngineHomes
from athena.proving.playbooks import evidence
from athena.proving.playbooks.__main__ import main
from athena.proving.playbooks.evidence import (
    DRAWING_CAPTION,
    MAX_SECONDS,
    MIN_SECONDS,
    SCHEMA,
    STORY_COUNT,
    STORY_MAX_BYTES,
    STORY_TOTAL_MAX_BYTES,
    STORY_WIDTH,
    EvidenceError,
    Tools,
    Voice,
    choose_voice,
    clause,
    encode_still,
    estimate_seconds,
    find_tools,
    fixture_for,
    narration,
    sample_turns,
    sha256,
    speak,
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
    """A repository of one shipped playbook, its bench kept and its evidence (index, any old
    thumbnail, storyboard) dropped.

    The library's taxonomy comes along: a playbook is loaded against the one beside it.
    """
    target = tmp_path / "playbooks" / playbook_id
    shutil.copytree(SHIPPED / playbook_id, target)
    shutil.copyfile(SHIPPED / "taxonomy.json", tmp_path / "playbooks" / "taxonomy.json")
    for name in ("evidence.json", "thumb.jpg"):
        (target / name).unlink(missing_ok=True)
    shutil.rmtree(target / "story", ignore_errors=True)
    return target


def _says(playbook_id: str, **bench_changes: Any) -> str:
    root = SHIPPED / playbook_id
    return narration(_json(root / "playbook.json"), {**_json(root / "bench.json"), **bench_changes})


# --- the narration ---------------------------------------------------------------------------


@pytest.mark.parametrize("root", _benched(), ids=lambda p: p.name)
def test_every_benched_playbook_narrates_inside_its_bounds(root: Path) -> None:
    showcase, bench = _json(root / "playbook.json"), _json(root / "bench.json")
    text = narration(showcase, bench)
    assert text == narration(showcase, bench), "the same run always says the same words"
    assert MIN_SECONDS + 5 <= estimate_seconds(text) <= MAX_SECONDS - 5
    score, verdict = bench["score"], bench["verdict"]
    assert str(showcase.get("short_title") or showcase["title"]) in text
    assert f"she found {score['found']} of {score['eligible']} items" in text
    assert f"The verdict: {verdict['word']}" in text
    assert "test run" in text
    assert "mistake" in text
    assert "\n" not in text and "$" not in text, "figures are spelt as they are said"


@pytest.mark.parametrize("root", _benched(), ids=lambda p: p.name)
def test_every_narration_uses_the_pages_words(root: Path) -> None:
    """ADR 0133 to 0136: "test run", never "bench"; her time with your review, and a ratio only
    from that sum; a count weight never as dollars."""
    showcase, bench = _json(root / "playbook.json"), _json(root / "bench.json")
    text = narration(showcase, bench)
    assert not re.search(r"bench", text, re.IGNORECASE), "the page says test run, not bench"
    if bench.get("your_time_s"):
        assert "reviewing her cards takes you" in text
    if "times faster" in text:
        assert "even with your review" in text, "no ratio from her wall clock alone"
    kinds = set(showcase["economics"].get("kinds", {}).values())
    if kinds == {"count"}:
        found = text.split(" items", 1)[1].split(".", 1)[0]
        assert "dollar" not in found, "a count weight is never dollars"


def test_the_narration_says_the_chore_the_money_the_mistakes_and_the_time() -> None:
    text = _says("lien-desk")
    assert text.startswith("Lien rights kept on every job. This is a chore for a 6-million-dollar")
    # Protected money is said as protected, not as money back (ADR 0133).
    assert "she found 10 of 10 items: 416,700 dollars of 416,700 dollars protected." in text
    assert "416,700 dollars back" not in text
    assert "The example case set up 12 mistakes for her to make, and she avoided 12." in text
    # The minutes are the latest run's plus the person's review; the hand time is the playbook's.
    assert re.search(
        r"She took \d+ minutes? in the test run, and reviewing her cards takes you \d+ minutes? "
        r"more, so \d+ minutes in all\. By hand, the same chore takes 8 hours, so even with your "
        r"review she is about \d+ times faster\.",
        text,
    )
    # The verdict names the runs it stands on (ADR 0128, 0136).
    assert re.search(
        r"The verdict: exceeds\. .* in (its one test run|\d+ of \d+ test runs)\.", text
    )


def test_money_back_is_said_against_the_example_cases_own_total() -> None:
    text = _says("medical-bills")
    example = _json(SHIPPED / "medical-bills" / "playbook.json")["economics"]["example_usd"]
    assert example == 3423.5
    assert "back of the 3,423 dollars and 50 cents the example case holds" in text


def test_each_kind_of_money_is_said_in_its_own_words() -> None:
    showcase = {
        "title": "Mixed",
        "economics": {
            "example_usd": 100,
            "kinds": {
                "refund": "money_back",
                "guard": "money_protected",
                "fine": "penalty_avoided",
                "screen": "count",
            },
        },
    }
    bench = {
        "wall_s": 120,
        "verdict": {"word": "exceeds"},
        "score": {"found": 4, "eligible": 4},
        "cards": [
            {"action": "refund", "outcome": "correct", "value_usd": 100},
            {"action": "guard", "outcome": "correct", "value_usd": 5000},
            {"action": "fine", "outcome": "correct", "value_usd": 250},
            {"action": "screen", "outcome": "correct", "value_usd": 1},
        ],
    }
    text = narration(showcase, bench)
    assert (
        "4 of 4 items: 100 dollars back of the 100 dollars the example case holds, 5,000 dollars "
        "of 5,000 dollars protected and 250 dollars of 250 dollars in penalties avoided." in text
    )
    assert "1 dollar" not in text, "a count weight is never dollars"


def test_a_count_only_chore_says_no_dollars_and_its_bar_in_items() -> None:
    showcase = {"title": "Notices", "economics": {"kinds": {"mail": "count"}}}
    bench = {
        "wall_s": 60,
        "verdict": {"word": "meets", "expected": {"recall": 0.75}},
        "score": {"found": 3, "eligible": 4},
        "cards": [{"action": "mail", "outcome": "correct", "value_usd": 1}] * 3,
        "missed": [{"action": "mail", "value_usd": 1}],
    }
    text = narration(showcase, bench)
    assert "she found 3 of 4 items." in text and "dollar" not in text
    assert "The bar was 75 percent of what the example case holds." in text
    assert "She cleared the bar this playbook set itself in the latest test run." in text


def test_no_times_faster_from_the_wall_clock_alone() -> None:
    text = _says("lien-desk", your_time_s=0)
    assert "times faster" not in text and "review" not in text
    assert "By hand, the same chore takes 8 hours." in text


def test_a_run_that_approved_its_cards_never_says_they_waited_unsigned() -> None:
    """``bench --approve all`` approves every card and runs it on the page, and bench.json says so
    in ``approve``. The film's closing words must not say nothing was sent."""
    bench = _json(SHIPPED / "lien-desk" / "bench.json")
    assert bench["approve"] == "none"
    unsigned = "Every card she filed waited for a person's signature, and nothing was sent."
    assert _says("lien-desk").endswith(unsigned)

    approved = _says("lien-desk", approve="all")
    assert "nothing was sent" not in approved and "waited for a person's signature" not in approved
    assert approved.endswith(
        "This test run approved every card she filed, so each one ran once on the invented "
        "portal; nothing reached a real person."
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
    assert "455 dollars and 50 cents back of the 612 dollars the example case holds" in text
    assert "She made 1 false claim." in text
    assert "she avoided 6. She made 1: DP-124." in text
    assert (
        "The verdict: short, in its one test run. Took 27.3 min, expected at most 25; "
        "1 false claims" in text
    )


def test_a_playbooks_markdown_and_lab_words_are_read_as_the_page_says_them() -> None:
    showcase = {
        "title": "X",
        "caveat": "- **The bench world** is invented.\n- A second bullet.",
        "economics": {},
    }
    bench = {"wall_s": 60, "verdict": {"word": "exceeds"}, "score": {"found": 1, "eligible": 1}}
    text = narration(showcase, bench)
    assert "The example case is invented." in text
    assert "**" not in text and "- " not in text and "A second bullet" not in text


# --- the speech ------------------------------------------------------------------------------


class _FakeKokoro:
    """Kokoro's shape: ``synthesize`` yields 16-bit PCM, here a fixed ramp per chunk."""

    def __init__(self, _homes: Any, voice: Any) -> None:
        self.voice = voice

    def synthesize(self, chunk: str) -> list[bytes]:
        n = 2400
        return [
            b"".join(
                int((i * 37) % 2000 - 1000).to_bytes(2, "little", signed=True) for i in range(n)
            )
        ]


def _kokoro(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Voice:
    monkeypatch.setattr(evidence, "KokoroTTS", _FakeKokoro)
    monkeypatch.setattr(evidence, "find_voice", lambda name: object())
    return Voice("kokoro", "af_heart", EngineHomes(root=tmp_path))


def _frames(path: Path) -> int:
    with wave.open(str(path), "rb") as wav:
        return wav.getnframes()


def test_the_narration_is_spoken_in_her_halo_when_numpy_is_here(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    if not ether.available():
        pytest.skip("numpy (the voice-fx extra) is not installed: the halo cannot run here")
    voice = _kokoro(monkeypatch, tmp_path)
    natural = speak(voice, "One. Two.", tmp_path / "natural.wav", tone="natural")
    halo = speak(voice, "One. Two.", tmp_path / "halo.wav")
    assert (natural.tone, halo.tone, halo.note) == ("natural", "halo", "")
    assert _frames(tmp_path / "halo.wav") == _frames(tmp_path / "natural.wav"), "length kept"
    assert (tmp_path / "halo.wav").read_bytes() != (tmp_path / "natural.wav").read_bytes()


def test_without_numpy_the_narration_is_natural_and_says_why(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def missing(_pcm: bytes, _rate: int, _tone: str = "halo") -> bytes:
        raise ether.EtherUnavailable("the halo tone needs numpy, which is not installed")

    monkeypatch.setattr(ether, "apply", missing)
    voice = _kokoro(monkeypatch, tmp_path)
    spoken = speak(voice, "One. Two.", tmp_path / "n.wav")
    assert spoken.tone == "natural"
    assert spoken.note.startswith("spoken in her natural tone: the halo tone needs numpy")
    assert spoken.seconds > 0


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
    assert "thumbnail" not in out and "thumb.jpg" not in out
    assert "halo tone" in out
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


def _index(root: Path, run_at: str, *, thumbnail: bool = True) -> None:
    """Schema 1, the index as it was before the storyboard: it must keep verifying as it is."""
    showcase, bench = _json(root / "playbook.json"), _json(root / "bench.json")
    thumb = root / "thumb.jpg"
    thumb.write_bytes(b"\xff\xd8 a still \xff\xd9")
    index: dict[str, Any] = {
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
    }
    if thumbnail:
        index["thumbnail"] = {
            "path": f"playbooks/{root.name}/thumb.jpg",
            "bytes": thumb.stat().st_size,
            "sha256": sha256(thumb),
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


def test_verify_rehashes_the_media_that_is_here_and_no_longer_needs_a_thumbnail(
    tmp_path: Path,
) -> None:
    root = _copy(tmp_path)
    _index(root, str(_json(root / "bench.json")["run_at"]))
    film = tmp_path / "evidence" / root.name / "evidence.mp4"
    film.parent.mkdir(parents=True)
    film.write_bytes(b"not the film that was indexed")
    [standing] = verify([load_playbook(root)], tmp_path)
    assert standing.notes == (f"evidence/{root.name}/evidence.mp4 does not match its sha256",)
    film.unlink()
    # The thumbnail is retired (ADR 0137): an old index's thumb.jpg may already be gone.
    (root / "thumb.jpg").unlink()
    [standing] = verify([load_playbook(root)], tmp_path)
    assert (standing.notes, standing.ok) == ((), True)
    (root / "thumb.jpg").write_bytes(b"another still")
    [standing] = verify([load_playbook(root)], tmp_path)
    assert standing.notes == (f"playbooks/{root.name}/thumb.jpg does not match its sha256",)


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


def _held_story(index_path: Path, index: dict[str, Any]) -> None:
    """Every still committed beside its index, at its bytes and hash, and none left over."""
    for s in index["story"]:
        assert _repo_relative(s["path"]), s["path"]
        file = REPO / s["path"]
        assert file.is_file(), f"{s['path']} is committed beside its index"
        assert file.stat().st_size == s["bytes"] <= STORY_MAX_BYTES
        assert sha256(file) == s["sha256"]
    on_disk = sorted(p.name for p in (index_path.parent / "story").glob("*.webp"))
    assert on_disk == [Path(s["path"]).name for s in index["story"]], "no still left over"


@pytest.mark.parametrize(
    "index_path", sorted(SHIPPED.glob("*/evidence.json")), ids=lambda p: p.parent.name
)
def test_every_committed_index_has_a_small_storyboard(index_path: Path) -> None:
    index = _json(index_path)
    playbook_id = index_path.parent.name
    bench = _json(index_path.parent / "bench.json")
    assert index["schema"] in (1, 2, SCHEMA)
    assert index["playbook"] == playbook_id
    assert index["bench_run_at"], "an index names the bench run it shows"
    if index["schema"] == SCHEMA:
        # ADR 0137: the drawing and up to four turns, numbered, no thumbnail, film keys optional.
        assert "thumbnail" not in index
        story = index["story"]
        assert 1 <= len(story) <= STORY_COUNT
        assert [s["n"] for s in story] == list(range(1, len(story) + 1))
        assert [s["path"] for s in story] == [
            f"playbooks/{playbook_id}/story/{i:02d}.webp" for i in range(1, len(story) + 1)
        ]
        assert (story[0]["kind"], story[0]["caption"]) == ("drawing", DRAWING_CAPTION)
        assert "turn" not in story[0]
        for s in story[1:]:
            assert s["kind"] == "turn"
            assert s["caption"].startswith(f"Turn {s['turn']} - "), s["caption"]
        if index["bench_run_at"] == bench["run_at"]:
            assert [s["turn"] for s in story[1:]] == sample_turns(len(bench["trace"]))
        _held_story(index_path, index)
        for key in ("narration", "video"):
            assert index.get(key, {}) is not None, f"an absent {key} is left out, not null"
        return
    # Schema 1 and 2, while the stills are re-shot: the old shape, read as it was.
    if index["schema"] == 2:
        story = index["story"]
        assert 3 <= len(story) <= 6
        assert (story[0]["caption"], story[0]["turn"]) == ("The abstract", None)
        assert (story[-1]["caption"], story[-1]["turn"]) == ("What she filed", None)
        if index["bench_run_at"] == bench["run_at"]:
            assert [s["turn"] for s in story[1:-1]] == sample_turns(len(bench["trace"]))
        _held_story(index_path, index)
    for key in ("text", "engine", "voice", "duration_s", "sha256"):
        assert key in index["narration"], key
    assert index["video"]["path"] == f"evidence/{playbook_id}/evidence.mp4"


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


@pytest.mark.parametrize("narrated", ["the words, flattened", None, ["a", "list"]])
def test_verify_reads_a_narration_that_is_not_an_object_as_a_fault_not_a_crash(
    tmp_path: Path, narrated: Any
) -> None:
    """The narration entry is read like the video's: anything but an object is an entry with no
    text. Before: ``.get`` on a string raised, and ``--verify`` reported no playbook at all."""
    root = _copy(tmp_path)
    _index(root, str(_json(root / "bench.json")["run_at"]))
    index = _json(root / "evidence.json")
    index["narration"] = narrated
    (root / "evidence.json").write_text(json.dumps(index), encoding="utf-8")
    [standing] = verify([load_playbook(root)], tmp_path)
    assert standing.state == "current" and not standing.ok
    assert "the narration no longer says what the record says: film it again" in standing.notes


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
    assert STORY_COUNT == 5, "the drawing and four turns, no still 06"


def test_a_caption_is_the_drawing_or_the_portal_and_the_first_clause_of_what_was_said() -> None:
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
    assert story_caption(None, trace) == DRAWING_CAPTION == "How it runs"
    assert story_caption(1, trace) == "Turn 1 - Office: Lien desk for the week"
    assert story_caption(2, trace) == "Turn 2 - Procore, Athena: I have all five jobs"
    assert story_caption(3, trace) == "Turn 3 - GCPay"


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


def test_a_still_steps_down_in_quality_until_it_fits_and_is_never_cut(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    filters = _fake_ffmpeg(monkeypatch, {52: STORY_MAX_BYTES})
    tools = Tools(ffmpeg="ffmpeg", ffprobe="ffprobe", node="node")
    out = tmp_path / "01.webp"
    assert encode_still(tools, tmp_path / "still-01.png", out) == (STORY_MAX_BYTES, 52)
    assert out.stat().st_size == STORY_MAX_BYTES
    assert filters == [f"scale={STORY_WIDTH}:-2:flags=lanczos"] * 4, "75, 68, 60, then 52"
    assert STORY_WIDTH == 1280 and STORY_MAX_BYTES == 44_000


def test_an_oversize_still_fails_and_leaves_no_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    filters = _fake_ffmpeg(monkeypatch, {})
    tools = Tools(ffmpeg="ffmpeg", ffprobe="ffprobe", node="node")
    out = tmp_path / "01.webp"
    with pytest.raises(EvidenceError, match="no WebP under 44,000 bytes even at quality 30"):
        encode_still(tools, tmp_path / "still-01.png", out)
    assert not out.exists()
    assert not any("crop" in f for f in filters), "a frame is never cut shorter"


def _story(root: Path) -> list[dict[str, Any]]:
    """The drawing and two turns written by hand into ``root/story``, and their schema 3 entries."""
    story = []
    for i, (caption, turn) in enumerate(
        [(DRAWING_CAPTION, None), ("Turn 1 - Office: Lien desk", 1), ("Turn 5 - Procore", 5)],
        start=1,
    ):
        still = root / "story" / f"{i:02d}.webp"
        still.parent.mkdir(exist_ok=True)
        still.write_bytes(b"RIFF a still %d" % i)
        entry: dict[str, Any] = {
            "n": i,
            "path": f"playbooks/{root.name}/story/{still.name}",
            "bytes": still.stat().st_size,
            "sha256": sha256(still),
            "caption": caption,
            "kind": "drawing" if turn is None else "turn",
        }
        if turn is not None:
            entry["turn"] = turn
        story.append(entry)
    return story


def test_stills_only_writes_a_schema_3_index_of_the_stills_alone(tmp_path: Path) -> None:
    """ADR 0137: no thumbnail; the old film and narration describe a page that is gone, so they
    are not carried; ``captured_at`` is the stills' date and ``bench_run_at`` the run they show."""
    from datetime import UTC, datetime

    root = _copy(tmp_path)
    _index(root, "2026-10-01T00:00:00Z")
    story = _story(root)
    write_story(
        load_playbook(root), tmp_path, story, now=lambda: datetime(2026, 10, 23, 12, tzinfo=UTC)
    )
    after = _json(root / "evidence.json")
    assert after == {
        "schema": SCHEMA,
        "playbook": root.name,
        "captured_at": "2026-10-23T12:00:00Z",
        "bench_run_at": _json(root / "bench.json")["run_at"],
        "story": story,
    }
    assert SCHEMA == 3
    assert b"\r\n" not in (root / "evidence.json").read_bytes()
    [standing] = verify([load_playbook(root)], tmp_path)
    assert (standing.state, standing.notes, standing.ok) == ("current", (), True)


def test_stills_only_needs_no_index_before_it(tmp_path: Path) -> None:
    root = _copy(tmp_path)
    write_story(load_playbook(root), tmp_path, _story(root))
    assert _json(root / "evidence.json")["schema"] == SCHEMA


def test_verify_holds_the_storyboard_to_its_bytes_and_hashes(tmp_path: Path) -> None:
    root = _copy(tmp_path)
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
    assert standing.notes == ("a schema 3 index has no story",)


def test_verify_holds_a_schema_3_storyboard_to_its_numbers_and_kinds(tmp_path: Path) -> None:
    root = _copy(tmp_path)
    write_story(load_playbook(root), tmp_path, _story(root))
    index = _json(root / "evidence.json")
    index["story"][0]["kind"] = "turn"
    index["story"][1]["n"] = 7
    del index["story"][2]["turn"]
    index["story"] += [dict(index["story"][1]) for _ in range(3)]
    (root / "evidence.json").write_text(json.dumps(index), encoding="utf-8")
    [standing] = verify([load_playbook(root)], tmp_path)
    assert standing.notes[:4] == (
        "story has 6 stills, more than 5",
        "story still 1 is of kind 'turn'",
        "story still 2 is numbered 7",
        "story still 3 names no turn",
    )


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
    # The turns follow the latest committed run (re-benched 2026-10-22): only their shape holds.
    assert re.search(r"--stills --fixture shipped:lien-desk --turns 1(,\d+)+ ", out)
    assert "playbooks/lien-desk/story/01..05.webp" in out
    assert "1280 px WebP, 16:10, <= 44,000 bytes each" in out
    assert "schema 3, the stills only" in out
