# 0147. The tick is a working set, and only AUTO acts run over it

Date: 2026-10-25

## Context

`select` rings invoices on the ledgerbox sheet "so a person can see which ones a run is about".
The tick (`picked` in `components/lanes/Lanes.tsx`) was page state whose setter only the tool
layer held: Swarm and Spread got a read-only set, so the person could see the ring and do nothing
with it - not untick it, not count it, not act on it. Reviewing an agent's twelve ticked invoices
meant twelve rounds of Escape, find the ringed mark, click. Meanwhile `categorizeAction` already
takes a list of ids, and `card/read.ts` `actRefusal` already answers, per invoice, why a draft
would be refused.

## Decision

1. **One tick, two hands.** The person ticks with Ctrl/Cmd-click or `x` on a mark (L0) or a node
   (L1). It moves the SAME `picked` that `select` moves, under the same cap (`SELECT_MAX`); past
   the cap the press is refused with a sentence and the tick stands. A plain click still opens.
2. **A tray over the tick.** `shell/Tray.tsx` mounts at L0 and L1 whenever the tick is non-empty.
   It counts the tick from the sheet (unknown ids dropped; a draft or a void is not owed), offers
   Refile all and Draft reminders, opens the first ticked card, and clears.
3. **Only AUTO acts in bulk.** The tray's acts are `trayActs()`, each AUTO by `TOOL_CLASSES`.
   Send, record and void stay one invoice at a time behind the card's Gate, so a tick never widens
   a consent check.
4. **The refusal is known before the press.** The draft plan holds back each invoice the books
   would refuse, grouped by the row's own `actRefusal` line, and the tray prints the groups.
5. **One batch, bounded, and the failures become the tick.** `createBatch` runs sequential calls
   capped at `SELECT_MAX`, behind a flag set synchronously at the door (a second press is refused
   with no call made), counts a throw as that id's failure, says `Drafted N of M`, and hands back
   the failed ids, which become the new tick.

All of it is pure in `components/lanes/shell/tray-plan.ts` (no React, no `lib/db`), pinned by
`test/ledgerbox-lanes-tray.test.ts` against the real server actions on scratch books.

## Consequences

- The person has a bulk path over an agent's working set, and a bulk path of their own.
- A walk mode (Prev/Next through the ticked cards on the L2 head) was scoped out of this change;
  the tray opens the first ticked card and the person returns to the tray for the next.
- The module is named `tray-plan.ts`, not `tray.ts`: beside `Tray.tsx` the two names collide on a
  case-insensitive file system.
- An invoice the books stop taking between the plan and the press (voided, paid, disputed) is
  reported by the batch as a failure and re-ticked, rather than the plan pretending it still holds.
