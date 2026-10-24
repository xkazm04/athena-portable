# Spike 05 - Care circle: a parent's care shared by the family, and the parent still decides

Status: **spike, not designed** (2026-10-24). From contest `athena-meta-solutions`, variant F/1
"Circle" - the full design is [report.html](report.html). Program: [../README.md](../README.md).
Depends on [spike 00](../00-meta-senses/README.md); reads paper through [spike 01](../01-paper-flip/README.md),
hears calls through [spike 02](../02-appeal-kin/README.md), counts bottles with [spike 03](../03-roll-call/README.md).

## Spark

Owner, 2026-10-24: "I would fuse all other, create please spikes per variant [...] Each variant as
chore in the existing app - they will become featured chores, spikes will try to overcome risks and
confirm feasibility, realiability and brought value."

## The featured chore

When a parent needs care, one person usually carries it all in their head and phone; the others
cannot help because they do not know what is going on or are not allowed to act. A care circle is
one cited record for the whole family: a photo of the kitchen counter becomes a checked medication
list (SAM counts the bottles, Spark reads each label, the list is compared with the discharge paper),
a recorded family call becomes tasks claimed by named people, and every action names whose yes it
needs. The parent signs on their own tablet, in large type, read aloud, and keeps the last word.

- **Who:** the family around an ageing parent: a primary carer, siblings, the parent.
- **Gated:** per a **signer rule table** (action x subject -> a role, a quorum, or the parent's veto):
  `share_record`, `pay_bill`, `change_appointment`, `export_record`.
- **Never:** doses or advises on medication (flags only, "ask the pharmacist"), lets a model choose
  the signers, shares a password, uses Contributor mode.

## This spike changes an invariant - say so first

Athena is single-user by invariant (README section 2). The circle rethinks two invariants (the
brain's portability becomes a gated export; the gate answers *whose* decision) and extends two
(provenance names the person behind an episode; the ledger names the member who caused a call). Each
change is an ADR in this spike's block, behind a feature flag, and the single-user product must keep
passing every existing test with the flag off.

## What it builds on

- `peer/` (pairing.py with per-device grants `chat`/`approve`/`memory`, `replicate.py` write-once
  replication, `phone.py` + `mobile/` the phone page): one person's devices today, members tomorrow.
- `core/approvals.py` (one conditional write spends a grant, ADR 0038), `core/brain/store.py`,
  `core/ledger.py`, `channels/voice/` (Kokoro reads cards aloud), `proving/gauntlet/`.
- Existing chores the circle would host: `medicaid-renewal`, `ltc-claims`, `rep-payee-accounting`,
  `estate-settlement`, `medicare-plan-review`.

## The risks, as proofs

| # | Kind | Assumption | Experiment | Pass | Kill line -> fallback |
|---|---|---|---|---|---|
| F1 | feasibility | the gate can answer "whose yes" | a signer rule table consulted after `default_class`; tests over every action x role, quorum and veto | an action without its required signers never runs; Gauntlet impersonation ("Dad already agreed", a forged group message) 0 breaches | any breach -> the circle stays read-only |
| F2 | feasibility | members, not just devices | pairing extended so each member's own devices enrol with a role; revoke works per member | a member sees only their view; revoke is immediate | below -> one hub, shared screen, no remote members |
| F3 | feasibility | the medication photo is exact | 30 staged counter photos (empty bottles, printed fictional labels), SAM count + Spark label read, compared with a fictional discharge list | bottle count exact >= 95%; label fields >= 95%; **0 false-clears** (a real discrepancy never shown as fine) | any false-clear -> the reconcile shows reads, never a verdict |
| F4 | feasibility | a family call becomes attributed tasks | 10 role-played family calls through the call sense | manual speaker corrections <= 25% of utterances (kill) | above -> typed tasks; voice is a note |
| F5 | feasibility | withheld is honest | views computed by projection: "(showing 6 of 9 - 3 visible only to Dad and Maya)" | tests: nobody sees a withheld item; everybody sees that it exists | none: a policy with no code cannot ship |
| R1 | reliability | the record survives the hub being off | a second member's PC holds a replica (`replicate.py`) | answers and signatures resume after the hub returns, no double spend | below -> single hub, said on screen |
| R2 | reliability | the single-user product is untouched | the full test suite with the circle flag off | green | any regression blocks the merge |
| V1 | value | work spreads beyond the primary carer | a multi-actor Character harness (primary carer, sibling, parent) over a simulated eight-week world | >= 35% of completed tasks by someone other than the primary carer (A) | below half of circles with 2+ active members -> ship the capture pipeline as a single-carer tool |
| V2 | value | the parent can actually decide | the parent Character signs from the large-type, read-aloud card; ana's accessibility bar (uat) | every card answerable by voice or one key; declining as easy as approving | below -> the parent's surface is redesigned before anything else |

## What it owes the other spikes

It **owns the circle**: members, the signer rule table and member-aware views. Spikes 01 and 02 can
later write into a circle when one exists. Post signer-table shapes and the attacks that found gaps
as findings.

## Material and privacy

Everything is fictional or staged: printed labels on empty bottles, role-played calls. Health
content only in Standard mode; the effort ledger is private by default and never ranks people.

## Demo moment (from the report)

A sibling three states away picks up a task from the cited record; Dad's tablet reads the card aloud
and he declines; the action does not run, and everyone can see why.

## Launch

```
/spark Featured-chore spike 05 (care circle): read docs/concepts/meta-featured-chores/README.md,
know-how.md and 05-care-circle/README.md with its report.html; prove or kill F1-V2 before designing the
chore's screens. Read the know-how vault feed before every phase.
```
