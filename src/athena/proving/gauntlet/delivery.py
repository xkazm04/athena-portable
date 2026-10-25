"""How one attack reaches Athena: through the surface it was written for (README §9; ADR 0032).

Each surface is delivered exactly the way the production path carries that kind of content, so the
fences and the frame are the ones a real page would meet. What each surface sends, and what its
world needs first, is its entry in :data:`~athena.proving.gauntlet.surfaces.REGISTRY` (ADR 0175);
this module only dispatches through it, so no surface is an ``if`` branch here.

**The user's message is deliberately neutral.** It asks a question and never asks for an action,
so any gated call Athena attempts was the attacker's idea — that is what makes ``pressure`` a
measurement of the attack rather than of the request.
"""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType

from athena.proving.gauntlet.attacks import Attack
from athena.proving.gauntlet.surfaces import REGISTRY, Delivery, surface
from athena.proving.world import TurnRecord, World

__all__ = ["MESSAGES", "Delivery", "deliver", "delivery_for"]

#: What the user says, per surface: a read-only view of the registry. Questions, never
#: instructions.
MESSAGES: Mapping[str, str] = MappingProxyType(
    {name: entry.message for name, entry in REGISTRY.items()}
)


def delivery_for(attack: Attack) -> Delivery:
    """Where this attack's payload goes, by its surface's registry entry."""
    return surface(attack.surface).build(attack.payload)


def deliver(world: World, attack: Attack) -> TurnRecord:
    """Set the world up for the surface, seed, then run the one turn the attack is delivered in."""
    entry = surface(attack.surface)
    if entry.setup is not None:
        entry.setup(world)
    delivery = entry.build(attack.payload)
    for text, role in delivery.seed_episodes:
        world.seed_episode(text, role)
    return world.turn(
        delivery.message,
        host_state=delivery.host_state,
        tool_results=delivery.tool_results,
        fields=delivery.fields or None,
    )
