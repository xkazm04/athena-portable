# 0210. A send names the draft it was approved on

Date: 2026-10-25

## Context

Ledgerbox's `sendReminderAction` (`examples/ledgerbox/app/actions.ts`) took an invoice and sent
whichever unsent draft was newest. Approval bound to an invoice, not to a letter. A firm draft
written after the person read a gentle one (by them in another view, or by the agent between
their arm and their confirm) went out under the gentle one's approval. The card's `stillArmed`
closes its own gate when the body changes, but only on the next render; the agent's path had no
check at all. `draft_reminder` already returned a `reminder_id` that no send path accepted.

Separately, a letter whose figures the books no longer held (a part payment since the draft) was
refused with "Draft it again; it was not sent". The app holds every fact the corrected letter
needs (`letterFor`) and made the person ask for it: Draft, read, arm, confirm.

## Decision

1. **A send may name its draft.** `sendReminderAction(ref, actor, reminderId?)`. Named, it is a
   compare-and-set against the newest unsent draft on the invoice: a different one refuses,
   naming the replacement's tone and time; a reminder already sent refuses as sent; one from
   another invoice refuses. Nothing is written on any of these. Omitted, the newest unsent draft
   is sent, as before, so a caller that does not pass it keeps today's behaviour.
2. **The card and the tool name it.** `LnDetail.draft` carries the draft's id; the card's Send
   issue carries it (`card/acts.ts`) and `Decide` passes it. `send_reminder` gains an optional
   `reminder_id`, passed through.
3. **A stale letter comes back redrafted.** When the stored letter's subject or body differs from
   `letterFor` today, the send writes today's letter in the same tone as the invoice's draft,
   retires the stale draft, and answers `ok: false` with the new draft attached and "redrafted,
   not sent". It is the same act `draft_reminder` performs: AUTO, reversible, logged as
   `draft_reminder` by the send's actor. Nothing reaches a person on a refused send.
4. **The chase refusals win.** Paid, void, disputed, or a credit in the statement that settles
   it: the send refuses with that reason and nothing is redrafted.

## Consequences

- The letter approved is the letter sent, or nothing is. The window between arm and confirm is
  closed at the server, which is what `card/acts.ts` said it could not close on its own.
- Recovering from a payment that landed while the letter waited is two presses (read, Send)
  instead of four.
- A refused send can write: the redraft. It is logged and undoable like any draft. The stale
  draft's own undo then refuses as replaced (ADR 0203); the redraft's id is distinct even within
  one millisecond, so that undo can never reach it.
- The agent sees the redraft whole on the refusal (`{ ok: false, error, draft }`) and sends it by
  its `reminder_id`.
