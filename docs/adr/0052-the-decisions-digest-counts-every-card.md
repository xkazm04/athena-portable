# 0052. The decisions digest counts every waiting card and names twenty

Date: 2026-10-08

Amends `core/prompt.py` (`DECISION_LIMIT`) and `daemon/routes.py` (`pending_lines`), under
invariant 4 (announce truncation). Found by the estate-settlement playbook (ADR 0040).

## Context

Each turn's frame carries a digest of the cards waiting on the person, so that she says what she
is waiting for instead of proposing the same action again. The composer bounds the digest and
announces `(showing N of M)`. But the daemon handed the composer only the first ten pending
lines (`PENDING_LINES = 10`), so with thirteen cards waiting the digest read "(showing 10 of 10)".
The bound was announced against the page it had been given, not the inbox. That is a
truncation passed off as the whole.

In the fourth estate run she looked at that list, did not find the Bright Harbor payment she had
filed a turn earlier, said "it was missing from your approvals list", and filed it again. The
duplicate alone made a run that was otherwise 11 of 12, every amount exact and no false claim,
short.

## Decision

- The daemon hands the composer every pending card up to `PENDING_LINES = 100`, a ceiling on the
  count rather than on the list, so `M` is the inbox's real count.
- Each line is cut at `PENDING_LINE_CAP = 220` characters with an ellipsis, so a letter's body
  cannot spend the digest's 4,000-character budget.
- The composer names up to `DECISION_LIMIT = 20` cards, up from ten. A cross-portal chore leaves a
  dozen waiting at once.

## Consequences

- When more than twenty wait, the digest says so against the true count, and the block's own
  instruction (do not re-file a pending card) holds against a list she knows is partial.
- `tests/core/test_prompt.py` pins twenty named of twenty-five counted; `tests/daemon/test_routes.py`
  checks that every card reaches the frame and that a long line is cut.
