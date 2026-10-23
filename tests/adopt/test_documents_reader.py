"""The documents lane's opt-in picture reader (ADR 0097, WP-L):
``ATHENA_DOCUMENT_READER=nemotron-vl`` sends a small picture to Nemotron 3.5 Super-VL, and anything
else - or any VL failure - reads the document with the Claude leg as before.
No network: the HTTP post is a fake."""

from __future__ import annotations

import base64
import json
import struct
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from athena.adopt.documents import (
    DOCUMENT_SYSTEM,
    DOCUMENT_VL_SYSTEM,
    READER_CLAUDE,
    READER_ENV,
    READER_VL,
    document_prompt,
    document_reader,
    document_task,
)
from athena.adopt.session import AdoptSession, SessionStore
from athena.adopt.slots import add_slots
from athena.contracts.adopt import Usage
from athena.harness.tokenfactory import SUPER_VL_MODEL, HttpReply
from athena.harness.vision import sniff_image

from . import conftest
from .conftest import PLAYBOOK_ID, Rig, load_fixture

KEY = "nb-test-secret-key-3141592653"
VL_ON = {READER_ENV: READER_VL, "NEBIUS_API_KEY": KEY}

CLAUDE_ANSWER = {
    "summary": "A deposit report (Claude).",
    "findings": [{"text": "p. 1: 38 participants.", "slot_ids": ["f1"], "value": "38"}],
}
VL_ANSWER = {
    "summary": "A deposit report (VL).",
    "findings": [{"text": "the header: 41 participants.", "slot_ids": ["f1"], "value": "41"}],
}


@pytest.fixture(autouse=True)
def _kinds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(conftest.SYSTEMS, DOCUMENT_SYSTEM, "document")


@pytest.fixture
def session(rig: Rig, tmp_path: Path) -> Iterator[AdoptSession]:
    rig.model.script = {"document": [CLAUDE_ANSWER]}
    store = SessionStore(tmp_path / "reader", rig.runner, load_playbook=load_fixture)
    made = store.create(PLAYBOOK_ID)
    made.set_slots(
        add_slots(made.slots, [{"kind": "fact", "label": "People in the plan", "value": ""}])
    )
    try:
        yield made
    finally:
        store.close_all()


@dataclass
class Post:
    """A fake Token Factory: one reply (or one exception) for every POST, each request kept."""

    reply: HttpReply | None = None
    raises: BaseException | None = None
    sent: list[dict[str, Any]] = field(default_factory=list)

    def __call__(
        self, url: str, headers: Mapping[str, str], body: bytes, timeout: float
    ) -> HttpReply:
        self.sent.append({"url": url, "headers": dict(headers), "body": json.loads(body)})
        if self.raises is not None:
            raise self.raises
        assert self.reply is not None
        return self.reply


def vl_body(content: str, *, finish: str = "stop") -> bytes:
    return json.dumps(
        {
            "model": SUPER_VL_MODEL,
            "choices": [{"message": {"content": content}, "finish_reason": finish}],
            "usage": {"prompt_tokens": 2000, "completion_tokens": 100},
        }
    ).encode()


def ok_post() -> Post:
    return Post(HttpReply(200, vl_body(json.dumps(VL_ANSWER))))


def png(width: int, height: int) -> bytes:
    ihdr = struct.pack(">II", width, height) + b"\x08\x02\x00\x00\x00"
    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + ihdr + b"\0\0\0\0"


def drop(session: AdoptSession, name: str, data: bytes) -> Path:
    path = session.temp_dir / "docs" / f"doc1-{name}"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def claude_calls(rig: Rig) -> int:
    return sum(1 for c in rig.model.calls if c.kind == "document")


def run(session: AdoptSession, path: Path, env: Mapping[str, str], post: Post) -> Any:
    return document_task(session, "doc1", path, environ=env, post=post).body()


# --- the switch ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("env", "reader"),
    [
        ({}, READER_CLAUDE),
        ({READER_ENV: ""}, READER_CLAUDE),
        ({READER_ENV: "gpt-vision"}, READER_CLAUDE),
        ({READER_ENV: "claude"}, READER_CLAUDE),
        ({READER_ENV: "nemotron-vl"}, READER_VL),
        ({READER_ENV: " Nemotron-VL "}, READER_VL),
    ],
)
def test_the_reader_is_claude_unless_nemotron_vl_is_asked_for(
    env: dict[str, str], reader: str
) -> None:
    assert document_reader(env) == reader


