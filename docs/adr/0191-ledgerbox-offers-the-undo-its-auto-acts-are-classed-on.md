# 0191. Ledgerbox offers the undo its auto acts are classed on

Date: 2026-10-25

## Context

Design 5.1 runs a write unasked when it is reversible and touches only data. Five of ledgerbox's
acts are classed that way (`lib/tool-classes.ts`: categorize, match_bank_line, unmatch,
draft_reminder, export_summary), and each one already logs an activity row with an undo payload
that `undoAction` (`app/actions.ts`) reverses. Nothing called `undoAction`: `BooksTools.tsx`'s
`settle` toasted the act's sentence with two arguments, and `ActionResult` was `{ ok, message }`,
so the row id `logActivity` returns never reached the page. The class the agent's gate reads
promised a way back no surface kept, and the card's own words ("Reversible: it writes an undo
row") said the same.

ADR 0111 gave the kit toast one optional action for hirelane and left ledgerbox untouched by
construction ("Callers that pass two arguments are unchanged"): deferred, not decided against.
ADR 0156 then let an app's `applyUndo` answer what it put back - `{ refused }`, `{ partial }` or
nothing - instead of throwing.

One undo lied. A draft reminder's undo ran `DELETE ... WHERE id = ? AND sent_at IS NULL`, which
changes nothing once the draft has been sent, and the kit then marked the row undone and logged
"Undid #n" over a letter that stayed sent.

## Decision

1. **Each reversible action answers its `undoId`.** `ActionResult` gains an optional `undoId`,
   the id of the activity row the act logged. categorize, match, unmatch, draft_reminder and
   export_summary carry it on success; mark_paid, send_reminder and void_invoice never do. The
   field is additive: every caller that reads `{ ok, message }` is unchanged.
2. **The class table, not the payload, decides the Undo.** `components/lanes/tools/undo.ts`
   holds `toastFor(tool, result)`: a toast earns an Undo only for an ok result of a tool whose
   class is `{ reversible: true, sideEffects: "data" }`. A gated act whose result carried an id
   gets no button.
3. **The press is `undoPress(id)`.** It calls `undoAction`, toasts what came back in hirelane's
   words ("Undone.", "Not undone: <reason>.", "Partly undone: ..."), toasts a throw without
   claiming either way, and refreshes the router so the lanes redraw from the books.
4. **The agent's answer does not change, and the agent gains no undo verb.** `settle` strips
   `undoId` from the result it returns to the handler, so match_bank_line's and draft_reminder's
   whole-object answers read exactly as before; the manifest and the class table are untouched.
   The Undo is the person's way back from what the agent did, which is what makes AUTO honest.
5. **A sent draft's undo refuses.** `applyUndo` answers ADR 0156 verdicts instead of throwing; the
   reminder case returns `{ refused: "already sent - a sent reminder cannot be taken back" }` when
   the draft's row is sent, so the kit writes nothing and the row stays as it was. A draft that a
   later send replaced is already deleted, and its undo stays the clean no-op it was. The
   unmatch case's two refusals move from a thrown `UndoRefused` to the same verdict, with the
   same reasons.

## Consequences

- Every AUTO act an agent runs on the books can be taken back from its toast in one press;
  0 of 5 did before. No gated act offers one.
- The Undo lives as long as the toast (4 s, the kit default), the same trade ADR 0111 made. A
  durable way back (a History band, as hirelane has) is out of the tool layer's reach; the card's
  own acts (`card/Decide.tsx`) can read `undoId` in a follow-up.
- The activity record stops claiming a sent letter was undone.
- Tests: `examples/ledgerbox/test/ledgerbox-tools-undo.test.ts` (eight cases, three guards).
