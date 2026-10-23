# 0132. Chores are certified by a character-played onboarding and rehearsal

Date: 2026-10-23 (spark chores-uat)

## Context
Chores (playbooks) promise money and time figures, and a non-technical person has to understand them before
adopting one. The bench certifies a playbook against its own invented world with Athena running alone; the
adopt-tier bench certifies which model tier asks the questions, on 9 fixed scenarios with a fact-sheet
persona. Neither asks whether a real person of the chore's audience understands it, gets through the
conversation, and believes what it shows them. A scout found that `economics.value_usd` is authored and never
checked against the bench world (94 of 100 differ), and that the desktop never renders a figure's basis or the
playbook's caveat.

## Decision
`athena.proving.chores_uat` runs every playbook with two Characters of its own audience (`uat/chores/pairs.json`,
22 Characters in `uat/characters/chores/`) through the real adopt loop, played by Claude Sonnet 5.5 from the
Character's card and a per-pair case card (`uat/chores/cases/`), approves the brief the way the desktop does
("Good enough" when the audit has not cleared it), runs the real showcase rehearsal, and has a blind judge
(Sonnet 5.5, fresh conversation, never shown Athena's prompts) score the pair against the Character's own
criteria. `numbers` audits every figure the Chores scene renders, deterministically, mirroring the desktop's
arithmetic. Runs are dumps first, verdicts second, under `proving-runs/chores-uat/<run-id>/`, with the
instrument's prompt and tier hashes in `run.json`; a resume across a changed instrument is refused.

## Consequences
A run costs about $2 per pair on the claude CLI (rehearsal dominates) and hours of wall time, so it is a
periodic pass, never a CI gate. The judge's verdicts are LC evidence (uat skill), not L2: rendering and the
live desktop stay with a driven session. An undecidable criterion is `null` and never counted as a pass.
The operator chose Sonnet over Nemotron to play the users; the Character format stays compatible with
`proving.characters` so the Nemotron players can take it later.
