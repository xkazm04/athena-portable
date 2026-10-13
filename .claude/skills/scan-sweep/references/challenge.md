# `--challenge` - the proving-ground strategy

Read from `SKILL.md` § "Challenge mode". This file is the long form: the cohort
rule, the two challenge lenses, the card, the critic, the deck gate, the build
waves, the integration step and the scorecard.

The other three strategies are tuned to land SAFE work: S and M, measured, routed
by evidence, with every L parked for a human. That tuning is right for a standing
quality loop and wrong for one specific question: **how good is this model (or
this builder setup) at the hard half of the job** - seeing the structural move a
context needs, arguing it from the tree, and then landing a multi-file, risky
change without breaking anything. `--challenge` asks that question on purpose. It
is the moonshot shape (see LESSONS 2.8.0, four runs) turned into a method: fewer
ideas, bigger ones, each one built, and the run scored.

## 1. What a challenge candidate is

| Field | Floor | Why |
| --- | --- | --- |
| size | **M or L** - never S | an S is not a challenge; it is the stabilize loop's job |
| effort | **>= 5** (1-10) | multi-file, a real design decision inside it |
| impact | **>= 7** | a user or an operator notices, or a whole class of defect closes |
| risk | **4-8** | moderate to high. Under 4 it belongs to `--stabilize`/`--develop`. Over 8 is an irreversible-grade change and is never built here |
| write set | **<= ~15 files, <= ~800 changed lines**, declared up front | one builder, one wave. Bigger is **XL**: a staged plan, backlogged as `architecture` |

A card below any floor is not rejected - it is **re-homed**: written to the
ordinary backlog under the strategy it belongs to, and the slot is re-scouted.

## 2. Cohort - which contexts get challenged

