"""A playbook directory, read and checked (README §14; ADR 0040).

Four files, one directory per use case under ``playbooks/<id>/``:

- ``playbook.json`` — the showcase: who it is for, the command, the portals, the gates, the
  economics with their sources, and where it sits between difficulty and usefulness. The desktop's
  Playbooks module renders it; the bench reads only ``id``, ``command`` and ``expectation``.
- ``world.json`` — the portals as data: each app's origin, its tools with their honest flags, the
  view the bridge would post as ``host_state``, the tables its reads answer from, and the phases
  of the run (which app, what the user says).
- ``truth.json`` — what a perfect run files and what it must never file. Athena never sees it; the
  page never reads it; only the scorer does.
- ``bench.json`` — the latest measured run, written by the bench (absent until one ran).

A problem is reported as a list of sentences, every one of them, rather than the first: a
playbook is authored by hand and a fix-one-rerun loop over a JSON file is a slow way to learn
that it had five mistakes.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

__all__ = [
    "BEFORE_ADR_0057",
    "KINDS",
    "PER_TABLE",
    "PLAYBOOKS_DIRNAME",
    "AppSpec",
    "Phase",
    "Playbook",
    "PlaybookError",
    "Target",
    "ToolSpec",
    "load_all",
    "load_playbook",
]

PLAYBOOKS_DIRNAME = "playbooks"

#: The four kinds a portal's tool can be, as manifest flags ``(reversible, side_effects)`` — the
#: same table as :data:`athena.proving.manifests.FLAGS`, so a playbook's portal is classed exactly
#: as a real page that registered the same claims would be.
KINDS: dict[str, tuple[bool, str]] = {
    "READ": (True, "none"),
    "WRITE": (True, "internal"),
    "PERMANENT": (False, "internal"),
    "REACHES_A_PERSON": (False, "external"),
}

#: The nine playbooks authored before ADR 0057 fixed the floor of 2 portals and 8 traps (rule 1)
#: and ADR 0056 asked for ``times_per_year``. They are exempt from those three rules only. The set
#: is closed: a test pins it to exactly these ids, so a new playbook is never added to it.
BEFORE_ADR_0057: frozenset[str] = frozenset(
    {
        "carrier-accessorials",
        "clinic-denials",
        "cpg-deductions",
        "estate-settlement",
        "fba-reimbursements",
        "freelancer-receivables",
        "lien-desk",
        "ltc-claims",
        "medical-bills",
    }
)

#: ADR 0056 section (a): the values ``economics.per`` may take. Adding one takes an amendment.
PER_TABLE: tuple[str, ...] = ("year", "quarter", "month", "week", "estate", "episode")

MIN_PORTALS = 2  # ADR 0057 rule 1
MIN_TRAPS = 8  # ADR 0057 rule 1

_PARAM_TYPES = {"string", "integer", "number", "boolean"}


class PlaybookError(ValueError):
    """A playbook directory that cannot be benched, with every problem found."""

    def __init__(self, where: str, problems: Sequence[str]) -> None:
        self.problems = list(problems)
        super().__init__(f"{where}: " + "; ".join(self.problems))


@dataclass(frozen=True)
class ToolSpec:
    """One tool a portal registers, and how the simulated page answers it."""

    name: str
    kind: str
    description: str
    params: dict[str, dict[str, Any]]
    #: READ only: ``{table, match?: {param: field}, page_size?}``.
    returns: dict[str, Any] = field(default_factory=dict)
    #: WRITE / gated: the page's answer once it runs, a ``str.format`` template over the params.
    says: str = ""

    @property
    def gated(self) -> bool:
        reversible, side_effects = KINDS[self.kind]
        return not (reversible and side_effects != "external")


@dataclass(frozen=True)
class AppSpec:
    app_id: str
    name: str
    origin: str
    path: str
    view: dict[str, Any]
    tools: tuple[ToolSpec, ...]
    #: What a person calls this portal in a sentence ("MyChart", "the insurance portal"); the
    #: name is always one. The bench uses them to hear a request to switch tabs.
    aliases: tuple[str, ...] = ()

    def tool(self, name: str) -> ToolSpec | None:
        bare = name.rsplit(".", 1)[-1]
        return next((t for t in self.tools if t.name == bare), None)

    def manifest(self) -> dict[str, Any]:
        """The JSON this portal's page would post to ``POST /manifest``."""
        tools = []
        for tool in self.tools:
            reversible, side_effects = KINDS[tool.kind]
            tools.append(
                {
                    "name": tool.name,
                    "description": tool.description,
                    "params_schema": {"type": "object", "properties": tool.params},
                    "reversible": reversible,
                    "side_effects": side_effects,
                }
            )
        return {
            "app_id": self.app_id,
            "app_version": "1",
            "page_origin": self.origin,
            "tools": tools,
        }


