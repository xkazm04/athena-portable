---
name: scan-sweep
description: "Long-running quality sweep that walks a repository context by context, reads each area's code once, judges it through every scan lens, and lands what it can PROVE itself with atomic commits. With no arguments it runs the STABILIZE loop - bug hunting, UI perfection, performance - picking the least-covered context each round and keeping a per-context lens-coverage ledger so a codebase gets swept evenly instead of repeatedly in the same corner. Every finding climbs an evidence ladder (gate > probe > experiment > simulation) before it is routed: a measured `better` with no escalation builds in-session, S or M, under any strategy; `not-better` is rejected with its figures; what a probe could not measure - a walked simulation, a named-but-unbuilt instrument, an out-of-scope seam, an M or L too large to land unread - goes to Lane B, an A/B wave of Opus workers in worktrees that build both arms, measure with the same instrument, seed the control red, and let the director merge `better` and throw `not-better`; only a direction, an XL, an irreversible change, a loosened policy, or an operator-only act still waits for a human. Use for a standing quality loop, a hardening milestone, or a backlog. Pass --develop for new capability, --optimize for deep hardening, --challenge for a proving ground (two critic-graded hard candidates per context), --ideas-only to change no code, --coverage for the pick list, --backlogs for what earlier passes left open, --handoff to file them into Personas Approvals (each run ends there)."
argument-hint: "[--stabilize|--develop|--optimize|--challenge] [--cohort N] [--riders N] [--until-covered] [--go] [--one <context>] [--depth N] [--ideas-only] [--lenses k1,k2] [--coverage] [--backlogs] [--ab] [--ab-only] [--workers N] [--handoff]"
category: workflow
contexts: tracked
memory: project
version: 4.6.0
tags: sweep, quality, stabilization, backlog, coverage, registry, atomic-commits
---
# Context Sweep

A **long-running sweep** that owns a repository's quality loop. It walks the
context map one area at a time, reads each area's code once, judges what it read
through every relevant lens, and lands the safe fixes itself.

The expensive part of any scan is reading the code. Do it once per context, then
judge. Depth beats breadth *within* a context; breadth comes from the loop
returning to the next-least-covered area, not from skimming.

## Invocation

```
/scan-sweep                     # the LOOP: stabilize, least-covered context first, until stopped
/scan-sweep --one <context>     # exactly one context, then stop
/scan-sweep --coverage          # the pick list; scan nothing
/scan-sweep --ideas-only        # scan and propose; change no code
/scan-sweep --backlogs          # list the open backlogs earlier passes left behind; scan nothing
/scan-sweep --challenge [--cohort N] [--go]
                                # proving ground: 2 hard candidates per context, critic, deck, build waves, scorecard
/scan-sweep --ab                # after the round's Lane A commits, dispatch Lane B (§5, references/ab-lane.md)
/scan-sweep --ab-only           # no scan: drain the existing backlog's Lane B items through the wave
/scan-sweep --workers N         # cap on concurrent Lane B workers (default 4)
/scan-sweep --handoff           # no scan: file every open backlog into Personas Approvals (§9.1), then delete it
```

**Default = the stabilize loop.** No arguments means: pick the least lens-covered
context, sweep it, land what is safe, record coverage, then pick the next one and
say so - round after round until the operator stops the session or every context
has been swept. Each round is self-contained: its commits are landed and its
snapshot is written before the next context is chosen, so an interrupted loop
loses nothing but the round in flight.

