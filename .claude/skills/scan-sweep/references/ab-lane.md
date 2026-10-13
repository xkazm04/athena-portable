# Lane B — the A/B wave

The sweep's middle band. Lane A builds in-session what a probe or gate has already
measured `better`; Lane C hands a human the four decisions only a human owns. Lane B
is everything between: a finding whose benefit is *claimable* but whose measurement
was out of the round's reach — the instrument did not exist, the seam sat in another
context, the change was too large to read at a glance, or the only rung climbed was a
walked simulation. Those items are not decided by a score and not decided by a person.
They are decided by **building B and measuring both arms with the same instrument**,
in isolation, in parallel, with the director merging what measured better and
discarding what did not.

The shape is `intake`'s Phase 7.5 + 7.7 (A/B modes, worktree dispatch, director
merge, `--no-ff`, never push) carried into the sweep, with one addition the sweep
learned on its own: **the seeded control.** A worker's instrument must be shown to go
red on A before its green on B counts — measured 2026-09-05, a probe written against
an unsound helper passed vacuously and only the seeded control caught it.

## What goes to Lane B

A finding enters Lane B when it is not vetoed, not escalated (§5, Lane C), not
`not-better`, and **any** of:

| Trigger | Why A could not take it |
| --- | --- |
| `Method: simulation` | Nothing was measured; three walked cases are a prediction. B's first job is the instrument. |
| `unmeasurable` with a named S/M instrument in its After line | Same — the round said what would decide it and did not have budget to build it. |
| `better` by probe, but **M with risk ≥ 4**, or **L** | The delta is real on a sample; the whole change needs its own gate run in isolation before it lands. |
| `out-of-scope` (the old veto 1) | The seam is in a context this round did not own. A worker that owns that context can build it; a worker is not a parallel session. |
| `contract` with in-tree consumers, verifier missing | The contract rule's letters (a)–(d) are exactly a B's checklist: enumerate, regenerate, pin, gate. |
| `carry` from a prior round that still lacks its instrument | Approved and still unbuilt for the same reason twice is a B, not a third carry. |

**XL never enters B.** Intake's E4 holds: a change too large to read in one diff is a
human's, however good its figure.

## The worker contract

One worker per B item — or one worker per **write-set group** when several items name
the same files (intake v2.3.2: parallel branches over one file only move the merge
conflict to the director). The director groups by the seam lines in each card's
Evidence before dispatching, and a group is executed in order on one branch with one
commit per item.

The worker is an **Sonnet-class subagent** (operator rule, 2026-09-06) with the full
finding card as its spec, in an isolated worktree:

```
git worktree add C:/t/w-<repo>-<slug> -b sweep/<slug>
```

Short path, per the long-path rule. The worktree shares the git common dir, so hooks,
`.claude/`, and the registry link follow it; `node_modules` does not — junction it
(`mklink /J`) rather than reinstalling.

**And then never run `npm ci` or `npm install` inside the worktree.** The junction is a
door into the base checkout's `node_modules`, and `npm ci` DELETES that directory before
it installs — through the door. Measured 2026-09-06, the first wave this contract ran:
one worker's `npm ci` emptied the base checkout's `node_modules` mid-run, two sibling
workers saw an empty tree and reinstalled locally, and the director found the base
repopulated only because the same `npm ci` finished. The base checkout is the
director's arm A and every other worker's toolchain; a worker that finds it empty
reports `unmeasurable: toolchain` and stops rather than reinstalling. The director
says this in the dispatch prompt, every time.

The worker does these **in order**, and stops at the first that fails:

1. **Re-measure A.** Take the card's `Before` figure on the base tree with the card's
   own method. If the figure does not reproduce, the finding is a false positive: stop,
   report `fp`, build nothing.
2. **Build the instrument first** where the card is `simulation`/`unmeasurable` — the
   probe, the fixture, the root override, the counter. Commit it on its own as
   `test(<ctx>): <instrument>` so it survives even if B is thrown. Then re-take `Before`
   at the new rung; if it now reads `not-better`, stop and report with the figure.
3. **Build B** within the card's stated size. If a third file or a shared surface is
   needed that the card did not name, stop: demote to the honest larger size and report.
   Size creep at execution time is the safety valve; a worker never argues past it.
4. **Take the same figure on B.** Same instrument, same inputs, same predicate.
5. **Run the repo's gates**, each in its own invocation, statuses asserted — the
   overlay's shape, never a pipe. A gate the worker could not run is a gate that did
   not pass; say so.