@dataclass(frozen=True)
class Phase:
    """One stretch of the run on one portal: the user's words, and how often they may nudge."""

    app: str
    message: str
    nudges: int = 1


@dataclass(frozen=True)
class Target:
    """One tool whose cards are scored: which ones a perfect run files, which it never does."""

    tool: str
    key: str
    #: ``{key value: {value_usd, why, expect?: {param: value}}}``
    eligible: dict[str, dict[str, Any]]
    #: ``{key value: why it must not be filed}``
    traps: dict[str, str]
    #: ``{key value: {why, expect?}}``: acceptable either way. Filed with the ``expect`` params (or
    #: with none declared) it is neither credited nor a fault; filed otherwise it is a trap.
    neutral: dict[str, dict[str, Any]] = field(default_factory=dict)


@dataclass(frozen=True)
class Playbook:
    id: str
    root: Path
    showcase: dict[str, Any]
    today: str
    apps: tuple[AppSpec, ...]
    tables: dict[str, list[dict[str, Any]]]
    phases: tuple[Phase, ...]
    targets: tuple[Target, ...]
    #: Tools that must never even be proposed in this run (a card for one is a fault).
    forbidden: tuple[str, ...] = ()

    @property
    def expectation(self) -> dict[str, Any]:
        value = self.showcase.get("expectation")
        return dict(value) if isinstance(value, Mapping) else {}

    def app(self, app_id: str) -> AppSpec:
        return next(a for a in self.apps if a.app_id == app_id)

    def app_for_action(self, action: str) -> AppSpec | None:
        """``host.<app_id>.<tool>`` back to its app."""
        parts = action.split(".")
        if len(parts) != 3 or parts[0] != "host":
            return None
        return next((a for a in self.apps if a.app_id == parts[1]), None)

    def eligible_total(self) -> float:
        return round(
            sum(float(v.get("value_usd", 0)) for t in self.targets for v in t.eligible.values()), 2
        )


# --- reading -------------------------------------------------------------------------------------


def _json(path: Path, problems: list[str]) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        problems.append(f"{path.name} is missing")
        return {}
    except json.JSONDecodeError as exc:
        problems.append(f"{path.name} is not JSON: {exc}")
        return {}
    if not isinstance(value, dict):
        problems.append(f"{path.name} is not an object")
        return {}
    return value


def _tool(app_id: str, raw: Any, tables: Mapping[str, Any], problems: list[str]) -> ToolSpec | None:
    if not isinstance(raw, Mapping):
        problems.append(f"{app_id}: a tool is not an object")
        return None
    name = str(raw.get("name", ""))
    where = f"{app_id}.{name or '?'}"
    kind = str(raw.get("kind", ""))
    if not name.replace("_", "").isalnum():
        problems.append(f"{where}: name must be snake_case letters and digits")
    if kind not in KINDS:
        problems.append(f"{where}: kind {kind!r} is not one of {sorted(KINDS)}")
    params = raw.get("params", {})
    if not isinstance(params, Mapping):
        problems.append(f"{where}: params must be an object of JSON-schema properties")
        params = {}
    for pname, schema in params.items():
        if not isinstance(schema, Mapping) or schema.get("type") not in _PARAM_TYPES:
            problems.append(f"{where}: param {pname!r} needs a type in {sorted(_PARAM_TYPES)}")
    returns = raw.get("returns", {})
    if kind == "READ":
        if not isinstance(returns, Mapping) or str(returns.get("table", "")) not in tables:
            problems.append(f"{where}: a READ tool returns a table the world declares")
            returns = {}
        else:
            for param in dict(returns.get("match", {})):
                if param not in params:
                    problems.append(f"{where}: match on {param!r}, which is not a param")
    elif not str(raw.get("says", "")):
        problems.append(f"{where}: a {kind} tool needs `says`, the page's answer once it runs")
    if not str(raw.get("description", "")):
        problems.append(f"{where}: a tool needs a description; it is what Athena reads")
    return ToolSpec(
        name=name,
        kind=kind if kind in KINDS else "READ",
        description=str(raw.get("description", "")),
        params={str(k): dict(v) for k, v in params.items() if isinstance(v, Mapping)},
        returns=dict(returns) if isinstance(returns, Mapping) else {},
        says=str(raw.get("says", "")),
    )