**Announce each round's boundary out loud**: `── Round <n>: <context> (lens
coverage <a>/<total>, last swept <age>) ──`. A loop whose rounds are not visible
reads as one runaway session.

**Existing backlog is spoken first (§0), including `--coverage`.** A run that
starts a new scan while a previous wave still has unbuilt auto items has
forgotten its own queue.

## Strategies - pick at most one

- **`--stabilize` (DEFAULT)** - make what exists *solid*. Deep tier: bounty-hunter,
  parity-auditor, error-handler, observability-auditor, risk-assessor,
  code-optimizer, ux-reviewer, visual-craft, state-coverage, copy-auditor,
  accessibility-checker, test-strategist, security-auditor. Aim ~80% of the
  finding budget at defects, broken or unpolished UI states, and measured
  performance problems. Feature ideas and architecture proposals are recorded as
  findings only - never built under this strategy.

  **Five of those thirteen were added because the eight before them kept missing
  whole classes** (measured over two full rounds on one repo, 2026-09-04):
  `parity-auditor` because one rule with two implementations, only one fixed, was
  five of the ten defects found and no other lens is looking for it;
  `observability-auditor` because a swallowed error and a missing audit row are
  invisible to every lens that reads for correctness; and `visual-craft`,
  `state-coverage`, `copy-auditor` because this strategy's own blurb promises
  "broken or unpolished UI states" while `ux-reviewer` alone owns flow, leaving
  how a surface LOOKS, which states it can enter, and what it SAYS unassigned -
  and copy that asserts a removed behaviour ships to a human who then acts on it.
- **`--develop`** - NEW capability. Deep tier: feature-scout, innovation-catalyst,
  ux-reviewer, onboarding-designer, integration-planner, business-strategist,
  growth-hacker, monetization-advisor. ~70% of the budget at forward-building
  items. Quality lenses still run as a light pass - a real defect is never
  ignored, but marginal cleanups are dropped.

  **"New" is not a reason to write `unmeasurable`.** A capability that lives
  inside what the context already declares it does is COVERAGE, and its figure
  is a behaviour test the sweep writes first: Before = `0 of N cases pass`,
  After = `N of N`, Method = `gate`. Sized S or M, it builds (§5). What stays
  human under this strategy is a **direction** - a capability the context's
  declared scope does not name - and anything **L**. Under v2.x every
  forward-building item was `unmeasurable` on arrival and the strategy had no
  auto-build path at all; `references/evidence.md` carries the recipe per lens.
- **`--optimize`** - QUALITY of what exists, deeper than stabilize goes: adds
  tech-debt-tracker, dependency-auditor, devops-optimizer, documentation-auditor,
  mobile-specialist, observability-auditor. ~70% of the budget at hardening, debt
  and coverage.

  **Every hardening claim has a count.** Debt is duplicated sites; a dependency
  is an audit line, a version delta and a green gate; a pipeline is a duration or
  a step count; a doc is a stated rule checked against the code it describes; a
  mobile issue is a reproduced viewport. "Cleaner" or "more maintainable" with
  no figure is `not-better` (pure churn), never `unmeasurable` - the
  `unmeasurable` drawer is where this strategy's whole output went under v2.x.

- **`--challenge`** - the PROVING GROUND. High effort, high impact, moderate to
  high risk, built rather than parked. For the moment a new model (or a new
  builder setup) arrives and the question is whether it can do the hard half of
  the job: see the structural move a context needs, argue it from the tree, and
  land a multi-file risky change without breaking anything. It inverts the other
  three strategies' tuning on purpose, so it runs on its own procedure - see
  **§ Challenge mode** below and `references/challenge.md`. Lenses:
  `architecture-challenger` and `ux-elevation`, exactly **two candidates per
  context** (one per slot), M or L only.

Name the strategy in the report header and record it in the snapshot's `strategy`
field.

## Challenge mode - `--challenge`

A challenge run replaces §1, §4.4-§4.8, §5's escalation table and §7's one-at-a-
time queue with the procedure below. Everything else binds unchanged: §0 speaks the
open backlogs first, §2's never-re-propose lists apply, §4.10's card form and
`file:line` anchors apply, §7.2's asserted gates and §7's staging rules apply, and
§10 writes a per-context snapshot. The long form is `references/challenge.md`;
read it before the first scout goes out.

1. **Cohort, not a context.** `node ${CLAUDE_SKILL_DIR}/scripts/coverage.mjs
   --challenge [--cohort N] [--riders N]` picks N contexts (default 6): >= 10
   files, never challenged first, at most one per group, larger first, each
   carrying up to 3 small same-group **riders** the scout reads and records (a
   group with no large context left promotes its small ones). `--one` /
   `--group` override. `--until-covered` loops cohorts until none is left
   unchallenged, pipelining the next run's scouts behind this run's builds
   (references/challenge.md §2.1-2.2). Print the cohort and the reason for each pick.
2. **Scout - two cards per context.** One read-only subagent per context (or the
   coordinator, sequentially, when there are none) reads the context once, the
   governing registry subject (§6), and the open backlogs, then returns exactly two
   cards: slot A `architecture-challenger`, slot B `ux-elevation` (a second
   architecture card on a different seam when the context has no user surface).
   Floors: size M/L, effort >= 5, impact >= 7, risk 4-8, a declared `write_set`,
   and 3-8 `acceptance` cases a builder can write as failing tests first. A card
   under a floor is re-homed to the ordinary backlog and the slot re-scouted once.
   Every scout writes its cards to the run directory BEFORE replying.
3. **Critic - an independent reader.** A separate subagent gets the cards and the
   tree, never the scout's reasoning: re-verifies every premise, checks floors and
   never-re-propose, grades ambition / grounding / falsifiability 1-5, and returns
   `build` / `revise` / `void`. The mean is the run's `idea_score`.
4. **Deck - one human decision.** The deck approval IS the human gate for
   `architecture` and in-scope `direction` - that is what this mode exists to
   exercise. `irreversible`, `policy-loosen`, cross-repo contracts and out-of-scope
   directions are **never built** under this mode, whatever the approval says.
   Attended: ask once. `--go`, or an invocation that explicitly asks for execution,
   is the approval in advance - the report says which. Unattended without either:
   stop at the deck and register it as an open backlog (§9).
5. **Build in waves.** Waves of <= `waveSize` (default 4) builders with disjoint
   write sets; a signature change runs alone and first. Each builder: re-verify the
   premise -> write the acceptance tests and watch them fail -> build -> tests and
   the overlay's gates green by asserted exit code -> commit a short series. In a
   shared checkout: `git commit -- <paths>` only, and the shared-surface `mkdir`
   lock for locale catalogs, generated references and ratchet files. Past the
   write set or past L -> revert and return `demoted`.
6. **Integrate after every wave.** Full gate on the combined tree before the next
   wave starts. Red: one fix-forward, then `git revert` the offending series.
7. **Score the run.** One row in `.claude/scan-history/challenge-runs.jsonl`:
   models per role, cards, premise-false, void, approved, excluded, landed,
   **flawless** (landed + cases red-before/green-after + gates green at hand-off +
   no integration fix + not reverted), demoted, reverted, integration failures,
   idea score, tokens and wall-clock as reported (null, never estimated). Close the
   report with `execution_score = flawless / approved`, `idea_score`, and the delta
   against the previous challenge row.

Challenge lenses carry `Group: challenge` in `references/lenses.md`; they run only
under this strategy and are excluded from the stabilize coverage denominator, so a
challenge run can never make a context read as swept.

## 0. Open backlogs - tell the operator FIRST

**Before the round header, before scoping, before any code is read: say what
earlier passes left unworked.** A sweep is run weeks apart. An ideas-only wave, a
`--develop` pass, or a round that hit the outbox cap leaves findings that exist
nowhere but a file, and the operator who starts the next sweep has forgotten
them. Scanning for MORE findings on top of an unworked backlog is the most
expensive way to be reminded of it. (Measured 2026-09-17: one ideas-only wave
produced 1,040 findings, 30 reached the outbox, 1,010 were "held" in a scratch
directory, and the only record that they existed was a line in a report.)

Look in every one of these, and report what each holds - `none` is an answer:

1. **The open-backlog register** (overlay key `openBacklogs`, default
   `.claude/scan-history/open-backlogs.jsonl`) - every row whose `status` is
   `open`. This is the durable pointer; §9 says when a pass must write it.
2. **The outbox** (overlay key `memoryOutbox`) - if the file exists and still
   carries `"type":"finding"` lines, the last pass was never ingested. Count them.
3. **The backlog digest** (overlay key `backlogDigest`) - the `pending` count:
   findings a consumer ingested and nobody has decided.
4. **Sweep history** - rows with `mode: "ideas"` or a `note` naming held or
   unrecorded findings, newer than the last `mode: "resolve"` row for the same
   scope.
5. **Stray findings files** - `**/scan-sweep-*/all-findings.jsonl` and
   `**/scan-sweep-*/findings/*.jsonl` under the repo's scratch locations
   (`scratchpad/`, `.claude/scan-sweep/`, the overlay's own paths). A file found
   here with no register row gets one written now, `status: open`.

Then print the notice as the FIRST thing the operator reads, one line per backlog:

```
OPEN BACKLOG  <strategy> wave of <date> (<age>) - <open> of <total> findings unworked
              <path> - <built> built, <declined> declined, <descoped> descoped
              tiers: <undisputed n> ready to build, <n> need a contract/policy review, <n> need a direction call
```

and say what can be done with it: **work it down** (route it through §5 exactly as
a fresh round would: Lane A items build in-session, Lane B items drain through
the wave with `--ab-only`, Lane C - `direction` / `architecture` /
`irreversible` / `policy-loosen` / operator-only - stays for the operator),
**hand it to Approvals** (`--handoff`, §9.1: the cards go to Personas
Approvals → Backlog, the files are deleted, the row is closed), **keep sweeping
anyway**, or **close it** (the operator says the rest is not wanted; set the row `closed` with
the reason). When the operator is present, ask which. When the run is
unattended, do not block: repeat the notice at the top of every round report
and carry on with the loop.

Rules that keep the notice honest:

- **Count from the file, not from the row.** Re-read the findings file and the
  result files beside it; a register row is a pointer, and its numbers go stale
  the moment anyone builds from the backlog.
- **A missing path is reported, not skipped.** `OPEN BACKLOG ... file is gone`
  tells the operator the findings were lost; silently dropping the row tells
  them nothing was ever owed.
- **Never re-propose what an open backlog already holds.** Its titles join §2's
  never-re-propose lists for this run, exactly like the digest's.
- **A backlog older than 14 days is not carried again.** Offer the operator:
  hand it to Approvals, or delete it. A file nobody reopened in two weeks is a
  file nobody will; carrying it forward only lengthens the notice.
- **A row whose note says the hand-off was owed** (Personas was not running when
  §9.1 ran) is retried before anything else, without asking.
- `--backlogs` prints this notice and stops. `--coverage` prints it above the
  table.

## 1. Scope the round

- `--one <context>` names the context. Otherwise **pick it**: read the context map
  and the sweep history, and choose, in this order - the first context in map
  order with NO snapshot at all; else the smallest `lens_keys` union (fewest
  lenses ever applied); tie → oldest latest snapshot. `scripts/coverage.mjs
  --next` computes exactly this and is the cheapest way to ask.
- State the choice and why in the round header ("never swept" / "lens coverage
  4/22, oldest 2026-08-11"). Coverage rotation must be auditable.
- **Size the context before you size the package.** Count its files and lines
  first. Under roughly **10 files or 200 LOC**, a full package is recording, not
  scanning: either **sweep it together with its siblings** in the same group as
  one round (preferred - it gives the lenses a real surface), or run the
  **matched tier only** and say so in the header. §4.8's yield floor assumes ten
  files or more, and §1's picker used to have no matching rule. Measured: 28
  lenses walked over a 38-line route shell.
- Stay inside the context's declared file paths for the whole round.

## 2. Load shared awareness - BEFORE reading code

- **Backlog memory** (overlay key `backlogDigest`, default
  `.personas/backlog-digest.json`) - pending / accepted / rejected titles.
  **Never re-propose anything on those lists, including rephrasings of rejected
  titles.** A rejected title is a durable human "no".
- **Hard gates** (`.claude/conventions.json` when present) - a finding that
  violates a declared gate is a defect you are about to introduce, not a finding.
- **Sweep history** (`.claude/scan-history/scan-sweep.jsonl`) - prior snapshots,
  for the trend line and the lens-ordering rule.
- **The registry**, when this repo consumes one - see §6. The registry is
  KNOWLEDGE THAT FEEDS THE LENSES, not a lens of its own and not the sweep's
  primary instrument: each lens reads the governing subject's techniques that
  touch its concern and judges against them (§3). The one place where
  "registry deviation" is itself the finding is the `registry-conformance`
  lens, which runs like any other lens and is budgeted like any other lens.

## 3. Pick the lens package

- `--lenses k1,k2` uses exactly those keys.
- Otherwise the package is **ALL lenses in `references/lenses.md`** except the
  `Group: challenge` pair, which only `--challenge` runs, ordered:
  the active strategy's deep tier first, then lenses whose `Match` regex hits the
  context's name, description, keywords, stack or paths, then the rest as a
  lighter pass. Most of the tail will honestly report "nothing real" - but a
  clean verdict earns coverage only when the lens was **pointed at something**
  (§4.9); a lens with no surface in this context is recorded as having none, and
  counts for nothing.
- Within each tier, never-applied lenses (absent from prior `lens_keys`) go
  first. The package's job is to close lens coverage, not re-walk it.
- List the deep / matched / remaining keys in the round header.
- **Lenses are the instrument; the registry is what sharpens them.** A scan is
  a set of prompts applied to the code - `error-handler` asks about error
  doors, `code-optimizer` about render and query cost - and when the repo
  consumes a registry (§6), each lens FIRST reads the techniques in the
  governing subject that touch its concern, then judges the code against them
  and names the technique in the finding. A lens whose concern has no
  governing knowledge judges on the repo's own conventions and says so in the
  finding. The `registry-conformance` lens is the ONLY lens whose findings are
  the deviations themselves - the pure registry→backlog transformation - and
  every other lens leaves those to it rather than restating them.

## 4. Survey, then judge

1. Read the context's files and collect evidence FIRST - form no verdicts while
   still reading.
2. Run any cheap deterministic check that applies (type-checker, linter, existing
   script) and reconcile. Deterministic findings belong to those tools - do not
   restate them as findings.
3. Walk the lens package **sequentially**, and give each tier room to report:
   **deep tier ≤3** findings, **matched tier ≤2**, **remaining tier ≤1**, each
   grounded in `file:line`. Zero from one lens is a valid result - say "nothing
   real" and move on. Zero from a whole TIER is a claim about the codebase, and
   §4.9 is where you test it.

   **`file:line` means `<path>:<line>`, the path relative to the REPOSITORY
   root, exactly as `git ls-files` prints it.** A basename is not an anchor and
   an anchor that does not resolve is not evidence - in a multi-package tree
   `limiter.ts:41` is ambiguous where `src/api/limiter.ts:41` is not. This binds
   every anchor in the round: findings, evidence blocks, commit bodies, report.

4. **FIND GENEROUSLY, BUILD CONSERVATIVELY. These are different budgets and
   confusing them is the failure this clause exists to prevent.**

   How much work a round does is decided by the ROUTING RULES in §5 - S builds,
   M clears a ratio, L never builds - and not by how many findings exist. So the
   finding budget is not a work budget: raising it raises the BACKLOG, which is
   the artefact the operator triages, and leaves the build volume where §5 put
   it. A sweep that finds five things in a 24-file context has not been
   disciplined; it has been incurious, and it has left the operator a backlog
   that under-describes their own repository.

   **Budget: 16 findings per context per round.** `--depth N` overrides; `--one`
   raises it to 24, because a named context is a deliberate deep dive.
   **Lifetime cap per context: 40.** Subtract what prior snapshots already
   reported, and never re-emit a finding already reported or present in the
   backlog digest.

   It was 12 while the stabilize deep tier was 8 lenses. The tier is 13 now, and
   this clause's own rule - the budget must absorb the package you ran - applies
   to the package this skill ships by default, not only to one an operator
   narrows by hand.

   **THE BUDGET MUST BE ABLE TO ABSORB THE PACKAGE YOU RAN.** A 22-lens package
   against a 5-item budget is exhausted by lens three, and the other nineteen
   have nowhere to put anything - they become coverage RECORDING, the ledger
   reads 22/22, and the round reports a clean tail it never had room to hear.
   If you narrow the budget, narrow the package with it (`--lenses`), or the
   coverage number is a lie you told yourself. Measured 2026-08-27: a 5-item
   budget over a full package yielded **0.098 findings per lens-pass** against
   the same repository's **1.63** under a 6-lens package a fortnight earlier -
   17× less, from 3.6× more lenses.
5. **Score both sides of every candidate.** *Reward* = user-visible or
   developer-measurable gain (impact 1-10). *Risk* = chance of breaking working
   code, plus churn - lines rewritten per unit of gain (1-10). These two numbers
   drive every routing decision in §5, so guessing them is guessing the routing.
   Two hard rules learned from calibration:
   - **"Unused/dead" claims require proof.** A finding that says dead/unused MUST
     cite its zero-consumer grep in the evidence. Verified dead-code removal is
     the best reward/risk class there is; guessed dead-code removal is the worst.
   - **Repo-declared incremental migrations** (string extraction, token adoption
     - whatever the repo calls fix-as-you-touch) are in scope for the nearest
     lens in files you already read, never as a bulk migration, and never where a
     deterministic gate already tracks them.
6. **Hunt for pairs, not for defect shapes.** On any codebase already swept a few
   times, pattern greps yield near zero. What still hits is **two
   implementations of one rule that must agree, where only one was fixed** -
   client vs server validation, a gate vs its debit, an abstraction vs its
   un-migrated call sites, a doc's stated rule vs the code. Grep for the *shared
   symbol* and diff its call sites. The signal to abandon a grep battery is the
   *second* clean result, not the fifth.
7. **Interrogate every hand-maintained list.** Coverage lists, allow-lists,
   enumerations of tables or routes - ask *what enumerates the ground truth, and
   is the test derived from that or from the list?* A test that reads the
   implementation's own list is coverage theater, and this class produces the
   highest-impact findings a sweep can find.

8. **BEFORE you declare the round, check the yield.** A full package over a
   context of ten files or more should produce roughly **10-16** findings. Fewer
   than **8 is a signal about YOUR PASS, not about the codebase** - the usual
   cause is that you read the deep tier and let the tail report "nothing real"
   without ever pointing it at anything. Under 8, do one more pass before
   declaring: open the two largest files you only skimmed, and drive the three
   never-applied lenses at something specific rather than at the context in
   general.

   A genuinely clean round is possible and must stay reportable - but it is a
   CLAIM, so state what you did to earn it: which files you read in full, which
   hypotheses you traced and why each failed. "Nothing found" and "nothing
   looked for" produce identical reports otherwise, and only one of them is a
   result. Measured 2026-08-27: eight of thirteen rounds returned two findings
   or fewer, none hit the budget, and re-running one of them under this clause
   found the yield had been the method's, not the repository's.

9. **A clean lens is only credible once the tier around it has spoken.** If an
   entire tier reports nothing, name the three things in it you actually
   checked. The tail's job is coverage AND a lighter hunt - it is not a list of
   keys to write into the ledger.

   **So the coverage ledger records only lenses that were POINTED AT A NAMED
   ARTEFACT** - a file read, a grep run, a hypothesis traced. Each recorded lens
   says *what it checked*: `error-handler - the 3 await sites in queue.ts, all
   guarded`. A bare "clean" is not a record. A lens with no surface in this
   context (`mobile-specialist` on a CLI crate) goes to `lens_no_surface[]`
   with its one-line reason and **earns no coverage credit** - it is not a pass,
   it is an absence. Measured 2026-09-16: ~31 judge verdicts read a 28-lens
   "all clean" list as rubber-stamped, which is the padding §4.9 already
   forbids in prose and the ledger was still accepting as a key.

10. **EVERY finding is written in the standard form - no exceptions, no prose
    dumps.** The operator decides from the deck at a glance and a cheaper model
    (Sonnet, Haiku) executes from the text alone, so a finding that is vague
    where another is precise is a finding that will be mis-decided or
    mis-built. The `body` of a finding is markdown with exactly these `## `
    sections, in this order, each present even when short:

    ```markdown
    ## Summary
    One or two sentences: what is wrong (or missing) and where. No reasoning.

    ## Description
    What the code does today, why that is a defect or a gap, and what "fixed"
    looks like. Name the technique/golden path it violates when one applies.
    `file:line` for every claim.

    ## Flow
    - the steps that reproduce or expose it, as bullets - user action -> code
      path -> observed result
    - for a proposal: the steps the fix takes, in build order

    ## Expected impact
    Who notices, what changes for them, and how it would be measured. One
    sentence on what could break.

    ## Evaluation
    Claim: quality | performance | resilience | user | other - <what the idea
      promises, one clause>
    Before: <the measurement today - a number, a count, a reproduced
      behaviour, or the sample you looked at>
    After: <the same measurement under the proposed change - from a gate run,
      a probe on a small sample, a harness, or three walked cases>
    Method: gate | probe | experiment | simulation - <what you actually did to
      get the two figures, and why the rung above was not reachable>
    Result: better | not-better | unmeasurable
    Gate: none | contract | policy-tighten | policy-loosen | irreversible |
      architecture | direction
    ```

    **The Evaluation is the routing step (§5), written down - and it is a
    MEASUREMENT, not an opinion.** "Net positive" was the previous form, and it
    let a plausible story pass for evidence: measured on this operator's deck
    (2026-08-28), 44 of 64 human-gated ideas were `uncertain` because nobody
    had checked the claim, and the executors then found premises false at the
    point of build. So: pick the benefit the idea actually promises, take the
    figure BEFORE (count the sites, time the path, reproduce the failure, read
    the sample), take the same figure AFTER by the highest rung of the ladder
    you can reach (§4.11), and write both down. `better` means the After
    figure is better on the claimed dimension without a worse figure on
    another you can see. `not-better` is a finding you are REJECTING with its
    numbers attached. `unmeasurable` is reserved for what genuinely has no
    figure - a matter of taste, a product bet - and may only be written AFTER
    the ladder was climbed and the card says which rung failed and why. It is
    the only result that goes to a human for the benefit question itself. Pure
    churn measures the same before and after and is therefore `not-better`.

11. **Climb the evidence ladder before writing `unmeasurable`.** The rungs, top
    down: **`gate`** - a test or repo gate that goes red-then-green on the
    change, or a gate's exit code on both sides; **`probe`** - the change
    applied to a small sample and the same figure taken on both sides (three
    call sites, one timed path, one reproduced flow); **`experiment`** - the
    same inputs run twice through a harness that ships nothing (a script over
    a store copy, a replayed session, a dry run of a hook); **`simulation`** -
    three concrete cases from this tree or its history walked under A and B,
    with what would falsify the prediction. Take the highest rung reachable in
    the round and say in the Method line why the one above was not. **When
    the only thing between a claim and its figure is an S-sized instrument** -
    a test file, a counter, a timing wrapper, a fixture - **build the
    instrument as its own S fix first, then measure.** A sweep that writes
    `unmeasurable` where a twenty-line test would have decided it has skipped
    its own method. `references/evidence.md` carries the rungs, the reachable
    conditions and the per-strategy recipes.

    `evidence` is SEPARATE from `body` and is the proof, as a code block or a
    `file:line` list - the exact lines, the grep output, the count - never a
    restatement of the Description. `title` is the Summary compressed to one
    line (≤ 80 chars, imperative for a fix, noun phrase for a defect).

    The renderer (`TriageCardBody`) splits on these headings and paints each as
    its own block; a body without them paints as one undifferentiated block
    and reads as the lower-quality item it is. Do not invent extra sections;
    put anything else under Description.

## 5. Routing - three lanes, evidence decides, four escalations stay human

Every finding leaves §4 with a size, an Evaluation (Before / After / Method /
Result / Gate) and two scores. §5 turns that into exactly one of three lanes:

| Lane | Who decides | What it holds |
| --- | --- | --- |
| **A - build now** | the measurement already taken | `better` at `gate` or `probe`, no escalation, XS/S, or M with risk ≤ 3, inside this round's paths. Built in-session, one commit each, seeded control on every instrument. |
| **B - A/B, then build or throw** | the same instrument on both arms, in isolation | everything claimable that A could not measure or should not land unread: `simulation`-only, `unmeasurable`-with-a-named-instrument, M with risk ≥ 4, L, out-of-scope seams, in-tree contracts without a verifier, carries that still lack their instrument. Dispatched to Opus workers in worktrees, in parallel; the director merges `better`, rejects `not-better` with figures, escalates the rest. `references/ab-lane.md` is the contract. |
| **C - human** | the operator, from the deck | the four escalations — `direction`, `architecture`, `irreversible`, `policy-loosen` — plus XL, contracts with consumers outside the tree, and anything Lane B returned `unmeasurable` after a real attempt. |

`not-better` is not a lane. It is a rejection, with both figures, and it leaves the
backlog. The three lanes are checked **in the order C, then A, then B**: escalations
first because a score may never overturn one; A second because what is already
measured needs no wave; B takes what is left.

The history of this section is four routing rules on one operator's deck.
Reward/risk asked "how dangerous is the edit?"; net delta asked "does it sound
better?" and passed 85 of 149 on stories; measured evaluation (v2.5) could say NO
but sent every `unmeasurable` and every contract to a human; v3.0 built what a
probe had measured and handed the rest over. Measured on gravitone 2026-09-06:
twelve backlog cards, **all five S-sized ones `Method: simulation`** — walked
cases with the instrument named and unbuilt. None was risky. Each was backlogged
because the round could not take the figure, and v3.0 had no lane whose job was
to go and take it. That lane is B (v4.0), and it is the same move `intake` made
in its Phase 7.5/7.7: the run builds both arms and reads the verdict off the
project's own gate, and the human sees only what no instrument can decide.

### Size

Classify every candidate for the build bound:

- **XS** - one line, one mechanism, no new file: a guard, a clamp, an attribute.
- **S** - localized: one file, one mechanism, plus its test.
- **M** - a few files or one subsystem seam; a normal PR.
- **L** - structural within one context: a new module, a migrated seam, an
  instrument that did not exist.
- **XL** - architecture-grade work spanning contexts or modules: new layers,
  protocol redesigns, cross-cutting migrations, an edit to the context map itself.

Size bounds the build and picks the lane's ceiling; it does not decide who
approves. XS and S may go to A; M may go to A or B; L goes to B; XL goes to C.

### Lane C - the escalations (checked first)

An escalation applies when the implementation REQUIRES it, not when the finding
mentions it. Design and feature are not escalations: a feature inside scope with a
passing test is coverage.

- **direction** - a capability the context's declared scope does not name: the
  manifest's `scope` block when the repo carries one, else the context map entry's
  description and keywords. A one-line change that creates a capability the scope
  does not name is a direction; a two-hundred-line build inside the declared
  purpose is coverage.
- **architecture** - every **XL**, and any change that alters what the product IS:
  a new layer, a protocol redesign, a cross-cutting migration, the context map.
  **Not** "a file outside my paths" — that is `out-of-scope`, and it is Lane B.
- **irreversible** - deletes user data, rewrites stored history, a migration with no
  rollback, or changes what is paid for.
- **policy-loosen** - removes or weakens a security, privacy or audit check, widens
  access, or stores or sends MORE than before. Its mirror, **`policy-tighten`**, is
  Lane A when a test pins the new behaviour: a reviewer would only ever say yes and
  the test is the review.
- **contract with consumers outside this tree** - another repository's, a public
  SDK's, a wire format with readers elsewhere. Letter (a) of the contract rule
  cannot be done, so nobody in the run can verify it.
- **an operator-only act** - an ingest, a scan, a `pip freeze` on a machine this
  session is not on. Named so the card says whose hands it needs, not "human" in
  the abstract.
- **`unmeasurable` after a Lane B attempt** - a worker built what it could and
  still has no figure. The card carries the instrument it could not build and why.

The gate column is an ESCALATION list, not a danger list. Important things that are
verifiable are exactly what a sweep is for.

### Lane A - build now (checked second)

An item is Lane A when **all** of:

- `Result: better` and `Method: gate` or `probe` — a figure was actually taken, on
  the real tree or a real sample, on both sides;
- `Gate: none`, or `policy-tighten` with a test, or `contract` with its verifier
  green and letters (a)–(d) met;
- size XS or S; or M with **risk ≤ 3**;
- every file it touches is inside this round's declared paths (or the round is a
  coordinator wave, where that veto does not bind);
- a gate exists that can see it, or one can be built at S — and if one is built,
  it is built **first**, seeded red, then the fix lands green (§4.11, §7.6).

Lane A is executed in-session, one atomic commit per item, highest-reward first,
under §7. A Lane A item the round cannot build (budget, time, a tree that will not
take a commit) is emitted `disposition: carry` and is Lane A **first** next round —
unless it is carried for the same missing instrument twice, in which case it is B.

### Lane B - A/B, then build or throw (takes what remains)

An item is Lane B when it is neither C nor A and its Result is `better` or
`unmeasurable`. In practice that is one of:

| Trigger | Why it is B and not A |
| --- | --- |
| `Method: simulation` | three walked cases predict; nothing measured. B builds the instrument, then measures. |
| `unmeasurable` with a named S/M instrument | the round said what would decide it and lacked the budget to build it |
| `better` by probe, M with risk ≥ 4, or L | real on a sample; the whole change needs its own isolated gate run before landing |
| `out-of-scope` (the old veto 1) | the seam is in a context this round did not own; a worker that owns it can build it |
| in-tree `contract` without a verifier | letters (a)–(d) are the worker's checklist |
| `carry` lacking its instrument for the second time | approved twice and unbuilt twice is a wave item, not a third carry |

Lane B is dispatched after the round's Lane A commits have landed, one Sonnet worker
per write-set group, in isolated worktrees, in parallel, capped by `--workers`. The
worker re-measures A, builds the instrument if the card names one, builds B within
the stated size, takes the same figure on B, runs every gate with its status
asserted, **seeds the control red**, and commits with a pathspec on its branch. The
director reviews each return against the diff, merges `better` `--no-ff`, deletes
`not-better` with both figures in the ledger, escalates `unmeasurable` to C, counts
`fp` and `demoted` against the mechanism, and never pushes. The whole contract —
worker steps, director rules, ledger shape, prompt template — is
`references/ab-lane.md`; this section only says who goes there.

**What Lane B is for, stated once.** Unit tests say a change did not break what was
already pinned. Lane B says the change made the figure better than it was, on the
same inputs, with an instrument that has been shown to notice the difference. That
is the harder claim, and it is the one a backlog card actually makes.

### The four vetoes - they override every route above

An item is set aside regardless of lane when it:

1. **touches a file outside this context's declared paths** (see the parallel
   rules in §7) — no longer a backlog verdict but a routing one: it goes to
   Lane B as `out-of-scope`, to a worker that owns that context. It is a veto on
   THIS session's hands only. **But a coupled doc, test, locale entry or
   generated artefact the fix REQUIRES is part of the fix**, not a second change,
   not `out-of-scope` and not an escalation: build it, stage it with the rest,
   and name the extra path and why it was coupled in the commit body. Veto 1 is
   for a change that wanders into another area, not for the file the change
   cannot land without.
2. **changes a contract whose consumers you cannot enumerate by instrument** —
   another repository's, a public SDK's, a wire format with readers outside this
   tree — Lane C. An in-tree contract with a verifier is A; without one it is B.
3. **has no gate that can verify it and none can be built at S or M** — if
   nothing can tell you the fix worked, committing it is committing a belief. A
   missing test you could write in twenty lines is not this veto; write it. Lane
   B attempts the rest; if the worker cannot build an instrument either, it
   returns `unmeasurable` and the card goes to C naming the instrument.
4. **is a foreign session's in-flight file** — a coordination call, not a triage
   call: wait, and say so in the finding. Neither lane nor human; the next session
   sees the note and knows the difference.

### The mechanism measures itself

The snapshot (§10) carries `lanes=A:<n>/B:<n>/C:<n>`,
`ab=<better>/<not-better>/<unmeasurable>/<fp>/<demoted>` and `fp=<n>`. A false
positive is a Lane A item that failed its gate at build, **or a Lane B item whose
`Before` did not reproduce on the base tree**. **Three `fp` across the last five
rounds and Lane A requires `Method: gate` — a probe no longer suffices — and Lane B
requires the instrument commit to land before the fix, until three consecutive
rounds at `fp=0`.** Two `not-better` verdicts on one finding from two different
workers is a measurement: the finding is rejected with both, never dispatched a
third time.

**The repo's own mechanical gate binds on the SITE, not on the idea.** A ratchet — a
LOC ceiling, a bundle budget, a dependency ban, a coverage floor — can make a
`better` item unbuildable because the only file its fix belongs in is already at
the line. That is not a reason to shrink the fix until it slips through, and not a
reason to invent a new file to escape the rule. Check each candidate's site against
the declared gates before choosing a lane, and route the blocked ones to C naming
THAT gate as the blocker.

**A ratchet blocks the change that would BREACH it, and nothing else.** Measure
the headroom before deferring: if the fix fits under the ceiling, **build it**
and put the measured headroom in the commit body ("file at 284/300 after"). Only
a candidate whose own implementation site is at the line goes to C, and the
card says which gate and by how much it overshoots. Deferring on the mere
existence of a ratchet is how a proven fix goes unbuilt - ~16 judge verdicts
split on exactly this, in both directions.

**Unattended runs** (dispatched by an app or a fleet, no operator present): Lane A
builds, Lane B dispatches if `--ab` was given, Lane C waits for the deck. Nothing
asks.

**Without `--ab`, Lane B is a queue that only grows - say its size every round.**
The default loop does not dispatch the wave, so every round adds its B cards to
a pile no step of the run drains. Measured 2026-10-04 (one `--stabilize` loop,
23 contexts, 20 rounds): 208 built, 112 Lane B left open - more than half as
many as were built, and nothing in the per-round reports added them up. So:

- Every round's close-out (§8) carries the running total: `Lane B open: <n>
  (this round +<k>) - drain with /scan-sweep --ab-only`.
- When the run's open Lane B count passes **half its Lane A built count**, or
  **25** items, say so in the next round's header, once, as a choice for the
  operator: drain now (`--ab-only`), or keep sweeping. When attended, ask.
  When unattended, keep going and repeat the line.
- The loop's closing report leads with the pile, not the built count, and the
  register row's `note` (§9) names the drain command. A B card with no
  `instrument` field cannot be drained - the round that wrote it owes it one.

**What the backlog is FOR — and what never goes in it.** The Personas idea backlog
(Approvals → Backlog, the `dev_ideas` table, reached by §9.1's hand-off or the memory
outbox) is where a HUMAN decides. During a run it
holds Lane C and nothing else (at session end §9.1 adds the undrained Lane B,
tagged as drainable): the escalations, the operator-only acts, and what
Lane B could not measure. A Lane A item is built. A Lane B item is built or thrown.
A backlog full of approved-but-unbuilt items is a sweep that stopped one step early
— measured 2026-08-28, 149 of 240 wave findings were auto-approvable, and measured
again 2026-09-06, every S card on the deck was one an instrument would have decided.

## 6. The registry lane - knowledge feeds the lenses, deviations are one lens, leads flow back

Skip this section entirely when the repo declares no registry. When
`.ai/manifest.yaml` carries `registry.local` (or `registry.remote`) and
`knowledge.domains`, the repo consumes a shared knowledge corpus, and a sweep is
one of the few moments that can pay into it as well as read from it.

**Read side - before you judge (§4.3).** Resolve the subject governing this
context and read its golden path plus the techniques whose `use_when` matches.
This read is what the LENSES consume (§3): each lens takes the techniques that
touch its concern into its own judging. The read is not itself a lens, and a
list of "we deviate from technique X" is not a sweep - it is the output of ONE
lens, `registry-conformance`, budgeted like every other one.

- If `.ai/registry-map.json` exists it already holds the context→subject join;
  take the subject's `file` **verbatim** from the index. Never construct a path
  from a slug - bundles are nested and depth is dynamic, so a built path points
  at a folder nobody walks.
- **The map's `paths` are a twelve-path sample, not the context.** Take the
  round's file list from the context map (`contextMap`) and use the registry
  map only for its subjects. A file missing from the map row is not
  "ungoverned", and a lead claiming the map drops files is wrong
  (`check-context-coverage.mjs` measures real reach).
- Without a map, resolve through `<registry>/knowledge/<domain>/index.json`.
- Without either, say so in the header (`registry: declared, unmapped`) and judge
  on the repo's own conventions. Degrade honestly; never invent a standard.

A finding that names the technique it violates is worth more than one that names
a smell, and it arrives with the fix already described.

**Log the consult** - append one line to `.ai/consults.jsonl`:

```json
{"ts":"<ISO>","bundle":"<domain>","subjects":["<slug>"],"techniques":["<slug>"],"deviations":<n>}
```

`deviations` counts findings in this round that a technique explicitly names as a
failure. Slugs and counts only, never paths. This is the demand signal the
registry reads to learn which knowledge is actually reached for.

**Write side — after a fix LANDS.** Most rounds produce nothing here, and that is
the expected result. A lead is owed only when a landed fix (or an L finding you
are backlogging) clears **all four** bars:

1. **General** — an unrelated team on a different stack would face the same
   problem. If it depends on this repo's file layout, it is a project lesson, not
   a lead.
2. **Rule-shaped** — it states as *"when X, do Y, because Z"*. A description with
   no trigger has not finished becoming knowledge.
3. **Novel against the corpus** — you read the governing subject this round and
   the rule is not already in it. A lead that restates a technique is noise.
4. **Earned** — it came from code you changed and verified, not from a fix you
   proposed. A sweep learns by landing things.

Append it to `.ai/registry-leads.jsonl`:

```json
{"ts":"<ISO>","bundle":"<domain>","nearest":"<subject-slug or null>","kind":"technique|application|subject","claim":"<when X, do Y, because Z - one sentence>","because":"<what this run measured or broke and fixed>","confidence":"low|medium|high","from":"scan-sweep@<version>"}
```

**This is a LEAD, not a knowledge write.** A sweep ORIGINATES a finding; it never
AUTHORIZES one. Nothing here edits a bundle — the registry's own intake triages
leads, corroborates them, and lands only what survives. Say in the report that
you filed one, and say plainly when you filed none.

## 7. Execution — land the approved list

This section is **Lane A**. Lane B's execution is a wave of workers under
`references/ab-lane.md`, dispatched after this section's commits have landed; the
director's merge rules live there too. Work the approved queue - this context's `carry` items from prior rounds
first, then this round's, highest-reward first - one finding at a time:

1. **One atomic commit per finding.** Fix, verify, commit, then start the next.
   Never stack two findings' edits in one working state. **Re-measure the
   Evaluation's After on the real change before committing**, and put the
   re-measured figure in the commit body: a probe on three sites is what
   routed the item, the gate on the whole change is what lands it. An After
   that comes back `not-better` on the real change is a demotion (§7.4) and
   a false positive for the snapshot's `fp` count.
2. **Verify before committing** with the repo's own gates for the surface you
   touched (`.claude/conventions.json` or the manifest's capabilities name them;
   else the obvious ones). A fix that fails its gate is repaired inline or fully
   reverted — never committed red, never left half-applied. **A gate you could
   not run is a gate that did not pass**: say so in the report and mark the round
   degraded.

   **ASSERT the gate's own exit code. Reading it is not asserting it, and
   piping it away destroys it.** Three ways this rule has actually been defeated,
   all in one session, each by the shell rather than by the code:

   - `npm run typecheck | tail -3 && git commit` takes **`tail`'s** status,
     always 0. The chain commits over a red gate and the failure scrolls past in
     the output you were trimming.
   - `npm run typecheck; echo "TC=$?"; git commit` **prints** the failure and
     commits anyway. A number in the transcript is not a gate; `;` is not `&&`.
   - The gate is red for a reason that is **not yours** — see below.
   - The gate is a **composite script whose early stage failed**, so the later
     stages never ran. `check = typecheck && lint && build` with a foreign lint
     error means the build was never executed, and "the red is not mine" is only
     half the analysis: you still owe the skipped stage. Run it on its own and
     say which stages actually passed, or the round is degraded.

   The shape that holds: run each gate in its own invocation, `&&`-chained so a
   non-zero status stops everything, and let the commit be the last link.

   **This binds the COORDINATOR as hard as the builders, and the coordinator is
   where it was actually defeated.** Measured on lighttrack 2026-10-05: the first
   command of a whole challenge run was `cargo build --workspace 2>&1 | tail -15;
   echo "BUILD_EXIT=$?"`, and it printed `BUILD_EXIT=0` over a build that had failed
   on a locked output file. The baseline that twelve cards were about to be judged
   against read green only because the pipe ate the status. A coordinator runs more
   gates than any single builder - the baseline, one integration gate per wave, the
   final one - so this rule belongs in its own checklist and not only in the builder
   brief it hands out.

   **Under a concurrent session, a whole-tree gate says nothing about your
   change.** `tsc --noEmit` covers every file in the repository, so a sibling
   agent mid-write turns your verification red and a *passing* run can equally
   depend on their unfinished work. Before treating a red whole-tree gate as
   yours, get the failing paths and compare them against the files you touched;
   if none of them are yours, say so, verify what you can scope to your own
   files, and wait for the tree to settle rather than committing into it. §7's
   parallel rules cover STAGING and stopped there — verification has the same
   hazard and it is easier to miss, because the output looks like a verdict on
   you.
3. Commit message `fix(<context>): <finding title>`, with a body line naming the
   lens — the finding's provenance survives in history.
4. **A fix that grows beyond its size class mid-flight is demoted, not forced.**
   If an S starts touching a third file or a shared surface, stop, revert the
   attempt, and emit it as a finding at its honest larger size. This is the
   safety valve behind auto-approving S: the class is enforced at execution time,
   not just at classification time.
5. **Contract and source-guard tests pin the OLD expression**, so a real fix
   fails them. That is correct by design. Budget for it, and *strengthen* the
   assertion in the same commit (pin the new expression AND forbid the old), or
   the fix silently loses its guard.
6. **Never author a pattern through a shell heredoc, and seed a violation to
   prove the gate still bites.** A heredoc reads `\b`, `\s`, `\n` as its own
   escapes, so a regex written that way can reach the file as control characters
   — measured: `\b` arrived as a literal `0x08`, the matcher found nothing, and
   every subject read as compliant. Use the file-writing tool for anything
   containing a backslash, and after ANY scripted edit to a checker, seed the
   thing it looks for and watch it go red. A gate that cannot match reports a
   clean codebase in a voice indistinguishable from success.

7. **Never point a build, test or package cache inside the repository.**
   `CARGO_HOME`, `UV_CACHE_DIR`, `npm_config_cache`, `PYTEST_DEBUG_TEMPROOT`, a
   scratch worktree, a downloaded toolchain: all of them go to the OS temp dir,
   never under the tree you are sweeping and never under a vault or overlay
   directory. Measured 2026-09-16: ~10 judge verdicts found 12k-file caches left
   behind, after which `git status` can no longer tell work from litter. Before
   the round's last commit, confirm `git status --porcelain` shows only files
   you meant to touch.

8. **A source-scanning gate must strip comments before it matches.** The files a
   sweep writes explain the rule in prose, directly above the code that
   implements it — so a matcher run over raw text is satisfied by a file that
   TALKS about the rule and does not follow it. Measured twice in one session: a
   probe passed against a deliberately broken subject because the word it looked
   for survived in the comment describing the fix. Strip `//` and `/* */` first,
   then match, and let the fail-before be what tells you — it is the only step
   that catches this, and it caught it both times.

9. **Run each overlay gate once before the first round, and check what it
   loaded.** A gate copied from an overlay can run without the config its
   directory depends on. Measured 2026-10-04: `uv run --project <pkg> pytest`,
   run from the repo root, picked up no pytest config. Its `live` marker was
   not deselected, so the gate made a real network ingest against a data
   source in the first round. Read the gate's header (rootdir/configfile, the
   tsconfig, the selected tests) before you trust it. A gate that can reach the
   network or spend money must refuse that from inside the test tree (a
   conftest or setup hook), not only through an ini file that a different
   working directory skips.

**Parallel-session rules** — several sweeps may share this repo, one context each:

- Edit ONLY inside your context's paths, plus their tests and any generated
  artifacts the repo REQUIRES you to regenerate for those edits. A needed change
  outside that boundary is veto 1, not a decision.
- Stage with explicit pathspecs only. Never `git add -A` / `.` / `-u`, never
  `git stash`, never reset another session's work. Before each commit confirm the
  staged list is exactly your files.
- Shared or generated surfaces other sessions also write (locale bundles,
  generated types, checksum manifests): make the edit and its regen, commit
  IMMEDIATELY, and keep that commit minimal. Shared files must never sit
  uncommitted while you work on the next finding.

**Director-run fan-out**: one session runs the loop and hands rounds to
round-agents, all working in one checkout. The rules above cover each agent. The
director has its own job, and every rule below was paid for once (measured
2026-10-04: 20 rounds over 23 contexts, in 5 waves of 4 agents, 256 commits,
no cross-agent contamination):

- **The director owns every shared file**: the snapshot ledger (§10), the
  open-backlog register and outbox (§9), the consult and lead files (§6), and
  any ratchet baseline. Round-agents never write them. They return their
  snapshot row, consult line and lead lines in the final reply, and the
  director appends them. Each agent writes its own findings file, one per
  context or merged round (`<findingsDir>/<slug>.jsonl`), so no two agents share a
  findings file.
- **A wave is ≤ 4 contexts that share no write paths.** Hold a context whose
  paths another session has reserved, and run it in a later wave once that
  session releases them. Pair the small contexts (§1) inside the wave. Each
  pair is one round with one agent.
- **One brief, written once, pins the gates verbatim** from the overlay. It
  states the asserted-exit-code rule (§7.2), the "a red whole-tree gate is
  probably not yours" rule, the pathspec commit including the form for an
  untracked file (`git add <file>` then `git commit -m … -- <paths>`), the
  never-touch list, and the reply shape. Correct the brief when a round finds
  a gate wrong. A rule told to one agent only applies to that agent.
- **Integrate after every wave, before the next starts.** Run the full
  offline gate on the combined tree. Then commit the wave's ledger rows in one
  `chore(scan-sweep): wave <n> ledger` commit, and lower any ratchet baseline
  only after that combined run. A ratchet that drifted up during the wave
  goes back to the agents whose files caused it, with the files named. The
  director never formats the whole tree.
- **A stalled agent is resumed, not replaced.** Its committed work and its
  transcript survive. Send it a message that says what it already committed
  and what is left. A second agent spawned on the same context will rebuild
  committed fixes and fight the first for the same files.
- **Slow gates stay with the director.** Agents must not run the end-to-end
  suite, dev servers, or anything that hits the network. The director runs
  these once, when the loop closes.

## 8. Report each round

Header first:

- `Method: full (context: <name>, strategy: <s>, lenses: <n> evaluated)` — or
  `DEGRADED: <what was skipped and why>` if you sampled, skipped a lens, or could
  not run a gate. **A degraded sweep reported as complete is worse than no
  sweep.**
- `registry: <domain>/<subject>` — or `none` / `declared, unmapped`.

Then what SHIPPED, one line each (`fixed  <title> - <sha> - <re-measured
After>`), then what was REJECTED (`rejected  <title> - <Before> vs <After>`),
then the carried and backlogged findings — each in the standard form of §4.10
(Summary / Description / Flow / Expected impact / Evaluation, evidence
separate), plus **Scores** (size + effort / impact / risk) and, for every
backlogged card, **the escalation or the failed rung** that put it there.

Close each round with: X built (of which carries), Y rejected, Z backlogged
(escalated / unmeasurable / vetoed / carry), lenses evaluated **and how many had
no surface** (§4.9 - the two numbers are reported separately), `auto=` and
`fp=`, leads filed, the trend for this context (`12 -> 7 -> 5 findings`), the
running **Lane B open** total when `--ab` was not given (§5), and **the next
context the loop will take**.

## 9. Emit to the memory outbox

Append to the outbox (overlay key `memoryOutbox`, default
`.personas/memory-outbox.jsonl`), ONE JSON object per line.

**A BUILT finding is a progress node, not a finding** — it must never land in the
backlog as open work:

```json
{"type":"node","kind":"progress","skill":"scan-<lens-key>","context":"<context>","title":"Fixed: <title>","body":"<sha>; <one-line gist>"}
```

A Lane B item that MERGED is the same progress node with the wave's figures:

```json
{"type":"node","kind":"progress","skill":"scan-<lens-key>","context":"<context>","title":"Fixed (A/B): <title>","body":"<merge sha>; before <..> -> after <..>; seeded red; worker sonnet"}
```

A Lane B `not-better` is never emitted - it was rejected with figures in the report
and the ab ledger. A Lane B `unmeasurable` is emitted as a BACKLOGGED finding whose
After line names the instrument the worker could not build.

Each BACKLOGGED finding (Lane C only):

```json
{"type":"finding","skill":"scan-sweep","lens":"<lens-key>","context":"<context>","title":"<title>","body":"## Summary\n...\n\n## Description\n...\n\n## Flow\n- ...\n\n## Expected impact\n...\n\n## Evaluation\nClaim: performance - ...\nBefore: ...\nAfter: ...\nMethod: probe - ...\nResult: better\nGate: none","evidence":"<code block or file:line list - the proof, not the prose>","size":"S|M|L","effort":3,"impact":7,"risk":2,"result":"better|not-better|unmeasurable","method":"gate|probe|experiment|simulation","gate":"none|contract|policy-tighten|policy-loosen|irreversible|architecture|direction","disposition":"backlog|carry"}
```

`body` is the §4.10 form verbatim — the five `## ` sections, newline-escaped in
the JSON; `result`, `method` and `gate` repeat the Evaluation's verdict as
fields so a consumer can route without parsing prose. A `backlog` finding is,
by construction, one whose result or gate said "human" — say which, on the
card. A `carry` finding is approved and owed to the next round on this
context, and a consumer must not present it for a decision. A `not-better`
finding is never emitted: it was rejected in the report. A finding emitted in
any other shape is rejected at review, not reformatted.

