"""Write-once memory replication between paired PCs (ADR 0140, "Memory replication"; WP2).

Every device is a full Athena with its own brain, and "one Athena everywhere" means what one of
them remembers the others come to remember. Not all of a brain can travel that way honestly. A
goal, a case or a ritual is *rewritten* in place, so two copies of one diverge and a merge has to
pick a winner - that is versioned last-writer-wins, and it is v2. Episodes, facts and procedurals
are **write-once** (no rewrite path exists for them in :mod:`athena.core.brain.store`; ADR 0234
makes the memory wall's two acts new records too), so a copy can never be stale: a device either
has a memory, byte for byte, or it does not yet. That is the whole of what replicates here, and it
is why this is a pull of files rather than a sync protocol.

**Serving** (grant ``memory``, :func:`peer_routes`):

``GET /peer/brain/manifest?since=<iso>&after=<id>``
    ``{items: [{id, kind, created, sha256, path}], next, next_after, truncated}``, oldest first,
    at most :data:`MANIFEST_PAGE` items. ``next`` (with ``next_after``, the last id) is where the
    next page starts, or ``null`` when this page is the end - the truncation announcement of a
    bounded answer. ``since`` is inclusive and ``after`` breaks a tie on one stamp, so a page that
    is all one instant still moves on. Only the three write-once kinds are listed, read from the
    index and hashed from the bytes on disk; goals, cases, rituals, reflections, cycles, the
    backlog, ``index.sqlite`` and ``brain/.peer/`` are never in it, because the query names its
    kinds and the path of every row must be one :func:`~athena.core.brain.store.replicated_path`
    accepts.
``GET /peer/brain/file?id=<id>``
    The file exactly as on disk, ``text/markdown``, or ``404 not_found``.

**Pulling** (:class:`Puller`). A peer is pulled when *this* device granted it ``memory`` and holds
a sealed key for it (:class:`~athena.peer.client.PeerKeys`); the other half - that the peer
granted this device ``memory`` - is the peer's answer to decide: a 403 there is recorded as
``not_shared`` and nothing more, and a 401 - the peer no longer knows this device's token, so it
removed this device - as ``removed_there`` (ADR 0140 "Link state"). A pass reads the manifest
from the cursor, applies **episodes first, then facts and procedurals**, and files each through
:meth:`Brain.receive_file <athena.core.brain.store.Brain.receive_file>`: the brain's own atomic
writer (ADR 0080), the same provenance gate every writer passes, the same per-file index function
the rebuild uses. So:

- same id, same sha: skipped;
- same id, different sha: the local file stays and the remote copy is kept at
  ``brain/.peer/conflicts/<id>.<peer_id>.md`` for a person, and counted - a write-once id with two
  bodies is a fault to look at, never something to resolve by guessing;
- a fact or procedural citing an episode that has not arrived: deferred to the next pass, never
  written with a dead source - provenance is not bypassed for a copy;
- new: written at the path the sender used, which must be the path this brain's own writer would
  have chosen, so a path cannot climb out of its directory. Its ``device:`` stamp comes with it;
- stamped with a project this brain holds an erase tombstone for, and written at or before it:
  skipped, so an erase is never pulled back (ADR 0234).

The memory wall's two acts travel as write-once records too (ADR 0234): a promotion is a new core
memory that closes the stamped one, and an erase is a retired core fact that ``erases`` the space,
which :meth:`Brain.receive_file` applies to this brain as its own erase.

**The cursor** (``brain/.peer/cursors.json``, ``{peer_id: iso}``) is the newest ``created`` a pass
saw, held back to the oldest item it could not finish (deferred, or a fetch that failed), minus
:data:`SKEW` - ten minutes, because two PCs' clocks disagree and a stamp format can sort a second
out of place. Re-reading that margin costs nothing: an id already here is skipped. The cursor
follows ``created``, so a memory that reached the peer late from a *third* device with an old
stamp is not seen here through that peer; it arrives directly from the device that wrote it, which
is the fleet shape v1 assumes (every PC paired with every PC).

**When.** A thread subscribed to the peer host's event bus pulls once at start, again on every
``peer.changed`` (a pairing completed, a key arrived, a grant changed), and every
:data:`PULL_EVERY_S` between; it ends when the bus closes, which is the host's
:meth:`~athena.peer.listener.PeerHost.close`. A pass is bounded (:data:`MAX_PAGES` manifest pages
per peer) and passes never overlap. :func:`memory_view` is the per-peer status ``GET /devices``
shows under ``memory``: ``{last_pull_at, pulled, conflicts, deferred, state}`` with ``state`` one
of ``ok``, ``not_shared``, ``removed_there``, ``unreachable``, or ``null`` for a peer never
pulled.

Nothing here logs a token, a body or a URL. The manifest is fetched with
:func:`~athena.peer.client.call`; the one call that wants bytes rather than JSON, the file, goes
through :func:`fetch_file`, which keeps ``call``'s rules - fixed timeout, a read cap,
``Connection: close``, failures reduced to the exception's type.
"""

