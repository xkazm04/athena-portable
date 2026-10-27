"""ADR 0225 (projects are walled spaces): the daemon's ``/spaces`` routes.

Mounted by wiring beside the adopt studio's, and like them they never take the daemon's write lock:
a space is one small file under its book's own lock, and a turn in another conversation never
waits for one. Every answer is the contract's shape, key for key; a refusal is the one error
shape, with the finer word a surface acts on (``bad_request``, ``space_busy``) beside ``reason``
as ``error`` (:func:`athena.daemon.routes.refusal`).

``GET /spaces``
    ``{"spaces": [SpaceSummary]}``, most recently updated first. Bounded by the book, which holds
    at most :data:`~athena.spaces.book.MAX_SPACES`, so the answer is never cut.
``POST /spaces`` ``{name, brief?, apps?, hue?}``
    A new space -> its ``SpaceSummary``, 201. A value past a cap is 400 ``bad_request`` naming
    the cap; nothing is cut.
``GET /spaces/<id>``
    Its ``SpaceSummary``, or 404 ``unknown_ref``.
``POST /spaces/<id>`` any of ``{name, brief, apps, hue}``
    A patch -> the ``SpaceSummary`` as it now stands.
``DELETE /spaces/<id>``
    Erase it -> ``SpaceErased``: every memory stamped with it (:func:`erase_space_memory`), its
    chores back in core (``space_id: ""``, the chore and its runs untouched), then its file. While
    a turn runs in it the answer is 409 ``space_busy`` and nothing is erased; while it is being
    erased no turn starts in it.
``GET /spaces/<id>/memory?kind=&limit=``
    ``{"rows": [SpaceMemoryRow], "showing": n, "total": m}``. ``<id>`` may be ``core``; ``kind``
    is ``episode``, ``fact`` or ``procedural`` (none is every kind); ``limit`` is 1 to 200, 50 by
    default, and a larger one is held to 200.
``POST /spaces/<id>/memory/<mem_id>/core``
    The fact or procedural ``mem_id`` loses the space's stamp and is core's from now on ->
    ``{"id", "kind"}``. An episode is 400 ``bad_request``: it stays a record of where it was said.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import asdict
from typing import TYPE_CHECKING

from athena.contracts import ids
from athena.contracts.spaces import (
    CORE,
    CORE_ITEM,
    MEMORY_KINDS,
    MEMORY_LIMIT,
    MEMORY_LIMIT_MAX,
    Space,
    SpaceErased,
    SpaceMemoryKind,
    SpaceSummary,
)
from athena.core.brain import UnstampRefused
from athena.daemon.routes import Reply, Request, Route, error, refusal
from athena.spaces.book import SpaceBook, SpaceInvalid, check_input
from athena.spaces.memory import (
    erase_space_memory,
    promote_to_core,
    space_counts,
    space_memory_page,
)

if TYPE_CHECKING:
    from athena.adopt.cases import CaseBook
    from athena.daemon.server import AthenaDaemon

__all__ = ["SPACES_PATH", "SPACES_PREFIX", "space_routes", "space_summary"]

SPACES_PATH = "/spaces"
SPACES_PREFIX = "/spaces/"


def space_summary(daemon: AthenaDaemon, space: Space, chores: int) -> SpaceSummary:
    """``space`` on the wire, with its counts: its memory through the one seam that reads the
    stamp (:func:`space_counts`), and ``chores``, the cases the caller found linked to it."""
    return SpaceSummary(
        id=space.id,
        name=space.name,
        brief=space.brief,
        apps=space.apps,
        hue=space.hue,
        created=space.created,
        updated=space.updated,
        counts=space_counts(daemon.brain, space.id, chores=chores),
    )


def _linked(cases: CaseBook | None) -> Counter[str]:
    """How many cases each space holds, from one read of the case files."""
    if cases is None:
        return Counter()
    return Counter(case.space_id for case in cases.cases() if case.space_id)


def _invalid(exc: SpaceInvalid) -> Reply:
    return refusal(400, "bad_request", str(exc))


def _missing(space_id: str) -> Reply:
    detail = "not a space id" if not ids.is_id("space", space_id) else "no such space"
    return error(404, "unknown_ref", f"{detail}: {space_id!r}")


# --- the routes ----------------------------------------------------------------------------------


def list_spaces(daemon: AthenaDaemon, book: SpaceBook, cases: CaseBook | None) -> Reply:
    linked = _linked(cases)
    rows = [asdict(space_summary(daemon, s, linked[s.id])) for s in book.list()]
    return 200, {"spaces": rows}


def create_space(daemon: AthenaDaemon, book: SpaceBook, request: Request) -> Reply:
    try:
        fields = check_input(request.body, partial=False)
        space = book.create(fields)
    except SpaceInvalid as exc:
        return _invalid(exc)
    return 201, asdict(space_summary(daemon, space, 0))


def one_space(
    daemon: AthenaDaemon,
    book: SpaceBook,
    cases: CaseBook | None,
    request: Request,
    tail: str,
) -> Reply:
    """Everything under ``/spaces/<id>``: the space, its patch, its erase, its memory."""
    space_id, _, rest = tail.partition("/")
    if rest == "memory" and request.method == "GET":
        return memory_page(daemon, book, request, space_id)
    head, _, verb = rest.rpartition("/")
    if request.method == "POST" and verb == "core" and head.startswith("memory/"):
        return promote(daemon, book, space_id, head[len("memory/") :])
    if rest:
        return error(404, "unknown", f"no route for {request.method} {SPACES_PREFIX}{tail}")
    if request.method == "DELETE":
        return erase(daemon, book, cases, space_id)
    if request.method == "POST":
        try:
            patch = check_input(request.body, partial=True)
        except SpaceInvalid as exc:
            return _invalid(exc)
        changed = book.update(space_id, patch)
        if changed is None:
            return _missing(space_id)
        return 200, asdict(space_summary(daemon, changed, _linked(cases)[space_id]))
    space = book.get(space_id)
    if space is None:
        return _missing(space_id)
    return 200, asdict(space_summary(daemon, space, _linked(cases)[space_id]))


def erase(daemon: AthenaDaemon, book: SpaceBook, cases: CaseBook | None, space_id: str) -> Reply:
    """``DELETE /spaces/<id>``: memory first, then the chores back to core, then the file.

    The file goes last so that a crash part way leaves a project still listed, whose erase can be
    pressed again, and never memory stamped with a project nobody can name any more. Core facts
    that cite an erased episode keep their citation (ADR 0225).
    """
    if book.get(space_id) is None:
        return _missing(space_id)
    if not daemon.begin_erase(space_id):
        return refusal(409, "space_busy", "a turn is running in this project; erase it after")
    try:
        episodes, facts, procedurals = erase_space_memory(daemon.brain, space_id)
        unlinked = 0
        if cases is not None:
            for case in cases.cases():
                if case.space_id == space_id:
                    cases.set_space(case.id, CORE)
                    unlinked += 1
        book.delete_file(space_id)
    finally:
        daemon.end_erase(space_id)
    erased = SpaceErased(
        id=space_id,
        episodes=episodes,
        facts=facts,
        procedurals=procedurals,
        chores_unlinked=unlinked,
    )
    return 200, asdict(erased)


def memory_page(daemon: AthenaDaemon, book: SpaceBook, request: Request, space_id: str) -> Reply:
    """``GET /spaces/<id>/memory``: one page of what the space holds (``core`` for core's)."""
    if space_id == CORE_ITEM:
        target = CORE
    elif book.get(space_id) is None:
        return _missing(space_id)
    else:
        target = space_id
    raw_kind = request.query.get("kind", "")
    kind: SpaceMemoryKind | None = None
    if raw_kind:
        matched = [k for k in MEMORY_KINDS if k == raw_kind]
        if not matched:
            return refusal(400, "bad_request", f"kind is one of {', '.join(MEMORY_KINDS)}")
        kind = matched[0]
    raw_limit = request.query.get("limit", "")
    try:
        limit = int(raw_limit) if raw_limit else MEMORY_LIMIT
    except ValueError:
        return refusal(400, "bad_request", f"limit must be a whole number, got {raw_limit!r}")
    if limit < 1:
        return refusal(400, "bad_request", "limit must be 1 or more")
    limit = min(limit, MEMORY_LIMIT_MAX)
    rows, total = space_memory_page(daemon.brain, target, kind, limit)
    page = rows[:limit]
    return 200, {
        "rows": [asdict(row) for row in page],
        "showing": len(page),
        "total": max(total, len(page)),
    }


def promote(daemon: AthenaDaemon, book: SpaceBook, space_id: str, memory_id: str) -> Reply:
    """``POST /spaces/<id>/memory/<mem_id>/core``: a fact or procedural made core's."""
    if space_id == CORE_ITEM:
        return refusal(400, "bad_request", "core's memory is core's already")
    if book.get(space_id) is None:
        return _missing(space_id)
    kind = ids.kind_of(memory_id)
    if kind == "episode":
        return refusal(400, "bad_request", "an episode stays in the project it was said in")
    if kind not in ("fact", "procedural"):
        return refusal(400, "bad_request", f"not a fact or procedural id: {memory_id!r}")
    try:
        moved = promote_to_core(daemon.brain, space_id, memory_id)
    except UnstampRefused as exc:
        return error(409, "validator_failed", str(exc))
    if moved is None:
        return error(404, "unknown_ref", f"{memory_id} is not a memory of this project")
    return 200, {"id": memory_id, "kind": moved}


def space_routes(
    daemon: AthenaDaemon, book: SpaceBook, cases: CaseBook | None = None
) -> list[Route]:
    """The ``/spaces`` routes, exact before prefix, for :meth:`RouteTable.add`. ``cases`` is the
    adopt studio's case book - the same one, so a link and a receipt never race two locks."""

    def tail(request: Request) -> str:
        return request.path[len(SPACES_PREFIX) :]

    def one(request: Request) -> Reply:
        return one_space(daemon, book, cases, request, tail(request))

    return [
        Route("GET", SPACES_PATH, lambda request: list_spaces(daemon, book, cases)),
        Route("POST", SPACES_PATH, lambda request: create_space(daemon, book, request)),
        Route("GET", SPACES_PREFIX, one, prefix=True),
        Route("POST", SPACES_PREFIX, one, prefix=True),
        Route("DELETE", SPACES_PREFIX, one, prefix=True),
    ]