def load_playbook(root: str | Path) -> Playbook:
    """Read ``root`` into a :class:`Playbook`; raise :class:`PlaybookError` with every problem."""
    root = Path(root)
    problems: list[str] = []
    showcase = _json(root / "playbook.json", problems)
    world = _json(root / "world.json", problems)
    truth = _json(root / "truth.json", problems)
    pid = str(showcase.get("id", ""))
    if pid != root.name:
        problems.append(f"playbook.json id {pid!r} must be the directory's name {root.name!r}")
    for key in ("title", "promise", "command", "persona", "economics", "edge", "expectation"):
        if key not in showcase:
            problems.append(f"playbook.json needs {key!r}")
    edge = showcase.get("edge", {})
    for axis in ("difficulty", "usefulness"):
        score = edge.get(axis) if isinstance(edge, Mapping) else None
        if not isinstance(score, int | float) or not 1 <= score <= 5:
            problems.append(f"edge.{axis} must be a score from 1 to 5")

    tables_raw = world.get("tables", {})
    tables: dict[str, list[dict[str, Any]]] = {}
    if isinstance(tables_raw, Mapping):
        for name, rows in tables_raw.items():
            if isinstance(rows, list) and all(isinstance(r, Mapping) for r in rows):
                tables[str(name)] = [dict(r) for r in rows]
            else:
                problems.append(f"table {name!r} must be a list of objects")

    apps: list[AppSpec] = []
    for raw in world.get("apps", []) if isinstance(world.get("apps"), list) else []:
        app_id = str(raw.get("app_id", ""))
        if not app_id.isidentifier():
            problems.append(f"app_id {app_id!r} must be an identifier")
        origin = str(raw.get("origin", ""))
        if not origin.startswith(("http://", "https://")):
            problems.append(f"{app_id}: origin must be an http(s) origin")
        tools = tuple(
            t
            for t in (_tool(app_id, item, tables, problems) for item in raw.get("tools", []))
            if t is not None
        )
        if not tools:
            problems.append(f"{app_id}: a portal with no tools has nothing to bench")
        apps.append(
            AppSpec(
                app_id=app_id,
                name=str(raw.get("name", app_id)),
                origin=origin,
                path=str(raw.get("path", "/")),
                view=dict(raw.get("view", {})) if isinstance(raw.get("view"), Mapping) else {},
                tools=tools,
                aliases=tuple(
                    dict.fromkeys(
                        [str(raw.get("name", app_id)), *(str(a) for a in raw.get("aliases", []))]
                    )
                ),
            )
        )
    if not apps:
        problems.append("world.json declares no apps")
    app_ids = {a.app_id for a in apps}

    phases: list[Phase] = []
    for raw in world.get("phases", []) if isinstance(world.get("phases"), list) else []:
        app = str(raw.get("app", ""))
        if app not in app_ids:
            problems.append(f"a phase runs on {app!r}, which is not an app")
        if not str(raw.get("message", "")).strip():
            problems.append("a phase needs the user's message")
        phases.append(
            Phase(app=app, message=str(raw.get("message", "")), nudges=int(raw.get("nudges", 1)))
        )
    if not phases:
        problems.append("world.json declares no phases")

    tools_by_name = {t.name: t for a in apps for t in a.tools}
    targets: list[Target] = []
    for raw in truth.get("targets", []) if isinstance(truth.get("targets"), list) else []:
        tool = str(raw.get("tool", ""))
        spec = tools_by_name.get(tool)
        if spec is None:
            problems.append(f"truth targets {tool!r}, which no app registers")
        elif not spec.gated:
            problems.append(f"truth targets {tool!r}, which is not gated: it files no card")
        key = str(raw.get("key", ""))
        if spec is not None and key not in spec.params:
            problems.append(f"truth key {key!r} is not a param of {tool!r}")
        eligible = raw.get("eligible", {})
        traps = raw.get("traps", {})
        if not isinstance(eligible, Mapping):
            problems.append(f"truth eligible for {tool!r} must be an object")
            eligible = {}
        if not isinstance(traps, Mapping):
            problems.append(f"truth traps for {tool!r} must be an object")
            traps = {}
        # A target of traps alone names a tool every use of which is wrong in this world.
        if not eligible and not traps:
            problems.append(f"truth for {tool!r} needs at least one eligible item or trap")
        neutral = raw.get("neutral", {})
        if not isinstance(neutral, Mapping) or not all(
            isinstance(v, Mapping) for v in neutral.values()
        ):
            problems.append(f"truth neutral for {tool!r} must map keys to objects")
            neutral = {}
        overlap = {_norm(k) for k in eligible} & {_norm(k) for k in traps}
        if overlap:
            problems.append(f"{sorted(overlap)} are both eligible and a trap")
        both = ({_norm(k) for k in eligible} | {_norm(k) for k in traps}) & {
            _norm(k) for k in neutral
        }
        if both:
            problems.append(f"{sorted(both)} are neutral and also eligible or a trap")
        targets.append(
            Target(
                tool=tool,
                key=key,
                eligible={_norm(k): dict(v) for k, v in eligible.items()},
                traps={_norm(k): str(v) for k, v in traps.items()},
                neutral={_norm(k): dict(v) for k, v in neutral.items()},
            )
        )
    if not targets:
        problems.append("truth.json declares no targets")
    forbidden = tuple(str(t) for t in truth.get("forbidden", []))
    problems.extend(_authoring_problems(pid or root.name, showcase, apps, targets))
    if problems:
        raise PlaybookError(root.name, problems)
    return Playbook(
        id=pid,
        root=root,
        showcase=showcase,
        today=str(world.get("today", "")),
        apps=tuple(apps),
        tables=tables,
        phases=tuple(phases),
        targets=tuple(targets),
        forbidden=forbidden,
    )