The loop picks ONE context; a challenge run picks a **cohort** (default 6,
`--cohort N`, or `--one <context>`, or `--group <name>` for one group's contexts).
`scripts/coverage.mjs --challenge [--cohort N]` computes it:

1. contexts with **>= 10 files** (below that there is no structure to challenge -
   the size rule of §1 in SKILL.md, applied harder);
2. **never challenged** first (no snapshot with `strategy: "challenge"`), then the
   oldest challenge;
3. **at most one context per group**, so the cohort spreads over the product and
   two builders in one wave rarely share a seam;
4. among equals, the larger context first - more surface, harder test.

State the cohort and why in the run header. `neverSweep` contexts are skipped.

### 2.1 Riders - how the small contexts get covered

The >= 10-file floor alone would leave every small context unchallenged forever
(measured on kp: 40 of 210). So each host carries up to `--riders N` (default 3)
**riders**: never-challenged contexts under 10 files from the host's group, in map
order. A small context is never a host while its group still has an unchallenged
large one; once none is left, the group's small contexts are promoted to hosts,
largest first, and the rest ride with them.

The host's scout reads every rider in full alongside the host. Riders do not add
cards - the host still returns exactly two - but either card MAY target a rider, and
the scout records for each rider one line of what it checked (the files read, the
hypothesis it traced, why no card went there). That line is the rider's coverage
record (§4.9 of SKILL.md: a lens counts only when pointed at a named artefact), and
the rider gets its own §10 snapshot with `"note":"rider of <host>"`.

### 2.2 `--until-covered` - the coverage loop

Runs cohort after cohort until `coverage.mjs --challenge` reports `0 context(s)
never challenged`. Two rules keep it affordable:

- **Pipeline the read-only stages.** Scouts and the critic of run N+1 read the tree
  while run N's builders write it - they change nothing, and their premises are
  re-verified by the builder at build time anyway (§7 step 1). Only one run's
  BUILDS are ever in flight. Pick the next cohort with `coverage.mjs --challenge
  --in-flight <run>/cohort.json`: a run whose snapshots are not yet written would
  otherwise be picked again, host and riders both.
- **One deck approval covers the loop** when the operator asked for coverage; each
  run's deck is still written, and `irreversible` / `policy-loosen` stay out.

Each run is a complete run: its scorecard row, snapshots and integration gate land
before the next run's first builder starts.

## 3. The two lenses and the two slots

Every context in the cohort yields **exactly two candidates**, one per slot:

- **Slot A - `architecture-challenger`.** The structural move this context needs
  to stop being the reason something else is hard: the seam that caps it, the
  duplicated rule that should be one module, the synchronous path that should be
  a job, the hand-list that should be derived, the state machine hiding in
  booleans. Supported by reads from `architecture-analyst`, `risk-assessor`,
  `parity-auditor`, `tech-debt-tracker`.
- **Slot B - `ux-elevation`.** The experience leap, not a polish: a flow that
  takes five steps and should take one, a decision the user makes blind that the
  app already has the data for, a surface that reports state it should let you
  act on, a missing mode (compare, bulk, undo, preview). Supported by
  `ux-reviewer`, `state-coverage`, `onboarding-designer`, `visual-craft`.

A context with no user surface (a library, a store module) fills slot B with a
second `architecture-challenger` card on a DIFFERENT seam, and the card says so
(`slot: "B-architecture (no UI surface)"`). An operator-facing UI (an admin page,
a CLI's output) IS a user surface.

**Two cards, not two ideas per lens.** The scout may consider many; it returns its
best two and names the runner-up of each slot in one line, so the critic can see
what was traded away.

**Never re-propose.** Every open backlog of §0, the digest and prior challenge
decks are read first; a card that restates one of their titles is void. A card
MAY adopt an open backlog item that is itself high-effort (an escalated L the
drain left behind) - say so and cite it; that is the best kind of card, because
the premise already survived one reader.

## 4. The card

The §4.10 body (Summary / Description / Flow / Expected impact / Evaluation),
plus these fields, all required:

```json
{"context":"<ctx>","slot":"A|B|B-architecture (no UI surface)","lens":"architecture-challenger|ux-elevation",
 "title":"<= 80 chars","size":"M|L","effort":7,"impact":8,"risk":6,
 "write_set":["<repo-relative path>", "..."],"new_files":["<path>"],
 "shared_surfaces":["messages/en.json"],
 "acceptance":["<behaviour case 1 - input -> expected>", "... 3-8 cases"],
 "premise":"<the file:line facts the idea stands on, as a list>",
 "rollback":"<how it comes out: the commit series reverts cleanly because ...>",
 "gate":"none|contract|policy-tighten|architecture|direction|irreversible|policy-loosen",
 "runner_up":"<the slot's second-best idea, one line>",
 "body":"<the five sections>","evidence":"<proof block>"}
```

- **`acceptance` is the heart of the card.** 3-8 concrete behaviour cases, each an
  input and an expected result, written so a builder can turn each one into a test
  BEFORE touching the implementation. Before = `0 of N pass`, After = `N of N`, the
  `gate` rung of the ladder. A UX card's cases are behaviour of the logic module
  under the surface (the state it enters, the action it enables, the call it makes)
  plus, where the repo can drive a browser, one journey. A card whose claim cannot
  be written as cases is `unmeasurable` and does not reach the deck.
- **`write_set` is a promise.** The builder may shrink it; growing it past the
  declared set by more than the tests and one coupled doc is a demotion (§7).

## 5. The critic - an independent reader grades every card

Idea generation is half of what this mode measures, so the cards are not graded by
the model that wrote them. A **critic** (a separate subagent; the coordinator when
no subagents exist, and the run is then marked `critic: self`) receives the cards
and the tree - **never the scout's reasoning or transcript** - and for each card:

1. **Re-verifies the premise** at every cited `file:line`. A false premise voids
   the card (count it: `premise_false`).
2. **Checks the floors** of §1 and the never-re-propose lists.
3. **Grades** 1-5 on three axes, each with one sentence:
   - **ambition** - is this the move a principal would make here, or a big-sounding
     tidy-up?
   - **grounding** - does every claim stand on the tree as it is?
   - **falsifiability** - would the acceptance cases catch a wrong build?
4. **Verdicts** `build` / `revise` (one concrete change, applied by the
   coordinator, no second scout round) / `void` (with the reason).

The critic never adds a card of its own. `idea_score` for the run is the mean of
the three axes over all cards, void included - a model that writes void cards
should score for them.

## 6. The deck gate - one human decision for the whole run

The deck is the surviving cards, one line each, ranked by `impact x critic mean`,
with size, risk, slot, write-set size and the critic's one-line reason. The
escalations then route like this:

| Gate | In challenge mode |
| --- | --- |
| `none`, `policy-tighten`, `contract` (in-tree, verifier listed) | built if the deck is approved |
| `architecture`, `direction` (inside the manifest's scope) | **the deck approval IS the human decision** - that is the point of this mode; the card must be named on the deck |
| `irreversible`, `policy-loosen`, a contract another repo consumes, `direction` outside the declared scope | **never built here.** Backlogged with the card, and counted on the scorecard as `excluded` |

Attended: present the deck and ask once - build all / a subset / none. `--go` (or
an operator who invoked the run with an explicit instruction to execute) is the
approval in advance, and the report says which it was. Unattended with no `--go`:
stop at the deck, write it as an open backlog (§9 register), do not build.

## 7. Build waves

**Wave planning.** Partition the approved cards into waves of at most `waveSize`
(default 4) builders whose `write_set`s are **disjoint**. `shared_surfaces` (the
overlay lists them: locale catalogs, generated references, ratchet ceilings, tab
registries) do not break disjointness - they are handled by the lock below. A card
whose write set overlaps another's goes to a later wave. A card that changes a
signature other cards call runs ALONE in its wave, first (LESSONS 2.8.0 lighttrack).

**The builder brief** - one subagent per card, and the brief's first lines are:

- the base sha, the branch, and "commit on this branch, never push";
- the card verbatim, including `acceptance` and `write_set`;
- the repo law it will trip (the overlay's `## Challenge mode` block);
- the order: **(1)** re-verify the premise on the current tree - false is a
  `demoted` return, no code; **(2)** write the acceptance cases as tests and watch
  them fail; **(3)** build; **(4)** the tests pass, then every gate the overlay
  names for the touched surface, each asserted by exit code (§7.2 of SKILL.md) -
  **and, before the last commit, the repo's FULL unit suite and any whole-tree
  budget (import graph, bundle size), not only the tests in the touched folders.**
  Repos keep their guards away from what they guard: a repo-wide ratchet over
  hand-typed literals, a source-guard test in a sibling feature folder, a
  per-route import budget. Measured on the first run (kp, 2026-09-22): all six
  integration breaks were exactly that class, every builder's folder-scoped run was
  green, and the wave after this clause was added had zero test failures;
  **(5)** commit as a short series (`test(<ctx>): ...` then `feat|refactor(<ctx>): ...`),
  each commit green;
- the demotion rule: past the write set, past L, or a gate it cannot turn green in
  two attempts -> revert its own uncommitted work and return `demoted` with why;
- **which artefacts are GENERATED, and by what.** A builder told to hand-edit a
  generated file either breaks its guard or is stopped by it, and both outcomes cost
  a wave. Measured on lighttrack 2026-10-05: the brief listed a backend parity doc
  among the `shared_surfaces`, but that file is generated from the backends' own
  manifests and pinned by a guard test, so a hand-written note in it goes red unless
  the change actually adds a declared surface. The builder read the guard, refused
  the instruction and used the changelog instead - the right call, and one the brief
  should not have cost it. Two more of the same class in the same run: a published
  client baseline, which snapshots the WHOLE surface and would have baked three
  siblings' half-finished schemas into a release artefact (two builders declined it
  independently and left it to the coordinator), and a route matrix that is safe to
  touch only through its generator's env var. So the brief classifies every file in
  the write set and every shared surface as one of: hand-edited, generated-by-X (and
  how to regenerate), or release-artefact-the-coordinator-owns;
- the return shape: `{card, status: landed|demoted|partial, shas[], tests_added,
  cases_red_before, cases_green_after, gates:{name: exit}, files_changed,
  lines_changed, deviations_from_card, notes}` - written to the run directory
  BEFORE the agent replies, so a dead agent's work is recoverable.

**Shared checkout.** When builders share one working tree (worktrees cannot run the
repo's gates - the overlay says so), two rules replace isolation:

- **Commit with `git commit -- <paths>`** (only-paths semantics), never a bare
  `git commit` after `git add`: a sibling's staged file must not ride along.
- **The shared-surface lock.** Before editing any `shared_surfaces` file, a builder
  takes the lock with an atomic `mkdir <git-dir>/scan-sweep-challenge.lock`
  (retry every few seconds; stale after 10 minutes), makes the edit, commits it
  IMMEDIATELY and alone, and `rmdir`s the lock. Append at the END of a list, never
  reflow a file (LESSONS 2.8.0: that is what keeps additive hunks unionable).
- A whole-tree gate that goes red on a path the builder did not touch is a
  sibling's in-flight work: re-run it once after a short wait, then report it
  rather than "fixing" a file outside the write set.

With worktrees available (a repo whose gates run in one), give each builder its own
worktree from the base sha and let the coordinator merge; the LESSONS 2.8.0
lighttrack merge rules then apply.

**Integration - after EVERY wave, before the next.** The coordinator runs the
repo's full gate on the combined tree (the builders' green was true for the tree
each one stood in; the combined tree is a different tree). Red on the combined tree:
one fix-forward attempt by the coordinator or a single finisher agent; still red ->
revert that builder's series (`git revert --no-edit <shas>`), mark it `reverted`,
and continue. Never start wave n+1 on a red tree.

**Do not write the attribution until the control has run.** A red combined tree has a
third possible owner besides this wave and combined growth (section 8): a test that was
already flaky before the run started. Telling those apart is a MEASUREMENT, not a
reading of the diff. So before blaming or absolving any builder: **(a)** check whether
the failing test, and the code path it exercises, appear in ANY of the run's write
sets - if neither does, no builder can own it; and **(b)** run the failing gate N times
at the BASE sha in a worktree OUTSIDE the repo, and N times on the merged tree,
sequentially and never in parallel (a parallel run changes the timing the flake depends
on), then compare the rates and the exact assertion.

Measured on lighttrack 2026-10-05: a soak lane failed its own planted-red self-check on
the merged tree. A first control of 5 runs at base came back clean, and the disposition
had already been written as "pre-existing flaky instrument" off 3 merged samples - which
that clean control had just contradicted. The honest figure needed 8 against 8: base 1
in 13, merged 2 in 11, same assertion, and no causal path from any landed change. The
conclusion survived, but the write-up had to be retracted first, in front of the
operator. Take the numbers, then write the verdict - never the other way round.

## 8. The scorecard - the run measures the model

Append one line per run to `.claude/scan-history/challenge-runs.jsonl`:

```json
{"at":"<ISO>","run":"challenge-<date>","models":{"scout":"<id>","critic":"<id>","builder":"<id>","coordinator":"<id>"},
 "cohort":["<ctx>"],"cards":12,"premise_false":0,"void":1,"revised":2,"approved":10,"excluded":1,
 "idea_score":{"ambition":4.1,"grounding":4.4,"falsifiability":3.9},
 "waves":3,"landed":8,"flawless":6,"flawless_strict":5,"demoted":1,"partial":0,"reverted":1,
 "cases":{"written":61,"red_before":61,"green_after":58},
 "integration_failures":2,"coordinator_fixes":1,"lines_changed":5210,
 "tokens":{"scouts":0,"critic":0,"builders":0},"wall_clock_min":0,"note":"<= 120 chars"}
```

- **`flawless`** = landed, every acceptance case red-before and green-after, every
  gate green at hand-off, no coordinator fix at integration, not reverted. It is the
  headline execution number; `landed` without it is a partial credit.
  A **guard case** - one that pins behaviour the change must NOT alter ("a
  non-overlapping booking is still accepted") - is green before by design. It
  counts toward flawless only when the card or the builder DECLARED it a guard
  before building; report `flawless_strict` (no exceptions) beside `flawless`, so
  the two readings stay comparable across runs.
- **Attribute a combined-growth break to no one.** A whole-tree budget that only the
  combined wave exceeds (each builder under, the sum over) is an integration failure
  with no builder penalty; a break one builder's own diff causes is that builder's.
- `execution_score = flawless / approved`, `idea_score` from §5. Report both in the
  run's closing lines, and the delta against the previous `challenge-runs.jsonl`
  row when one exists - the same cohort under a different model is the fairest
  comparison the file can give, and the row says which models ran which role.
- Token and wall-clock figures come from the agents' own usage reports; write `null`
  when a figure was not reported, never an estimate dressed as a count.

Per context, the ordinary §10 snapshot is still written (`strategy: "challenge"`,
`lens_keys: ["architecture-challenger","ux-elevation"]` for the lenses actually
pointed at the context). Challenge lenses do NOT count toward the stabilize
coverage denominator (`coverage.mjs` excludes `Group: challenge`), so a challenge
run cannot make a context look swept.

**A fallback wake-up names no stage.** A coordinator that schedules a heartbeat while
agents run writes the prompt as "resume the challenge run from its run directory's
state", never as the stage it is in at the time - a heartbeat that says "proceed to
the critic" fires hours later into wave 3 and reads as an instruction.

## 9. What a challenge run is not

- Not a backlog drain: it builds only its own approved cards.
- Not a replacement for the escalations: `irreversible` and `policy-loosen` stay
  out even when the operator says "build everything" - they are asked for by name
  in a separate conversation, not approved in bulk on a deck.
- Not a place to shrink a card to pass. A card that turns out to be an S once read
  properly is re-homed (§1), and the scorecard counts it against `ambition`.
