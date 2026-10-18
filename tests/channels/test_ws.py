"""The WebSocket codec, both halves, against the RFC's own examples (channels/voice/ws.py)."""

from __future__ import annotations

import io
import struct

import pytest

from athena.channels.voice.ws import (
    MAX_FRAGMENTS,
    MAX_FRAME_BYTES,
    FrameTooLarge,
    Message,
    WebSocket,
    WebSocketError,
    accept_key,
    protocol_token,
)


class _Pipe:
    """A client and a server that share two byte buffers, so a frame written by one is read by
    the other and nothing else is in the loop."""

    def __init__(self) -> None:
        self.to_server = io.BytesIO()
        self.to_client = io.BytesIO()

    def client(self) -> WebSocket:
        return WebSocket(self.to_client, self.to_server, masked=True)

    def server(self) -> WebSocket:
        return WebSocket(self.to_server, self.to_client, masked=False)

    @staticmethod
    def rewind(buffer: io.BytesIO) -> None:
        buffer.seek(0)


def test_the_accept_key_matches_the_rfc_example() -> None:
    assert accept_key("dGhlIHNhbXBsZSBub25jZQ==") == "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="


def test_the_token_rides_the_subprotocol_list() -> None:
    assert protocol_token("athena-token.abc") == "abc"
    assert protocol_token("chat, athena-token.abc, other") == "abc"
    assert protocol_token("chat") is None
    assert protocol_token("athena-token.") is None
    assert protocol_token("") is None


@pytest.mark.parametrize("size", [0, 5, 125, 126, 65535, 65536, 200_000])
def test_a_client_frame_is_masked_and_a_server_reads_it_back(size: int) -> None:
    pipe = _Pipe()
    payload = bytes(range(256)) * (size // 256 + 1)
    payload = payload[:size]
    pipe.client().send_binary(payload)
    raw = pipe.to_server.getvalue()
    assert raw[1] & 0x80, "a client frame carries the mask bit"
    pipe.rewind(pipe.to_server)
    assert pipe.server().recv() == Message("binary", payload)


def test_a_server_frame_is_bare_and_a_client_reads_it_back() -> None:
    pipe = _Pipe()
    pipe.server().send_text("héllo")
    raw = pipe.to_client.getvalue()
    assert not raw[1] & 0x80, "a server frame carries no mask"
    pipe.rewind(pipe.to_client)
    got = pipe.client().recv()
    assert got is not None and got.kind == "text" and got.text == "héllo"


def test_a_frame_masked_on_the_wrong_side_is_a_violation() -> None:
    pipe = _Pipe()
    pipe.server().send_text("bare")  # a server frame...
    pipe.rewind(pipe.to_client)
    # ...read by a *server*, which requires masking, is refused.
    with pytest.raises(WebSocketError, match="masked on the wrong side"):
        WebSocket(pipe.to_client, io.BytesIO(), masked=False).recv()


def test_fragments_are_joined_and_a_ping_is_answered_in_between() -> None:
    buffer = io.BytesIO()
    # text "ab" in two fragments with a ping between them, all unmasked (a server's frames).
    buffer.write(bytes([0x01, 1]) + b"a")  # FIN=0, opcode text
    buffer.write(bytes([0x89, 2]) + b"hi")  # ping
    buffer.write(bytes([0x80, 1]) + b"b")  # FIN=1, continuation
    buffer.seek(0)
    out = io.BytesIO()
    got = WebSocket(buffer, out, masked=True).recv()
    assert got is not None and got.text == "ab"
    pong = out.getvalue()
    assert pong[0] == 0x8A and pong[1] & 0x80, "the pong went back masked, as a client's frame"


def test_a_close_frame_ends_the_stream_and_is_answered() -> None:
    pipe = _Pipe()
    pipe.client().close(1001, "going away")
    pipe.rewind(pipe.to_server)
    server = pipe.server()
    assert server.recv() is None
    assert server.close_code == 1001
    assert server.closed
    reply = pipe.to_client.getvalue()
    assert reply[0] == 0x88 and struct.unpack("!H", reply[2:4])[0] == 1000


def test_a_frame_over_the_ceiling_is_refused_before_it_is_read() -> None:
    head = bytes([0x82, 0x7F]) + struct.pack("!Q", MAX_FRAME_BYTES + 1)
    with pytest.raises(WebSocketError, match="exceeds"):
        WebSocket(io.BytesIO(head), io.BytesIO(), masked=True).recv()


def test_a_peer_that_hangs_up_mid_frame_raises_rather_than_returning_half() -> None:
    with pytest.raises(WebSocketError, match="hung up"):
        WebSocket(io.BytesIO(bytes([0x82, 10]) + b"abc"), io.BytesIO(), masked=True).recv()


def test_sending_on_a_closed_socket_raises_unless_it_is_the_close_itself() -> None:
    pipe = _Pipe()
    client = pipe.client()
    client.close()
    with pytest.raises(WebSocketError, match="closed"):
        client.send_text("late")
    client.close()  # idempotent


def _fragmented(count: int, payload: bytes = b"") -> io.BytesIO:
    """One text message of ``count`` unmasked data frames, each carrying ``payload``."""
    buffer = io.BytesIO()
    for index in range(count):
        opcode = 0x01 if index == 0 else 0x00
        fin = 0x80 if index == count - 1 else 0x00
        buffer.write(bytes([fin | opcode, len(payload)]) + payload)
    buffer.seek(0)
    return buffer


def test_a_message_of_exactly_max_fragments_frames_is_accepted() -> None:
    got = WebSocket(_fragmented(MAX_FRAGMENTS, b"a"), io.BytesIO(), masked=True).recv()
    assert got is not None and got.text == "a" * MAX_FRAGMENTS


def test_a_message_of_one_frame_more_than_max_fragments_is_refused() -> None:
    with pytest.raises(FrameTooLarge):
        WebSocket(_fragmented(MAX_FRAGMENTS + 1), io.BytesIO(), masked=True).recv()


def test_control_frames_between_fragments_do_not_count_toward_max_fragments() -> None:
    buffer = io.BytesIO()
    buffer.write(bytes([0x01, 0]))
    for _ in range(MAX_FRAGMENTS):
        buffer.write(bytes([0x8A, 0]))  # pong
    buffer.write(bytes([0x80, 0]))
    buffer.seek(0)
    got = WebSocket(buffer, io.BytesIO(), masked=True).recv()
    assert got is not None and got.text == ""


def test_the_byte_ceiling_still_raises_across_fragments() -> None:
    buffer = io.BytesIO()
    half = MAX_FRAME_BYTES // 2 + 1
    buffer.write(bytes([0x02, 0x7F]) + struct.pack("!Q", half) + b"x" * half)
    buffer.write(bytes([0x80, 0x7F]) + struct.pack("!Q", half) + b"x" * half)
    buffer.seek(0)
    with pytest.raises(FrameTooLarge):
        WebSocket(buffer, io.BytesIO(), masked=True).recv()


class _Dribble(io.BytesIO):
    """An unbuffered socket file under backpressure: each write takes only a few bytes."""

    def write(self, data: object) -> int:  # type: ignore[override]
        view = memoryview(data)  # type: ignore[arg-type]
        return super().write(bytes(view[:1000]))


def test_a_frame_the_writer_takes_in_pieces_reaches_the_reader_whole() -> None:
    pipe = _Pipe()
    pipe.to_server = _Dribble()
    payload = bytes(range(256)) * 40
    pipe.client().send_binary(payload)
    pipe.rewind(pipe.to_server)
    assert pipe.server().recv() == Message("binary", payload)
