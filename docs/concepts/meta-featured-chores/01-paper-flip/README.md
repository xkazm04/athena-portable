# Spike 01 - Paper flip-through: a parent's mail, filmed once

Status: **spike, not designed** (2026-10-24). From contest `athena-meta-solutions`, variant B/1
"Athena Envelope" - the full design is [report.html](report.html) (opens from disk; its numbers
were researched by the seat, every Meta claim there is press or unverified). Program:
[../README.md](../README.md). Depends on [spike 00](../00-meta-senses/README.md).

## Spark

Owner, 2026-10-24: "I would fuse all other, create please spikes per variant [...] Each variant as
chore in the existing app - they will become featured chores, spikes will try to overcome risks and
confirm feasibility, realiability and brought value."

## The featured chore

A family caregiver films a parent's pile of medical and benefits mail on the phone, one flip-through,
about a minute. Athena finds every sheet, reads each one twice, matches bills against the insurer's
statements, puts every deadline on the calendar, and drafts the dispute, the appeal or the renewal.
Every date and dollar on a card taps back to the crop of the paper it came from. Nothing is sent and
nothing is paid until the caregiver signs.

- **Who:** an adult child handling a parent's paper (a new uat Character; Mira and Priya are not it).
- **Gated:** `dispute_bill`, `request_refund`, `file_appeal`, `submit_renewal`, `pay_bill` - the
  existing chores' gates.
- **Never:** submits without a signature, invents a field it could not read (an unreadable field is
  asked, not guessed), sends raw video anywhere but a Standard model.

## What it builds on

- Existing chores with answer keys for exactly this paper: `medical-bills`, `medicaid-renewal`,
  `hospital-financial-assistance`, `observation-status-appeal`, `part-d-exception`,
  `out-of-network-claims`, `msp-extra-help`. Their `world.json` + `truth.json` are the ground truth.
- `adopt/documents.py` (the documents lane), `adopt/cadence.py` (chores coming due),
  `core/brain/store.py` (provenance at write: a field cites its frame and box), `peer/phone.py` (the
  phone page signs cards).
- Spike 00's SAM and Spark clients and the media-world contract.

## The risks, as proofs

| # | Kind | Assumption | Experiment | Pass | Kill line -> fallback |
|---|---|---|---|---|---|
| F1 | feasibility | SAM 3.1 separates sheets in a flip-through video | print the letters of 3 existing worlds (render each world's documents to paper), film 20 piles of 15-25 sheets | track purity >= 90%, every sheet found | < 90% -> one photo per page, same pipeline |
| F2 | feasibility | Spark reads a filmed sheet well enough to sign on | two-frame agreement per field, scored against `truth.json` | field accuracy >= 95%, false facts <= 2% | below -> photo mode; below in photo mode -> the existing reader (spike 00 P2) |
| F3 | feasibility | every field can point at its pixels | frame + box stored with each fact; tap-to-crop in the card | 100% of card figures have a crop; crop opens <= 1 s | no grounding boxes from Spark -> SAM crop tiles |
| R1 | reliability | the read does not depend on who films | same 5 piles filmed by 3 people, different light | field agreement across runs >= 95%; correlated misreads <= 30% of misreads | above 30% -> second reader (Glimmer or the existing lane) |
| R2 | reliability | hard paper does not break it | a set of glare, folded, stacked, two-sided and handwritten sheets | each case either read or asked, never silently wrong | a named case unsupported, said on screen |
| R3 | reliability | it is cheap and fast enough to repeat weekly | ledger over the 20 piles | <= $0.50 and <= 3 min per 20-sheet pile (targets, A) | above -> frame sampling, cached reads |
| R4 | safety | printed instructions are evidence, not commands | spike 00's sense Gauntlet surface with seeded letters | 0 breaches | any breach blocks the chore |
| V1 | value | it is faster than doing it by hand | Character-played onboarding + rehearsal through `proving/chores_uat`, plus one person timed for real | median pile-to-answered-cards <= 10 min; deadlines caught >= 95% | above 30 min -> the bet is wrong; report it |
| V2 | value | the filmed path finds the money the portal path finds | the same world rehearsed from paper vs from portals | >= 90% of the answer key's money found from paper | below -> paper is intake only, portals stay the source |

## What it owes the other spikes

It **owns the paper sense** (video or photos -> sheets -> fields with pixel provenance). Spike 02
reads letters through it and spike 05 reads discharge papers through it. Post every technique that
moved F1-F2 (prompting, frame choice, crop padding, agreement rule) as a `breakthrough` finding.

## Material and privacy

All paper is fictional, rendered from existing worlds and printed. No real person's mail is filmed in
the spike. Raw video is deleted after processing; the ledger records the Standard mode on every call.

## Demo moment (from the report)

A real pile on a real table, one flip-through, and a tap on "$180" that jumps to the exact line on
the paper, beside the portal screenshot on the signed card.

## Out of scope

The UI theme (contest `athena-meta-theme`), a hosted service, real portals, real mail.

## Launch

```
/spark Featured-chore spike 01 (paper flip-through): read docs/concepts/meta-featured-chores/README.md,
know-how.md and 01-paper-flip/README.md with its report.html; prove or kill F1-V2 before designing the
chore's screens. Read the know-how vault feed before every phase.
```
