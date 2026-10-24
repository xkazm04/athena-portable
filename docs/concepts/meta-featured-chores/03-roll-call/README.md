# Spike 03 - Roll Call: the home inventory your photos already took

Status: **spike, not designed** (2026-10-24). From contest `athena-meta-solutions`, variant D/1
"Roll Call" - the full design is [report.html](report.html). Program: [../README.md](../README.md).
Depends on [spike 00](../00-meta-senses/README.md).

## Spark

Owner, 2026-10-24: "I would fuse all other, create please spikes per variant [...] Each variant as
chore in the existing app - they will become featured chores, spikes will try to overcome risks and
confirm feasibility, realiability and brought value."

## The featured chore

After a fire, flood or storm, an insurer pays for a home's contents only against a list of every
item, and almost nobody has that list. The household's phones and their Facebook and Instagram
albums hold years of pictures of every room. Athena turns those pictures into the claim list: SAM 3.1
finds every instance of each kind of thing, Muse Spark says what each one is, and a merge across
photos and years keeps one line per possession, each line citing the photos that prove it. The
household says yes or no to what the photos show, instead of remembering for six months. The same
chore runs before a loss as **Ready**: the inventory keeps itself.

- **Who:** a household that lost the contents of its home and must itemise them (the report sizes
  this from the 2025 Los Angeles fires and California SB 495); before a loss, any household.
- **Gated:** `submit_inventory` to an insurer or adjuster, `share_binder`. Export to the household is
  not gated.
- **Never:** generates or edits an image, claims an item without a photo or the person's own word,
  sends photos of people (people are excluded or blurred before anything leaves the PC).

## What it builds on

- Existing chores near it: `recoverable-depreciation` (the insurer pays the rest after
  replacement - Roll Call's list feeds it), `fema-individual-assistance`.
- `core/brain/store.py` (an item is a fact citing photo episodes), `adopt/receipts.py` (receipts and
  where each number comes from), `proving/` bench and Characters, spike 00's SAM and Spark clients,
  and the open-weights path for a local first sort.

## The risks, as proofs

| # | Kind | Assumption | Experiment | Pass | Kill line -> fallback |
|---|---|---|---|---|---|
| F1 | feasibility | a photo archive contains the home | 2 staged homes (team members' own, with consent): a hand-made ground-truth inventory, then their real photo archives | recall of confirmed items >= 60% | < 40% after a "memory walk" video -> keep only **Ready** mode |
| F2 | feasibility | SAM 3.1 finds household things by name | a vocabulary of ~150 item classes, run over the archives | per-class recall reported; the 20 most valuable classes >= 70% | weak classes listed, asked in review instead |
| F3 | feasibility | one possession stays one line across years | the merge (same sofa in 40 photos, two identical lamps) | duplicates <= 2% of accepted lines; misses preferred over duplicates | above -> stricter threshold, side-by-side review |
| F4 | feasibility | an archive can be read in | a camera-roll folder and a Facebook "Download Your Information" export; local sort of interior shots, people excluded | interior shots found >= 90%; 0 people photos uploaded | the person picks folders by hand |
| R1 | reliability | the list is stable | 3 runs on the same archive, threshold sweep | accepted lines differ <= 2% between runs | pin thresholds; say what moved |
| R2 | reliability | it scales and resumes | 5,000 photos as a resumable batch | finishes under the report's ~$45 per household (A) and survives a restart mid-run | above -> local first pass, cloud only for crops |
| R3 | safety | text in photos is evidence | spike 00's sense Gauntlet with seeded images | 0 breaches | any breach blocks the chore |
| V1 | value | reviewing beats remembering | one team member reviews one room's draft (~150 lines), timed | <= 10 min per 150 lines (report target: <= 6 h per 1,000) | above -> the review screen is the problem, redesign before more model work |
| V2 | value | it adds money to the claim | same person makes a memory-only list first, then reviews the draft | >= 25% more claimed value (kill: < 10%) | below -> the bet is wrong; keep Ready mode only |

## What it owes the other spikes

It **owns the object sense** (photos or video -> named instances -> one identity across views and
time). Spike 04 counts installed items in a room walk with it; spike 05 counts medication bottles
with it. Post per-class prompt phrasing, mask thresholds and merge rules as findings.

## Material and privacy

Real archives only from team members who consent, processed on their own PC; only interior crops
without people reach a Standard model. The ground-truth inventories stay local (ADR 0055). Nothing
from the archives is committed.

## Demo moment (from the report)

A real home, a real archive and a live mask bloom over a room, and one memorable refusal: the product
declines to claim the old TV that a 2024 photo shows was already gone.

## Launch

```
/spark Featured-chore spike 03 (Roll Call): read docs/concepts/meta-featured-chores/README.md,
know-how.md and 03-roll-call/README.md with its report.html; prove or kill F1-V2 before designing the
chore's screens. Read the know-how vault feed before every phase.
```
