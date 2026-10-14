"""ADR 0097 (Wave 3, the tier bench): which Claude 5.5 tier serves each adopt leg kind.

The Adopt studio names a kind for every model leg, and ``src/athena/adopt/tiers.json`` says which
model and effort serve each kind. This bench chooses them from measurements instead of taste:
nine scenarios in three complexity bands (:mod:`.scenarios`), each a playbook and a person with a
hidden fact sheet, are interviewed by the real studio under six configs — Haiku, Sonnet and Opus
5.5 at low and medium effort — twice each, with a simulated person answering from her sheet
(:mod:`.simulate`); each interview is scored against the sheet and judged blind (:mod:`.score`);
per role, the quality floor disqualifies, then the fastest p50 wins with usage as tiebreak
(:mod:`.pick`); :mod:`.report` writes the plan and the tables. ``python -m
athena.proving.adopt_tiers --dry`` plans without spending.
"""

from __future__ import annotations

__all__: list[str] = []