Escalation — at most one per lens, ONLY when that lens produced a critical
finding (impact >= 8) or 3 real findings in this context:

```json
{"type":"escalation","skill":"scan-sweep","lens":"<lens-key>","context":"<context>","reason":"<<=120 chars: what a deep pass should chase>"}
```

Coverage — one node per lens **actually pointed at a named artefact** (§4.9); a
clean lens counts only when its `body` says what it checked. Lenses with no
surface are not emitted as coverage. Plus one for the round:

```json
{"type":"node","kind":"progress","skill":"scan-<lens-key>","context":"<context>","title":"Sweep pass: <lens-key> over <context>","body":"<n> findings; <what was checked - the files, the grep, the hypothesis>"}
{"type":"node","kind":"progress","skill":"scan-sweep","context":"<context>","title":"Sweep of <context>","body":"<n> lenses; <built> built, <open> backlogged, <e> escalations, <l> leads"}
```

Keep the outbox lean — ingest caps at 200 lines / 512 KB and 30 finding lines per
pass. At 12 findings per context that is between two and three rounds, so the
loop WILL meet this cap: check whether the file was drained between rounds (the
app deletes it on ingest), keep going if it was, and if it was not, emit the
round's findings highest-reward first, stop at the cap, and say in the report
which findings did not fit and that they are unrecorded. A finding silently
dropped for want of a line is worse than one never found, because the ledger
will claim the context was swept.

