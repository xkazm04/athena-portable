"""The call sense (spike 02): cited turns, the consent gate, packet binding and its proofs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from athena.senses import call
from athena.senses.build import context
from athena.senses.call.packet import canonical_packet, packet_sha256, unsupported
from athena.senses.contract import MediaItem, SenseContext, SenseOutput

REPO = Path(__file__).resolve().parents[2]
CHORE = REPO / "playbooks" / "prior-auth-denial-appeal"
LINE = "This call is being transcribed for my records."


def write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def turn(speaker: str, start: float, text: str) -> dict[str, Any]:
    return {"speaker": speaker, "start_s": start, "end_s": start + 4.0, "text": text}


def chore(tmp_path: Path, calls: dict[str, list[dict[str, Any]]], **world: Any) -> SenseContext:
    """A one-sense chore in ``tmp_path``: one audio item per call, A caregiver and B the rep."""
    media = [
        {
            "id": mid,
            "kind": "audio",
            "sense": "call",
            "path": f"media/{mid}.wav",
            "params": {"consent_line": LINE, "speakers": {"A": "caregiver", "B": "insurer_rep"}},
        }
        for mid in calls
    ]
    write(tmp_path / "senses" / "media.json", {"media": media})
    write(tmp_path / "world.json", {"tables": world})
    for mid, turns in calls.items():
        write(tmp_path / "senses" / "fixtures" / f"{mid}.json", {"transcript": {"turns": turns}})
    return context(tmp_path)


CONSENTED = [
    turn("C", 0.0, "Thank you for calling."),
    turn("A", 7.0, "Hi - THIS call is being transcribed, for my records!"),
    turn("B", 12.0, "Your reference number is FW-4471-B."),
]


def test_a_consented_call_becomes_cited_turns_with_roles(tmp_path: Path) -> None:
    out = call.build(chore(tmp_path, {"call-1": CONSENTED}))
    rows = out.tables["call_turns"]
    assert [r["turn_id"] for r in rows] == ["call-1#1", "call-1#2", "call-1#3"]
    # An unmapped diarized label (the IVR) is kept as-is, never guessed into a role.
    assert [r["speaker"] for r in rows] == ["C", "caregiver", "insurer_rep"]
    assert rows[2] == {
        "turn_id": "call-1#3",
        "media_id": "call-1",
        "second": 12.0,
        "speaker": "insurer_rep",
        "end_s": 16.0,
        "text": "Your reference number is FW-4471-B.",
    }
    # Absent provenance is omitted, never 0: a call turn has a second, no frame and no box.
    assert all("frame" not in r and "box" not in r for r in rows)
    assert out.tables["call_log"] == [
        {"media_id": "call-1", "second": 7.0, "consent": "heard", "turns": 3}
    ]
    assert out.asked == () and [c.backend for c in out.calls] == ["fixture"]


@pytest.mark.parametrize(
    "turns",
    [
        [turn("B", 0.0, "Member services."), turn("A", 5.0, "Hi, about my mother.")],
        # Said, but only after the first minute: it does not rescue the call.
        [turn("B", 0.0, "Member services."), turn("A", 61.0, LINE)],
        [],
    ],
)
def test_a_call_without_the_consent_line_in_its_first_minute_yields_nothing(
    tmp_path: Path, turns: list[dict[str, Any]]
) -> None:
    out = call.build(chore(tmp_path, {"call-1": CONSENTED, "call-2": turns}))
    assert {r["media_id"] for r in out.tables["call_turns"]} == {"call-1"}
    assert out.asked == ("call-2.consent",)
    assert out.tables["call_log"][1] == {"media_id": "call-2", "consent": "missing", "turns": 0}
    # The transcription still ran and is still a priced row; only its words were dropped.
    assert [c.media_id for c in out.calls] == ["call-1", "call-2"]


def test_a_call_with_no_consent_line_param_is_never_kept(tmp_path: Path) -> None:
    ctx = chore(tmp_path, {"call-1": CONSENTED})
    media = ctx.media[0]
    bare = MediaItem(id=media.id, kind=media.kind, sense=media.sense, params={})
    out = call.build(SenseContext(ctx.playbook_id, ctx.root, ctx.world, (bare,), ctx.senses))
    assert out.tables["call_turns"] == [] and out.asked == ("call-1.consent",)


def test_the_sense_reads_only_its_own_items(tmp_path: Path) -> None:
    ctx = chore(tmp_path, {"call-1": CONSENTED})
    other = MediaItem(id="sheet-1", kind="paper", sense="paper")
    out = call.build(
        SenseContext(ctx.playbook_id, ctx.root, ctx.world, (*ctx.media, other), ctx.senses)
    )
    assert {c.media_id for c in out.calls} == {"call-1"}


# --- packet binding ------------------------------------------------------------------------------

PACKET = [
    {"text": "Ruth asks for a reconsideration of DN-6104.", "cites": ["s01.denial_id", "call-1#3"]},
    {"text": "The reference is FW-4471-B.", "cites": ["call-1#3"]},
]


def test_the_packet_hash_is_pinned_to_its_canonical_form() -> None:
    assert (
        canonical_packet(PACKET[1:])
        == '[{"cites":["call-1#3"],"text":"The reference is FW-4471-B."}]'
    )
    assert packet_sha256(PACKET) == packet_sha256([dict(s) for s in PACKET])
    assert len(packet_sha256(PACKET)) == 64 and packet_sha256(PACKET).islower()


def test_cites_are_a_set_but_sentences_and_bytes_are_not() -> None:
    base = packet_sha256(PACKET)
    shuffled = [{**PACKET[0], "cites": ["call-1#3", "s01.denial_id", "call-1#3"]}, PACKET[1]]
    assert packet_sha256(shuffled) == base
    assert packet_sha256([{**PACKET[0], "hint": "bold"}, PACKET[1]]) == base
    assert packet_sha256(list(reversed(PACKET))) != base
    assert packet_sha256([{**PACKET[0], "text": PACKET[0]["text"] + " "}, PACKET[1]]) != base
    assert packet_sha256([{**PACKET[0], "cites": ["s01.denial_id"]}, PACKET[1]]) != base


@pytest.mark.parametrize("bad", [[{"cites": []}], [{"text": "x", "cites": "call-1#3"}]])
def test_a_malformed_sentence_is_refused(bad: list[dict[str, Any]]) -> None:
    with pytest.raises(ValueError, match="sentence 0"):
        packet_sha256(bad)


def test_a_sentence_without_a_resolving_source_is_unsupported() -> None:
    sentences = [*PACKET, {"text": "She fell twice.", "cites": []}]
    assert unsupported(sentences, {"s01.denial_id", "call-1#3"}) == [2]
    assert unsupported(sentences, {"call-1#3"}) == [0, 2]


# --- proofs --------------------------------------------------------------------------------------


def test_prove_measures_attribution_exactness_consent_and_binding(tmp_path: Path) -> None:
    drafts = [
        {"packet_id": "AW-1", "sentences": PACKET, "packet_sha256": packet_sha256(PACKET)},
        {
            "packet_id": "AW-2",
            "sentences": [{"text": "Ten days were approved.", "cites": ["call-2#2"]}],
            "packet_sha256": "0" * 64,
        },
    ]
    ctx = chore(
        tmp_path,
        {"call-1": CONSENTED, "call-2": [turn("B", 0.0, "Ten days were approved.")]},
        drafts=drafts,
    )
    out = call.build(ctx)
    merged = SenseOutput(
        tables={
            **out.tables,
            "sheet_fields": [{"sheet_id": "s01", "field": "denial_id", "status": "read"}],
        },
        calls=out.calls,
        asked=out.asked,
    )
    key = {
        "call": {
            "calls": {
                "call-1": {
                    "consent": True,
                    "turns": [
                        {"second": 0.0, "speaker": "C"},
                        {"second": 7.3, "speaker": "caregiver"},
                        {"second": 12.0, "speaker": "caregiver"},  # the fixture says the rep
                    ],
                    "exact": [{"second": 12.0, "text": "FW-4471-B"}],
                },
                "call-2": {"consent": False},
            },
            "packets": {"table": "drafts", "fileable": ["AW-1"], "unsupported": ["AW-2"]},
        }
    }
    got = {r.id: r for r in call.prove(ctx, merged, key)}
    assert list(got) == ["F1", "F1k", "F3", "F3x", "F4", "R4"]
    assert got["F1"].measured == pytest.approx(2 / 3) and not got["F1"].passed
    assert got["F1k"].measured == 1.0 and got["F1k"].passed
    assert got["F3"].measured == 0 and got["F3"].passed and got["F3"].n == 2
    assert got["F3x"].measured == 1.0 and got["F3x"].passed
    # AW-2's stored hash is not its packet's: binding fails for that draft.
    assert got["F4"].measured is not None and got["F4"].measured < 1.0 and not got["F4"].passed
    assert got["R4"].measured == 1.0 and got["R4"].passed
    assert all(
        r.backend == {"segmenter": "fixture", "transcriber": "fixture", "reader": "fixture"}
        for r in got.values()
    )


def test_without_the_sheet_fields_a_sheet_cite_does_not_resolve(tmp_path: Path) -> None:
    drafts = [{"packet_id": "AW-1", "sentences": PACKET, "packet_sha256": packet_sha256(PACKET)}]
    ctx = chore(tmp_path, {"call-1": CONSENTED}, drafts=drafts)
    key = {"call": {"calls": {}, "packets": {"table": "drafts", "fileable": ["AW-1"]}}}
    got = {r.id: r for r in call.prove(ctx, call.build(ctx), key)}
    assert got["F3"].measured == 1 and not got["F3"].passed


# --- the chore -----------------------------------------------------------------------------------


def test_the_chore_binds_each_draft_to_its_hash_and_its_truth_to_those_hashes() -> None:
    world = json.loads((CHORE / "world.json").read_text("utf-8"))
    truth = json.loads((CHORE / "truth.json").read_text("utf-8"))
    hashes = {d["packet_id"]: d["packet_sha256"] for d in world["tables"]["drafts"]}
    for draft in world["tables"]["drafts"]:
        assert draft["packet_sha256"] == packet_sha256(draft["sentences"]), draft["packet_id"]
    appeal = next(t for t in truth["targets"] if t["tool"] == "file_appeal")
    assert appeal["key"] == "packet_sha256"
    assert set(appeal["eligible"]) == {hashes["AW-1"]}
    assert set(appeal["traps"]) == {hashes[p] for p in ("AW-2", "AW-3", "AW-4", "AW-5", "AW-6")}


def test_the_chores_second_call_keeps_nothing() -> None:
    ctx = context(CHORE)
    out = call.build(ctx)
    assert {r["media_id"] for r in out.tables["call_turns"]} == {"call-1"}
    assert out.asked == ("call-2.consent",)
