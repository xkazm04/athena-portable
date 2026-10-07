# 0038. An approval is spent when the gate lets it through

Date: 2026-10-07

Builds on [0005](0005-approvals-live-in-the-index-and-survive-a-reconcile.md) (the approval table)
and [0036](0036-the-simulated-user-decides-cards-on-the-card.md) (the approve-path probe).
Implements README §3.2 step 6 and §2 invariant 3 ("policy lives in the gate, never in the model").

## Context

The approve-path probe of ADR 0036 measured where single use lives. Asked twice with the card's own
parameters, `GateHook.run_tool(..., approval_id=...)` let the call through both times
(`gate_reuse: allowed`). `_check_grant` asked three things: does the approval exist, is it
`approved`, and does the grant match this action and these parameters. Nothing asked whether it had
already been used. Single use held only because the approval table refuses a second *answer* and
`POST /decisions/<id>` was the only caller that handed the gate an approval id. One more caller,
such as the MCP channel, a voice confirmation or a retry after a timeout, and an approved payment
could run twice. Single use is policy, so it belongs in the gate.

## Decision

**The gate spends an approval as it lets the approved action through.** After the grant check
passes (exists, approved, matches), `_check_grant` calls `ApprovalsPort.consume(approval_id)`.
`Approvals.consume` is one conditional write inside the brain writer's `BEGIN IMMEDIATE`:
`UPDATE companion_approval SET consumed_at = ? WHERE id = ? AND status = 'approved' AND consumed_at
IS NULL`. The `rowcount` says whether *this* call spent it. Two replays racing on one approval
therefore split into one `True` and one `False` without a read before the write. A `False` is
refused with `approval_spent` and nothing runs.

**The consume point is the allow, before execution, for both kinds of tool.** For a host tool the
gate's allow is the last point the daemon controls: the page runs the tool after `execute`, so the
daemon has nothing later to hang a "used" mark on. For an executor tool the grant is spent *before*
`execute` too, so a crash or exception mid-execute leaves a spent grant rather than a replayable
one. Run at most once, never at least once: an approved payment that might have half-run is a card
the user is asked again, never one the gate silently runs a second time.

**Altered parameters are checked before the spend.** A replay with parameters the user never saw is
still refused `validator_failed`, exactly as before, and it does *not* spend the grant. A caller
that guesses wrong cannot use up the user's real approval. Declined, expired, pending and unknown
approvals are refused as before (`user_denied`, `expired`, `pending_approval`, `unknown_ref`) and
are never touched by `consume`.

**`consumed_at` is a column, not a fifth status.** The row's `status` stays `approved`, because that
is still what the user answered, and every reader of status (the route's `_why`, the inbox, the
panel) keeps its meaning. `consumed_at` is the gate's record, not the user's. A brain whose table
predates the column gains it on open (`PRAGMA table_info`, then `ALTER TABLE ... ADD COLUMN`,
nullable so old rows stay valid). This is the first column migration on this table, and it is the
idiom for the next one: `_ADDED_COLUMNS` in `core/approvals.py`.

**Approvals stay out of the rebuildable truth.** The approval table is runtime state and is absent
from `INDEX_TABLES` (ADR 0005), so a reconcile neither empties nor rebuilds it. A spent approval
stays spent across a reconcile. If a reconcile could clear `consumed_at`, the grant would become
usable again. A test pins this.

**`approval_spent` is a new member of `ERROR_REASONS`.** No existing member fits honestly.
`expired` says a clock ran out and none did. `unknown_ref` says the row is not there and it is.
`validator_failed` says the parameters are wrong and they are the right ones. `pending_approval`
says the user has not answered and they have. A ledger reader grouping refusals by reason should
be able to see a double-spend attempt as itself. The member sits with the policy refusals. The
JavaScript port in `packages/athena-bridge/gate.js` gains it in the same change, and
`tests/test_refusal_parity.py` holds the two lists equal. The desktop's `plainReason` has no case
for it and falls back to "Athena could not carry it out". The decision route never surfaces it,
because a second `POST /decisions/<id>` is refused earlier, at `resolve` (the row is not pending).

## Consequences

- `ApprovalsPort` gains `consume(approval_id) -> bool`. Every implementation must provide it: the
  real table and the fakes in `tests/harness/conftest.py` and `tests/lane/conftest.py`. A port
  without it fails `isinstance(…, ApprovalsPort)` and the gate fails closed on it with an
  `AttributeError`, never by letting the call through.
- The approve-path probe's `gate_reuse` observation now reads `refused`: the replay door, asked a
  second time with the card's own parameters, cancels `approval_spent`. The probe's planted "card
  table that answers twice" no longer produces a violation, because the gate catches the replay the
  table let through. That is the defence in depth this ADR is for. Showing the probe can still fail
  now needs both bugs planted, or a planted `consume` that always answers `True`.
- Tests: `tests/core/test_approvals.py` covers consume-once, rows that are not approved left
  untouched, an unknown id, eight threads over two brain handles giving exactly one winner, the
  column migration on an old table, and a spent grant that survives a reconcile.
  `tests/harness/test_hooks.py` covers the second replay refused `approval_spent`, a host tool spent
  on allow, the grant spent before the executor runs (an exception mid-execute is not replayable),
  altered parameters refused without spending, and a declined card never spent.
  `tests/harness/test_ports.py` sends eight concurrent replays through real gates over the real
  table: one runs, seven are `approval_spent`. `tests/contracts/test_harness.py` adds the member.
- An approval that was let through and whose host-side execution failed on the page cannot be
  retried with the same id. The user approves a new card. This is the at-most-once trade, accepted
  deliberately.
