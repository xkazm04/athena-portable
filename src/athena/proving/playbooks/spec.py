"""A playbook directory, read and checked (README §14; ADR 0040).

One directory per use case under ``playbooks/<id>/``, six files in it, three of them authored:

- ``playbook.json`` — the showcase: who it is for, its area and its job, the command, the portals,
  the gates, the economics with their sources, and where it sits between difficulty and usefulness.
  The desktop's Playbooks module renders it; the bench reads only ``id``, ``command`` and
  ``expectation``; this loader also checks ``category`` and ``job`` against the library's list.
- ``world.json`` — the portals as data: each app's origin, its tools with their honest flags, the
  view the bridge would post as ``host_state``, the tables its reads answer from, and the phases
  of the run (which app, what the user says).
- ``truth.json`` — what a perfect run files and what it must never file. Athena never sees it; the
  page never reads it; only the scorer does.
- ``bench.json`` — the latest measured run, written by the bench (absent until one ran).
- ``evidence.json`` and ``thumb.jpg`` — the film's index and its still, written by ``evidence``
  (ADR 0055) from a bench that passed; absent until then. This module never reads them.

Beside the directories, one file the whole library shares: ``playbooks/taxonomy.json``, the ten
areas and four jobs a playbook's ``category`` and ``job`` may name (ADR 0096). It is the one list;
the desktop imports the same file, so the bench and the ledger cannot disagree about an id.

``playbook.json`` also says what its figures are (ADR 0133): ``economics.value_kind`` for the
author's estimate, ``economics.kinds`` for each truth target's weights, ``economics.example_usd``
for the example case's money back (derived from the truth by ``derive``, never typed), and ``fit``
for where and for whom the chore works. The loader checks their shape; ``check`` also holds
``example_usd`` to its derivation.

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

from athena.proving.manifests import FLAGS

__all__ = [
    "BEFORE_ADR_0057",
    "DEFAULT_KIND",
    "FIT_REGIONS",
    "KINDS",
    "PER_TABLE",
    "PLAYBOOKS_DIRNAME",
    "TARGET_KINDS",
    "TAXONOMY_FILENAME",
    "USPS_CODES",
    "VALUE_KINDS",
    "AppSpec",
    "Phase",
    "Playbook",
    "PlaybookError",
    "Target",
    "Taxonomy",
    "ToolSpec",
    "derive_example_usd",
    "example_problems",
    "kind_of",
    "load_all",
    "load_playbook",
    "load_taxonomy",
]

PLAYBOOKS_DIRNAME = "playbooks"

#: The four kinds a portal's tool can be, as manifest flags ``(reversible, side_effects)``. It IS
#: :data:`athena.proving.manifests.FLAGS`, the table Ledgerbox's world is built from, not a copy
#: of it, so a playbook's portal is classed exactly as a real page that registered the same claims
#: would be.
KINDS: dict[str, tuple[bool, str]] = FLAGS

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

#: The one list of areas and jobs a playbook may name (ADR 0096), read by the bench and the desktop.
TAXONOMY_FILENAME = "taxonomy.json"

#: ADR 0133: what ``economics.value_usd``, the author's estimate, is. Only ``money_back`` is money
#: that comes back to the person; the other two are named in their own words wherever they show.
VALUE_KINDS: tuple[str, ...] = ("money_back", "money_protected", "penalty_avoided")

#: ADR 0133: what one truth target's ``value_usd`` weights are, per target tool. ``count`` is a
#: scoring weight and is never shown as dollars. A tool ``economics.kinds`` leaves out is
#: ``money_back``, the default every reader shares.
TARGET_KINDS: tuple[str, ...] = (*VALUE_KINDS, "count")

#: The kind a reader assumes when a playbook names none (ADR 0133).
DEFAULT_KIND = "money_back"

#: ADR 0133: the region words ``fit.where`` may be besides a list of USPS state codes.
FIT_REGIONS: tuple[str, ...] = ("US", "EU")

#: USPS codes for the states, the District and the territories, the ones ``fit.where`` may list.
# fmt: off
USPS_CODES: frozenset[str] = frozenset({
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN",
    "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
    "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
    "VT", "VA", "WA", "WV", "WI", "WY", "PR", "GU", "VI", "AS", "MP",
})
# fmt: on

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
    def category(self) -> str:
        """The area the ledger files this playbook under; the loader checked it (ADR 0096)."""
        return str(self.showcase.get("category", ""))

    @property
    def job(self) -> str:
        """What it does for the person (recover, claim, contest, comply); checked (ADR 0096)."""
        return str(self.showcase.get("job", ""))

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


def load_playbook(root: str | Path, taxonomy: Taxonomy | None = None) -> Playbook:
    """Read ``root`` into a :class:`Playbook`; raise :class:`PlaybookError` with every problem.

    ``category`` and ``job`` are checked against ``taxonomy``, or, when none is given, against the
    ``taxonomy.json`` beside the playbook (its parent directory, the library). There is no default
    list in the code: a library is read by its own file, so a copied-out playbook is refused until
    the list travels with it, rather than quietly checked against a list it was never written for.
    """
    root = Path(root)
    problems: list[str] = []
    showcase = _json(root / "playbook.json", problems)
    if taxonomy is None:
        try:
            taxonomy = load_taxonomy(root.parent)
        except PlaybookError as exc:
            problems.extend(exc.problems)
    if showcase and taxonomy is not None:
        problems.extend(_taxonomy_problems(showcase, taxonomy))
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
        if not isinstance(raw, Mapping):
            problems.append(f"an app must be an object, found {raw!r}")
            continue
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
        if not isinstance(raw, Mapping):
            problems.append(f"a phase must be an object, found {raw!r}")
            continue
        app = str(raw.get("app", ""))
        if app not in app_ids:
            problems.append(f"a phase runs on {app!r}, which is not an app")
        if not str(raw.get("message", "")).strip():
            problems.append("a phase needs the user's message")
        nudges = raw.get("nudges", 1)
        if isinstance(nudges, bool) or not isinstance(nudges, int) or nudges < 0:
            problems.append(f"a phase on {app!r}: nudges must be a whole number, found {nudges!r}")
            nudges = 0
        phases.append(Phase(app=app, message=str(raw.get("message", "")), nudges=nudges))
    if not phases:
        problems.append("world.json declares no phases")

    tools_by_name = {t.name: t for a in apps for t in a.tools}
    targets: list[Target] = []
    for raw in truth.get("targets", []) if isinstance(truth.get("targets"), list) else []:
        if not isinstance(raw, Mapping):
            problems.append(f"a target must be an object, found {raw!r}")
            continue
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
        for item, value in list(eligible.items()):
            if not isinstance(value, Mapping):
                problems.append(f"truth eligible {item!r} for {tool!r} must be an object")
        eligible = {k: v for k, v in eligible.items() if isinstance(v, Mapping)}
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
    forbidden = _forbidden(truth.get("forbidden", []), tools_by_name, targets, problems)
    problems.extend(_authoring_problems(pid or root.name, showcase, apps, targets))
    problems.extend(_kind_problems(pid or root.name, showcase, targets))
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


def _forbidden(
    raw: Any,
    tools_by_name: Mapping[str, ToolSpec],
    targets: Sequence[Target],
    problems: list[str],
) -> tuple[str, ...]:
    """The tools that must never be proposed. A card for one is a fault, so each must be a tool a
    card can name: registered, gated, and not a target (the scorer reads a target first, so a
    forbidden target would never be counted as one). Checked as a target is checked."""
    if not isinstance(raw, list):
        problems.append("truth forbidden must be a list of tool names")
        return ()
    targeted = {t.tool for t in targets}
    for name in (str(t) for t in raw):
        spec = tools_by_name.get(name)
        if spec is None:
            problems.append(f"truth forbids {name!r}, which no app registers")
        elif not spec.gated:
            problems.append(f"truth forbids {name!r}, which is not gated: it files no card")
        elif name in targeted:
            problems.append(f"truth forbids {name!r}, which it also targets")
    return tuple(str(t) for t in raw)


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
    caveat = showcase.get("caveat")
    if not isinstance(caveat, str) or not caveat.strip():
        found.append(
            f"{pid}: ADR 0057 rule 4 wants a caveat, a non-empty string in playbook.json "
            "naming what is invented, the public rule and its date, and that it is not advice"
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


def kind_of(economics: Mapping[str, Any], tool: str) -> str:
    """The kind of ``tool``'s truth weights (ADR 0133); ``money_back`` when none is named."""
    kinds = economics.get("kinds")
    kind = kinds.get(tool) if isinstance(kinds, Mapping) else None
    return kind if isinstance(kind, str) and kind in TARGET_KINDS else DEFAULT_KIND