6. **Seed the control.** Revert B's source change in the worktree, run the instrument,
   require RED; restore. For an item spanning N surfaces, seed each surface alone. An
   instrument that stays green on A is not an instrument, and the verdict above it is
   void.
7. **Commit with a pathspec** on the worktree branch, `fix(<ctx>): <title>` with the
   lens, the Before/After as re-measured, the seeded-control result, and the gate exit
   codes in the body. Never push. Never `git add -A`.
8. **Return** one JSON object, nothing else:

```json
{"slug":"...","verdict":"better|not-better|unmeasurable|fp|demoted","before":"...","after":"...",
 "method":"gate|probe|experiment","seeded_red":true,"gates":{"typecheck":0,"lint":0,"test":0},
 "sha":"...","branch":"sweep/<slug>","size_actual":"S|M|L","files":[...],"note":"<=200 chars"}
```

`unmeasurable` after a real attempt must name the instrument it could not build and
why; it is the only verdict that goes on to Lane C.

## The director

The session that ran the sweep is the director. It never builds a B itself; it
dispatches, reads, and merges.

- **Dispatch** every group in one message so the workers run concurrently. Cap at
  `--workers N` (default 4). Groups beyond the cap wait for a free slot.
- **Review each return against the diff**, not the report: the gate ran (exit codes
  present), `seeded_red` is true, the After matches what the gate could see, the size
  did not creep, only the card's files moved.
- **Merge** a `better` with green gates into the active branch, `--no-ff`, message
  naming the item and the gate date. **Unlink the junction before removing the
  worktree** — `git worktree remove --force` deletes THROUGH a junction on Windows
  and empties the base checkout's `node_modules` (measured 2026-09-06: the last
  worktree removed still held its junction, and the director's own gate run then
  found 0 packages and read three red gates that were nothing but a missing
  compiler). `cmd /c rmdir <worktree>\node_modules` removes the link only; then
  `git worktree remove`. Emit a progress node.
- **A red gate the branch did not cause is main's red, not the worker's.** Before
  refusing a merge for it, run the same gate on the active branch WITHOUT the
  worker's commits; if it fails identically there, merge on the worker's own gates,
  name the pre-existing red in the merge message, and carry it as a finding.
- **Reject** a `not-better` with both figures attached — the most valuable row, and it
  never re-enters the backlog. Delete the branch. Record it in the ledger (below).
- **Escalate** an `unmeasurable` to Lane C with the worker's named instrument; keep the
  branch if the instrument commit is worth having.
- **Count** an `fp` or a `demoted` against the mechanism (§5's `fp` rule) and keep the
  branch for the human if anything landed on it.
- **A red or unrunnable gate keeps its branch** — the human merges by hand or asks for a
  second pass. Never merge red.
- **Ledger conflicts** in append-only files (`.claude/scan-history/*.jsonl`,
  `.ai/applied.jsonl`) resolve by **union**, never by side.
- **Never push.** The operator pushes after reading the log.

## The ledger

One line per B item, appended by the director to `.claude/scan-history/ab.jsonl`:

```json
{"at":"<ISO>","scope":"<context>","slug":"<slug>","title":"...","lane":"B","mode":"code|experiment",
 "verdict":"better|not-better|unmeasurable|fp|demoted","before":"...","after":"...","seeded_red":true,
 "sha":"<merge sha or null>","branch_kept":false,"worker":"sonnet","note":"<=80 chars"}
```

This is what the next round's picker reads to avoid re-dispatching a `not-better`, and
what the snapshot's `ab=` field is summed from.

## The worker prompt (template)

> You are a scan-sweep Lane B worker for `<repo>`. Your worktree is `<path>` on branch
> `<branch>`; the base tree is untouched. Your spec is the finding card below, verbatim.
> Follow `references/ab-lane.md` §"The worker contract" steps 1–8 in order and stop at
> the first that fails. You may edit only the files the card names plus their tests and
> any generated artefact the repo requires you to regenerate. Run every gate in its own
> invocation and assert its exit code; never pipe a gate. Seed the control before you
> commit. Commit with a pathspec; never push. Return exactly one JSON object in the
> shape the contract gives and nothing else.
>
> `<card body, evidence, size, method, gate>`
> `<repo gates, from the overlay>`
