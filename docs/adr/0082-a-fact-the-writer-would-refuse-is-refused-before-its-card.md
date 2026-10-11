# 0082. A fact the writer would refuse is refused before its card

Date: 2026-10-11

Implements README section 3.3 (the gate) and section 2 invariant 2. Closes the full-council round 2
finding craft-7 of provenance-backed-memory. Builds on ADRs 0004, 0071 and 0080.

## Context

`core.write_fact` is GATED, so its validator runs before a decision card is filed and the writer
runs only after the user approved it. `WRITE_FACT_SCHEMA` had no `additionalProperties`, and the
validator checked the schema and the sources only. Three inputs passed it and met a refusal, or
nothing, later:

- a key holding a line feed or carriage return: `frontmatter.render` raises, after approval;
- a value that is empty after `strip()`: `Brain.write_fact` raises "refusing to write an empty
  fact", after approval;
- a param no code reads (`importance`, `expires_at`, `note`): the card lists it (ADR 0071: the card
  shows every param) and the executor ignores it, so the user approves something that does nothing.

AGENTS.md says the gate is the policy, and ADR 0004 makes the validator the schema plus a
provenance check. A refusal the writer would give belongs there, before the user is asked.

## Decision

- `WRITE_FACT_SCHEMA` gets `additionalProperties: False`. A card shows only params that take effect.
- `validators.fact_text()` refuses, with `validator_failed`, a key holding a character in
  `FACT_KEY_LINE_BREAKS` and a value empty after `strip()`. It checks only `str` fields (the schema
  has run), names the param and the rule, and never echoes the value. The two line-break characters
  are copied into a module constant so `validators.py` does not import the brain; a test pins the
  copy equal to `frontmatter._LINE_BREAKS`.
- `core.write_fact`'s validator is `all_of(schema_validator, fact_text(), live_sources)`: the cheap
  text check runs before the brain is asked about the sources.
- `RECALL_SCHEMA` and `CHECKPOINT_SCHEMA` stay open. Neither files a card, so an ignored param
  misleads nobody, and refusing it would cost the model a round for no safety gain. A test pins
  that `core.recall` accepts an extra param.
- The prompt renders a params line, not the raw schema, so no prompt text changes.

## Consequences

- A model that adds a param to `core.write_fact` now gets a refusal naming it and must retry.
- `expires_at` and `importance` stay unreachable from the tool, as they were. Whether a model
  should be able to set `expires_at` is craft-1 and stays open.
- The writer still refuses the same inputs, so a route that skips the gate is still caught.
- Writer inputs the validator does not cover (an empty key, a `"` in a key) are not added here.