def test_the_vl_prompts_share_the_lane_text_without_the_read_tool() -> None:
    assert "Read tool" in DOCUMENT_SYSTEM and "Read tool" not in DOCUMENT_VL_SYSTEM
    assert DOCUMENT_SYSTEM.replace(
        "- Use the Read tool on the one file you are given. Read nothing else.\n", ""
    ) == (DOCUMENT_VL_SYSTEM)
    prompt = document_prompt(load_fixture(PLAYBOOK_ID), [], None)
    assert "THE DOCUMENT\nThe picture attached to this message." in prompt
    assert "Read the file" not in prompt


# --- which leg reads ----------------------------------------------------------------------------


def test_by_default_the_claude_leg_reads_a_picture(rig: Rig, session: AdoptSession) -> None:
    post = ok_post()
    outcome = run(session, drop(session, "scan.png", png(800, 1000)), {"NEBIUS_API_KEY": KEY}, post)
    assert post.sent == [] and claude_calls(rig) == 1
    assert outcome.summary == "A deposit report (Claude)."


def test_nemotron_vl_reads_a_small_picture_and_claude_does_not(
    rig: Rig, session: AdoptSession
) -> None:
    post = ok_post()
    image = png(992, 1404)
    outcome = run(session, drop(session, "scan.PNG", image), VL_ON, post)

    assert claude_calls(rig) == 0 and len(post.sent) == 1
    assert outcome.status == "done"
    assert outcome.summary == "A deposit report (VL)."
    assert [f.text for f in outcome.findings] == ["the header: 41 participants."]
    assert outcome.findings[0].slot_ids == ("f1",) and outcome.findings[0].source_url == ""
    assert [(u["slot_id"], u["value"]) for u in outcome.updates] == [("f1", "41")]

    sent = post.sent[0]
    body = sent["body"]
    assert body["model"] == SUPER_VL_MODEL
    assert body["chat_template_kwargs"] == {"enable_thinking": False}
    assert body["messages"][0]["content"] == DOCUMENT_VL_SYSTEM
    text, picture = body["messages"][1]["content"]
    assert "The picture attached to this message." in text["text"]
    assert "People in the plan" in text["text"]
    url = picture["image_url"]["url"]
    assert url == "data:image/png;base64," + base64.b64encode(image).decode()
    assert sent["headers"]["Authorization"] == f"Bearer {KEY}"


def test_the_vl_call_is_ledgered_under_nebius_with_one_usage(
    rig: Rig, session: AdoptSession
) -> None:
    run(session, drop(session, "scan.png", png(800, 1000)), VL_ON, ok_post())
    row = rig.ledger.rows[-1]
    assert (row["engine"], row["model"], row["trigger"]) == (
        "nebius",
        SUPER_VL_MODEL,
        "adopt.research",
    )
    assert (row["input_tokens"], row["output_tokens"], row["is_error"]) == (2000, 100, False)
    assert row["cost_usd"] == pytest.approx((2000 * 0.30 + 100 * 0.90) / 1_000_000)
    assert row["conversation"] == session.conversation
    usages = [e for e in session.events_after(0) if isinstance(e, Usage)]
    assert usages[-1].model == SUPER_VL_MODEL and usages[-1].leg == "research"


def test_nemotron_vl_leaves_a_pdf_to_claude(rig: Rig, session: AdoptSession) -> None:
    post = ok_post()
    outcome = run(session, drop(session, "letter.pdf", b"%PDF-1.7\n" + b"x" * 64), VL_ON, post)
    assert post.sent == [] and claude_calls(rig) == 1
    assert outcome.summary == "A deposit report (Claude)."


def test_nemotron_vl_leaves_an_oversize_picture_to_claude(rig: Rig, session: AdoptSession) -> None:
    post = ok_post()
    run(session, drop(session, "scan.png", png(1200, 1601)), VL_ON, post)
    assert post.sent == [] and claude_calls(rig) == 1


def test_a_picture_whose_header_cannot_be_read_goes_to_claude(
    rig: Rig, session: AdoptSession
) -> None:
    post = ok_post()
    run(session, drop(session, "scan.jpg", b"not a jpeg at all"), VL_ON, post)
    assert post.sent == [] and claude_calls(rig) == 1


