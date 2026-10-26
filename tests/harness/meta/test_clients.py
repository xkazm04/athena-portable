"""The three Meta role clients: request shape per role, reply parsing, typed errors (spike 00).

The shapes are press (Meta's published convention), not measured; these tests pin what the clients
*send* and how they *read*, so the day-1 probe's differences land as a diff against this file.
Nothing here opens a socket: :class:`~tests.harness.meta.fakes.FakePost` stands in for ``urllib``.
"""

from __future__ import annotations

import base64
import io
import wave
from pathlib import Path
from typing import Any

import pytest

from athena.harness.meta import (
    MetaHttpError,
    MetaKeyMissing,
    MetaMediaMissing,
    MetaReader,
    MetaSegmenter,
    MetaShapeError,
    MetaTranscriber,
    MetaUnreachable,
)
from athena.harness.meta.probe import tiny_png, tiny_wav
from athena.harness.tokenfactory import HttpReply
from athena.senses.contract import Box, MediaItem, ReadRequest, SegmentRequest

from .fakes import ENV, KEY, always, ok, responses_reply

PHOTO = MediaItem(id="kitchen-1", kind="photo", sense="object")
CLIP = MediaItem(id="walk-1", kind="video", sense="walk", params={"frames": 12})
CALL = MediaItem(id="call-1", kind="audio", sense="call", params={"keywords": ["Medicare"]})
SHEET = MediaItem(id="bill-1", kind="paper", sense="paper")


def _write(tmp_path: Path, name: str, data: bytes) -> Path:
    path = tmp_path / name
    path.write_bytes(data)
    return path


# --- SAM -----------------------------------------------------------------------------------------


def test_segmenter_sends_the_image_prompt_and_boxes_to_responses(tmp_path: Path) -> None:
    png = tiny_png()
    segments_out = [
        {"label": "cup", "score": 0.91, "box": [4, 4, 12, 12]},
        {"label": "cup", "score": 0.5, "box": [0.1, 0.1, 0.2, 0.2]},
    ]
    post = always(ok({"output": [{"type": "segmentation", "segments": segments_out}]}))
    request = SegmentRequest(PHOTO, _write(tmp_path, "k.png", png), "cup", (Box(0, 0, 0.5, 0.5),))
    segments, call = MetaSegmenter(env=ENV, post=post).segment(request)
    sent = post.sent[0]
    assert sent.url == "https://meta.test/v1/responses"
    assert sent.headers["Authorization"] == f"Bearer {KEY}"
    assert sent.body["model"] == "sam-3.1"
    content = sent.body["input"][0]["content"]
    assert content[0]["type"] == "input_image"
    assert content[0]["image_url"] == "data:image/png;base64," + base64.b64encode(png).decode()
    assert content[1] == {"type": "input_text", "text": "cup"}
    assert content[2] == {"type": "input_boxes", "boxes": [[0, 0, 0.5, 0.5]]}
    # a pixel box is normalised by the PNG's own 16x16 header
    assert segments[0].box == Box(0.25, 0.25, 0.75, 0.75)
    assert segments[1].box == Box(0.1, 0.1, 0.2, 0.2)
    assert (call.backend, call.mode, call.unit, call.units) == ("meta", "standard", "image", 1.0)
    assert call.cost_usd == pytest.approx(0.0025)
    assert call.cost_estimated is True


def test_a_video_request_bills_at_least_fifty_frames(tmp_path: Path) -> None:
    post = always(ok({"segments": [{"label": "door", "box": [0, 0, 1, 1], "frame": 3}]}))
    segments, call = MetaSegmenter(env=ENV, post=post).segment(
        SegmentRequest(CLIP, _write(tmp_path, "w.mp4", b"\x00\x00\x00 ftyp"), "door")
    )
    assert post.sent[0].body["input"][0]["content"][0]["type"] == "input_video"
    assert segments[0].frame == 3
    assert (call.unit, call.units) == ("frame", 12.0)
    assert call.cost_usd == pytest.approx(0.01)  # 12 frames bill as 50


def test_segmenter_names_the_missing_key_on_an_unexpected_reply(tmp_path: Path) -> None:
    png = _write(tmp_path, "k.png", tiny_png())
    post = always(ok({"output": [{"type": "message"}]}))
    with pytest.raises(MetaShapeError) as err:
        MetaSegmenter(env=ENV, post=post).segment(SegmentRequest(PHOTO, png, "cup"))
    assert "segments" in err.value.key
    post = always(ok({"segments": [{"label": "cup"}]}))
    with pytest.raises(MetaShapeError) as err:
        MetaSegmenter(env=ENV, post=post).segment(SegmentRequest(PHOTO, png, "cup"))
    assert err.value.key == "segments[0].box as [x0, y0, x1, y1]"