**Findings that do not reach the outbox get a register row.** Whenever a pass
leaves findings anywhere but the outbox - the cap above, an `--ideas-only` or
mass wave that wrote a findings file, a build wave that stopped early - append
or update one line in the open-backlog register (overlay key `openBacklogs`):

```json
{"id":"<strategy>-<date>","at":"<ISO-8601>","strategy":"stabilize|develop|optimize","path":"<repo-relative path to the findings file>","total":<n>,"emitted":<n>,"built":<n>,"declined":<n>,"descoped":<n>,"open":<n>,"status":"open|closed","note":"<<=160 chars: what is left and who it waits on>"}
```

`open` reaching zero, or the operator declining the rest, sets `status:
"closed"` with the reason in `note`; rows are never deleted. §0 reads this file
first on every invocation - it is how a backlog survives the weeks between
sweeps.

### 9.1 Hand-off to Approvals - the session's last act

**A run does not end with findings in repo files.** The register above kept
backlogs from being lost; it did not get them decided. Measured 2026-10-11 across
twelve fleet repos: ~940 open items sat in registers, findings files, challenge
follow-up lists, moonshot READMEs and six undrained outboxes (130 findings the
30-line ingest never reached), the oldest 36 days old, and none of them was in
front of the operator. Personas Approvals
(Overview → Approvals → Backlog, the `dev_ideas` table) is the one place the
operator decides, so every item a session leaves open goes there before the
session reports done.

