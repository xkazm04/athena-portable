"""A WebSocket, RFC 6455, in the standard library (README §3.5; ADR 0019).

The daemon speaks HTTP through :mod:`http.server` and nothing else, and the voice channel adds no
dependency for the sake of one framing layer: the handshake is one SHA-1, and a frame is two
header bytes, a length, an optional mask and the payload. Everything here is the codec — the
handshake key, reading a frame off a buffered file, writing one — and nothing here knows what
the payload means. That is the gateway's job.

Two rules the gateway leans on:

**A client frame is masked, a server frame is not.** The RFC requires both, and a browser closes
the connection on a server that masks. Which side this socket is on is decided once, at
construction, by ``masked``.

**A frame has a ceiling.** :data:`MAX_FRAME_BYTES` bounds what is read into memory before anything
is decoded, the way :data:`~athena.daemon.server.MAX_BODY_BYTES` bounds a request body. A
microphone sends kilobytes; a megabyte is nonsense and is refused as such.

The client half — :func:`connect` — exists so the gateway can be tested over a real socket with no
dependency, and so ``athena voice`` can be a shell-free client of the same channel.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import socket
import struct
import threading
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Literal

__all__ = [
    "GUID",
    "MAX_FRAME_BYTES",
    "PROTOCOL_PREFIX",
    "HandshakeError",
    "Message",
    "WebSocket",
    "WebSocketError",
    "accept_key",
    "connect",
    "protocol_token",
]

#: The magic string of the handshake, as the RFC spells it.
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

#: The largest frame either side will read. Audio arrives in chunks of a few kilobytes and a
#: channel event is well under one; anything near this is refused before it is decoded.
MAX_FRAME_BYTES = 1_048_576

#: The subprotocol a browser client carries the daemon token in: ``athena-token.<token>``.
#: A page's ``WebSocket`` cannot set a header, and a query string lands in URLs and histories;
#: the subprotocol list is the one request header the browser lets a page fill (ADR 0019).
PROTOCOL_PREFIX = "athena-token."

OP_CONTINUATION = 0x0
OP_TEXT = 0x1
OP_BINARY = 0x2
OP_CLOSE = 0x8
OP_PING = 0x9
OP_PONG = 0xA


class WebSocketError(Exception):
    """The peer broke the framing rules, or the socket is gone."""


class HandshakeError(WebSocketError):
    """The server answered the upgrade with something other than 101."""

    def __init__(self, status: int, body: bytes = b"") -> None:
        super().__init__(f"the upgrade was refused with {status}")
        self.status = status
        self.body = body


def accept_key(key: str) -> str:
    """``Sec-WebSocket-Accept`` for one ``Sec-WebSocket-Key``."""
    digest = hashlib.sha1((key + GUID).encode("ascii")).digest()
    return base64.b64encode(digest).decode("ascii")


def protocol_token(header: str) -> str | None:
    """The token carried in a ``Sec-WebSocket-Protocol`` list, if one entry carries one."""
    for item in header.split(","):
        name = item.strip()
        if name.startswith(PROTOCOL_PREFIX) and len(name) > len(PROTOCOL_PREFIX):
            return name[len(PROTOCOL_PREFIX) :]
    return None


@dataclass(frozen=True)
class Message:
    """One complete message, fragments joined. ``text`` is decoded, ``binary`` is bytes."""

    kind: Literal["text", "binary"]
    data: bytes

    @property
    def text(self) -> str:
        return self.data.decode("utf-8")


class WebSocket:
    """One open socket after the handshake: read a message, write one, close.

    Reads happen on one thread and writes on any, which is the gateway's shape — a reader on the
    handler thread, a worker speaking — so the write side is behind a lock and the read side is
    not. Pings are answered inside :meth:`recv`, which is the only place they can be seen.
    """

    def __init__(self, rfile: Any, wfile: Any, *, masked: bool) -> None:
        # ``Any`` because the two file objects a handler owns are ``BufferedIOBase`` and the
        # ones a client socket makes are ``SocketIO``, and neither is the other's ancestor; both
        # answer ``read``, ``write`` and ``flush``, which is all that is asked of them.
        self._rfile = rfile
        self._wfile = wfile
        self._masked = masked
        self._write_lock = threading.Lock()
        self.closed = False
        #: The client half's own socket, so a test can close it outright.
        self.sock: socket.socket | None = None
        #: The close code the peer sent, once it has.
        self.close_code: int | None = None

    # -- reading ---------------------------------------------------------------------------------

    def recv(self) -> Message | None:
        """The next text or binary message, or ``None`` once the peer has closed.

        A ping is answered and skipped, a pong is skipped, and a close frame is answered with a
        close frame — so a well-behaved peer sees the closing handshake complete — and ends the
        stream. A protocol violation raises; the caller closes with 1002.
        """
        parts: list[bytes] = []
        first_opcode: int | None = None
        while True:
            fin, opcode, payload = self._read_frame()
            if opcode == OP_CLOSE:
                self.close_code = struct.unpack("!H", payload[:2])[0] if len(payload) >= 2 else 1005
                self._reply_close()
                return None
            if opcode == OP_PING:
                self._send_frame(OP_PONG, payload)
                continue
            if opcode == OP_PONG:
                continue
            if opcode in (OP_TEXT, OP_BINARY):
                if first_opcode is not None:
                    raise WebSocketError("a new message began inside a fragmented one")
                first_opcode = opcode
            elif opcode == OP_CONTINUATION:
                if first_opcode is None:
                    raise WebSocketError("a continuation frame with nothing to continue")
            else:
                raise WebSocketError(f"unknown opcode {opcode:#x}")
            parts.append(payload)
            if sum(len(p) for p in parts) > MAX_FRAME_BYTES:
                raise WebSocketError("message exceeds MAX_FRAME_BYTES")
            if fin:
                data = b"".join(parts)
                if first_opcode == OP_TEXT:
                    try:
                        data.decode("utf-8")
                    except UnicodeDecodeError as exc:
                        raise WebSocketError("text frame is not UTF-8") from exc
                    return Message("text", data)
                return Message("binary", data)

    def _read_exact(self, n: int) -> bytes:
        chunks: list[bytes] = []
        remaining = n
        while remaining > 0:
            try:
                chunk = self._rfile.read(remaining)
            except (OSError, ValueError) as exc:
                raise WebSocketError("the socket is gone") from exc
            if not chunk:
                raise WebSocketError("the peer hung up mid-frame")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _read_frame(self) -> tuple[bool, int, bytes]:
        head = self._read_exact(2)
        fin = bool(head[0] & 0x80)
        if head[0] & 0x70:
            raise WebSocketError("reserved bits set with no extension negotiated")
        opcode = head[0] & 0x0F
        masked = bool(head[1] & 0x80)
        length = head[1] & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._read_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._read_exact(8))[0]
        if length > MAX_FRAME_BYTES:
            raise WebSocketError("frame exceeds MAX_FRAME_BYTES")
        if opcode >= OP_CLOSE and (length > 125 or not fin):
            raise WebSocketError("a control frame must be short and whole")
        # The side that must mask is the side that is not us: a server reads masked frames and
        # writes bare ones; a client the reverse. A frame masked the wrong way is a violation.
        if masked == self._masked:
            raise WebSocketError("frame masked on the wrong side")
        mask = self._read_exact(4) if masked else b""
        payload = self._read_exact(length)
        if masked:
            payload = _xor_mask(payload, mask)
        return fin, opcode, payload

    # -- writing ---------------------------------------------------------------------------------

    def send_text(self, text: str) -> None:
        self._send_frame(OP_TEXT, text.encode("utf-8"))

    def send_binary(self, data: bytes) -> None:
        self._send_frame(OP_BINARY, data)

    def ping(self, payload: bytes = b"") -> None:
        self._send_frame(OP_PING, payload)

    def close(self, code: int = 1000, reason: str = "") -> None:
        """Send a close frame once. Safe to call twice and after the peer closed."""
        if self.closed:
            return
        self.closed = True
        payload = struct.pack("!H", code) + reason.encode("utf-8")[:123]
        with suppress(WebSocketError):
            self._send_frame(OP_CLOSE, payload, force=True)

    def _reply_close(self) -> None:
        if not self.closed:
            self.closed = True
            with suppress(WebSocketError):
                self._send_frame(OP_CLOSE, struct.pack("!H", 1000), force=True)

    def _send_frame(self, opcode: int, payload: bytes, *, force: bool = False) -> None:
        if self.closed and not force:
            raise WebSocketError("the socket is closed")
        head = bytearray([0x80 | opcode])
        length = len(payload)
        mask_bit = 0x80 if self._masked else 0
        if length < 126:
            head.append(mask_bit | length)
        elif length < 65536:
            head.append(mask_bit | 126)
            head += struct.pack("!H", length)
        else:
            head.append(mask_bit | 127)
            head += struct.pack("!Q", length)
        if self._masked:
            mask = secrets.token_bytes(4)
            head += mask
            payload = _xor_mask(payload, mask)
        with self._write_lock:
            try:
                self._wfile.write(bytes(head) + payload)
                self._wfile.flush()
            except (OSError, ValueError) as exc:
                self.closed = True
                raise WebSocketError("the socket is gone") from exc


def _xor_mask(payload: bytes, mask: bytes) -> bytes:
    """Mask or unmask in one integer XOR — audio is kilobytes a frame, and a byte loop is not."""
    if not payload:
        return payload
    n = len(payload)
    key = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(payload, "big") ^ int.from_bytes(key, "big")).to_bytes(n, "big")


# --- the client half -----------------------------------------------------------------------------


def connect(
    host: str,
    port: int,
    path: str,
    *,
    token: str,
    origin: str = "",
    timeout: float | None = 10.0,
    header_token: bool = False,
) -> WebSocket:
    """Open a WebSocket to the daemon and return it after the handshake.

    The token rides the subprotocol by default, exactly as a browser client sends it, or the
    ``X-Athena-Token`` header when ``header_token`` is set — both are what the server accepts. A
    refused upgrade raises :class:`HandshakeError` with the status and the JSON body the daemon
    answered, so a test can assert the refusal's reason.
    """
    sock = socket.create_connection((host, port), timeout=timeout)
    key = base64.b64encode(secrets.token_bytes(16)).decode("ascii")
    lines = [
        f"GET {path} HTTP/1.1",
        f"Host: {host}:{port}",
        "Upgrade: websocket",
        "Connection: Upgrade",
        f"Sec-WebSocket-Key: {key}",
        "Sec-WebSocket-Version: 13",
    ]
    if header_token:
        lines.append(f"X-Athena-Token: {token}")
    else:
        lines.append(f"Sec-WebSocket-Protocol: {PROTOCOL_PREFIX}{token}")
    if origin:
        lines.append(f"Origin: {origin}")
    rfile = sock.makefile("rb", buffering=0)
    wfile = sock.makefile("wb", buffering=0)
    wfile.write(("\r\n".join(lines) + "\r\n\r\n").encode("ascii"))
    wfile.flush()

    status_line = rfile.readline()
    try:
        status = int(status_line.split(b" ")[1])
    except (IndexError, ValueError) as exc:
        sock.close()
        raise WebSocketError(f"not an HTTP reply: {status_line!r}") from exc
    headers: dict[str, str] = {}
    while True:
        line = rfile.readline()
        if line in (b"\r\n", b"\n", b""):
            break
        name, _, value = line.decode("latin-1").partition(":")
        headers[name.strip().lower()] = value.strip()
    if status != 101:
        body = b""
        length = int(headers.get("content-length") or 0)
        if length:
            body = rfile.read(length)
        sock.close()
        raise HandshakeError(status, body)
    if headers.get("sec-websocket-accept") != accept_key(key):
        sock.close()
        raise WebSocketError("the server's accept key is wrong")
    # The socket outlives this function; a timeout on a voice channel is the gateway's business.
    sock.settimeout(timeout)
    ws = WebSocket(rfile, wfile, masked=True)
    ws.sock = sock
    return ws