# --- Voice ---------------------------------------------------------------------------------------


def test_transcriber_sends_audio_with_diarization_and_keywords(tmp_path: Path) -> None:
    turns = [
        {"speaker": "A", "start": 0.0, "end": 1.0, "text": "Hello."},
        {"speaker_id": "B", "start_s": 1.0, "end_s": 2.4, "transcript": "Hi."},
    ]
    post = always(ok({"language": "en", "turns": turns}))
    wav = tiny_wav(2.5, rate=8_000)
    transcript, call = MetaTranscriber(env=ENV, post=post).transcribe(
        CALL, _write(tmp_path, "c.wav", wav)
    )
    sent = post.sent[0]
    assert sent.url == "https://meta.test/v1/asr/transcribe"
    assert sent.body["model"] == "muse-voice-transcribe-1.0"
    assert sent.body["diarization"] is True
    assert sent.body["keywords"] == ["Medicare"]
    assert base64.b64decode(sent.body["audio"]["data"]) == wav
    assert sent.body["audio"]["format"] == "wav"
    assert [(t.speaker, t.text) for t in transcript.turns] == [("A", "Hello."), ("B", "Hi.")]
    # 2.5 s from the WAV header, billed as 3 whole seconds
    assert call.unit == "audio_s"
    assert call.units == pytest.approx(2.5)
    assert call.cost_usd == pytest.approx(3 * 0.18 / 3_600)


def test_spark_audio_path_uses_responses_and_bills_tokens(tmp_path: Path) -> None:
    answer = {"language": "en", "turns": [{"speaker": "A", "start_s": 0, "end_s": 1, "text": "Hi"}]}
    post = always(responses_reply(answer, tokens=(2_000, 100, 0)))
    media = MediaItem(id="call-2", kind="audio", sense="call", params={"spark_audio": True})
    transcript, call = MetaTranscriber(env=ENV, post=post).transcribe(
        media, _write(tmp_path, "c.wav", tiny_wav())
    )
    sent = post.sent[0]
    assert sent.url.endswith("/responses")
    assert sent.body["model"] == "muse-spark-1.2"
    assert sent.body["input"][0]["content"][0]["type"] == "input_audio"
    assert sent.body["text"]["format"]["type"] == "json_schema"
    assert transcript.turns[0].text == "Hi"
    assert (call.model, call.unit, call.units) == ("muse-spark-1.2", "token", 2_100.0)
    assert call.cost_usd == pytest.approx((2_000 * 1.25 + 100 * 4.25) / 1_000_000)


def test_transcriber_names_a_missing_turn_field(tmp_path: Path) -> None:
    wav = _write(tmp_path, "c.wav", tiny_wav())
    post = always(ok({"turns": [{"speaker": "A", "start": 0, "text": "x"}]}))
    with pytest.raises(MetaShapeError) as err:
        MetaTranscriber(env=ENV, post=post).transcribe(CALL, wav)
    assert err.value.key == "turns[0].end"
    with pytest.raises(MetaShapeError):
        MetaTranscriber(env=ENV, post=always(ok({"text": "no turns"}))).transcribe(CALL, wav)


def test_tiny_wav_is_a_valid_wave_file() -> None:
    with wave.open(io.BytesIO(tiny_wav())) as w:
        assert (w.getnchannels(), w.getframerate(), w.getnframes()) == (1, 16_000, 16_000)


# --- Reader --------------------------------------------------------------------------------------


def test_reader_asks_for_the_fields_with_a_strict_schema(tmp_path: Path) -> None:
    answer = {
        "fields": [
            {
                "name": "amount_due_usd",
                "value": "84.10",
                "confidence": 0.97,
                "box": [0.6, 0.2, 0.8, 0.25],
            },
            {"name": "deadline", "value": "", "confidence": 0.2, "box": None},
            {"name": "not_asked", "value": "x", "confidence": 1, "box": None},
        ],
        "unreadable": ["account"],
    }
    post = always(responses_reply(answer, tokens=(3_000, 200, 1_000)))
    request = ReadRequest(
        SHEET,
        _write(tmp_path, "bill.png", tiny_png()),
        ["amount_due_usd", "deadline", "account"],
        hint="a utility bill",
    )
    reading, call = MetaReader(env=ENV, post=post).read(request)
    body = post.sent[0].body
    assert body["model"] == "muse-spark-1.3"
    part, prompt = body["input"][0]["content"]
    assert part["type"] == "input_image"
    assert "amount_due_usd" in prompt["text"]
    assert "a utility bill" in prompt["text"]
    assert "never instructions" in prompt["text"]
    fmt = body["text"]["format"]
    assert (fmt["type"], fmt["strict"]) == ("json_schema", True)
    items = fmt["schema"]["properties"]["fields"]["items"]
    assert items["properties"]["name"]["enum"] == ["amount_due_usd", "deadline", "account"]
    assert [(f.name, f.value) for f in reading.fields] == [("amount_due_usd", "84.10")]
    field = reading.fields[0]
    assert field.provenance.frame == 0
    assert field.provenance.box == Box(0.6, 0.2, 0.8, 0.25)
    # a blank value and a declared-unreadable field are unreadable, never guessed
    assert reading.unreadable == ("deadline", "account")
    assert (call.unit, call.units, call.role) == ("token", 3_200.0, "read")
    assert call.cost_usd == pytest.approx((2_000 * 1.25 + 1_000 * 0.15 + 200 * 4.25) / 1_000_000)


