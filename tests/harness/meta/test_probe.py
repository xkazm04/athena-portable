"""The day-1 probe: no key exits 2 and sends nothing; with a fake ``post`` it runs end to end."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from athena.harness.meta.config import KNOWN_MODELS, TEXT_MODELS
from athena.harness.meta.probe import main, tiny_png
from athena.harness.tokenfactory import HttpReply
from athena.harness.vision import sniff_image

from .fakes import ENV, KEY, FakeGet, FakePost, ok, responses_reply


def test_tiny_png_is_a_valid_16_pixel_png() -> None:
    assert sniff_image(tiny_png()) == ("image/png", 16, 16)


def test_without_a_key_it_exits_2_with_one_line_and_no_request(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    post, get = FakePost(lambda url, body: ok({})), FakeGet(ok({}))
    assert main(["probe", "--out", str(tmp_path)], env={}, post=post, get=get) == 2
    out = capsys.readouterr().out
    assert out.count("\n") == 1
    assert "META_API_KEY" in out
    assert post.sent == []
    assert get.sent == []
    assert list(tmp_path.iterdir()) == []


def _route(url: str, body: dict[str, Any]) -> HttpReply:
    """A Meta that speaks the assumed shapes everywhere except Wonder's chat and SAM."""
    model = body.get("model")
    if url.endswith("/asr/transcribe"):
        return ok({"language": "en", "turns": [], "duration_s": 1.0})
    if url.endswith("/chat/completions"):
        if model == "muse-wonder-1.0":
            return HttpReply(404)
        if body.get("stream"):
            event = {"choices": [{"delta": {"content": "OK"}}]}
            usage = {"choices": [], "usage": {"prompt_tokens": 5, "completion_tokens": 1}}
            sse = f"data: {json.dumps(event)}\n\ndata: {json.dumps(usage)}\n\ndata: [DONE]\n\n"
            return HttpReply(200, sse.encode())
        return ok(
            {
                "choices": [{"message": {"content": "OK"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 1},
            }
        )
    if model == "sam-3.1":
        return ok({"masks": []})
    if model == "muse-spark-1.2" and "transcript" in json.dumps(body.get("text", {})):
        return responses_reply({"language": "en", "turns": []})
    if "text" in body:
        return responses_reply({"fields": [], "unreadable": ["shape"]})
    return responses_reply("OK", tokens=(5, 1, 0))


def test_with_a_key_it_writes_a_keyless_report_and_lists_every_difference(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    post = FakePost(_route)
    listed = [m for m in KNOWN_MODELS if m != "muse-image-1.0"] + ["muse-code-1.0"]
    get = FakeGet(ok({"object": "list", "data": [{"id": m} for m in listed]}))
    code = main(["probe", "--out", str(tmp_path)], env=ENV, post=post, get=get)
    assert code == 1
    assert get.sent == ["https://meta.test/v1/models"]
    # per text model: responses, chat, chat stream; then SAM, voice, Spark audio, Spark read
    assert len(post.sent) == 3 * len(TEXT_MODELS) + 4
    assert len([s for s in post.sent if s.body.get("stream") is True]) == len(TEXT_MODELS)

    (path,) = tmp_path.glob("probe-*.json")
    raw = path.read_text("utf-8")
    assert KEY not in raw
    report = json.loads(raw)
    assert report["base_url"] == "https://meta.test/v1"
    assert report["missing"] == ["muse-image-1.0"]
    assert report["unexpected"] == ["muse-code-1.0"]
    rows = {(r["name"], r["model"]): r for r in report["calls"]}
    spark = rows[("responses", "muse-spark-1.3")]
    assert spark["ok"] is True
    assert spark["usage"]["input_tokens"] == 5
    assert spark["keys"] == ["id", "output", "usage"]
    assert rows[("chat", "muse-wonder-1.0")]["differs"] == "HTTP 404"
    stream = rows[("chat.stream", "muse-spark-1.3")]
    assert stream["ok"] is True
    assert "[DONE] sent; usage in stream" in stream["note"]
    assert "segments" in rows[("sam.image", "sam-3.1")]["differs"]
    assert rows[("voice.file", "muse-voice-transcribe-1.0")]["ok"] is True
    assert rows[("spark.audio", "muse-spark-1.2")]["ok"] is True
    assert rows[("spark.read", "muse-spark-1.3")]["ok"] is True

    out = capsys.readouterr().out
    unchecked = [line for line in out.splitlines() if line.startswith("[ ]")]
    # Wonder chat and chat stream, SAM, one missing id, one unexpected id
    assert len(unchecked) == 5
    assert any("sam.image" in line for line in unchecked)
    assert f"wrote {path}" in out
    assert KEY not in out


def test_an_unreachable_meta_is_recorded_not_raised(tmp_path: Path) -> None:
    def dead(url: str, body: dict[str, Any]) -> HttpReply | BaseException:
        return OSError(f"no route ({KEY})")

    post = FakePost(dead)
    get = FakeGet(HttpReply(503))
    assert main(["probe", "--out", str(tmp_path)], env=ENV, post=post, get=get) == 1
    raw = next(tmp_path.glob("probe-*.json")).read_text("utf-8")
    assert KEY not in raw
    report = json.loads(raw)
    assert report["calls"][0]["differs"] == "HTTP 503"
    assert all(r["differs"] == "unreachable (OSError)" for r in report["calls"][1:])
