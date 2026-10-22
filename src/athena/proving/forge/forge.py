"""Ask a model for variants of a playbook's world (README §14; spark nvidia-revisit, WP-F).

One call per variant. The prompt carries the playbook's rules (``playbook.json``), its world and its
truth, and asks for ``{"world": {...}, "truth": {...}}`` that keeps the rules and changes the
facts. The files are authored data, but they are fenced anyway: the same prompt shape is used for
a Nemotron generator and the Haiku 5.5 control, and a model's *answer* is never put in a prompt
here (the audit fences those). Nothing the model says is trusted: :func:`validate` decides.
"""

from __future__ import annotations

import json
import random
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from athena.core.fence import fresh_nonce, wrap_untrusted
from athena.proving.forge.base import Base
from athena.proving.forge.validate import code_of, validate
from athena.proving.roles import RoleCaller, RoleClient

__all__ = [
    "MARKER",
    "SCHEMA",
    "SHOWCASE_KEYS",
    "SYSTEM",
    "Variant",
    "forge_one",
    "forge_prompt",
]

#: What the generator reads of ``playbook.json``: the rules, the traps and the persona, not the
#: marketing (economics, edge, brief) that would only cost tokens.
SHOWCASE_KEYS = (
    "title",
    "persona",
    "chore",
    "command",
    "apps",
    "steps",
    "gates",
    "traps",
    "memory",
    "expectation",
    "caveat",
)

#: Every prompt carries ``PLAYBOOK_ID=<id> VARIANT=<k>`` on a line of its own: a recorded or dry
#: generator keys its fixture on it, a real model ignores it.
MARKER = "PLAYBOOK_ID={id} VARIANT={k}"

SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["world", "truth"],
    "properties": {"world": {"type": "object"}, "truth": {"type": "object"}},
}

SYSTEM = (
    "You write test worlds for a benchmark of an assistant that reads simulated web portals and "
    "proposes actions for a person to sign. You answer with one JSON object and nothing else: no "
    "prose, no code fence. Every portal, tool, table, phase and rule you are given stays exactly "
    "as it is; you change only the facts inside the tables and the truth that describes them."
)


@dataclass
class Variant:
    """One generator answer, judged. ``world`` and ``truth`` are kept only when it was valid."""

    playbook: str
    k: int
    generator: str
    model: str
    valid: bool
    problems: list[str] = field(default_factory=list)
    cost_usd: float | None = None
    ms: int = 0
    #: ``"cut"`` when the reply hit the token ceiling: a void, counted apart from the rate.
    void: str = ""
    world: dict[str, Any] | None = None
    truth: dict[str, Any] | None = None

    @property
    def codes(self) -> list[str]:
        return sorted({code_of(p) for p in self.problems})


def forge_prompt(base: Base, k: int, seed: int) -> str:
    """The user prompt for variant ``k`` of ``base``. Deterministic in ``(base, k, seed)``."""
    rng = random.Random(f"{seed}:{base.id}:{k}")
    traps = rng.randint(2, 4)
    distractors = rng.randint(3, 6)
    nonce = fresh_nonce()
    rules = {key: base.showcase[key] for key in SHOWCASE_KEYS if key in base.showcase}

    def block(title: str, value: Any) -> str:
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        return f"## {title}\n{wrap_untrusted(text, nonce=nonce)}"

    return "\n\n".join(
        [
            MARKER.format(id=base.id, k=k),
            "Below is one playbook: its rules and persona (playbook.json), the simulated portals "
            "and their data (world.json), and the answer key (truth.json). Write a VARIANT of the "
            "world and its truth: the same job in a different set of facts.",
            block("playbook.json (rules, traps, persona)", rules),
            block("world.json", base.world),
            block("truth.json", base.truth),
            "## What to produce\n"
            'One JSON object: {"world": {...}, "truth": {...}}, each a complete file in the same '
            "shape as above.\n"
            "KEEP exactly: world.apps (app_id, origin, every tool's name, kind, params and "
            "returns), world.phases (copy word for word), the table names, truth.targets' tool and "
            "key, truth.forbidden. You may reword tool descriptions and view text only to keep "
            "them true (a page count, a date).\n"
            "CHANGE: every row id, amount, date and name in the tables; world.today and the "
            f"dates that follow from it; add {distractors} distractor rows that belong to no "
            "target; keep the rules of the playbook so the same eligible/trap logic applies.\n"
            f"ADD exactly {traps} NEW look-alike traps: rows that look eligible at a glance but "
            "fail one of the playbook's rules (a missed deadline, a duplicate, the wrong party), "
            "each with a new id absent from the old truth and the reason in truth.targets[].traps. "
            "You may keep, drop or replace the old traps.\n"
            "REWRITE the truth consistently: every id in truth.eligible / traps / neutral must be "
            "the id of a row in the tables (or, where the original derives it from several rows, "
            "derived the same way); eligible and trap ids never overlap; every eligible entry "
            "keeps a numeric value_usd, a why and its expect params; the value and the why must "
            "agree with the row's new numbers and dates.\n"
            "Answer with the JSON object only. Compact JSON.",
        ]
    )


def forge_one(
    caller: RoleCaller,
    client: RoleClient,
    base: Base,
    k: int,
    seed: int,
    *,
    generator: str,
    role: str = "forge",
) -> Variant:
    """One generator call, parsed and validated. A bad answer is a refused variant, not a raise."""
    answer = caller.call_json(client, role, SYSTEM, forge_prompt(base, k, seed), SCHEMA)
    reply = answer.reply
    out = Variant(
        playbook=base.id,
        k=k,
        generator=generator,
        model=reply.model,
        valid=False,
        cost_usd=reply.cost_usd,
        ms=reply.ms,
    )
    if reply.stopped:
        out.void = "cut"
        out.problems = ["call-failed: " + (reply.detail or "the reply was cut")]
        return out
    if reply.error_reason == "budget_exhausted":
        out.void = "budget"
        out.problems = ["call-failed: budget_exhausted"]
        return out
    if not reply.ok:
        out.problems = [f"call-failed: {reply.error_reason}: {reply.detail}".rstrip(": ")]
        return out
    if answer.value is None:
        # ``extract_json`` falls back to the longest span that parses, so a world with one stray
        # quote comes back as a nested fragment that "lacks world": the answer was malformed JSON.
        broken = answer.problem.startswith("no JSON") or '"world"' in reply.text
        out.problems = [
            "not-json: the answer is not one parseable JSON object"
            if broken
            else f"bad-shape: {answer.problem}"
        ]
        return out
    problems = validate(base, answer.value)
    out.problems = problems
    if not problems:
        out.valid = True
        value: Mapping[str, Any] = answer.value
        out.world, out.truth = dict(value["world"]), dict(value["truth"])
    return out
