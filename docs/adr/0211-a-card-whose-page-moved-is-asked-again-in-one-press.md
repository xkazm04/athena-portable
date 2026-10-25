# 0211. A card whose page moved is asked again in one press

Date: 2026-10-25

## Context

ADR 0103 binds a card to the tab and the document it was proposed on: once that tab reloads,
navigates or closes, the approval refuses locally (`unknown_ref`) before the daemon is asked, so
the grant is never spent on a page that no longer holds what the card's refs point into. That
rule is right, but what it left the person was a dead end. The slip already named the moved tab
("Proposed on Invoices (it has reloaded since)"), yet Approve stayed the primary press; pressing
it showed "Decline it and ask again", and the way on was to decline, then retype a request the
model already held. A local refusal also keeps the card on screen and at the daemon, so it waits
there with no route to run. On a sheet of six rows, one reload cost six declines and a retyped
request.

## Decision

1. **The slip shows a dead card as dead before any press.** When the card's bound tab moved or
   closed (`BoundTabView.moved`, or not `open`, which the model already derives from the tabs
   store on every `tabs:changed`), the primary button is "Ask again here" (`data-act="reask"`) in
   place of Approve. Decline stays. The A key still dispatches an approval, which still refuses
   locally with the bound-tab sentence, and that sentence now points at the button.
2. **"Ask again here" is `useRun.reask(id)`.** It declines the card - and every row of its sheet
   whose binding is also broken, in proposal order - through the ordinary per-card decline route
   (`POST /decisions/<id>`, which needs no tab and spends no grant), then starts one exchange whose
   message is a fixed line: `(these could not run because the page they were proposed on changed
   since: <actions>; propose them again on the page as it is now)`. The request carries the
   focused tab and its current `tab_nav`, so every new card is bound to the document as it is now
   and is shown, and gated, again. Nothing is re-targeted: what runs on approval is what was
   shown (hitl-approval, resume-after-decision).
3. **Bounded by the same rules as any other answer.** `reask` returns `false` and sends nothing
   when the card can still run where it was proposed, or while she is working (the person stops
   her first), or when no decline was taken. A delegated task's card hands its decline to the
   task's owner and starts nothing in this window. A card filed under a remote exchange continues
   under that exchange's `via` (ADR 0140). The words she reads are a fixed model-facing line, as
   the continuation line is: the person's transcript holds nothing they did not type, and the
   taint of another tab's text (ADR 0105) is not cleared by it - only the person's own message
   does that.
4. **Off the first frame.** The stale verdict (`staleOf`) and the re-ask line live in the lazy
   `stores/ran.ts`, loaded on the press. To keep the first-paint ratchet, the merge of the
   daemon's pending rows into the cards (`mergeCards`, `cardFromRow`), which only runs after
   `GET /decisions` has answered, moved there too; the run store loads it inside `reconcile`.

## Consequences

- A reload during a sheet costs one press instead of a decline per row plus a retyped request.
- No policy moves: no grant is spent or reused, the old decisions are declined at the daemon and
  recorded as declined, and the new proposals go through the gate and their own cards.
- The store keeps no separate `stale` map: the view's `bound.moved` / `bound.open` is the one
  derivation of "this card's page moved" before a press, and `reask` re-reads the tabs at the
  press with the same `bindingRefusal` an approval uses.
- The model may propose differently on the new page, or nothing at all; that is the point of
  asking rather than re-targeting.
