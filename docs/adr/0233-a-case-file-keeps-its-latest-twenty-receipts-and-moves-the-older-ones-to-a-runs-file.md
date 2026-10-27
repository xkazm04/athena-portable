# 0233. A case file keeps its latest twenty receipts and moves the older ones to a runs file

Date: 2026-10-27

Refines [0124](0124-your-runs-come-back-to-the-chore.md) (the receipts a case file keeps).
Owner-approved 2026-10-27 (scan-sweep Lane C card, risk-assessor).

## Context

Every `done` appended a full receipt (up to 20 cards with 6 parameters each, 10 notes) to the case
file's JSON block, nothing trimmed it, and every approve, done or space move rewrote the whole
file. A weekly chore is about 52 receipts a year of up to a few KB each: the file a person is
meant to read became mostly JSON and every write cost the whole history. Receipts are stored
data, so dropping the old ones was not an option.

## Decision

1. **Keep 20.** `receipts.KEPT_RECEIPTS = 20`, the number `GET /adopt/cases/<proj>/runs` has
   always answered at most. The cap hides nothing a surface showed, and the block is bounded by
   about 20 x 3 KB however long the chore has run.
2. **Move, never drop.** When a `done` would take the list past 20, the oldest are first appended
   to `goals/<proj>.runs.txt` (a readable line, then an `athena:receipt {json}` line; append-only,
   fsynced) and only then cut from the block. A crash between the two leaves a receipt in both
   places; the next move skips an entry already in the file, so none is lost and none doubled.
   An entry the reader cannot parse is moved too, as its raw JSON.
3. **Say the whole.** The block's `runs_archived` counts the file's entries. The case file's
   "Your runs" section ends `(showing N of M; the older K are in goals/<proj>.runs.txt)` and the
   runs route's `total` is M, so its `footer` reads `(showing 20 of 52)`. The desktop already
   prints that footer.
4. **Old cases read as they did.** A case written before the cap holds more than 20 in its block;
   it reads whole and is trimmed by its next `done`. `save` and `set_space` carry the list
   forward untouched.

## Deviation from the card

The card named `goals/<proj>.runs.md`. The brain's rebuild walks `goals/**/*.md` and would read
that file as a second goal (a named skip at best), so the file is `.runs.txt`.

## Consequences

The runs file is local: it is not an indexed node, so peer replication carries the case file
with its latest 20 and not the archive. Erasing a project must remove `goals/<proj>.runs.txt`
with the case (owed to the erase path, which is outside this change). Anything that lists
receipts reads the case file and says `(showing N of M)`; the archive is read by hand or by a
future reader of the `athena:receipt` lines.
