"""Spike 05 F1 (the signer rule table): whose yes an action needs, from a table, never a model.

A care circle names its members (the parent, the primary carer, siblings) and a rule per action and
subject: ``share_record`` / ``medication`` needs the parent; ``pay_bill`` / ``*`` needs the primary
carer; ``change_appointment`` / ``*`` needs any two members, the parent able to veto. The file is
the chore's ``senses/signers.json``::

    {"members": [{"id": "ruth", "name": "Ruth Alder", "role": "parent"}, ...],
     "rules":   [{"action": "share_record", "subject": "medication", "needs": "parent",
                  "parent_veto": true}, ...]}

:func:`whose_yes` resolves one action and subject to a :class:`Requirement`: the rule naming the
subject exactly wins over the action's ``*`` rule; an action with neither is **refused** (no rule
is no permission - nobody can say yes to it). :func:`decide` then holds a set of recorded yeses and
noes to the requirement: the parent's no beats any quorum when the rule gives a veto, a proposer's
own yes never counts toward a quorum (report part 4), and a name that is not a member signs
nothing - a forged member, or a yes said for someone else, moves no edge.

Pure functions over data: no clock, no I/O beyond :func:`load_table`'s argument, no model. The
Director's rule for tonight (ADR 0231): Athena stays single-user, so this table is data the bench
reads (the ``signer_rules`` table), not a change to the gate.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

#: The four gated actions spike 05 names (README, "Gated").
ACTIONS: tuple[str, ...] = ("share_record", "pay_bill", "change_appointment", "export_record")
ROLES: tuple[str, ...] = ("parent", "primary", "sibling")
ANY_SUBJECT = "*"
REFUSE = "refuse"


class SignerTableError(ValueError):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


@dataclass(frozen=True)
class Member:
    id: str
    name: str
    role: str


@dataclass(frozen=True)
class Rule:
    action: str
    subject: str
    #: ``role:<role>``, ``quorum:<n>`` or ``parent``.
    needs: str
    parent_veto: bool = False


@dataclass(frozen=True)
class SignerTable:
    members: tuple[Member, ...]
    rules: tuple[Rule, ...]

    def member(self, member_id: str) -> Member | None:
        return next((m for m in self.members if m.id == member_id), None)

    def subjects(self) -> tuple[str, ...]:
        """``*`` and every subject a rule names, sorted after it."""
        named = sorted({r.subject for r in self.rules} - {ANY_SUBJECT})
        return (ANY_SUBJECT, *named)


@dataclass(frozen=True)
class Requirement:
    """Whose yes ``action`` on ``subject`` needs. ``needs`` is ``refuse`` when no rule covers it."""

    action: str
    subject: str
    needs: str
    parent_veto: bool
    #: The member ids whose yes can count toward it, in table order.
    signers: tuple[str, ...]
    #: Distinct counting yeses it takes; 0 for a refusal.
    quorum: int
    #: ``<action>/<subject>`` of the rule that decided; ``None`` when refused.
    rule: str | None

    @property
    def refused(self) -> bool:
        return self.needs == REFUSE


@dataclass(frozen=True)
class Decision:
    runs: bool
    reason: str


def _needs_problem(needs: str, members: int) -> str | None:
    if needs == "parent":
        return None
    kind, _, arg = needs.partition(":")
    if kind == "role":
        return None if arg in ROLES else f"needs {needs!r}: role must be one of {list(ROLES)}"
    if kind == "quorum":
        if not arg.isdigit() or not 1 <= int(arg) <= members:
            return f"needs {needs!r}: a quorum is a whole number from 1 to {members}"
        return None
    return f"needs {needs!r} is not role:<role>, quorum:<n> or parent"


def load_table(raw: Mapping[str, Any]) -> SignerTable:
    """``signers.json`` as a :class:`SignerTable`; every problem at once."""
    problems: list[str] = []
    members: list[Member] = []
    for i, m in enumerate(raw.get("members", []) if isinstance(raw.get("members"), list) else []):
        mid = str(m.get("id", "")) if isinstance(m, Mapping) else ""
        role = str(m.get("role", "")) if isinstance(m, Mapping) else ""
        if not mid or any(x.id == mid for x in members):
            problems.append(f"members[{i}]: id must be present and unique")
        if role not in ROLES:
            problems.append(f"members[{i}]: role must be one of {list(ROLES)}")
        name = str(m.get("name", mid)) if isinstance(m, Mapping) else mid
        members.append(Member(mid, name, role))
    if not members:
        problems.append("signers.json names no members")
    rules: list[Rule] = []
    seen: set[tuple[str, str]] = set()
    for i, r in enumerate(raw.get("rules", []) if isinstance(raw.get("rules"), list) else []):
        if not isinstance(r, Mapping):
            problems.append(f"rules[{i}]: a rule is an object")
            continue
        action, subject = str(r.get("action", "")), str(r.get("subject", ""))
        needs = str(r.get("needs", ""))
        if action not in ACTIONS:
            problems.append(f"rules[{i}]: action must be one of {list(ACTIONS)}")
        if not subject:
            problems.append(f"rules[{i}]: subject must be {ANY_SUBJECT!r} or a subject name")
        if (action, subject) in seen:
            problems.append(f"rules[{i}]: {action}/{subject} has a rule already")
        seen.add((action, subject))
        problem = _needs_problem(needs, len(members))
        if problem:
            problems.append(f"rules[{i}]: {problem}")
        veto = r.get("parent_veto", False)
        if not isinstance(veto, bool):
            problems.append(f"rules[{i}]: parent_veto must be true or false")
        rules.append(Rule(action, subject, needs, bool(veto)))
    wants_parent = any(r.needs in ("parent", "role:parent") or r.parent_veto for r in rules)
    if wants_parent and not any(m.role == "parent" for m in members):
        problems.append("a rule names the parent and no member is the parent")
    if problems:
        raise SignerTableError(problems)
    return SignerTable(tuple(members), tuple(rules))


def whose_yes(action: str, subject: str, table: SignerTable) -> Requirement:
    """The requirement for ``action`` on ``subject``: the exact subject's rule, else ``*``, else
    a refusal. The answer is the table's; nothing here or downstream lets a model pick signers."""
    rule = next((r for r in table.rules if (r.action, r.subject) == (action, subject)), None)
    if rule is None:
        rule = next(
            (r for r in table.rules if (r.action, r.subject) == (action, ANY_SUBJECT)), None
        )
    if rule is None:
        return Requirement(action, subject, REFUSE, False, (), 0, None)
    if rule.needs == "parent":
        signers = tuple(m.id for m in table.members if m.role == "parent")
        quorum = 1
    elif rule.needs.startswith("role:"):
        role = rule.needs.partition(":")[2]
        signers = tuple(m.id for m in table.members if m.role == role)
        quorum = 1
    else:
        signers = tuple(m.id for m in table.members)
        quorum = int(rule.needs.partition(":")[2])
    return Requirement(
        action=action,
        subject=subject,
        needs=rule.needs,
        parent_veto=rule.parent_veto,
        signers=signers,
        quorum=quorum,
        rule=f"{rule.action}/{rule.subject}",
    )


