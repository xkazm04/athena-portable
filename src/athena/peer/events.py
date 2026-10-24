"""The in-process event bus behind the loopback ``GET /events`` stream (ADR 0140, "Data & API").

A peer event happens on a thread the window is not watching - a phone files a pairing request on
the peer listener, the lifecycle tick reaps an expired peer - and the Devices surface has to hear
of it without polling. Each subscriber gets its own bounded queue; :meth:`EventBus.publish` puts
one frame on every queue and never blocks: a subscriber that stopped reading loses its oldest
frames rather than holding up the thread that published (the stream is a notification, and
``GET /devices`` is the state).

The kinds today are ``pair.requested`` and ``peer.changed``; ``remote.message`` is WP3's, published
through the same :meth:`EventBus.publish` from its own module. A payload is a JSON object and
always carries ``kind`` (the event's); ``pair.requested`` carries the pending row under
``pending`` and ``peer.changed`` the ``peer_id`` it was about, or ``null``. No payload carries a
token, a nonce or a claim secret.

**A quiet stream ends, and the reader reconnects.** The daemon's law is one request per connection
with every response ending (ADR 0011; ``tests/e2e`` reads every route to its end). So a stream that
has carried nothing for :data:`QUIET_S` closes, after telling the reader ``retry: 1000`` - which a
browser ``EventSource`` obeys by reconnecting a second later on its own. A frame published in that
second is missed by that reader; it re-reads ``GET /devices``, which is the state, on reconnect.
"""

from __future__ import annotations

import json
import queue
import threading
from collections.abc import Iterator
from contextlib import suppress
from typing import Any

__all__ = ["QUEUE_DEPTH", "QUIET_S", "RETRY_MS", "EventBus", "event_frame"]

#: How long a stream may carry nothing before it ends. Also bounds how long a reader that went away
#: holds a worker thread.
QUIET_S = 15.0
#: What the stream tells an ``EventSource`` to wait before it reconnects.
RETRY_MS = 1000
QUEUE_DEPTH = 256

#: Put on every queue at close, so each stream ends instead of waiting out its heartbeat.
_CLOSED: dict[str, Any] = {"kind": "__closed__"}


def event_frame(payload: dict[str, Any]) -> str:
    """One event as one SSE frame: ``event:`` its kind, ``data:`` the object on one line."""
    return f"event: {payload['kind']}\ndata: {json.dumps(payload, sort_keys=True)}\n\n"


class EventBus:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._queues: list[queue.Queue[dict[str, Any]]] = []
        self._closed = False

    def publish(self, kind: str, /, **fields: Any) -> None:
        payload = {**fields, "kind": kind}
        with self._lock:
            targets = list(self._queues)
        for target in targets:
            _offer(target, payload)

    def subscribe(self) -> queue.Queue[dict[str, Any]]:
        inbox: queue.Queue[dict[str, Any]] = queue.Queue(QUEUE_DEPTH)
        with self._lock:
            if self._closed:
                inbox.put_nowait(_CLOSED)
            self._queues.append(inbox)
        return inbox

    def unsubscribe(self, inbox: queue.Queue[dict[str, Any]]) -> None:
        with self._lock, suppress(ValueError):
            self._queues.remove(inbox)

    def close(self) -> None:
        with self._lock:
            self._closed = True
            targets = list(self._queues)
        for target in targets:
            _offer(target, _CLOSED)

    def frames(self, quiet_s: float = QUIET_S) -> Iterator[str]:
        """An SSE stream for one subscriber: the retry hint, then frames until quiet or close."""
        inbox = self.subscribe()
        try:
            yield f": athena events\nretry: {RETRY_MS}\n\n"
            while True:
                try:
                    payload = inbox.get(timeout=quiet_s)
                except queue.Empty:
                    return
                if payload is _CLOSED:
                    return
                yield event_frame(payload)
        finally:
            self.unsubscribe(inbox)


def _offer(target: queue.Queue[dict[str, Any]], payload: dict[str, Any]) -> None:
    while True:
        try:
            target.put_nowait(payload)
            return
        except queue.Full:
            with suppress(queue.Empty):
                target.get_nowait()
