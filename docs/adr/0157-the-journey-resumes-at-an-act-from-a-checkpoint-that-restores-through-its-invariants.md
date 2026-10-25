# 0157. The journey resumes at an act from a checkpoint that restores through its invariants

Date: 2026-10-25

Builds on [0153](0153-the-journeys-gate-is-one-pipeline-at-productions-approval-rules.md): a spent
card (`consumedAt`) is part of what a checkpoint carries.

## Context

The four-act journey (`examples/journey`) had one mode: all or nothing. The acts are steps of one
test sharing a ledger, an approval table, a brain and two connector fakes in memory, and `beforeAll`
booted all four apps unconditionally, each cold `next dev` allowed 240 s. Re-checking act 3 after a
fix meant four boots and a replay of acts 1 and 2 before the line under test ran.

What a later act reads from an earlier one is exactly that in-memory state (act 3's
`brain.recall("pinegrove")`, act 4's whole record). Each app's database is touched only by its own
act, in a per-app scratch directory, so an app no remaining act drives does not need to boot, and an
app a remaining act drives boots fresh by construction.

## Decision

**A checkpoint is plain JSON of the five state holders, with no database copy.** `Ledger`, `Brain`,
`Approvals`, `FakeMail` and `FakeNotes` each gain `snapshot()` and `restore()`. A full run writes
`shots/checkpoint-act<n>.json` (gitignored) after each act that passes with every earlier act
passing; `JOURNEY_FROM=<n>` restores the act before n, boots only the apps acts n..4 drive
(`planRun` in `src/checkpoint.ts`) and plays from act n.

**A restore is a write, not a bypass.** `Ledger.restore` puts every row back through `write()` (a
reason outside `REFUSAL_REASONS` is refused, a renumbered `seq` is refused); `Brain.restore` passes
every fact through the same door as `writeFact` (no citation, no fact) and `restoreState` refuses a
fact citing a row the restored record does not hold; `Approvals.restore` refuses an unknown status,
a `describe` that names another tool, or a spend on an ungranted card. Every holder takes a restore
only while empty.

**A stale or missing checkpoint is refused, with the way out.** A checkpoint carries a format
version and a fingerprint (sha256 of the demo kit's `COMPANIES` registry plus the format); a
mismatch is refused naming both fingerprints, and a missing file is refused naming it and the full
run that writes it.

**A resumed run is never taken for a gate run.** It prints `resumed from act N (checkpoint written
<time>)` above the record, and the checkpoints it writes carry the act its chain of resumes began
at (`resumedFrom`), never `null`. Only a full run can write the act-1 checkpoint.

## Consequences

- Re-checking act 3 boots TidyCRM alone; act 4 boots nothing and re-asserts the record in about a
  second. A full run plays the same steps as before and additionally writes three files.
- `tests/checkpoint.spec.ts` pins the round trip, the restore invariants, the plan and the refusals
  offline, with no page fixture, beside `tests/gate-pipeline.spec.ts`.
- The fingerprint covers the company registry, not every demo-kit seed or app fixture. A change to
  an app's own seed that alters what an earlier act would have read is not detected; the operator
  re-runs the full journey after such a change, and the full run stays the gate.
- A resumed run writes over the checkpoints of later acts with state a full run did not produce;
  `resumedFrom` in those files says so.