def derive_example_usd(
    economics: Mapping[str, Any], targets: Sequence[tuple[str, Mapping[str, Any]]]
) -> int | float | None:
    """``economics.example_usd`` as ADR 0133 defines it: the example case's money back.

    ``targets`` is each truth target as ``(tool, eligible)``. The sum of ``value_usd`` over the
    eligible items of every ``money_back`` target, rounded to cents and written as an int when
    whole, so the same truth gives the same bytes; ``None`` when no target is ``money_back``.
    """
    total = 0.0
    any_money = False
    for tool, eligible in targets:
        if kind_of(economics, tool) != "money_back":
            continue
        any_money = True
        for item in eligible.values():
            value = item.get("value_usd", 0) if isinstance(item, Mapping) else 0
            if isinstance(value, int | float) and not isinstance(value, bool):
                total += float(value)
    if not any_money:
        return None
    cents = round(total, 2) + 0.0
    return int(cents) if cents == int(cents) else cents


def example_problems(book: Playbook) -> list[str]:
    """What ``check`` asks of ``economics.example_usd`` beyond its shape (ADR 0133).

    It must be present and equal to :func:`derive_example_usd` over the playbook's own truth. The
    loader does not ask this, so a playbook mid-edit still loads and benches; the committed library
    is held to it by ``check``, and ``derive`` is the one way the figure is written.
    """
    economics = book.showcase.get("economics")
    economics = economics if isinstance(economics, Mapping) else {}
    want = derive_example_usd(economics, [(t.tool, t.eligible) for t in book.targets])
    if "example_usd" not in economics:
        return [f"{book.id}: ADR 0133 wants economics.example_usd, written by `derive`"]
    have = economics["example_usd"]
    if have is None and want is None:
        return []
    if (
        have is None
        or want is None
        or isinstance(have, bool)
        or not isinstance(have, int | float)
        or abs(float(have) - float(want)) >= 0.005
    ):
        return [
            f"{book.id}: economics.example_usd is {have!r} but its truth derives {want!r} "
            "(ADR 0133): run `derive`, never type it"
        ]
    return []