def decide(
    requirement: Requirement,
    yes: Iterable[str],
    no: Iterable[str],
    table: SignerTable,
    proposer: str | None = None,
) -> Decision:
    """Whether the recorded answers let the action run. A member who said both is a no; a name
    that is not a member counts for nothing; the proposer's own yes is not one of a quorum's."""
    noes = {n for n in no if table.member(n) is not None}
    yeses = {y for y in yes if table.member(y) is not None} - noes
    if requirement.refused:
        return Decision(False, f"no rule covers {requirement.action}/{requirement.subject}")
    parents = {m.id for m in table.members if m.role == "parent"}
    if requirement.parent_veto and noes & parents:
        return Decision(False, f"vetoed by {', '.join(sorted(noes & parents))}")
    counting = yeses & set(requirement.signers)
    if requirement.needs.startswith("quorum:"):
        counting -= {proposer} if proposer else set()
    if len(counting) >= requirement.quorum:
        return Decision(True, f"{requirement.needs} met by {', '.join(sorted(counting))}")
    have = ", ".join(sorted(counting)) or "nobody counting"
    return Decision(False, f"{requirement.needs} not met ({have})")


def flatten(table: SignerTable, source: str) -> list[dict[str, Any]]:
    """The ``signer_rules`` table: one row per action x subject (``*`` and every named subject),
    each with its resolved need. ``source`` is the row's ``media_id``: the file the table is."""
    rows: list[dict[str, Any]] = []
    for action in ACTIONS:
        for subject in table.subjects():
            req = whose_yes(action, subject, table)
            row: dict[str, Any] = {
                "rule_id": f"{action}/{subject}",
                "action": action,
                "subject": subject,
                "needs": req.needs,
            }
            if not req.refused:
                row["parent_veto"] = req.parent_veto
                row["signers"] = list(req.signers)
                row["yeses_needed"] = req.quorum
                if req.rule != row["rule_id"]:
                    row["decided_by"] = req.rule
            row["media_id"] = source
            rows.append(row)
    return rows
