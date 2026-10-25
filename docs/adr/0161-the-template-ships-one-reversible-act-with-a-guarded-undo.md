# 0161. The template ships one reversible act with a guarded undo

Date: 2026-10-25

Builds on ADR 0017 (the demo kit), ADR 0111 (every reversible act offers its undo) and ADR 0156
(an undo answers what it put back).

## Context

`examples/demo-kit/template` is what a new host app is copied from, and it acted on nothing. Its
three registered tools were all read-only; the list counted the selection and offered nothing to
do with it; the detail page reported status as a field; the activity page wired an Undo that only
the irreversible seed row could ever reach; and `applyUndo` restored `records.status`
unconditionally for a payload nothing in the template wrote. So every app started without a
worked reversible write, and each re-derived one: hirelane needed ADR 0111 to retrofit the toast's
Undo and `undoId`, and learned separately that an undo must restore a row only if it is still
where the act left it.

## Decision

1. **One act, end to end, in the starting point.** Archive or reopen records: a bulk bar on the
   list (one button per status the selection can actually move to, counted from the plan, so it
   never offers a no-op), one button on the detail page, and the `set_record_status` WebMCP tool,
   all through one server action (`setStatusAction`) that logs one row and answers `undoId`. Each
   success toasts with the kit's Undo action.
2. **The plan is pure and refuses out loud.** `planStatusChange` (`lib/acts.ts`, client-safe)
   returns per-id changes and per-id skips with reasons; nothing to change, an unknown status or
   more than 50 ids is `{ ok: false, error }` and writes nothing. The server applies the same plan
   (`setRecordStatus`, `lib/db.ts`) in one transaction with its activity row.
3. **The undo is guarded and says so (ADR 0156).** A record goes back only if it still holds the
   status the act gave it. Some left alone is a partial verdict naming them ("Partly undid #n: put
   back ...; left rec_0001 (now open) alone"); all left alone is a refusal naming the latest later
   act on those records as `blockedBy`, so "Undo both" and the log's "Undo #n and this" work.
   `applyUndo` routes on the payload's `kind` and still throws for a kind it does not know.
4. **One vocabulary of statuses.** `STATUSES` in `lib/types.ts` is what the `Record_` type, the
   `records` CHECK constraint, the tool's enum and the buttons derive from.
5. **The act is AUTO by the kit's rule** (reversible, `sideEffects: "data"`, wire `internal`). That
   is honest only because the act is logged, undoable and guarded; the read-only tools stay as
   they were.

`setRecordStatus` and `applyUndo` live in `lib/db.ts`, not `lib/acts.ts`: they write through the
kit's server-only activity module, and `lib/acts.ts` is imported by client components.

## Consequences

- A copied app inherits a correct reversible write - planned, logged, undoable from the toast and
  the log, guarded against a later act, and offered to an agent - instead of re-deriving one.
- The template's old `{ table, id, status }` undo payload is gone; nothing ever produced it.
- `undoAction` now takes the kit's `UndoOptions` and answers its `UndoAnswer` fields, so the
  activity page shows refusals and partial undos as hirelane's does.
- Pinned offline by `examples/demo-kit/test/template-acts.test.ts` against the template's own
  seed in a scratch database. The template is still outside every workspace typecheck and lint;
  the missing `scripts/check-template.mjs` remains a backlog item.
