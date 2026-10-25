"""Whether she saw what she missed: every missed item and filed trap joined to her reads.

A short run says "found 4 of 9 items", and the five she missed are one of two failures. Either
she never saw them (the page, the search, a page of the list never read: a world or playbook
problem) or she saw them and walked past (a judgement problem: the prompt, or the model). This
module says which, item by item, from the run's own record.

The transcript keeps each READ call's name and params, never what the page answered. The page is
a pure function of the world's tables and the call (:mod:`.page`), so every read is replayed here
through a fresh :class:`~athena.proving.playbooks.page.SimulatedPortals` and the rows she was shown
are compared with the truth. The join lives outside the page, which must never know the truth,
and outside :func:`~athena.proving.playbooks.bench.score`, so the score, the verdict and every
comparability key stay as they were: attribution is a reading of the run, not a measure of it.

An item is ``seen`` when any replayed read showed a row with a value equal to its key (compared as
the scorer compares keys). An unseen item names, when there is one, the page of a bare listing it
sits on, the page she never read.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any

from athena.proving.playbooks.page import SimulatedPortals
from athena.proving.playbooks.spec import Playbook, ToolSpec, _norm

__all__ = ["attribute", "lines", "summary_block"]


def attribute(playbook: Playbook, report: Mapping[str, Any]) -> dict[str, Any] | None:
    """``{missed, traps, missed_seen, missed_unseen}`` for one scored report, or ``None`` when
    the report kept no transcript to replay."""
    transcript = report.get("transcript")
    if not isinstance(transcript, list):
        return None
    shown = _shown(playbook, transcript)
    scored = report.get("score", {})
    missed = []
    for item in scored.get("missed", []):
        key = str(item.get("key", ""))
        row = _row(str(item.get("action", "")), key, shown)
        if not row["seen"]:
            unread = _unread(playbook, key)
            if unread is not None:
                row["unread"] = unread
        missed.append(row)
    traps: list[dict[str, Any]] = []
    for card in scored.get("cards", []):
        if card.get("outcome") != "trap":
            continue
        pair = (str(card.get("action", "")), str(card.get("key", "")))
        if any((t["action"], t["key"]) == pair for t in traps):
            continue
        traps.append(_row(*pair, shown))
    return {
        "missed": missed,
        "traps": traps,
        "missed_seen": sum(1 for r in missed if r["seen"]),
        "missed_unseen": sum(1 for r in missed if not r["seen"]),
    }


def summary_block(attribution: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """What ``bench.json`` keeps: the two counts and one row an item, ``kind`` missed or trap."""
    if not attribution:
        return None
    by_item = [
        {"kind": kind, **row}
        for kind, rows in (("missed", "missed"), ("trap", "traps"))
        for row in attribution.get(rows, [])
    ]
    return {
        "missed_seen": attribution.get("missed_seen", 0),
        "missed_unseen": attribution.get("missed_unseen", 0),
        "by_item": by_item,
    }


def lines(attribution: Mapping[str, Any] | None) -> list[str]:
    """One line a missed item, for the bench's own output."""
    out: list[str] = []
    for row in (attribution or {}).get("missed", []):
        key = row.get("key", "")
        if row.get("seen"):
            tools = " and ".join(_bare(r) for r in row.get("read_by", []))
            out.append(f"missed {key} - seen on {tools}, not filed")
            continue
        unread = row.get("unread")
        if isinstance(unread, Mapping) and unread.get("page"):
            out.append(
                f"missed {key} - never surfaced (page {unread['page']} of {unread['pages']} "
                f"of {_bare(str(unread['read']))} not read)"
            )
        elif isinstance(unread, Mapping):
            out.append(f"missed {key} - never surfaced ({_bare(str(unread['read']))} not read)")
        else:
            out.append(f"missed {key} - never surfaced (no read showed it)")
    return out


def _bare(action: str) -> str:
    return action.rsplit(".", 1)[-1]


def _row(
    action: str, key: str, shown: Sequence[tuple[str, list[Mapping[str, Any]]]]
) -> dict[str, Any]:
    read_by: list[str] = []
    for name, rows in shown:
        if name not in read_by and any(_holds(r, key) for r in rows):
            read_by.append(name)
    return {"action": action, "key": key, "seen": bool(read_by), "read_by": read_by}


def _holds(row: Mapping[str, Any], key: str) -> bool:
    return any(
        _norm(v) == key for v in row.values() if isinstance(v, str | int | float) and v != ""
    )


def _read_tool(playbook: Playbook, app_id: str, bare: str) -> str | None:
    """The full ``host.<app>.<tool>`` a transcript call named by its bare tool on ``app_id``'s
    turn: that app's tool, else the one open app that has a READ by that name."""
    apps = sorted(playbook.apps, key=lambda a: a.app_id != app_id)
    for app in apps:
        tool = app.tool(bare)
        if tool is not None:
            return f"host.{app.app_id}.{tool.name}" if tool.kind == "READ" else None
    return None


def _rows(output: str) -> list[Mapping[str, Any]]:
    try:
        page = json.loads(output)
    except json.JSONDecodeError:
        return []
    rows = page.get("rows") if isinstance(page, dict) else None
    return [r for r in rows if isinstance(r, Mapping)] if isinstance(rows, list) else []


def _shown(
    playbook: Playbook, transcript: Sequence[Mapping[str, Any]]
) -> list[tuple[str, list[Mapping[str, Any]]]]:
    """Every READ the run made, replayed: ``(host.<app>.<tool>, rows the page showed)``."""
    portals = SimulatedPortals(playbook)
    shown: list[tuple[str, list[Mapping[str, Any]]]] = []
    for turn in transcript:
        for call in turn.get("calls", []):
            name = _read_tool(playbook, str(turn.get("app", "")), str(call.get("name", "")))
            if name is None:
                continue
            params = call.get("params")
            ok, output = portals.answer(name, params if isinstance(params, Mapping) else {})
            if ok:
                shown.append((name, _rows(output)))
    return shown


def _unread(playbook: Playbook, key: str) -> dict[str, Any] | None:
    """Where a bare listing would have shown ``key``: ``{read, page, pages}`` on a paged list,
    ``{read}`` on an unpaged one, ``None`` when no bare read shows it (a search, a detail page).
    """
    portals = SimulatedPortals(playbook)
    for app in playbook.apps:
        for tool in app.tools:
            if tool.kind != "READ":
                continue
            found = _page_of(portals, f"host.{app.app_id}.{tool.name}", tool, key)
            if found is not None:
                return found
    return None


def _page_of(
    portals: SimulatedPortals, name: str, tool: ToolSpec, key: str
) -> dict[str, Any] | None:
    ok, output = portals.answer(name, {})
    if not ok:
        return None
    first = json.loads(output)
    if not isinstance(first, dict):
        return None
    pages = int(first.get("pages", 1) or 1)
    if any(_holds(r, key) for r in _rows(output)):
        return {"read": name, "page": 1, "pages": pages} if pages > 1 else {"read": name}
    if pages <= 1 or "page" not in tool.params:
        return None
    for page in range(2, pages + 1):
        _, more = portals.answer(name, {"page": page})
        if any(_holds(r, key) for r in _rows(more)):
            return {"read": name, "page": page, "pages": pages}
    return None
