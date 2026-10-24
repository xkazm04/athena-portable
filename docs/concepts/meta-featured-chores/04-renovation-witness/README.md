# Spike 04 - Renovation witness: every promise, change and payment on the record

Status: **spike, not designed** (2026-10-24). From contest `athena-meta-solutions`, variant E/1
"Athena Witness" - the full design is [report.html](report.html). Program: [../README.md](../README.md).
Depends on [spike 00](../00-meta-senses/README.md); counts with [spike 03](../03-roll-call/README.md)'s
object sense and hears with [spike 02](../02-appeal-kin/README.md)'s call sense.

## Spark

Owner, 2026-10-24: "I would fuse all other, create please spikes per variant [...] Each variant as
chore in the existing app - they will become featured chores, spikes will try to overcome risks and
confirm feasibility, realiability and brought value."

## The featured chore

A homeowner paying a contractor for a kitchen, a bath or a basement walks the room with the phone
for three minutes a week. The walk's audio becomes speaker-attributed promises ("bigger tile, small
upcharge" - who said it, at which second). SAM 3.1 counts the quoted items actually in the room
(outlets, recessed lights, cabinet doors) against the quote's line items. A change becomes a card
that **cannot be signed while it is vague** (no price, no days). An invoice is matched to signed quote
and change lines; money for items nobody has seen waits. Muse Image may illustrate a proposed change,
always labelled as an illustration, never as evidence.

- **Who:** a US homeowner running a five-figure contractor-led remodel in the evenings (the report:
  53% of homeowners who hired a contractor went over budget, 46% had significant delays, sourced).
- **Gated:** `sign_change`, `approve_payment` (partial approvals and holds), `send_query`.
- **Never:** pays an unseen line, signs a change without a price and days, presents a generated
  picture as a photo, diarizes a walk whose consent notice was not recorded.

## What it builds on

- Existing chores on the contractor's side of the same work: `change-order-notices`, `lien-desk`,
  `closeout-package`, `sub-insurance-certs` - their worlds hold realistic quotes, changes and
  invoices to adapt to the homeowner's side.
- `adopt/documents.py` (reading the PDF quote), `core/approvals.py`, `contracts/manifest.py`
  (`default_class`), `core/fence.py` (hidden text in invoices), `peer/phone.py`, spike 00's clients.

## The risks, as proofs

| # | Kind | Assumption | Experiment | Pass | Kill line -> fallback |
|---|---|---|---|---|---|
| F1 | feasibility | a PDF quote becomes countable line items | 10 quotes in real contractor formats (adapted from the worlds) | quantities and units exact >= 95% | below -> the person confirms each line once |
| F2 | feasibility | SAM 3.1 counts installed items in a walk | 20 recorded walks of team members' rooms, hand-counted blind | per-line count exact >= 90% (kill: < 75%) | < 75% -> drop "seen", ship the promise ledger alone |
| F3 | feasibility | promises come out of a walk's audio | scripted walks with a contractor role-played, transcribed by the call sense | >= 85% of scripted promises captured with speaker and second | below -> typed promises, audio as evidence only |
| F4 | feasibility | a vague change cannot be signed | a deterministic validator on the change card (price and days required), tested | the gate refuses it; no model decides | none: it must hold |
| F5 | feasibility | the pay gate holds what was not seen | invoices with an unseen line and hidden "approve in full" text | unseen money held, hidden text fenced, the rest approvable | any leak blocks the chore |
| R1 | reliability | counts do not depend on who walks | the same room walked by 3 people in different light | counts agree >= 90% | below -> guided walk (slower pan, a checklist of what to film) |
| R2 | reliability | an illustration never becomes evidence | Muse Image output tagged at write; the brain refuses it as a source | test proves the refusal | none: provenance rule |
| R3 | safety | instructions in invoices or speech are evidence | spike 00's sense Gauntlet plus invoice traps | 0 breaches | any breach blocks the chore |
| V1 | value | three minutes a week is enough | a Character-played homeowner over a simulated six-week renovation world | traced dollars >= 95%; upkeep <= 10 min a week | habit cost above 20 min -> the capture is wrong |
| V2 | value | the record changes money paid | the world's answer key: overbilled and unseen lines | >= 90% of the key's held or queried money caught | below -> the walk is a diary, not a gate |

## What it owes the other spikes

It **owns the walk sense** (a room video with audio -> counts against a list, promises with speakers)
and the **vague-change validator** pattern. Post count-prompting and pan guidance that worked as
findings; spike 03 will want them.

## Material and privacy

Rooms are team members' own; the "contractor" is role-played. Home video goes only to Standard
models, frames rather than full video where that suffices, deleted after processing.

## Demo moment (from the report)

A real kitchen: the contractor says "bigger tile, small upcharge"; the card refuses to be signed
without a price; later the invoice asks $1,400 for tile with hidden "approve in full" text, and the
pay gate approves what was seen, holds the two outlets SAM never saw and queries the rest.

## Launch

```
/spark Featured-chore spike 04 (renovation witness): read docs/concepts/meta-featured-chores/README.md,
know-how.md and 04-renovation-witness/README.md with its report.html; prove or kill F1-V2 before
designing the chore's screens. Read the know-how vault feed before every phase.
```