def _kind_problems(pid: str, showcase: Mapping[str, Any], targets: Sequence[Target]) -> list[str]:
    """ADR 0133: the shape of ``value_kind``, ``kinds``, ``example_usd`` and ``fit``.

    Each is optional to the loader (a reader has a default for every one, and an absent ``fit``
    says nothing); when present it must be well formed. ``kinds`` names exactly the truth's target
    tools, so a renamed target cannot leave a stale kind behind or a new one silently defaulted.
    """
    found: list[str] = []
    economics = showcase.get("economics")
    economics = economics if isinstance(economics, Mapping) else {}
    if "value_kind" in economics and economics["value_kind"] not in VALUE_KINDS:
        found.append(
            f"{pid}: economics.value_kind {economics['value_kind']!r} is not one of "
            f"{', '.join(VALUE_KINDS)} (ADR 0133)"
        )
    if "kinds" in economics:
        kinds = economics["kinds"]
        if not isinstance(kinds, Mapping):
            found.append(f"{pid}: economics.kinds must map each truth target tool to a kind")
        else:
            for tool, kind in kinds.items():
                if kind not in TARGET_KINDS:
                    found.append(
                        f"{pid}: economics.kinds[{tool!r}] {kind!r} is not one of "
                        f"{', '.join(TARGET_KINDS)} (ADR 0133)"
                    )
            tools = {t.tool for t in targets}
            extra = sorted(set(kinds) - tools)
            missing = sorted(tools - set(kinds))
            if extra:
                found.append(f"{pid}: economics.kinds names {extra}, which truth does not target")
            if missing:
                found.append(f"{pid}: economics.kinds leaves out truth targets {missing}")
    if "example_usd" in economics:
        value = economics["example_usd"]
        if value is not None and (isinstance(value, bool) or not isinstance(value, int | float)):
            found.append(f"{pid}: economics.example_usd must be a number or null, not {value!r}")
    if "fit" in showcase:
        found.extend(_fit_problems(pid, showcase["fit"]))
    return found