**What is handed off.** Everything still open when the run stops: Lane C cards,
Lane B items the run did not drain (tagged A/B-drainable, so the operator can
bounce them to `--ab-only` instead of judging them), carries the run did not
reach (as Lane B), and Lane B `unmeasurable`. Built items and `not-better`
rejections never are. A Lane B item stays out of Approvals while the run can
still drain it - the hand-off is for what the session leaves behind, not a
shortcut past §5.

**How.**

1. Write the cards, one §9 finding object per line plus `"lane":"B|C"` and
   `"source":"<register id>"`, to `.claude/scan-sweep/handoff-<run id>.jsonl`.
   Cards from another shape (a challenge follow-up list, a moonshot README
   table, a `lanes.jsonl` row) are converted to it first; keep `title`, put the
   rest in `body`, and leave a scale out rather than invent it - the script
   defaults it and says so on the card.
2. `node ${CLAUDE_SKILL_DIR}/scripts/approvals.mjs --file <that file> --repo
   <repo root> --out <file>.results.jsonl` (`--dry-run` first when the operator
   is present and the batch is over 50; `--register` when the repo is not yet a
   Personas project and the operator agreed to register it). It files each card
   over the app's local HTTP door (`POST /dev-tools/ideas`, `origin: scan_sweep`,
   lens-keyed so a card the outbox already filed is a dedup hit), with no 30-item
   cap, and returns per card `created | deduped | rated | near_duplicate`.
   A dedup hit on a `rejected` row is a human "no" that already exists - it is
   reported, never re-filed with `force`.
