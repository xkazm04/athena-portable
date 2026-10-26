# 0304. A walk counts tracks, hears promises only with consent, and a vague change is refused by a pure validator

Date: 2026-10-26

Builds on [0300](0300-a-sense-writes-cited-world-tables-and-a-chore-earns-featured-on-its-proofs.md).
Spike: `docs/concepts/meta-featured-chores/04-renovation-witness/`. Chore: `playbooks/renovation-witness/`.

## Context

The walk sense turns a homeowner's weekly phone walk of a remodel into evidence for three gated acts
(`sign_change`, `approve_payment`, `send_query`). Four choices in it could each be made the other way,
and each changes what money the bench lets through.

## Decision

1. **A count is distinct track ids, not frames.** SAM keeps one identity per object across a video's
   frames; an outlet filmed twice is one outlet. A segment without a track id cannot be merged and
   counts once. The row cites the best-scored frame and its box; a zero count cites none (absent).
   A re-identification split (one object, two tracks) over-counts, and F2d measures that rate.
2. **No consent notice, no audio.** A walk whose `consent_recorded` is not `true` is never handed to
   the transcriber: its counts stand, it yields no promise, and the build asks `<media_id>.consent`.
   A promise row from such a walk fails F3 whatever else it matched.
3. **Promises are a pattern classifier, not a model.** Five named cues (change, price word, price
   figure, days, commitment) decide a turn; `mentions_price` is the figure alone, so "a small
   upcharge" is a promise without a price. A schedule stated with no commitment ("tile goes in
   Tuesday") is missed on purpose rather than guessed from tense; the miss is measured in F3.
4. **The validator is pure and published as data.** `athena.senses.walk.changes.vague_change` gives
   the reasons a change cannot be signed (no price, price not a number, no days, days not a number,
   no quote line). The build writes its verdict for every world change order as `change_checks`,
   each row citing the world row it judged (`media_id: world:change_orders/<id>`), so the bench's
   Athena reads the rule's answer instead of deciding it. It judges form only: a well-formed change
   that contradicts a walk's promise is signable here and caught by joining the two tables.

## Consequences

- F4 proves the validator on data, not the gate: a card for a vague change is still a card the
  person could approve. Wiring `vague_change` into the gate's validators (`core/catalog.py`,
  `harness/hooks.py`) is the remaining step to make "cannot be signed" hold outside the bench.
- On Meta, only the segmenter and transcriber backends change; the proofs re-run unchanged.