def test_no_key_means_no_call_and_the_claude_leg(rig: Rig, session: AdoptSession) -> None:
    post = ok_post()
    run(session, drop(session, "scan.png", png(800, 1000)), {READER_ENV: READER_VL}, post)
    assert post.sent == [] and claude_calls(rig) == 1
    assert all(row["engine"] != "nebius" for row in rig.ledger.rows)


@pytest.mark.parametrize(
    "post",
    [
        Post(HttpReply(500)),
        Post(HttpReply(401)),
        Post(raises=TimeoutError("timed out")),
        Post(raises=OSError(f"boom {KEY}")),
        Post(raises=RuntimeError("an unexpected bug")),
        Post(HttpReply(200, b"<html>not json</html>")),
        Post(HttpReply(200, vl_body("I see a letter."))),
        Post(HttpReply(200, vl_body('{"summary": "no findings key"}'))),
        Post(HttpReply(200, vl_body('{"findings": [{"text": "cut', finish="length"))),
    ],
    ids=["500", "401", "timeout", "oserror", "bug", "not-json", "prose", "bad-shape", "stopped"],
)
def test_any_vl_failure_falls_back_to_the_claude_leg(
    rig: Rig, session: AdoptSession, post: Post
) -> None:
    outcome = run(session, drop(session, "scan.png", png(800, 1000)), VL_ON, post)
    assert len(post.sent) == 1 and claude_calls(rig) == 1
    assert outcome.status == "done" and outcome.summary == "A deposit report (Claude)."


def test_the_key_appears_in_no_output(
    rig: Rig, session: AdoptSession, capsys: pytest.CaptureFixture[str]
) -> None:
    outcomes = [
        run(session, drop(session, "a.png", png(800, 1000)), VL_ON, ok_post()),
        run(session, drop(session, "b.png", png(800, 1000)), VL_ON, Post(HttpReply(403))),
        run(
            session,
            drop(session, "c.png", png(800, 1000)),
            VL_ON,
            Post(raises=OSError(f"could not reach {KEY}")),
        ),
    ]
    seen = [
        repr(outcomes),
        repr(rig.ledger.rows),
        repr(session.events_after(0)),
        repr([(c.prompt, c.argv) for c in rig.model.calls]),
        *capsys.readouterr(),
    ]
    assert all(KEY not in text for text in seen)


# --- picture headers ----------------------------------------------------------------------------


def jpeg(width: int, height: int) -> bytes:
    app0 = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\0\x01\x01\0\0\x01\0\x01\0\0"
    sof = b"\xff\xc0" + struct.pack(">HBHHB", 11, 8, height, width, 1) + b"\x01\x11\x00"
    return b"\xff\xd8" + app0 + sof + b"\xff\xd9"


def webp(chunk: bytes, payload: bytes) -> bytes:
    data = chunk + struct.pack("<I", len(payload)) + payload
    return b"RIFF" + struct.pack("<I", 4 + len(data)) + b"WEBP" + data


def test_sniff_reads_png_jpeg_and_the_three_webp_kinds() -> None:
    assert sniff_image(png(992, 1404)) == ("image/png", 992, 1404)
    assert sniff_image(jpeg(1200, 900)) == ("image/jpeg", 1200, 900)
    lossy = b"\x00\x00\x00" + b"\x9d\x01\x2a" + struct.pack("<HH", 640, 480)
    assert sniff_image(webp(b"VP8 ", lossy)) == ("image/webp", 640, 480)
    bits = (640 - 1) | ((480 - 1) << 14)
    assert sniff_image(webp(b"VP8L", b"\x2f" + struct.pack("<I", bits))) == (
        "image/webp",
        640,
        480,
    )
    extended = b"\0\0\0\0" + (1999).to_bytes(3, "little") + (99).to_bytes(3, "little")
    assert sniff_image(webp(b"VP8X", extended)) == ("image/webp", 2000, 100)
    assert sniff_image(b"GIF89a" + b"\0" * 30) is None
    assert sniff_image(b"\xff\xd8\xff") is None


def test_a_jpeg_is_sent_as_image_jpeg(rig: Rig, session: AdoptSession) -> None:
    post = ok_post()
    run(session, drop(session, "photo.jpeg", jpeg(1200, 900)), VL_ON, post)
    url = post.sent[0]["body"]["messages"][1]["content"][1]["image_url"]["url"]
    assert url.startswith("data:image/jpeg;base64,") and claude_calls(rig) == 0