3. **Exit 0** (every card landed): delete the hand-off file and every source
   file whose cards all landed (a source that is also a ledger - a findings
   file holding built rows, `lanes.jsonl` - is kept, and its handed rows get
   `"status": "handed_off"` so the build history survives and §0 stops counting
   them), set the register row `closed` with `note:
   "handed to Personas Approvals <date>: <n> created, <m> deduped"`, and commit
   the deletions where the files were tracked. **Exit 3 or 4** (Personas not
   running, repo not registered): delete nothing; leave the row `open` with
   `note: "hand-off owed: <reason>"` and say so in the closing report - §0
   retries it next run. **Exit 1**: delete only the sources whose cards all
   landed; the rest stay with their row open and the failures named.
4. The closing report leads with the hand-off line: `Approvals: <n> filed
   (<c> created, <d> deduped, <r> already rejected) - <k> owed`.

The outbox (§9 above) keeps the progress, coverage and escalation lines; when
Personas is running, findings go through the hand-off instead of competing for
the outbox's 30 lines. When it is not, the outbox is still the fallback for up
to 30 findings, and the rest wait for the hand-off.

`--handoff` runs this step alone over every open backlog §0 found, oldest first,
and scans nothing.

## 10. Persist a snapshot

Append one line per round to `.claude/scan-history/scan-sweep.jsonl` (create the
directory if needed). `lens_keys` = every lens that was **pointed at a named
artefact** (§4.9) — this is the per-context coverage ledger the picker and the
lens ordering both read, so a key written for a lens that looked at nothing
inflates it permanently. `lens_no_surface` holds the rest and earns no credit.
`findings` counts built, rejected, carried and backlogged. `auto` is the
routing tally (`accepted/rejected/escalated`), `fp` the auto-accepted items
demoted at build, `carried` the approved items left for the next round, `lanes` the routing
tally and `ab` the wave's verdicts - the numbers §5's self-correction reads.