def _authoring_problems(
    pid: str, showcase: Mapping[str, Any], apps: Sequence[AppSpec], targets: Sequence[Target]
) -> list[str]:
    """What ADR 0057 (rule 1) and ADR 0056 (with its 2026-10-09 amendment) ask of a playbook."""
    found: list[str] = []
    economics = showcase.get("economics")
    if not isinstance(economics, Mapping):
        economics = {}
    if pid not in BEFORE_ADR_0057:
        if len(apps) < MIN_PORTALS:
            found.append(
                f"{pid}: ADR 0057 rule 1 wants at least {MIN_PORTALS} portals "
                f"(world.json apps), found {len(apps)}"
            )
        traps = sum(len(t.traps) for t in targets)
        if traps < MIN_TRAPS:
            found.append(
                f"{pid}: ADR 0057 rule 1 wants at least {MIN_TRAPS} traps "
                f"(truth.json, all targets), found {traps}"
            )
        times = economics.get("times_per_year")
        if isinstance(times, bool) or not isinstance(times, int | float) or not times > 0:
            found.append(
                f"{pid}: ADR 0056 (c) wants economics.times_per_year, a number above 0, "
                f"found {times!r}"
            )
    per = economics.get("per")
    if per not in PER_TABLE:
        found.append(
            f"{pid}: ADR 0056 (a) wants economics.per in {', '.join(PER_TABLE)}, found {per!r}"
        )
    value = economics.get("value_usd")
    if isinstance(value, int | float) and not isinstance(value, bool) and value == 0:
        total = sum(float(v.get("value_usd", 0)) for t in targets for v in t.eligible.values())
        if not total > 0:
            found.append(
                f"{pid}: ADR 0056 amendment (2026-10-09) wants a truth total value above 0 when "
                "economics.value_usd is 0 (weight each item at a per-act price), "
                "or its bench can only come back short"
            )
    return found


def load_all(base: str | Path = PLAYBOOKS_DIRNAME) -> list[Playbook]:
    """Every playbook under ``base``, in directory order. One bad playbook fails the lot."""
    return [
        load_playbook(d) for d in sorted(Path(base).iterdir()) if (d / "playbook.json").is_file()
    ]


def _norm(value: Any) -> str:
    """A key value as the scorer compares it: trimmed, case-folded, inner spaces dropped."""
    return "".join(str(value).split()).upper()
