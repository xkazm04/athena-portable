"""The portals of a playbook, answering as their pages would (README §14, §3.2 step 5; ADR 0040).

The same contract as the Characters' Ledgerbox page (:mod:`athena.proving.characters.scene`),
generalised to data: a READ tool answers from one of the world's tables, filtered by the params
it declares a ``match`` for (``mode: contains`` matches a substring; ``mode: words`` every word
of the param, in any order, as a mail search does; ``default`` fills a param the call left out;
``require`` makes a detail page refuse without its id) and paged with the honest
``(showing N of M)`` footer; a reversible WRITE answers with its ``says`` sentence; a gated tool
never reaches :meth:`answer` (the gate turned it into a card) and runs only through
:meth:`execute`, an approved card's instruction.

The page knows nothing of ``truth.json``. A page that could see the answers could leak them, and
a bench whose page leaks is measuring the page.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from athena.core.catalog import READ_CAP
from athena.proving.playbooks.spec import Playbook, _norm
from athena.proving.report import announce

__all__ = ["SimulatedPortals"]


class _Blank(dict[str, Any]):
    def __missing__(self, key: str) -> str:
        return f"({key} not given)"


class SimulatedPortals:
    """Every portal of one playbook, answering the host calls the gate let through."""

    def __init__(self, playbook: Playbook) -> None:
        self.playbook = playbook
        #: Every reversible write and every approved gated action, in order: ``{name, params}``.
        self.writes: list[dict[str, Any]] = []
        self.executed: list[dict[str, Any]] = []
        self.reads = 0

    def host_state(self, app_id: str) -> dict[str, Any]:
        """What the bridge posts as ``host_state`` while ``app_id`` is the focused tab."""
        app = self.playbook.app(app_id)
        return {
            "app": app.name,
            "url": f"{app.origin}{app.path}",
            "today": self.playbook.today,
            **app.view,
            "open_tabs": [
                {"app": other.name, "url": f"{other.origin}{other.path}"}
                for other in self.playbook.apps
            ],
        }

    def answer(self, name: str, params: Mapping[str, Any]) -> tuple[bool, str]:
        """``(ok, output)`` for one host call. ``name`` is ``host.<app_id>.<tool>``."""
        app = self.playbook.app_for_action(name)
        tool = app.tool(name) if app is not None else None
        if app is None or tool is None:
            return False, f"no tool named {name!r} on any open page"
        if tool.kind == "READ":
            self.reads += 1
            return True, json.dumps(
                self._read(tool.returns, tool.params, params), ensure_ascii=False
            )
        if tool.kind == "WRITE":
            self.writes.append({"name": tool.name, "params": dict(params)})
            return True, tool.says.format_map(_Blank(params))
        # A gated tool reaching here means the gate let one through as a plain call. Say so.
        return False, f"{tool.name} reached the page without an approval"

    def execute(self, row: Mapping[str, Any]) -> tuple[bool, str]:
        """Run one ``execute`` instruction from ``POST /decisions/<id>``: an approved card."""
        name = str(row.get("name", ""))
        params = row.get("params")
        params = dict(params) if isinstance(params, Mapping) else {}
        app = self.playbook.app_for_action(name)
        tool = app.tool(name) if app is not None else None
        if tool is None:
            return False, f"no tool named {name!r} on any open page"
        self.executed.append({"name": tool.name, "params": params})
        if tool.kind == "READ":
            return self.answer(name, params)
        return True, tool.says.format_map(_Blank(params))

    def oversized(self, cap: int = READ_CAP) -> list[str]:
        """Every read the run loop would cut at ``cap``, as ``app.tool {params}: N chars``.

        A cut page is honest about itself, but a bench whose page cuts a table measures the cap,
        not her judgement: ``check`` names these so a world is paged before it is run. Each read
        is probed bare and with every value its exact-match params can take from the table.
        """
        found: list[str] = []
        for app in self.playbook.apps:
            for tool in app.tools:
                if tool.kind != "READ":
                    continue
                for params in self._probes(tool.returns):
                    answer = self._read(tool.returns, tool.params, params)
                    size = len(json.dumps(answer, ensure_ascii=False))
                    if size > cap:
                        found.append(f"{app.app_id}.{tool.name} {json.dumps(params)}: {size} chars")
        return found

    def _probes(self, returns: Mapping[str, Any]) -> list[dict[str, Any]]:
        probes: list[dict[str, Any]] = [] if returns.get("require") else [{}]
        if returns.get("mode") in ("contains", "words"):
            return probes
        rows = self.playbook.tables.get(str(returns.get("table", "")), [])
        for param, column in dict(returns.get("match", {})).items():
            values = sorted({str(r[column]) for r in rows if r.get(column) not in (None, "")})
            probes.extend({param: v} for v in values)
        return probes

    def _read(
        self,
        returns: Mapping[str, Any],
        declared: Mapping[str, Any],
        params: Mapping[str, Any],
    ) -> dict[str, Any]:
        params = {
            **dict(returns.get("default", {})),
            **{k: v for k, v in params.items() if v not in (None, "")},
        }
        missing = [p for p in returns.get("require", []) if params.get(p) in (None, "")]
        if missing:
            return {"error": f"this page needs {', '.join(missing)}"}
        rows = list(self.playbook.tables.get(str(returns.get("table", "")), []))
        mode = returns.get("mode")
        for param, column in dict(returns.get("match", {})).items():
            wanted = params.get(param)
            if wanted in (None, ""):
                continue
            needle = _norm(wanted)
            if mode == "contains":
                rows = [r for r in rows if needle in _norm(r.get(column, ""))]
            elif mode == "words":
                words = [_norm(w) for w in str(wanted).split()]
                rows = [r for r in rows if all(w in _norm(r.get(column, "")) for w in words)]
            else:
                rows = [r for r in rows if _norm(r.get(column, "")) == needle]
        fields = returns.get("fields")
        if isinstance(fields, list) and fields:
            rows = [{f: r[f] for f in fields if f in r} for r in rows]
        size = int(returns.get("page_size", 0) or 0)
        total = len(rows)
        if size <= 0 or total <= size:
            out: dict[str, Any] = {"rows": rows, "total": total}
            if total == 0:
                out["note"] = "nothing matched"
            return out
        pages = (total + size - 1) // size
        page = params.get("page", 1) if "page" in declared else 1
        try:
            page = min(max(int(page), 1), pages)
        except (TypeError, ValueError):
            page = 1
        shown = rows[(page - 1) * size : page * size]
        return {
            "rows": shown,
            "page": page,
            "pages": pages,
            "total": total,
            "note": f"page {page} of {pages} {announce(len(shown), total)}".strip(),
        }
