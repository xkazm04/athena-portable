"""The Proving Ground: Nemotron tests Athena beside a Claude control (README §9; ADR 0030).

Nebius is Athena's proving ground, not her companion engine. This package holds what every
prototype of it shares — and nothing a prototype owns on its own:

- :mod:`~athena.proving.roles` — a *role* client (attacker, user, judge) on Nemotron via Token
  Factory or on the Claude Haiku control via the ``claude`` CLI; every call recorded, every JSON
  answer schema-checked, a bad answer counted and never raised.
- :mod:`~athena.proving.budget` — the per-run, per-engine dollar caps, checked before each call.
- :mod:`~athena.proving.world` — one Athena under test on a throwaway brain, driven through the
  daemon's own routes, with the gate's records read back after every turn.
- :mod:`~athena.proving.report` — ``proving-runs/<ts>/report.json`` and ``report.md``.

The prototypes live beside it: :mod:`athena.proving.gauntlet` (WP2). Nothing here is imported by
``athena.core``, and nothing here decides policy: the catalog classifies, the gate decides, and a
verdict is read from what the gate recorded — never from what a model said about it (ADR 0032).
"""

from __future__ import annotations

__all__: list[str] = []