from __future__ import annotations

import hashlib
import json
import os
import queue
import secrets
import sqlite3
import threading
import time
import weakref
from collections.abc import Callable
from contextlib import closing
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from http.client import HTTPConnection
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import quote, urlsplit

from athena.contracts import ids
from athena.core.brain.store import (
    REPLICATED_KINDS,
    Brain,
    ErasedRefused,
    ProvenanceError,
    replicated_path,
)
from athena.daemon.routes import BinaryReply
from athena.peer.client import CALL_TIMEOUT_S, call
from athena.peer.identity import now_iso, write_whole
from athena.peer.listener import PeerRoute, _log, peer_error

if TYPE_CHECKING:
    from athena.daemon.routes import Reply, Request
    from athena.peer.listener import PeerHost

__all__ = [
    "CONFLICTS_DIRNAME",
    "CURSORS_FILENAME",
    "MANIFEST_PAGE",
    "PEER_DIRNAME",
    "PULL_EVERY_S",
    "SKEW",
    "PassResult",
    "Puller",
    "brain_routes",
    "fetch_file",
    "manifest",
    "memory_view",
    "peer_routes",
]

#: The brain's own peer directory: cursors and conflicts. Not in the tree a rebuild walks, so
#: nothing in it is ever indexed, and never served.
PEER_DIRNAME = ".peer"
CURSORS_FILENAME = "cursors.json"
CONFLICTS_DIRNAME = "conflicts"
#: Items per manifest page, and pages per peer per pass.
MANIFEST_PAGE = 500
MAX_PAGES = 40
PULL_EVERY_S = 60.0
#: How far behind the newest stamp seen the cursor is kept (clock skew between devices).
SKEW = timedelta(minutes=10)
#: The largest memory file fetched. A memory is a few kilobytes; this caps a broken peer.
MAX_FILE_BYTES = 4 * 1_048_576
#: The order a pass applies kinds in: evidence before the claims that cite it.
APPLY_ORDER: dict[str, int] = {"episode": 0, "fact": 1, "procedural": 1}
_KINDS_SQL = ", ".join(f"'{kind}'" for kind in REPLICATED_KINDS)


