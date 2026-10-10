# 0060. An approved card refused at its replay can be answered again

Date: 2026-10-10

Amends `lane/browser_lane.py` (`answer_decision`) and `core/approvals.py`, after ADRs 0004, 0005,
0010 and 0038. Found by the gated-action-approval council c9b4b75f (craft-2, craft-6; priced by
value-2 and economics-3).

## Context

`answer_decision` resolves the row first, so it moves from pending to approved, and only then
replays the gate. When the card's app is switched off, `PolicyHook` refuses the replay with
`foreign_origin` before `consume`, so the row stays approved with `consumed_at` NULL. Every later
answer then met `resolve`'s "not pending" error and was refused. The card could never be answered
again; the user had to ask the agent again, which costs one more model turn per refused card. The
panel also told them to focus the app, which cannot help when the app is switched off.

## Decision

Approving again replays the card. When `resolve` refuses, the lane re-reads the row and carries on
into the replay only if the row is approved, unspent (`consumed_at` NULL), not past `expires_at`,
and the new choice is the approve token. An approved, unspent row past its expiry is refused
`expired` and never replayed.

Declining closes it. `Approvals.decline_approved` is one conditional `UPDATE ... WHERE
status='approved' AND consumed_at IS NULL` that moves the row to `declined` for an offered
non-approve token. The lane then writes the same `user_denied` episode and ledger row a normal
decline writes. After that no answer can replay the row.

The panel says, for a `foreign_origin` refusal on a card whose origin is in the switched-off list
the answer carried, that Athena was told not to act on that app and to switch it back on and
approve again.

## Consequences

Single use and policy-first are unchanged: policy still runs first in the replay, and `consume`
still decides which of two racing answers runs the action. A pending row, a consumed row, an
unknown id and an answer the card never offered are refused as before. `GET /decisions` still
lists only pending rows, so a card that was approved and then refused lives only on the screen
that answered it; a reload loses it. `ApprovalsPort` and `GrantPort` in `lane/ports.py` each gain
a member (`decline_approved`; `consumed`, `expires_at`).
