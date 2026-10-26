"""The Meta price table against hand-computed figures, and the Standard-only guard (spike 00 #5).

Every figure below is worked by hand from ``meta-model-facts.md`` "Prices", so a table typo shows
as a wrong number rather than a self-consistent one.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from athena.harness import meta
from athena.harness.meta import (
    ContributorRefused,
    MetaReader,
    MetaSegmenter,
    MetaTranscriber,
    cost_of,
    mode_of,
    require_standard,
    token_cost,
)
from athena.senses.contract import MediaItem, ReadRequest, SegmentRequest

from .fakes import ENV, always, ok, responses_reply


@pytest.mark.parametrize(
    ("model", "units", "unit", "usd"),
    [
        ("muse-spark-1.3", 1_000_000, "input_token", 1.25),
        ("muse-spark-1.2", 1_000_000, "cached_input_token", 0.15),
        ("muse-spark-1.1", 2_000_000, "output_token", 8.50),
        ("muse-spark-1.3-contributor", 1_000_000, "input_token", 0.10),
        ("muse-spark-1.2-contributor", 1_000_000, "cached_input_token", 0.002),
        ("muse-spark-1.3-contributor", 1_000_000, "output_token", 0.20),
        ("muse-wonder-1.0", 1_000_000, "output_token", 20.00),
        ("muse-wonder-1.0", 500_000, "cached_input_token", 0.10),
        ("muse-spark-1.3", 4, "search_query", 0.01),
        ("muse-image-1.0", 3, "image", 0.03),
        ("muse-voice-transcribe-1.0", 3_600, "audio_s", 0.18),
        # whole seconds: 1.2 s bills as 2 s = 2 * 0.18 / 3600
        ("muse-voice-transcribe-1.0", 1.2, "audio_s", 0.0001),
        ("sam-3.1", 1, "image", 0.0025),
        ("sam-3.1", 1_000, "image", 2.50),
        # a video request under 50 frames bills as 50: 50 * 0.20 / 1000
        ("sam-3.1", 10, "frame", 0.01),
        ("sam-3.1", 300, "frame", 0.06),
    ],
)
def test_cost_of_matches_hand_computed_figures(
    model: str, units: float, unit: str, usd: float
) -> None:
    assert cost_of(model, units, unit) == pytest.approx(usd)


def test_unknown_model_or_unit_is_unpriced_never_zero() -> None:
    assert cost_of("muse-glimmer", 10, "input_token") is None
    assert cost_of("sam-3.1", 10, "input_token") is None
    assert cost_of("muse-spark-1.3", 1, "frame") is None
    assert token_cost("nobody-1.0", 10, 10) is None


def test_token_cost_prices_the_cached_part_at_the_cached_rate() -> None:
    # 800 fresh * 1.25 + 200 cached * 0.15 + 500 out * 4.25, per million
    assert token_cost("muse-spark-1.3", 1_000, 500, 200) == pytest.approx(0.003155)


def test_mode_of_reads_the_suffix() -> None:
    assert mode_of("muse-spark-1.3") == "standard"
    assert mode_of("muse-spark-1.3-contributor") == "contributor"
    assert mode_of("Muse-Spark-1.2-CONTRIBUTOR") == "contributor"


def test_require_standard_refuses_contributor_for_personal_data_only() -> None:
    with pytest.raises(ContributorRefused):
        require_standard("muse-spark-1.3-contributor", personal=True)
    require_standard("muse-spark-1.3-contributor", personal=False)
    require_standard("muse-spark-1.3", personal=True)


def test_the_stub_names_are_all_still_exported() -> None:
    for name in (
        "API_KEY_ENV",
        "BASE_URL",
        "SPARK_MODEL",
        "SPARK_AUDIO_MODEL",
        "WONDER_MODEL",
        "SAM_MODEL",
        "VOICE_MODEL",
        "ContributorRefused",
        "mode_of",
        "require_standard",
        "MetaSegmenter",
        "MetaTranscriber",
        "MetaReader",
        "HttpPost",
        "urllib_post",
    ):
        assert hasattr(meta, name), name


# --- every role class runs the guard before any request ------------------------------------------


def _file(tmp_path: Path, name: str, data: bytes = b"\x89PNG\r\n\x1a\n") -> Path:
    path = tmp_path / name
    path.write_bytes(data)
    return path


def test_each_role_refuses_a_contributor_id_for_personal_media_before_sending(
    tmp_path: Path,
) -> None:
    post = always(ok({}))
    png = _file(tmp_path, "a.png")
    wav = _file(tmp_path, "a.wav", b"RIFF")
    photo = MediaItem(id="m1", kind="photo", sense="object")
    audio = MediaItem(id="m2", kind="audio", sense="call")
    sheet = MediaItem(id="m3", kind="paper", sense="paper")
    spark_audio = MediaItem(id="m4", kind="audio", sense="call", params={"spark_audio": True})
    contributor = "muse-spark-1.3-contributor"
    with pytest.raises(ContributorRefused):
        MetaSegmenter(env=ENV, post=post, model="sam-3.1-contributor").segment(
            SegmentRequest(photo, png, "cup")
        )
    with pytest.raises(ContributorRefused):
        MetaTranscriber(env=ENV, post=post, model="voice-contributor").transcribe(audio, wav)
    with pytest.raises(ContributorRefused):
        MetaTranscriber(env=ENV, post=post, spark_model=contributor).transcribe(spark_audio, wav)
    with pytest.raises(ContributorRefused):
        MetaReader(env=ENV, post=post, model=contributor).read(ReadRequest(sheet, png, ["amount"]))
    # refused even with no key: the guard runs before anything else
    with pytest.raises(ContributorRefused):
        MetaReader(env={}, post=post, model=contributor).read(ReadRequest(sheet, None, ["a"]))
    assert post.sent == []


def test_a_contributor_id_may_see_media_that_is_not_personal(tmp_path: Path) -> None:
    answer = {"fields": [{"name": "amount", "value": "12", "confidence": 0.9, "box": None}]}
    post = always(responses_reply(answer, tokens=(1_000_000, 1_000_000, 0)))
    sheet = MediaItem(id="m1", kind="paper", sense="paper", personal=False)
    reading, call = MetaReader(env=ENV, post=post, model="muse-spark-1.3-contributor").read(
        ReadRequest(sheet, _file(tmp_path, "a.png"), ["amount"])
    )
    assert [f.value for f in reading.fields] == ["12"]
    assert call.mode == "contributor"
    assert call.cost_usd == pytest.approx(0.30)
    assert len(post.sent) == 1
