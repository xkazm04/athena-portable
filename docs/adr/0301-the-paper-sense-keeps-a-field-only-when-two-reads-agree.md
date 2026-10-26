# 0301. The paper sense keeps a field only when two reads agree, and asks for the rest

Date: 2026-10-26

Builds on [0300](0300-a-sense-writes-cited-world-tables-and-a-chore-earns-featured-on-its-proofs.md)
(a sense writes cited world tables). Spike: `docs/concepts/meta-featured-chores/01-paper-flip/`.
Code: `src/athena/senses/paper/`, `src/athena/senses/claude_reader.py`.

## Context

Spike 01's paper sense turns a filmed pile of mail into `sheets` and `sheet_fields`, which a bench
run then reads like any portal table, and which spikes 02 and 05 consume for letters and discharge
papers. A misread dollar on a signed card is the failure the spike exists to rule out ("never
invents a field it could not read"), and Claude CLI's `Read` gives no pixel box, so "every figure
points at its pixels" (F3) had to be defined for a reader that cannot ground.

## Decision

1. **Two reads, one rule.** Every sheet is read twice (attempt 0 and 1). A field is `read` only
   when both reads hold it and their values are equal after `normalise` (whitespace; `$`, commas
   and spaces off money, two decimals; dates to ISO); its value is that normal form and its
   confidence the lower of the two. Anything else is `asked` - no value, `<sheet>.<field>` in
   `asked` - and is never filled from one read. The answer key is scored with the same function.
2. **A sheet the camera did not find is not read.** A pile sheet with no track is all asked: a
   reading of paper the segmenter never saw would be a fixture talking, not the pile.
3. **F3 counts a crop, not only a box.** A read field is located when it has a frame and either a
   box of its own or its sheet's row (the track's best frame and box in a pile; the whole page in
   photo mode). The note says how many carry a box of their own, so a Claude build's 0 boxes is
   visible next to its passing F3.
4. **A failed Claude read reads nothing.** No file or no CLI falls back to the fixture reader with
   the call row saying `fixture`; a timeout, an engine error or a malformed answer (after the
   house retry) makes every field unreadable, with the call row still saying `claude`.
5. **Nothing measured is neither a pass nor a fail.** A key with no hard sheet omits R2 (n=0 has
   no figure; the Director's call, 2026-10-26: omitting is more honest than a vacuous pass). An
   unpriced call still fails R3 (ADR 0122): there the input exists and cannot be weighed.

## Consequences

- A correlated misread (both reads wrong the same way) still gets through; that is what F2x
  measures, and the shipped chore seeds one so the figure is not trivially zero.
- The printed seeded instruction (spike 01's R4) is a field like any other: the reader copies it,
  the bench decides what it is worth, and the truth holds a trap for obeying it.
- A paper chore with no hard sheet (spikes 02, 05) carries no R2 row; its proofs say nothing about
  hard paper, and the missing row is how a reader sees that.