```json
{"at":"<ISO-8601>","scope":"<context>","mode":"resolve|ideas","strategy":"stabilize|develop|optimize","lens_keys":["<key>"],"lens_no_surface":["<key>"],"lenses":<n>,"findings":<n>,"fixed":<n>,"auto":"<a>/<r>/<e>","lanes":"A:<n>/B:<n>/C:<n>","ab":"<better>/<not-better>/<unmeasurable>/<fp>/<demoted>","fp":<n>,"carried":<n>,"escalations":<n>,"leads":<n>,"degraded":<bool>,"note":"<<=80 chars>"}
```

**The row is committed, not left dirty.** Where `.claude/scan-history/` is
tracked, the snapshot rides in the round's **last fix commit**; if the round
built nothing, it goes in a closing `chore(<context>): scan-sweep round <n>
ledger` commit of its own. A round that ends with an uncommitted ledger row has
not recorded its coverage - the next picker reads the file from HEAD. Under a
director-run fan-out (§7), the director commits the wave's rows together right
after the wave's combined gate, so no row sits uncommitted while the next wave
runs.

## Project overlay

Everything project-specific lives in `.claude/scan-sweep/config.md` in the
consuming repo. The skill runs on the defaults without it.

| Key | Default | Meaning |
| --- | --- | --- |
| `contextMap` | `context-map.json` | The context inventory the loop walks. |
| `memoryOutbox` | `.personas/memory-outbox.jsonl` | Where findings are emitted. |
| `backlogDigest` | `.personas/backlog-digest.json` | Titles never to re-propose. |
| `openBacklogs` | `.claude/scan-history/open-backlogs.jsonl` | Register of findings files earlier passes left unworked; read first (§0), written by §9. |
| `handoff` | `on` | §9.1: file the session's open items into Personas Approvals. `off` for a repo with no Personas on the machine; the register then carries them. |
| `gates` | from `.claude/conventions.json` / manifest capabilities | Verification commands per surface. |
| `depth` | 5 (loop), 10 (`--one`) | Findings per context per round. |
| `neverSweep` | none | Contexts the loop skips (generated, vendored). |
| `challenge.cohort` | 6 | Contexts per `--challenge` run. |
| `challenge.waveSize` | 4 | Concurrent builders per wave. |
| `challenge.sharedSurfaces` | none | Files every builder may append to under the shared-surface lock (locale catalogs, generated references, ratchet ceilings). |
| `challenge.integrationGate` | the overlay's full gate list | What runs on the combined tree after each wave. |
| `challenge.worktrees` | `false` | Whether builders may take worktrees (only when the repo's gates run in one). |

## Coverage table

`--coverage` scans nothing. Run `node ${CLAUDE_SKILL_DIR}/scripts/coverage.mjs`
(`--all` for every context, `--next` for just the next pick, `--json` for a
machine read) and present the per-context table — lens coverage, findings vs
fixed, last strategy and age, least-covered first. Then stop.

---

<!-- clause: skill-reflection v5 - stamped by scripts/apply-skill-clauses.mjs from docs/skill-clauses/skill-reflection.md; edit the template, then re-stamp -->
## Skill Reflection

After the work, record only useful observations supported by this run. No lesson is
a valid result. Reflection inherits the task's authorization; it grants no additional
permission to edit another repository, send data, commit, or publish.

**Run log.** Unlike a lesson, this is written on every run that started work - failed and
aborted runs included; skip read-only info modes and runs cancelled before any work. Append
ONE line to `.ai/skill-runs.local.jsonl` at the root of the checkout you worked in: local,
gitignored run output inside the task's own repository, never a write into the registry.
The registry pulls it later (`/librarian skills` on the same machine). When a registry
checkout is reachable (`registry.local` in `.ai/manifest.yaml`), prefer its writer, which
stamps project, device and version for you:

```sh
node <registry>/scripts/log-run.mjs --skill scan-sweep --outcome <o> --difficulty <1-5> \
  --provider <claude|openai|xai|qwen|google|other> --model <your model id> [--effort <level>] \
  [--tokens-est <n>] --result "<one sentence>" --comment "<self-reflection>"
```

Otherwise write the line yourself: `{"ts":"<ISO, UTC Z>","skill":"scan-sweep","outcome":…,
"difficulty":…,"provider":…,"model":…,"effort":…|null,"tokensEst":…|null,"result":…,"comment":…}`.

- `outcome`: `shipped` (the goal landed) / `partial` / `no-op` (ran correctly, nothing to
  do) / `parked` (designed or staged, deliberately not landed) / `failed` / `aborted`.
- `difficulty` rates the task as this run met it: 1 trivial - mechanical; 2 routine - the
  method as written; 3 demanding - real judgment calls or one detour; 4 hard - dead ends,
  rework or an operator course-correction; 5 at the edge - partial or failed on the merits.
- `model`/`effort` as your harness states them (`null` effort when you cannot see it).
  `tokensEst` is the drop in the harness's remaining-token counter since this skill was
  invoked, or `null`; exact figures are measured later from transcripts - never guess one.
- `result` is one line (max 240 chars). `comment` (max 2000) is the self-reflection a
  reviewer reads: what worked, what the method made harder, where its instructions were
  wrong, missing or ignored. No filesystem paths or email addresses.
- Never read run logs during a run. They are evidence ABOUT this skill for its reviewer;
  an executor that reads its own diagnosis contaminates the next measurement.

**Project learning.** Only when this run produced an observation that would change how a
future run behaves. A run that went as the method describes writes nothing: an entry that
restates the procedure, records "no issues", or repeats the task is a defect, not a
deliverable. When there is such an observation and local edits are within scope, put one
dated line in the overlay this skill's `## Project overlay` section names, under
`## Skill improvement log`. **Write only into an overlay that already exists.** If the
project has none, put the observation in the response instead - creating a new tracked
file for a reflection is scope the task did not ask for, and a reader who never asked for
the skill has to review it. If the overlay is a structured config (YAML, TOML, JSON),
record the note as comments so the file keeps parsing, or use the response.
Use a supplied memory contract only when its destination and writes are authorized.
Keep project details out of the shared method.

**Method learning.** Identify the installation before editing anything. A local
`.ai/registry-installation.local.json` receipt can identify development versus release,
the registry revision, and selected skill versions. Verify any link's actual target;
do not assume a skill directory is a writable registry link.

- For a pinned release, marketplace cache, ordinary copy, or unknown installation,
  keep a proposal in the project overlay or response. Do not edit the installed method
  or silently relink it. Adoption and rollback are explicit installation operations.
- For a development link, edit the registry only when that checkout is already within
  the accepted task scope. Otherwise report a proposal. Authorized changes belong in
  the source checkout, followed by its gates; commit only when the task authorizes it.
- Record an actual lesson in `LESSONS.md` against the version **used**:
  `## <version-used> - <YYYY-MM-DD> - <project-name>` and concise bullets. A proposal
  must be labeled as such; structural checks are not evidence of field effectiveness.
- Applied skill changes require a version bump: patch for wording, minor for a step
  refinement, major for method redesign. A lesson alone needs no bump. Shared stamped
  clauses are edited in the registry's `docs/skill-clauses/` and regenerated with
  `scripts/apply-skill-clauses.mjs`, never patched in individual installed skills.

**Domain learning.** Follow `## Knowledge sync` when present, within the same scope
and privacy boundaries. A method lesson and a domain knowledge lead are different
artifacts; do not fabricate either to fill a reflection quota.
<!-- /clause: skill-reflection -->

## Model choice (bake-off 2026-09-01, pof / harness-autonomy)

No pin. Fable built twelve fixes including a feature (durable-sidecar status GET) and junctioned the package's node_modules to run its own gate; Opus built six, all defensive, including the two most severe defects of either run (a self-heal re-verify under a tenth of the gate's buffer; a prior session's output replayed as instruction into a permission-free session), refused to manufacture a gate it could not reproduce, and marked its snapshot degraded. The operator merged both. Fable for throughput on a `--one` round; Opus when the context is a control surface for autonomous execution.