def _instant(stamp: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(stamp)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _local_bytes(brain: Brain, rel: str) -> bytes | None:
    try:
        return (brain.root / rel).read_bytes()
    except OSError:
        return None


# --- serving -------------------------------------------------------------------------------------


def manifest(
    brain: Brain, since: str | None, after: str | None = None, *, limit: int = MANIFEST_PAGE
) -> dict[str, Any]:
    """One page of this brain's write-once memories from ``since`` (inclusive), oldest first.

    Ordered by ``(created, id)`` on the index's own ``created_at`` column, so a page boundary is a
    point in that order and ``after`` resumes exactly past it. A row whose path is not one this
    brain's writer would have chosen (a foreign tree's layout) or whose file is gone is left out:
    what cannot be filed where the receiver files it is not offered.
    """
    clauses = [f"kind IN ({_KINDS_SQL})"]
    args: list[Any] = []
    if since is not None and after is not None:
        clauses.append("(created_at > ? OR (created_at = ? AND id > ?))")
        args += [since, since, after]
    elif since is not None:
        clauses.append("created_at >= ?")
        args.append(since)
    with closing(brain.read_connection()) as con:
        rows = con.execute(
            f"""SELECT id, kind, file_path, created_at FROM companion_node
                WHERE {" AND ".join(clauses)} ORDER BY created_at, id LIMIT ?""",
            (*args, limit + 1),
        ).fetchall()
    truncated = len(rows) > limit
    page = rows[:limit]
    items: list[dict[str, Any]] = []
    for node_id, kind, rel, created in page:
        try:
            if replicated_path(str(kind), str(rel)) != node_id:
                continue
        except ValueError:
            continue
        data = _local_bytes(brain, str(rel))
        if data is None:
            continue
        items.append(
            {
                "id": str(node_id),
                "kind": str(kind),
                "created": str(created),
                "sha256": _sha(data),
                "path": str(rel),
            }
        )
    last = page[-1] if truncated and page else None
    return {
        "ok": True,
        "items": items,
        "next": str(last[3]) if last is not None else None,
        "next_after": str(last[0]) if last is not None else None,
        "truncated": truncated,
    }


def manifest_route(brain: Brain, request: Request) -> Reply:
    since = request.query.get("since")
    after = request.query.get("after")
    if since is not None:
        instant = _instant(since)
        if instant is None:
            return peer_error(400, "bad_request", "since must be an ISO 8601 stamp")
        # The index's stamps are UTC with an explicit offset (``contracts.channel.iso``); a since
        # in any other spelling of the same instant compares as theirs do.
        since = instant.astimezone(UTC).isoformat()
    if after is not None and (since is None or ids.kind_of(after) not in REPLICATED_KINDS):
        return peer_error(400, "bad_request", "after is a memory id, and needs since")
    return 200, manifest(brain, since, after)


def file_route(brain: Brain, request: Request) -> Reply | BinaryReply:
    node_id = request.query.get("id") or ""
    kind = ids.kind_of(node_id)
    node = brain.node(node_id) if kind in REPLICATED_KINDS else None
    if node is None or node.kind != kind:
        return peer_error(404, "not_found", "no such memory here")
    try:
        if replicated_path(node.kind, node.file_path) != node_id:
            raise ValueError(node.file_path)
    except ValueError:
        return peer_error(404, "not_found", "no such memory here")
    data = _local_bytes(brain, node.file_path)
    if data is None:
        return peer_error(404, "not_found", "no such memory here")
    return BinaryReply(200, data, "text/markdown; charset=utf-8")


def brain_routes(brain: Brain) -> list[PeerRoute]:
    """The two serving routes, both behind grant ``memory``."""
    return [
        PeerRoute(
            "GET",
            "/peer/brain/manifest",
            lambda request: manifest_route(brain, request),
            grant="memory",
        ),
        PeerRoute(
            "GET", "/peer/brain/file", lambda request: file_route(brain, request), grant="memory"
        ),
    ]


def peer_routes(host: PeerHost, brain: Brain) -> list[PeerRoute]:
    """:func:`brain_routes`, and this host's :class:`Puller`, started.

    The puller is created here, beside the routes, so the one registration line in
    :func:`athena.wiring._wire_peer` is all the wiring replication needs; it ends when the host
    closes its event bus.
    """
    Puller(host, brain).start()
    return brain_routes(brain)


# --- the outbound file call ----------------------------------------------------------------------


def fetch_file(
    base_url: str, node_id: str, *, token: str, timeout: float = CALL_TIMEOUT_S
) -> tuple[int, bytes]:
    """``GET /peer/brain/file?id=<id>`` on a peer: ``(status, bytes)``, status 0 if unreached."""
    parts = urlsplit(base_url)
    if parts.scheme != "http" or not parts.hostname:
        return 0, b""
    connection = HTTPConnection(parts.hostname, parts.port or 80, timeout=timeout)
    try:
        connection.request(
            "GET",
            f"/peer/brain/file?id={quote(node_id)}",
            headers={"Authorization": f"Bearer {token}", "Connection": "close"},
        )
        reply = connection.getresponse()
        data = reply.read(MAX_FILE_BYTES + 1)
    except (OSError, ValueError):
        return 0, b""
    finally:
        connection.close()
    if len(data) > MAX_FILE_BYTES:
        return 0, b""
    return reply.status, data


# --- pulling -------------------------------------------------------------------------------------


@dataclass
class PassResult:
    """What one pass against one peer did."""

    state: str
    pulled: int = 0
    skipped: int = 0
    conflicts: int = 0
    deferred: int = 0
    refused: int = 0
    failed: int = 0


@dataclass
class _Status:
    last_pull_at: str
    state: str
    pulled: int = 0
    deferred: int = 0

    def view(self, conflicts: int) -> dict[str, Any]:
        return {
            "last_pull_at": self.last_pull_at,
            "pulled": self.pulled,
            "conflicts": conflicts,
            "deferred": self.deferred,
            "state": self.state,
        }


@dataclass(frozen=True)
class _Item:
    id: str
    kind: str
    created: str
    sha256: str
    path: str

    @staticmethod
    def parse(data: Any) -> _Item | None:
        """A manifest item from a peer, or ``None``: every field checked, the path above all."""
        if not isinstance(data, dict):
            return None
        node_id, kind = data.get("id"), data.get("kind")
        created, digest, rel = data.get("created"), data.get("sha256"), data.get("path")
        if not all(isinstance(v, str) for v in (node_id, kind, created, digest, rel)):
            return None
        assert isinstance(node_id, str) and isinstance(kind, str) and isinstance(rel, str)
        assert isinstance(created, str) and isinstance(digest, str)
        if kind not in REPLICATED_KINDS or _instant(created) is None:
            return None
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            return None
        try:
            if replicated_path(kind, rel) != node_id:
                return None
        except ValueError:
            return None
        return _Item(node_id, kind, created, digest, rel)


@dataclass
class _Pass:
    result: PassResult
    newest: datetime | None = None
    #: The oldest item this pass could not finish: the cursor may not move past it.
    held: datetime | None = None
    items: dict[str, _Item] = field(default_factory=dict)

    def saw(self, item: _Item) -> None:
        instant = _instant(item.created)
        if instant is not None and (self.newest is None or instant > self.newest):
            self.newest = instant

    def hold(self, item: _Item) -> None:
        instant = _instant(item.created)
        if instant is not None and (self.held is None or instant < self.held):
            self.held = instant


_PULLERS: weakref.WeakKeyDictionary[PeerHost, Puller] = weakref.WeakKeyDictionary()


def memory_view(host: PeerHost, peer_id: str) -> dict[str, Any] | None:
    """The replication status ``GET /devices`` shows for one peer, ``None`` if never pulled."""
    puller = _PULLERS.get(host)
    return None if puller is None else puller.view(peer_id)


class Puller:
    """Pulls every peer this device shares memory with, into one brain, one pass at a time."""

    def __init__(
        self,
        host: PeerHost,
        brain: Brain,
        *,
        every_s: float = PULL_EVERY_S,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self.host = host
        self.brain = brain
        self.every_s = every_s
        self._now = now or host.now
        self.dir = brain.root / PEER_DIRNAME
        self.cursors_path = self.dir / CURSORS_FILENAME
        self.conflicts_dir = self.dir / CONFLICTS_DIRNAME
        self._lock = threading.Lock()
        self._pass = threading.Lock()
        self._status: dict[str, _Status] = {}
        self._cursors = self._load_cursors()
        self._thread: threading.Thread | None = None
        self._inbox: queue.Queue[dict[str, Any]] | None = None
        self._again = False
        self._closed = threading.Event()
        _PULLERS[host] = self

    # -- the loop ------------------------------------------------------------------------------

    def start(self) -> None:
        if self._thread is not None:
            return
        inbox = self._inbox = self.host.bus.subscribe()
        self._thread = threading.Thread(
            target=self._run, args=(inbox,), name="peer-replicate", daemon=True
        )
        self._thread.start()

    def close(self, timeout: float = 10.0) -> None:
        """Stop after the item in hand. The bus closing does the same; this also waits."""
        self._closed.set()
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=timeout)

    def _run(self, inbox: queue.Queue[dict[str, Any]]) -> None:
        due = 0.0
        try:
            while not self._closed.is_set():
                try:
                    payload: dict[str, Any] | None = inbox.get(
                        timeout=max(0.0, due - time.monotonic())
                    )
                except queue.Empty:
                    payload = None
                kind = None if payload is None else payload.get("kind")
                if kind == "__closed__":
                    return
                if payload is not None and kind != "peer.changed":
                    continue
                self._again = False
                try:
                    self.pull_all()
                except Exception as exc:  # a pass's bug must not end the loop
                    _log(f"replication pass raised {type(exc).__name__}")
                # A ``peer.changed`` heard during the pass is a reason to go again now.
                due = 0.0 if self._again else time.monotonic() + self.every_s
        finally:
            self._closed.set()
            self.host.bus.unsubscribe(inbox)

    def _stopping(self) -> bool:
        """Has the host closed? Read off the inbox between items, without waiting.

        A pass can take a while against a slow peer, and the brain is closed right after the host
        (``AthenaLocal.close``), so the pass looks between items rather than finishing first.
        """
        inbox = self._inbox
        while inbox is not None and not self._closed.is_set():
            try:
                payload = inbox.get_nowait()
            except queue.Empty:
                break
            if payload.get("kind") == "__closed__":
                self._closed.set()
            elif payload.get("kind") == "peer.changed":
                self._again = True
        return self._closed.is_set()

    # -- passes --------------------------------------------------------------------------------

    def candidates(self) -> list[tuple[str, str, str]]:
        """``(peer_id, url, token)`` for every PC this device granted ``memory`` and can call."""
        out: list[tuple[str, str, str]] = []
        for row in self.host.registry.rows():
            if row.kind != "pc" or "memory" not in row.grants:
                continue
            url = self.host.keys.url(row.peer_id)
            token = self.host.keys.token(row.peer_id) if url else None
            if url and token:
                out.append((row.peer_id, url, token))
        return out

    def pull_all(self) -> dict[str, PassResult]:
        return {
            peer_id: self.pull(peer_id, url, token)
            for peer_id, url, token in self.candidates()
            if not self._stopping()
        }

    def pull(self, peer_id: str, url: str, token: str) -> PassResult:
        """One pass against one peer: manifest from the cursor, episodes, then the rest."""
        with self._pass:
            work = _Pass(PassResult("ok"))
            since = self.cursor(peer_id)
            state = self._read_manifest(work, url, token, since)
            if state != "ok":
                return self._finish(peer_id, work, state)
            ordered = sorted(
                work.items.values(), key=lambda item: (APPLY_ORDER[item.kind], item.created)
            )
            for item in ordered:
                if self._stopping():
                    work.hold(item)
                    continue
                self._apply(peer_id, url, token, item, work)
            return self._finish(peer_id, work, "ok")

    def _read_manifest(self, work: _Pass, url: str, token: str, since: str | None) -> str:
        after: str | None = None
        for _ in range(MAX_PAGES):
            query = "" if since is None else f"?since={quote(since)}"
            if after is not None:
                query += f"&after={quote(after)}"
            answer = call(url, "GET", f"/peer/brain/manifest{query}", token=token)
            if answer.status == 401:
                return "removed_there"
            if answer.status == 403:
                return "not_shared"
            if answer.status != 200:
                return "unreachable"
            raw = answer.body.get("items")
            for entry in raw if isinstance(raw, list) else []:
                item = _Item.parse(entry)
                if item is None:
                    work.result.refused += 1
                    continue
                work.items.setdefault(item.id, item)
                work.saw(item)
            nxt, nxt_after = answer.body.get("next"), answer.body.get("next_after")
            if not isinstance(nxt, str) or not isinstance(nxt_after, str):
                return "ok"
            since, after = nxt, nxt_after
        # More pages than one pass reads: the cursor stops at the last stamp seen, and the next
        # pass carries on from there.
        return "ok"

    def _apply(self, peer_id: str, url: str, token: str, item: _Item, work: _Pass) -> None:
        result = work.result
        local = self.brain.node(item.id)
        if local is not None:
            data = _local_bytes(self.brain, local.file_path)
            if data is not None and _sha(data) == item.sha256:
                result.skipped += 1
                return
            self._conflict(peer_id, url, token, item, work)
            return
        status, data = fetch_file(url, item.id, token=token)
        if status != 200 or _sha(data) != item.sha256:
            # Unreached, gone since the manifest, or not the bytes it described: try again later.
            result.failed += 1
            work.hold(item)
            return
        try:
            self.brain.receive_file(item.kind, item.path, data)
        except ErasedRefused:
            # A memory of a project erased here, from a peer that has not heard yet (ADR 0234):
            # not filed, and not a fault - the tombstone reaches that peer on its next pull.
            result.skipped += 1
        except ProvenanceError:
            result.deferred += 1
            work.hold(item)
        except FileExistsError:
            # Filed between the check and the write (a parallel writer, or the path is taken by
            # another id): compare again on the next pass rather than guess now.
            result.failed += 1
            work.hold(item)
        except (ValueError, OSError, sqlite3.Error) as exc:
            result.refused += 1
            _log(f"replication refused {item.id} from {peer_id}: {type(exc).__name__}")
        else:
            result.pulled += 1

    def _conflict(self, peer_id: str, url: str, token: str, item: _Item, work: _Pass) -> None:
        """Keep the local file; keep the remote copy beside the brain for a person."""
        target = self.conflicts_dir / f"{item.id}.{peer_id}.md"
        existing = _read(target)
        if existing is not None and _sha(existing) == item.sha256:
            return  # already filed, already counted
        status, data = fetch_file(url, item.id, token=token)
        if status != 200 or _sha(data) != item.sha256:
            work.result.failed += 1
            work.hold(item)
            return
        _write_bytes(target, data)
        work.result.conflicts += 1
        _log(f"replication conflict on {item.id} from {peer_id}: kept the local copy")

    def _finish(self, peer_id: str, work: _Pass, state: str) -> PassResult:
        result = work.result
        result.state = state
        if state == "ok":
            moved = work.newest
            if work.held is not None and (moved is None or work.held < moved):
                moved = work.held
            if moved is not None:
                self._set_cursor(peer_id, (moved - SKEW).isoformat())
        with self._lock:
            status = self._status.get(peer_id)
            if status is None:
                status = self._status[peer_id] = _Status(now_iso(self._now()), state)
            status.last_pull_at = now_iso(self._now())
            status.state = state
            status.pulled += result.pulled
            if state == "ok":
                status.deferred = result.deferred
        return result

    # -- status --------------------------------------------------------------------------------

    def view(self, peer_id: str) -> dict[str, Any] | None:
        with self._lock:
            status = self._status.get(peer_id)
        return None if status is None else status.view(self.conflict_count(peer_id))

    def conflict_count(self, peer_id: str) -> int:
        """Conflicts filed from ``peer_id``, counted on disk: the files are the record."""
        if not self.conflicts_dir.is_dir():
            return 0
        return sum(1 for _ in self.conflicts_dir.glob(f"*.{peer_id}.md"))

    # -- the cursor file -----------------------------------------------------------------------

    def cursor(self, peer_id: str) -> str | None:
        with self._lock:
            return self._cursors.get(peer_id)

    def _set_cursor(self, peer_id: str, stamp: str) -> None:
        with self._lock:
            if self._cursors.get(peer_id) == stamp:
                return
            self._cursors[peer_id] = stamp
            write_whole(self.cursors_path, self._cursors)

    def _load_cursors(self) -> dict[str, str]:
        try:
            data = json.loads(self.cursors_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return {}
        if not isinstance(data, dict):
            return {}
        # An unreadable stamp is dropped: that peer is read from the start again, which dedupe
        # by id makes harmless.
        return {
            str(k): str(v)
            for k, v in data.items()
            if ids.is_id("device", str(k)) and isinstance(v, str) and _instant(v) is not None
        }


def _read(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except OSError:
        return None


def _write_bytes(path: Path, data: bytes) -> None:
    """``data`` at ``path``, whole or not at all (ADR 0080), as the brain writes a memory."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    try:
        with temp.open("xb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
