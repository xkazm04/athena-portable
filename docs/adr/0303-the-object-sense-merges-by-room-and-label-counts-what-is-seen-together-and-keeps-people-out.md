# 0303. The object sense merges by room and label, counts what is seen together, and keeps people out

Date: 2026-10-26

Builds on [0300](0300-a-sense-writes-cited-world-tables-and-a-chore-earns-featured-on-its-proofs.md)
(a sense writes cited world tables). Spike: `docs/concepts/meta-featured-chores/03-roll-call/`.
Code: `src/athena/senses/object/`. First chore: `playbooks/roll-call-inventory/`.

## Context

Roll Call turns a household's photos into the contents list an insurer pays against. SAM finds
every instance of each prompted concept in each photo, a reader names each crop, and the same
sofa then appears in dozens of photos over years. The list is sworn to an insurer, so the two
errors are not equal: a missed merge **double-claims** a possession, which reads as fraud, while
a wrong merge loses one, which the person can add back (README F3: misses preferred over
duplicates). Photos of people are most of any archive and must never leave the PC (spike 03's
"never").

## Decision

1. **One possession = one room + one normalised label.** Normalising drops case, punctuation,
   stopwords and word order and folds inch marks (`55"`, `55-inch`, `55 in` -> `55in`), so two
   readings of one sofa are one key. Different rooms or different labels are never merged: a
   moved armchair stays two lines for the person to join.
2. **A silence never splits a possession.** A first build split a key's sightings after a two-year
   gap; on the Roll Call fixtures that made 3 duplicates in 30 lines (a car photographed in 2023
   and 2025, a clock seen at two Thanksgivings), failing F3's 2% bar. Without the split: 0 of 27.
   The gap is shown instead as `first_seen` / `last_seen`, and whether a thing was still there
   on the day of the loss is the bench's question to answer from the dates and captions.
3. **The count is the most seen together in one photo**, never the sum across photos.
4. **People are counted, never read, never boxed.** Person instances are segmented so they can be
   excluded: no read is requested for their crop and no person box reaches any table. A line that
   cites such a photo carries `with_people` and `people_excluded`, so a gated share can leave the
   photo out; the best photo a line cites is one without people when one exists.
5. **An unnamed instance is asked, not guessed**: an `inventory_asked` row, never a line.

## Consequences

- F1 (recall), F1x (unsupported lines), F3 (duplicates) and F4 (people kept out) are measured on
  every build against `senses/key.json`; R2 is measured from the calls, which are free on
  fixtures. R2's note also prices the segment calls at SAM 3.1's published $2.50 per 1,000
  images: one call per prompt (267 calls for 45 photos, the person prompt included) is about $74 per 5,000-photo household,
  over the report's ~$45. A multi-prompt request, if Meta's SAM endpoint takes one, is the first
  thing the day-1 probe should check for this sense.
- Identical twin possessions in one room (two identical lamps in different photos, never seen
  together) are counted once. That is the miss the README prefers; the person adds the second.