def _fit_problems(pid: str, fit: Any) -> list[str]:
    """ADR 0133: ``fit`` says where a chore works, for whom, what it asks for and what it costs."""
    if not isinstance(fit, Mapping):
        return [f"{pid}: fit must be an object (ADR 0133)"]
    found: list[str] = []
    where = fit.get("where")
    if isinstance(where, list):
        bad = [c for c in where if not isinstance(c, str) or c not in USPS_CODES]
        if not where or bad:
            found.append(f"{pid}: fit.where lists {bad or 'nothing'}, not USPS state codes")
    elif not isinstance(where, str) or not where.strip():
        found.append(
            f"{pid}: fit.where must be {' or '.join(FIT_REGIONS)}, a region word or a list of "
            "USPS state codes (ADR 0133)"
        )
    for key in ("where_note", "who", "not_for", "costs"):
        value = fit.get(key)
        if not isinstance(value, str) or not value.strip():
            found.append(f"{pid}: fit.{key} must be one plain sentence (ADR 0133)")
    asks = fit.get("asks_for")
    if not isinstance(asks, list) or not all(isinstance(a, str) and a.strip() for a in asks):
        found.append(f"{pid}: fit.asks_for must be a list of plain items (ADR 0133)")
    extra = sorted(set(fit) - {"where", "where_note", "who", "not_for", "asks_for", "costs"})
    if extra:
        found.append(f"{pid}: fit carries {extra}, which ADR 0133 does not define")
    return found


def _taxonomy_problems(showcase: Mapping[str, Any], taxonomy: Taxonomy) -> list[str]:
    """ADR 0096: a playbook names one area and one job, each an id in the library's list.

    No playbook is exempt, the nine before ADR 0057 included: the ledger files every playbook by
    both, and one left out would show under "Uncategorised" in the desktop, which is a fallback for
    a library mid-edit, not a place a shipped playbook lives.
    """
    found: list[str] = []
    for key, ids in (("category", taxonomy.categories), ("job", taxonomy.jobs)):
        value = showcase.get(key)
        if value is None:
            found.append(f"playbook.json needs {key!r}, one of {', '.join(ids)} (ADR 0096)")
        elif not isinstance(value, str) or value not in ids:
            found.append(
                f"playbook.json {key} {value!r} is not in {TAXONOMY_FILENAME}: "
                f"one of {', '.join(ids)} (ADR 0096)"
            )
    return found


@dataclass(frozen=True)
class Taxonomy:
    """The ledger's two axes, id -> label, in the order the file lists them (ADR 0096)."""

    categories: dict[str, str]
    jobs: dict[str, str]


def load_taxonomy(base: str | Path = PLAYBOOKS_DIRNAME) -> Taxonomy:
    """``<base>/taxonomy.json``: the areas and jobs a playbook's ``category`` and ``job`` name."""
    path = Path(base) / TAXONOMY_FILENAME
    name = TAXONOMY_FILENAME
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise PlaybookError(
            str(path), [f"{name} is missing from {path.parent.as_posix()}"]
        ) from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise PlaybookError(str(path), [f"{name} is not readable JSON: {exc}"]) from exc

    def axis(key: str) -> dict[str, str]:
        rows = raw.get(key) if isinstance(raw, dict) else None
        if not isinstance(rows, list) or not rows:
            raise PlaybookError(str(path), [f"{name} '{key}' must be a non-empty list"])
        out: dict[str, str] = {}
        for row in rows:
            if not (
                isinstance(row, dict)
                and isinstance(row.get("id"), str)
                and isinstance(row.get("label"), str)
            ):
                raise PlaybookError(
                    str(path), [f"{name}: every '{key}' row needs a string id and label"]
                )
            if row["id"] in out:
                raise PlaybookError(str(path), [f"{name} '{key}' repeats {row['id']!r}"])
            out[row["id"]] = row["label"]
        return out

    return Taxonomy(categories=axis("categories"), jobs=axis("jobs"))


def load_all(base: str | Path = PLAYBOOKS_DIRNAME) -> list[Playbook]:
    """Every playbook under ``base``, in directory order. One bad playbook fails the lot.

    The library's ``taxonomy.json`` is read once here, not once per playbook; a bad one fails
    before any playbook is read, since every one of them would report the same problem.
    """
    taxonomy = load_taxonomy(base)
    return [
        load_playbook(d, taxonomy)
        for d in sorted(Path(base).iterdir())
        if (d / "playbook.json").is_file()
    ]


def _norm(value: Any) -> str:
    """A key value as the scorer compares it: trimmed, case-folded, inner spaces dropped."""
    return "".join(str(value).split()).upper()
