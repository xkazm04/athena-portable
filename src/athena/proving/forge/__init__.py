"""The world forge: Nemotron mutates a playbook's world so the bench is judged on more than one.

Implements the nvidia-revisit spark, WP-F (README §14, the playbook bench; §9, the Proving
Ground's roles). A playbook's bench runs on ONE fixed world, so a chore's verdict can be an
artefact of that world. The forge asks a model for variants of the world and its truth (same
portals, tools, phases and tables; new ids, amounts, dates, distractors and look-alike traps),
refuses every variant a pure validator can fault, benches the valid ones on the real bench, and
has a blind Claude control audit every miss and every trap the run filed before anyone is blamed.

Nothing here writes outside ``proving-runs/<ts>/forge/`` (gitignored): no playbook is changed.
"""

from __future__ import annotations

from athena.proving.forge.pick import pick
from athena.proving.forge.validate import validate

__all__ = ["pick", "validate"]