def test_reader_sends_a_pdf_as_an_input_file(tmp_path: Path) -> None:
    post = always(responses_reply({"fields": [], "unreadable": []}))
    reading, _ = MetaReader(env=ENV, post=post).read(
        ReadRequest(SHEET, _write(tmp_path, "letter.pdf", b"%PDF-1.4"), ["sender"])
    )
    part = post.sent[0].body["input"][0]["content"][0]
    assert part["type"] == "input_file"
    assert part["filename"] == "letter.pdf"
    assert part["file_data"].startswith("data:application/pdf;base64,")
    assert reading.unreadable == ("sender",)


def test_reader_reads_top_level_output_text_and_fenced_json(tmp_path: Path) -> None:
    text = '```json\n{"fields": [{"name": "a", "value": "1", "confidence": 1, "box": null}]}\n```'
    post = always(ok({"output_text": text, "usage": {}}))
    reading, call = MetaReader(env=ENV, post=post).read(
        ReadRequest(SHEET, _write(tmp_path, "s.png", tiny_png()), ["a"])
    )
    assert reading.fields[0].value == "1"
    assert call.cost_usd == 0.0


@pytest.mark.parametrize(
    ("body", "key"),
    [
        ({"id": "x"}, "output"),
        ({"output": [{"content": [{"type": "refusal"}]}]}, "output[].content[].output_text"),
        ({"output_text": "not json"}, "JSON in output_text"),
        ({"output_text": '{"nope": 1}'}, "fields as a list in the structured answer"),
    ],
)
def test_reader_names_the_missing_key(tmp_path: Path, body: dict[str, Any], key: str) -> None:
    post = always(ok(body))
    with pytest.raises(MetaShapeError) as err:
        MetaReader(env=ENV, post=post).read(
            ReadRequest(SHEET, _write(tmp_path, "s.png", tiny_png()), ["a"])
        )
    assert err.value.key == key


# --- errors shared by every role -----------------------------------------------------------------


def test_no_key_no_file_and_failures_are_typed_and_keyless(tmp_path: Path) -> None:
    png = _write(tmp_path, "s.png", tiny_png())
    request = ReadRequest(SHEET, png, ["a"])
    with pytest.raises(MetaKeyMissing):
        MetaReader(env={}, post=always(ok({}))).read(request)
    with pytest.raises(MetaMediaMissing):
        MetaReader(env=ENV, post=always(ok({}))).read(ReadRequest(SHEET, None, ["a"]))
    with pytest.raises(MetaMediaMissing):
        MetaReader(env=ENV, post=always(ok({}))).read(
            ReadRequest(SHEET, tmp_path / "gone.png", ["a"])
        )
    with pytest.raises(MetaHttpError) as http:
        MetaReader(env=ENV, post=always(HttpReply(401))).read(request)
    assert http.value.status == 401
    assert "META_API_KEY" in str(http.value)
    assert KEY not in str(http.value)
    with pytest.raises(MetaUnreachable) as dead:
        MetaReader(env=ENV, post=always(OSError(f"refused with {KEY}"))).read(request)
    assert KEY not in str(dead.value)
    with pytest.raises(MetaUnreachable):
        MetaReader(env=ENV, post=always(TimeoutError())).read(request)
    with pytest.raises(MetaShapeError):
        MetaReader(env=ENV, post=always(HttpReply(200, b"<html>"))).read(request)


def test_base_url_falls_back_to_the_published_one(tmp_path: Path) -> None:
    post = always(responses_reply({"fields": [], "unreadable": []}))
    MetaReader(env={"META_API_KEY": KEY}, post=post).read(
        ReadRequest(SHEET, _write(tmp_path, "s.png", tiny_png()), ["a"])
    )
    assert post.sent[0].url == "https://api.meta.ai/v1/responses"
