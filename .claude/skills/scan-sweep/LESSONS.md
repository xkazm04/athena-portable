# Lessons - scan-sweep

Append-only reflection lane. One entry per run that taught something. Format:
`## <version used> - <YYYY-MM-DD> - <project>` followed by `- ` bullets. Merged from every copy of this skill on 2026-08-22 when it moved into the registry lane.

## 4.5.0 - 2026-10-11 - fleet (backlog migration to Personas Approvals, no scan)

Operator asked for every scan backlog left in fleet repos to reach Personas
Approvals; the run built section 9.1 (4.6.0) and migrated by hand first.

- **The register made backlogs visible; it never got them decided.** ~940 open items
  across twelve repos: register-pointed findings files, challenge follow-up lists,
  moonshot READMEs, and six outboxes holding 130 findings the 30-line ingest never
  reached (oldest 36 days). Section 0's notice was being read and carried, run after
  run. The fix is a destination, not a louder notice: 335 items from the last 14 days
  were filed into Approvals, ~600 older ones expired and were deleted on the operator's
  call.
- **The outbox is the wrong door for a backlog.** It takes 30 findings per ingest and
  is read only when a Fleet session exits in that exact root, so any file over 30 lines
  is a queue that drains one Fleet session at a time. `POST /dev-tools/ideas` has no
  cap and answers per item; it needed an `origin`/`lens` pair (Personas fcf65c4d85) so
  the items keep the Scan-sweep badge and share the outbox's dedup keys - 11 outbox
  findings came back as dedup hits, not duplicates.
- **Probe the running build before a bulk filing.** The first real card filed as
  `app_master`: the app predated the patch. One card, one DB read, then the batch.
- **An uncommitted patch in a shared checkout is not a patch.** The Personas change
  vanished from the working tree between test and use (another session restored the
  tree; nothing in stash or reflog). Re-applied and committed by pathspec at once - and
  `git commit --only <paths>`, because that index already held another session's
  staged files.
- **A findings file is also a build ledger.** StatReel's files held 208 built rows next
  to 131 open ones; deleting them would have erased the history. Handed rows get
  `status: handed_off` instead, rewritten line by line in each row's own JSON spacing
  (a whole-file re-serialise touched 212 lines for 131 changes).

## 4.3.0 - 2026-10-05 - lighttrack (LightTrack)

First `--challenge` run in this repo, and the first anywhere with a rider cohort.
Cohort of 6 hosts + 9 riders over 48 contexts / ~2000 tests of Rust. 12 cards, 0 void,
0 false premises, 5 revised, 12 approved, 12 landed over 6 waves, 0 demoted, 0 reverted,
0 coordinator fixes. `execution_score` 12/12, `idea_score` 4.33 / 4.58 / 4.58, cases
72/101 red before and 101/101 green after, suite 1931 -> 2075.

- **The critic earned the stage on its own.** It caught a card whose FRAMING was wrong
  while its defect was real: the scout called a scope-membership divergence a *gate*
  defect, and the reference backend's admission path was already correct - only the
  ledger and reporting sides diverged. Graded `grounding 3/5`, re-pointed with one
  concrete edit, and the builder later confirmed the warning was "accurate, arguably
  understated". It also found the run's only cross-card hazard: two cards added HTTP
  routes that a *third* card's new access layer would answer 500 to unless they
  declared contract rows. Both corrections were one edit each at card stage and would
  have been a dead wave at build stage. On a 12-card run the critic changed 5 cards and
  voided none - that ratio is the argument for keeping it.
- **A brief that does not say which artefacts are GENERATED will hand a builder a red
  gate.** Three instances in one run (a guarded parity doc the coordinator wrongly
  listed as a lockable shared surface, a published client baseline that snapshots the
  whole surface, a generated route matrix). One builder refused the coordinator's
  instruction, cited the guard test, and used the changelog instead. Now in section 7.
- **Section 7.2's "assert the exit code" clause is a COORDINATOR rule too.** The run's
  very first command piped a build into `tail` and reported `BUILD_EXIT=0` over a
  failure - the baseline for twelve cards. The clause was written for builders and the
  coordinator runs more gates than any of them. Now stated in 7.2.
- **Never write a red-gate attribution before the control has run.** A flaky
  pre-existing test is a third owner the method did not name. A 5-run control at base
  came back clean *after* the disposition had already been written off 3 merged samples;
  the honest answer needed 8 against 8 (base 1/13, merged 2/11, same assertion). The
  verdict survived; the write-up had to be retracted in front of the operator. Now in
  section 7 as a two-step procedure.
- **Riders are not a courtesy, they are where the severity was.** 3 of the 4
  high-severity backlog findings came from rider files - a Postgres-only type error
  (`pass IS TRUE` against a `BIGINT`), an FX `converted` flag the cap path never reads
  (a revenue-share cap reading ~150x too generous), and a reaper that strands cancelled
  rows. The >= 10-file host floor would have left all three unread indefinitely.
- **Builders corrected their own cards downward on claims far more than expected, and
  the defects survived every time.** One argued its impact was UNDER-rated and proved it
  with a stored `cost_usd`; one found its own acceptance case had the wrong expected
  value and that discovery was the card's real payoff (2 of 3 production refusals remove
  zero routes, so a renderer promised a 501 no route ever returned); one refused to let
  two guards pass vacuously and folded liveness preconditions into them; one reported
  two of its own cases as weak red cases because a default-returning stub satisfied
  them; one reported a case as vacuously green rather than claim it. None of these
  changed whether the defect was real. The `flawless` / `flawless_strict` split (12 vs
  10) is what keeps that honesty cheap - a builder that declares a guard green-before
  loses nothing, so declaring it is the dominant strategy.
- **Serializing code files beats locking them.** Five cards wanted one `main.rs` and
  three wanted one MCP `schemas.rs`. Locking a doc is cheap; locking a code file in a
  shared checkout is not. One card per wave per contended code file cost two extra waves
  and produced zero merge conflicts. Note clippy's `items_after_test_module` can forbid
  the append-at-the-end rule the shared-surface lock assumes, turning a union into a
  3-way merge.
- **One wave's work can improve the next wave's card.** Wave 2 made judge counters real,
  which made wave 5's aggregation meaningful rather than cosmetic; wave 3 landed an
  `until` parameter whose doc comment said it existed "because a replay of a past instant
  needs one", which was wave 6's substrate. Ordering by write-set disjointness happened
  to order by dependency too - worth checking deliberately rather than by luck.

## 1.0 - 2026-08-20 - kp (CandiDate / KP studio)

Run shape: `--lenses bounty-hunter`, all-contexts coverage, resolve mode. 285
contexts, 235k LOC TS/TSX + 54k LOC Python, a codebase already swept by several
long-running quality loops (a 19-round perfection loop, UAT, an LLM-call-site
audit).

- **On a heavily-swept codebase, pattern greps yield ~zero and burn a lot of
  budget.** Divide-by-length, `parseInt` radix, `.sort()` on numbers, loose
  equality, unescaped `new RegExp`, unclamped query params, `catch` returning
  success, bare `except` — every single one came back clean or already guarded,
  usually with a comment naming the bug it closed. Roughly half the run's budget
  went into probes that could not have hit. The signal to switch is the *second*
  clean battery, not the fifth.

- **What DID hit, all of it the same shape: two implementations of one rule
  that must agree, where only one got fixed.** Four of the five real findings
  were divergence, not absence:
  - a gate and its debit reading different amounts (one sibling route fixed, the
    other not — the fixed one's comment even described the bug);
  - a declared single-source constant module with one call site still
    hardcoding the literals;
  - an abstraction built to kill name-comparisons, with ~20 name-comparisons
    never migrated onto it (and one that *writes* an off-axis value);
  - a word-boundary alias whose boundary was unsatisfiable at the end of the
    string it was tested against.

  Generalizable technique: **hunt for pairs.** Client vs server validation, gate
  vs debit, TS vs Python constants, an abstraction vs its un-migrated call sites,
  a doc's stated rule vs the code. Grep for the *shared* symbol and diff the call
  sites, rather than grepping for a defect shape.

- **Hand-maintained coverage lists are the highest-impact finding class, and no
  gate watches them.** The critical finding (candidate PII with no GDPR erasure
  path) was a scrub function enumerating PII tables by hand, which had drifted
  behind a whole module added later — and its regression test asserted only over
  the tables the implementation *already* covered, so the test could never catch
  the omission. Same shape as auth allow-lists, tenancy manifests, rate-limit
  contracts. **Ask of every such list: what enumerates the ground truth, and is
  the test derived from that or from the list?** A test that reads the
  implementation's own list is coverage theater.

- **Contract/source-guard tests pin the OLD expression, so a real fix fails
  them.** Two of three fixes required editing an assertion that had frozen the
  buggy line. That is correct by design (the repo says changing one is
  deliberate) — but the sweep must budget for it and must *strengthen* the
  assertion in the same edit (pin the new expression AND forbid the old), or the
  fix silently loses its guard.

- **Parallel-session boundaries bind harder than the skill's file-path rule
  suggests.** Two genuine S-sized fixes were left unbuilt not because of risk but
  because their files (`messages/cs.json`, `pipeline-stages.ts`) were mid-edit by
  a concurrent session — committing them would have carried a stranger's in-flight
  work. Worth stating in the finding itself so the next session knows it was a
  coordination call, not a triage call.

### Redesign proposal (not applied)

The all-contexts + single-lens invocation has no home in the method: SKILL.md
assumes one session owns one context and runs many lenses over it. The inverse —
one lens over every context — is a genuinely different and useful shape (it finds
cross-context divergence a per-context sweep structurally cannot see, because
both halves of a divergent pair rarely live in the same context). It needs its
own scoping rule (pattern sweep repo-wide, then rank contexts by risk and deep-read
top N, declare the split honestly as DEGRADED), its own budget (findings are
repo-wide, not per-context), and its own snapshot scope value. Proposing rather
than applying: it changes the coverage ledger's shape, which the no-arg picker
and `coverage.mjs` both read.

## 1.0 - 2026-08-27 - personas (method review, no run)

Design review of the method itself against three gaps the operator named. Recorded
here because each was a *structural* absence, not a run-specific miss - and two of
them were invisible from inside a single run, which is why several good runs never
surfaced them.

- **The method described a session; the operator wanted a LOOP.** v1.0 owned one
  context end to end and stopped. Every coverage instrument it shipped
  (`lens_keys`, the no-arg picker, `coverage.mjs`) existed to make the NEXT session
  pick well - which quietly assumed a human would keep starting sessions. The
  budget was the tell: 30 findings per context against 22 lenses is a depth-first
  number, and it is the wrong one when 12 sibling contexts have never been read at
  all. v2.0 makes the loop the default and cuts the per-round budget to 5, on the
  rule that *the fifth-best finding in an unswept context beats the eleventh-best in
  this one*.

- **`--optimize` and `--develop` bracketed a default that had no name.** "Balanced"
  is not a direction, and a strategy with no name cannot be argued with or recorded
  honestly in a snapshot. Naming the default `stabilize` - defects, unpolished UI
  states, measured performance - is what lets the report say which of three things
  the run was actually doing.

- **The triage gate was keyed on RISK alone, so it could not see a cheap win or an
  expensive one.** v1.0 auto-executed at `risk <= 3` and asked above it. That routes
  a risk-5/impact-9 fix and a risk-5/impact-2 fix identically, which is the decision
  the operator was being asked to make by hand every time. v2.0 keys on the ratio:
  S auto-approves, L always backlogs, and M clears at `impact/risk >= 2.0` with
  `risk <= 4`. Pure churn is excluded by construction rather than by rule - it
  cannot score an impact that clears the bar.

- **Auto-approving a size class is only safe if the class is enforced at EXECUTION
  time.** The demotion rule (an S that touches a third file is reverted and re-emitted
  larger) existed in v1.0 as good hygiene; under auto-approval it is the load-bearing
  guard, because classification happens before the code is opened. Stated as such,
  and joined by four vetoes that outrank every route: outside the context boundary,
  a schema/protocol/public-API change, no gate that can verify it, or a foreign
  session's in-flight file.

- **The skill consumed a knowledge registry and paid nothing back into it.** A sweep
  is one of the few moments that can: it lands a fix and then knows something it did
  not before. v1.0 had no read side (findings were graded against the repo's own
  conventions, so a finding could only ever be an opinion about local taste) and no
  write side. v2.0 adds both, and the write side is deliberately the weaker verb: a
  LEAD to `.ai/registry-leads.jsonl`, gated on four bars - general, rule-shaped,
  novel against the subject actually read this round, and earned by a fix that
  LANDED. A sweep originates a finding; it never authorizes one.

  The bar that does the most work is the fourth. Proposing is free and landing is
  not, so restricting leads to fixes that shipped is what keeps the inbox from
  filling with things the sweep merely believed.

### Redesign proposal (not applied)

`leads-collect.mjs` folds project ledgers into `librarian/inbox.md` but has no
gate - nothing fails when a lead sits untriaged for a quarter, and nothing counts
the decline rate. If leads turn out to arrive faster than they are ruled on, the
answer is an age clause in `librarian/standard.md` (attention points for an
inbox line past N days), not a bigger inbox. Deferred until there is a real
arrival rate to measure: a threshold set before any data is a guess with a number
on it.

## 2.0 - 2026-08-27 - gravity (gravitone studio)

First run of the v2.0 loop, and the first full-coverage one: 13 contexts, 13/13
at 22/22 lenses, 13 fixes landed as atomic commits, 5 registry leads, 19
deviations logged across 22 subjects. Every fix carries a gate and a proven
fail-before. The repo arrived with a BLOCKING CI gate red on main and left green.

- **The loop's real payoff was lens coverage, not depth, and it is measurable.**
  The single most serious finding of the run - a server-side request forgery
  through a vendor-supplied image URL, proven by downloading the cloud metadata
  endpoint - came from `security-auditor` on a context that had been swept two
  days earlier by a `--optimize` pass and had never had that lens applied. The
  second most serious (an unbounded paid compute route) came from
  `risk-assessor`, also never applied there. Both contexts read as "already
  worked" by every other measure. **A context at 6/22 is not a swept context, and
  the ledger is the only thing that says so.**

- **The 5-item budget did what it was designed to do and cost nothing.** No round
  hit the cap; two rounds honestly returned zero built. Under v1.0's 30-item
  budget the first context would have consumed the session.

- **Three of thirteen rounds produced no fix, and two of those were right.**
  `research-step` and `shared-notebook` came back clean at this depth after two
  candidate races were traced and BOTH proved unreachable - mutually exclusive
  mount branches in one case, an internal catch in the other. The discipline that
  produced the clean verdict was checking reachability before writing the fix; on
  the second I had already drafted the hypothesis and it was wrong.

### The routing rules, measured

- **S auto-approval held.** Ten of thirteen fixes were S and none needed an ask.
  The execution-time demotion rule never fired, but the four VETOES fired
  constantly and are what made auto-approval safe.
- **Veto 3 (no gate that can verify it) is the one that earns its place.** It
  stopped a defensive fix to a path the UI prevents, and it is the reason two
  probes were rewritten rather than shipped: one asserted a *timing* property no
  return-value test can see, the other spent a real Claude run to prove a limit.
- **Veto 1 (outside the context boundary) fired six times in thirteen rounds,
  which is too many.** See the redesign proposal below.
- **The M rule was exercised exactly twice.** One cleared at 7/3 = 2.33 and was
  built (the SSRF); one landed at 5/3 = 1.67 in the ask band and was surfaced to
  the operator rather than guessed at. Two data points is not calibration, but
  the band did discriminate rather than collapsing to one side.

### The registry lane, measured

- **The read side changed the findings, not just the paperwork.** Naming the
  technique a finding violates makes it arrive with the fix already described,
  and twice it CHANGED THE VERDICT: the corpus already stated the focus-management
  rule and the "a second list is a copy that drifts" rule verbatim, so those
  rounds correctly filed no lead and recorded a deviation instead.
- **The four-bar gate refused more leads than it passed** - 5 filed against 13
  rounds - which is the intended ratio. The bar that did the work was "novel
  against the corpus", and it can only be applied by actually reading the
  technique: twice I expected novelty and found the rule already written.
- **A ledger nobody reads is theatre, so the collector had to exist.** It was
  also the run's own worst bug: `leads-collect.mjs` shipped non-idempotent and
  appended all five leads twice, because its dedup key was reconstructed from the
  row's columns and had to be kept in step with the renderer by hand. The exact
  hand-maintained-list failure four of the leads are about, in the script that
  carries them.

### Two method defects this run, both mine, both worth a rule

- **`cmd | tail && git commit` takes `tail`'s exit code.** I committed once on a
  RED typecheck because the pipe that was keeping output short also swallowed the
  failure, and section 7.2's "verify before committing" was defeated by the shell
  idiom I was verifying with. Caught, repaired, amended. **Assert the exit code of
  the gate itself (`npm run typecheck; echo $?`), never the exit code of whatever
  you piped it into.** Applied to SKILL.md in this change.

- **A shell heredoc silently corrupted a regex I was writing INTO a gate.**
  `\b` became a literal 0x08, so `/<BS>guardRequest/` matched nothing and all
  nine gated routes read as ungated. The gate could not fail, in the commit whose
  entire subject was a gate that could not fail. It was caught only because the
  count looked wrong (9 ungated out of 10) - a plausible-looking number would have
  shipped. **Never author a pattern through a heredoc; use the file-writing tool,
  and after any scripted edit assert the gate still detects a seeded violation.**
  Applied to SKILL.md in this change.

### Redesign proposal (not applied)

**Veto 1 is too blunt for a small, tightly-coupled repository.** Six of thirteen
rounds found something real whose fix touched a second context, and the method's
only answer is "emit it as a finding naming the foreign file". That was right
twice - the two repairs deferred to `script-step` landed properly in its own
round, with the boundary doing exactly its job. It was wrong the other four
times: a red CI gate, two gates missing from CI, and a delete dialog that folds
"could not read" into "holds nothing" all sat unfixed for a coordination benefit
that did not exist, because no parallel session was running.

The rule should key on the actual hazard rather than on the boundary. Something
like: a cross-context edit is permitted when (a) the sweep can name every context
it touches, (b) the change lands as ONE commit that says so, and (c) no other
session has declared those paths - which the fleet already has a ledger for. The
loop would then end with an explicit cross-context pass rather than a backlog of
items each blocked on a different round. Proposing rather than applying: it
weakens the one rule that makes parallel sweeps safe, and that trade needs the
operator's judgement, not mine.

## 2.1 - 2026-08-27 - gravity (yield audit of the run above)

The operator challenged the previous entry's numbers: 13 contexts, 22 lenses, 28
findings. The challenge was right and the cause was the method - specifically the
v2.0 rewrite recorded above, not the session that ran it.

**The measurement, same repository, a fortnight apart:**

| | lenses | findings/context | findings per LENS-PASS |
|---|---|---|---|
| v1.0 `--optimize` | 6 | 16.3 | **1.63** |
| v2.0 `--stabilize` | 22 | 2.2 | **0.098** |

A 17x collapse in yield per lens-pass, from 3.6x MORE lenses. And the diagnostic
that rules out "the codebase was clean": **0 of 13 rounds reached the 5-finding
cap.** A binding cap makes rounds cluster at the cap; these clustered at 1-3. The
budget was never the limit - it was the ANCHOR.

Two causes, both introduced by the v2.0 rewrite:

- **I deleted v1.0's yield floor.** It read "around 20 findings on a healthy
  context. Under ~10 usually means you stopped at the surface - dig again before
  declaring clean." I replaced it with "Under-filling the budget is fine and
  common on a healthy area; say so." That inverts the pressure from *you failed,
  look again* to *few is fine*, and nothing else in the method pushed back.

- **The budget and the package contradicted each other.** A 22-lens package
  against a 5-item budget is exhausted by lens three. The other nineteen had
  nowhere to put a finding, so they became coverage RECORDING - the ledger reads
  22/22 and the round reports a clean tail it never had room to hear. That is
  coverage theater, produced by the skill whose highest-value finding class is
  coverage theater, in the same file that teaches how to spot it.

**The root confusion, worth naming because it is easy to repeat: I tuned the
FINDING budget while reasoning about the WORK budget.** How much a round builds is
decided by the routing rules - S builds, M clears a ratio, L never does - not by
how many findings exist. Raising the finding budget raises the BACKLOG, which is
the artefact the operator triages, and leaves build volume exactly where routing
put it. Find generously, build conservatively; they are different dials.

**Rebalanced and then VALIDATED rather than asserted.** Budget 12/context (20 for
`--one`), per-tier allowances (deep 3, matched 2, tail 1), lifetime cap 40, and
the floor restored with counter-pressure: under 6 is a signal about the PASS, not
the codebase, and a genuinely clean round must now state what it read and which
hypotheses it traced. Re-swept one context that had returned 2 findings / 0
fixed: **6 findings and 2 fixes from two of its fifteen files.** Both fixes were
real - colliding render ids from a stale-closure counter, and a documented
"caller revokes when done" contract that no caller in the repository had ever
honoured.

**The re-sweep also found the previous run's most embarrassing miss.** A repo-wide
grep in round 6 had already PRINTED the colliding-id site; I read the `set*`
updaters on the two lines it showed, saw they used their arguments correctly, and
moved on without reading the line above them where the id was being taken from
render state. The grep did its job. The budget had nowhere to put another finding
and the anchor said the round was done.

### Three more ways a verification step passed while verifying nothing

All three were mine, all three in this session, all three now in SKILL.md:

- **`; echo "TC=$?"` reports a red gate and commits anyway.** I had already fixed
  the `| tail` variant in v2.1 and then wrote the printing variant, which is the
  same failure wearing the fix's clothes. *Reading* an exit code is not asserting
  it. Only `&&`-chaining is.
- **A whole-tree gate under a concurrent session is not a verdict on you.** A
  sibling agent mid-write made `tsc` red; the failing path was theirs and I
  committed into a red tree without checking whose it was. The parallel-session
  rules covered STAGING and stopped there. Verification has the same hazard and
  is easier to miss, because the output looks like it is about you.
- **A source-scanning gate matched its own comment.** The probe for the blob-URL
  contract passed against a deliberately broken subject because
  "revokeObjectURL" survived in the prose describing the fix. Strip comments
  before matching. Notably I had applied exactly this in round 1 and did not
  carry it forward - and the fail-before is the only step that caught it, both
  times.

## 2.2.0 - 2026-08-27 - personas (parallel wave, 8 contexts, 8 Opus workers, coordinator-committed)

- The method parallelizes cleanly at the CONTEXT boundary (the map was 3 shared paths in 4,133) but not at the OUTPUT boundary: the memory outbox ingest reads the first 200 lines and 30 finding lines, and one context's per-lens coverage nodes alone are 22 lines. Eight contexts produced 131 findings + 176 coverage nodes against a 200-line file - 101 findings did not fit. Under parallel waves the outbox must be DRAINED between contexts, or findings emitted in priority order (built -> findings -> summaries -> escalations -> coverage) with the scan-history ledger carrying coverage. §9's "emit highest-reward first, stop at the cap, say what did not fit" is right; what it lacks is the per-wave arithmetic that makes the cap the binding constraint.
- Workers should RETURN a structured result and never write shared files. Eight sessions appending to one outbox/history/consults file is a write race the skill's parallel rules do not cover; returning `{fixed, findings, files_changed, lenses_evaluated, consult, leads}` to a coordinator that persists once removed the race entirely and made per-context isolated-index commits possible.
- A worker's `context` field must be the map's context NAME. Workers wrote their round header prose into it; the ingest matches by name, so every node would have landed on an unknown context. Normalize before persisting.
- Real cost was ~540k tokens per context for a full 22-lens `--one` round on 14-20-file contexts (4.34M for eight) - 4.5x the 120k the coordinator assumed. Budget waves from measured cost, not from file counts.
- Three census rules ROSE from the wave's own fixes (direct `@sentry` imports + breadcrumb `data:` from new diagnostics; five hand-rolled `++seq` latest-wins guards where the repo owns `createLatestWins()`). The fixes were correct by the lens and wrong by the repo's gates: §2's "hard gates" reading did not reach the census rules that name a shared primitive as the legal destination. A worker that adds a diagnostic or a race guard should grep `scripts/census/rules.json` for the shape it is about to write.
- 60 of 131 backlogged findings were S. Under the parallel rules every S that needs a locale key, a binding, or a file outside the context is vetoed, so "S auto-builds" holds only for fixes with no shared-surface tail; a coordinator-owned i18n pass after each wave would convert most of them.

### Redesign proposal
- A `--wave` mode: the coordinator computes a disjoint assignment (exclude contexts intersecting the tree's dirty set; pin the few shared paths to one owner), runs N `--one` workers that return the structured result above, commits per context from an isolated index, persists outbox/history once in priority order with drain cycles, runs the census once and CONFORMS rises at the source, then pushes. Not applied this run: the change is to the invocation contract, not to a step, and it needs its own calibration log.

## 2.3.0 - 2026-08-28 - personas (operator review of two waves, 16 contexts)

**Correction from the operator, in spirit:** "Applying ai-registry practices is
a nice feature; the scans themselves should be primarily about applying various
prompts/lenses per code analysis. Lenses should follow ai-registry knowledge
where it exists. Pure registry-to-backlog transformation can be a separate
lens." And: "Idea description is inconsistent - enforce almost jira-like
metadata: Summary, Description, bullet-point flow, code block (evidence),
Expected impact. Some ideas are well described, some were thrown vaguely.
Standardizing improves the ability to decide and to execute with cheaper
models."

What changed in the spec:
- S2/S3/S6: the registry is knowledge that FEEDS the lenses; each lens reads the
  techniques touching its concern and judges against them. The
  registry-deviation-to-backlog transformation is its own lens,
  `registry-conformance` (added to `scan_agents.toml` and `references/lenses.md`,
  23 lenses now; `scripts/coverage.mjs` counts the reference, so the
  denominator follows).
- S4.10 (new, MANDATORY): every finding body is `## Summary / ## Description /
  ## Flow / ## Expected impact`; `evidence` is a separate code block or
  file:line list; title <= 80 chars. S8 and S9 point at it; the outbox example
  shows the escaped form.
- Renderer side (personas `TriageCardBody`): splits on the headings, lead
  Summary above a rule, other sections as labelled blocks; an un-sectioned body
  paints as one block.

Why it was needed (seen across waves 1+2, 240 findings): bodies ranged from a
one-line smell to a five-paragraph essay with the fix buried in the middle; the
deck showed both as the same undifferentiated markdown, so "decide in three
seconds" depended on which worker wrote the card.

Known gap: the personas generator `scripts/skills/scan-agents-to-skills.mjs`
still carries an OLDER SKILL.md template; `--force` would overwrite this file.
The registry copy is the authored one - regenerate only `references/lenses.md`
from the TOML (or append by hand, as done here) until the template is retired.

## 2.4.0 - 2026-08-28 - personas (net-delta routing)

Operator, after triaging the first ~35 sectioned ideas by hand: "majority of
ideas are worth to execute — design one thought step to compare the state after
implementation and the current state (similar to risk rating). If the
conclusion is net positive, auto-accept. Leave core design choices or major
features on the human gate."

What changed: S4.10 gains a `## Net delta` section (Before / After / Delta /
Gate); S5 drops the reward/risk-ratio band entirely — `positive` + gate `none`
auto-accepts, everything else goes to the deck with the delta on the card; the
five human gates (design, feature, contract, policy, irreversible) are defined
by what the implementation REQUIRES. S9 carries `delta` and `gate` as fields.

Why the RRR band was wrong: it scored the edit's danger, not the product's
state. Exercised the same day on the remaining 149 pending ideas with Sonnet
classifiers doing the Before/After step per item (results in the personas
run ledger `net-delta-triage`).

## 2.5.0 - 2026-08-28 - personas (measured evaluation replaces net delta)

Operator, after the net-delta wave left 154 pending: "instead of evaluating
net positives we should have a framework for before/after which can measure
both variants as pre-analysis on a small sample or thought simulation. If the
solution has better code quality, performance, resilience, user benefit, or
the other benefit promised by the idea, auto-accept. If not, reject. If not
measurable (subjective — new large features, redesigns), human gate."

What changed: S4.10's `## Net delta` became `## Evaluation` (Claim / Before /
After / Method / Result / Gate); S5 routes on `better` / `not-better` /
`unmeasurable`, and `not-better` is a REJECTION with figures — the first
routing rule in this skill that can say no. Design/feature stopped being gates
(they are the unmeasurable result); contract/policy/irreversible remain hard
gates. Exercised on the 154 pending ideas; the retrospective on all three
rules in one day is in the personas run ledger `eval-triage` and in this
file's next entry.

## 2.6.0 - 2026-08-29 - personas (retrospective: three routing rules in 36 hours)

Three routing rules ran back to back on one operator's deck, each executed by
Opus subagents in worktrees and merged by the same coordinator. This entry is
the calibration data, not the doctrine.

| Rule | Input | Auto-accept | Executed: built / already / demoted | Demotion rate | Could it say NO? |
| --- | --- | --- | --- | --- | --- |
| 1 reward/risk (S auto, M by RRR) | 240 wave findings | 149 | 129 / 3 / 18 | 12% | no (backlog only) |
| 2 net delta (positive + no gate) | 149 pending | 85 (+30 operator, +19 escalations) | 89 / 8 / 21 | 18% | no (backlog only) |
| 3 measured evaluation (better/not-better/unmeasurable) | 154 pending | 57 | 52 / 0 / 4 | 7% | **yes: 36 rejected with figures** |

What the numbers say:

- **Rule 2 was careless in exactly one place: the `uncertain` band.** 46 ideas
  were `uncertain` because nobody checked the claim. Rule 3 measured them: 25
  were `not-better` (premise false, file not in this repo, already fixed) and
  21 `unmeasurable`. **Zero were better.** An "uncertain" that is never resolved
  is a backlog entry that costs a human decision for nothing.
- **Rule 3 found 26 ideas that belong to a different codebase** (a Next.js /
  imaging project, ingested on 2026-08-27 before the waves). No earlier rule
  could have found them because none of them *read the cited file*; the
  measurement step forces the read. That alone justified the rule.
- **Executors demoted 6 of rule 2's 85 auto-accepts** (7%) — mostly hard
  gates the classifier under-called (contract/policy) and premises that were
  false on contact with the code. Rule 3's demotions in wave 3: WAVE3_DEMOTED
  of 57, all hard gates or architecture (the two repeat offenders — the
  spotlight z-index and the settings-component relocation — were demoted for
  the THIRD time; a rule that keeps re-accepting an idea three executors
  refused needs a "demoted twice → reject" clause, added below).
- **Re-measurement held.** Wave 3 executors re-measured the Evaluation's
  After on the real change: of 52 built items, the figure matched or
  exceeded the prediction in all but a handful; the deviations were
  informative, not embarrassing — a census drop that never existed (the rule
  did not match the site), a "14 new registry entries" that turned out to be 0,
  two fixes that had to change shape (a refcount that cannot make two panes
  paint one holder; a blanket hydrate guard that would have regressed
  dead-session retry). Executors also caught three Evaluation premises that
  were stale ("panel renders nowhere" — it renders; "13 alias importers" —
  5). The measurement is good enough to route on and not good enough to build
  from blind, which is the right division of labour.
- **Cost.** Rule 3's classification cost ~5x rule 2's per idea (Sonnet with
  Grep/Read against the code vs. Sonnet reading prose): ~180k vs ~35k tokens
  per 30 ideas. It paid for itself in the 36 rejections alone (each would have
  cost an operator decision or an executor run of ~200k tokens).

What backfired, and the balancing added:

1. **Rules 1 and 2 could only accept or defer**, so the backlog grew
   monotonically (240 → 154 pending after two waves). A gate that cannot say
   no is not a gate. Rule 3 says no; the deck shrank to 61.
2. **Executors were trusted to demote, and did — repeatedly, for the same
   items.** Added: an idea demoted by two independent executors is
   `not-better` by measurement (two builds attempted, zero landed) and is
   rejected, not re-queued.
3. **The Evaluation is a small-sample probe, and executors found stale
   premises in ~10% of accepted items.** That is the expected failure mode of
   sampling; the mitigation is already in the executor brief (re-verify the
   Before, re-measure the After) and it worked. Do not raise the probe budget;
   keep the executor's re-measure mandatory.
4. **Unmeasurable is doing two jobs** — genuinely subjective (taste, product
   direction) and "measurable but I did not have the instrument" (a perf claim
   with no benchmark). The second kind should name the missing instrument as a
   finding of its own, so the next sweep can build it. Added to §4.10.
5. **The mechanics, not the rule, caused the actual damage** this week: two
   `node_modules/.bin` wipes from worktree cleanup, one dead Vite child, 44
   findings dropped by the ingest cap. None of it was the routing rule. They
   are recorded in the operator's memory and the coordinator scripts, and they
   argue for a coordinator that owns cleanup with verified steps, not for a
   softer rule.

Verdict on direction: **good, with one over-correction to watch.** The
measured rule is the first one that produced a smaller backlog AND a lower
demotion rate on what it accepted. The risk is the mirror of rule 2's: an
evaluator that cannot find a figure will be tempted to write `not-better`
instead of `unmeasurable` and reject something real. The 36 rejections were
spot-checked (26 other-repo, 4 already fixed, the rest premise-false with the
disagreeing figure attached) — none looked like a real defect rejected for
want of a number. Keep the rejection reason mandatory and figure-bearing so
that check stays cheap.

## 2.7.0 - 2026-08-29 - gravitone-gcloud

- **A red gate's own diagnosis is a hypothesis, not a finding — and §4.2 currently
  says to defer to it.** The clause reads "Deterministic findings belong to those
  tools — do not restate them as findings", which is right about not re-emitting
  what a linter already prints, and wrong about what to do when the tool's
  explanation is false. The lint ratchet was red and said "A RISE means new debt.
  Fix the finding", naming four hook rules. The truth was that an agent worktree
  under `.claude/` had put a second full checkout in the walk: 608 files against a
  299-file tree, every bucket at exactly twice its baseline. Reading it as debt
  would have cost a refactor of the app's data loading that nobody had caused;
  taking the gate at its word would have cost the whole round's best finding.
  The tell was cheap and general: **every bucket moved by the same factor.** A
  real debt rise moves the buckets it touches, not all of them uniformly. Suggested
  §4.2 addition — before accepting a red deterministic gate's account of itself,
  check whether its POPULATION changed; a uniform multiple across independent
  buckets is a population fault, never a content one.

- **Never put a heredoc on a gate chain.** §7.2 already has two ways the shell
  defeats a gate (`| tail` taking tail's status, `;` instead of `&&`). Here is a
  third, hit this round: `npm run typecheck > /dev/null && npm test > /dev/null &&
  git commit -F - <<'EOF'`. Bash attaches the heredoc to the whole list, the first
  npm process reads stdin to EOF and consumes the commit message, and the chain
  exits non-zero with the staged files untouched and no explanation. It looks
  exactly like a failed gate, and the natural next move — re-running the gates
  individually, finding them all green — wastes a full cycle. The shape that
  holds: write the message to a file first and `git commit -F <path>` as the last
  link. Worth adding beside the other two, because the failure imitates the thing
  the chain exists to detect.

- **A concurrent session's `git reset` clears YOUR index, and §7's parallel rules
  do not cover it.** The rules say what a sweep must not do (`git add -A`, `git
  stash`, resetting another session's work). They say nothing about surviving
  another session doing it to you. Measured: a sibling agent ran `git reset HEAD~1`
  between my `git add` and my `git commit`; the commit reported "no changes added
  to commit" with my working-tree edits fully intact. Nothing was lost, but the
  message reads like the edits were, and the recovery instinct — re-applying work
  that is already there — is destructive. Suggested addition to the parallel rules:
  stage immediately before committing, never across a gate run, and treat "no
  changes added" as an index event to re-verify rather than as lost work.

- **The §7.7 comment-stripping rule earned its place again, in the other
  direction.** The clause exists because a source-scanning gate matched prose that
  described a fix. Writing a new gate this round, the same discipline is what made
  the fail-before demonstration meaningful: both boundary files explain their rule
  in a header directly above the code, so a raw-text matcher would have passed
  against the PRE-FIX files. Running the matchers over comment-stripped HEAD
  sources gave 0/3 and 0/2, and over the fixed tree 3/3 and 2/2. Recording it as a
  positive: the strip is not only how you avoid a false green, it is how you get a
  fail-before you can actually believe.

- Yield this round: 10 findings / 23 lens-passes = 0.43 per pass, against the
  0.098 the clause was written after. Three of the ten came from reading the
  repo's own load-bearing comments against its code rather than from a pattern
  grep — on a codebase this heavily documented, the comments ARE the spec, and
  §4.6's "pair" hunt should name doc-vs-code as one of its shapes explicitly.

## 2.7.0 - 2026-08-29 - gravitone-gcloud

- **The first gate run of a round is the cheapest finding-generator in the whole
  sweep, and §4.2 currently tells you to throw its output away.** The clause reads
  "run any cheap deterministic check that applies... Deterministic findings belong
  to those tools - do not restate them as findings." Taken literally that is right
  for a lint warning and WRONG for the case that produced this round's highest-
  impact item: `npm test` was RED on committed main, and the failure was not a
  defect in the code the gate covers - it was the GATE itself mis-detecting, so
  nine correctly-gated API routes read as ungated and the repo's blocking CI job
  had been failing for reasons everyone had learned to step over. That is the most
  valuable thing a sweep can find (a gate red for a false reason has stopped
  refusing anything), and it is invisible to every lens that reads source, because
  the source is correct. Suggested refinement to §4.2: run the repo's own gates
  FIRST, and treat a gate that is red on committed code as a finding of the round,
  distinguishing three cases - the tree is broken (not yours, say so), the gate is
  broken (yours, and usually the round's best item), or the gate is right and the
  code is wrong (belongs to the tool).

- **Re-run a red gate once before believing it, on any repo with concurrent
  sessions.** The lint ratchet came back red with all four buckets EXACTLY doubled;
  the obvious reading (an agent worktree inside the repo being linted twice) was
  wrong, and a second run four minutes later was clean - another session had
  committed the fix between the two runs. §7.2 already covers this hazard at
  COMMIT time; it happens at SURVEY time too, and there it costs a fabricated
  finding rather than a bad commit. One re-run is cheap insurance against filing
  something another session already closed.

- **"Derive the population from the filesystem" does not finish the job that
  §4.7 starts.** This repo had already applied that fix to its route-gate probe
  two days earlier, and the gate was still wrong - because the POPULATION was
  derived and the DETECTOR was a single name (`guardRequest(`) for a chokepoint
  that had since grown two more legitimate doors. §4.7 asks "what enumerates the
  ground truth, and is the test derived from that or from the list?" and should
  ask a second question: "and does the test recognise every shape compliance is
  allowed to take?" A derived population with a stale matcher fails in the more
  damaging direction - it reports compliant code as violating, which trains
  everyone to ignore the gate.

- **A fix whose benefit cannot be measured by anything in the repo is the
  `unmeasurable` result even when the DEFECT is certain.** The strongest a11y
  finding this round (a live-region clear that React batches away, so a repeat
  message is never spoken) has a certain defect and an unverifiable fix: the Node
  probe lane cannot render React, and the live lane has no way to count live-region
  mutations. Veto 3 and the §4.10 "name the missing instrument" clause together
  gave the right answer - backlog it, and say in the After line which instrument is
  missing - and that instrument is now itself a queued finding. Recording it as a
  case where the two clauses composed correctly, because the tempting move was to
  ship the fix and call it `better` on a story.

- Yield: 12 findings / 23 lens-passes = 0.52 per pass. Four built. Two of the four
  came from running the repo's gates rather than from reading its code, which is
  the bullet above stated as a number.

## 2.7.0 - 2026-08-29 - kp (agent-workforce, --optimize, first sweep of the context)

- **Check the SIZE of your staged diff, not just its file list.** §7's parallel
  rules say to confirm the staged list is exactly your files, and it was - while
  the CONTENT was a whole-file rewrite. The editing tools wrote CRLF into files
  whose committed form was LF, so a 39-line change staged as 525 insertions and
  525 deletions across four files. On a shared checkout that is a silent clobber:
  a concurrent session's edit to the same file loses to a whole-file overwrite,
  and every hunk-level review passes because the hunks are real. `git diff
  --cached --stat --ignore-all-space` beside the plain `--stat` shows it in one
  line - real change vs. reported change - and it costs nothing to look. Worth a
  sentence in §7's staging rules; the hazard is not Windows-specific (any repo
  with mixed EOL, any tool that rewrites a file wholesale) and it is invisible in
  the transcript.

- **A repo-specific gate can redesign a fix, not just reject it - so run it
  against the DRAFT.** Corroborates the gravitone-gcloud bullet above from the
  other end: there, gates caught red committed code during SURVEY; here, a gate
  run during BUILD named the repo's own helper. Asked to show a server error in
  the UI, `i18n:check` did not say "this is wrong" - it said "resolve the machine
  `code` through `useErrorMessage()`, never the server's English `error`", which
  turned a correct-but-English-leaking fix into a localized one and exposed that
  the error code the whole feature was built around had never had a catalog entry.
  §4.2 currently frames gates as deterministic-findings-belong-to-the-tool
  (survey-time, don't restate). The complement belongs in §7.2: run the surface's
  gate before you consider the fix DESIGNED, because a mature repo's gates encode
  conventions no amount of reading the context's own files will reveal.

- **The richest pair shape on a well-swept repo: a producer that is tested and a
  consumer that is not.** §4.6 lists client-vs-server validation, gate-vs-debit,
  abstraction-vs-call-sites and doc-vs-code. Add: a route that builds a typed
  reply, pinned by route tests and described accurately in the docs, whose only
  UI caller awaits the fetch and reads nothing. Everything green, the payload
  reaching nobody. The grep that finds it is cheap and mechanical - take the
  route's own reason/code CONSTANTS and ask which UI file references them - and it
  produced this round's headline finding on a codebase that had already been
  bug-hunted end to end.

- Yield: 14 findings / 23 lens-passes = 0.61 per pass. 5 built, 8 backlogged, 1
  rejected as `not-better` (a staleness whose realistic window measured the same
  on both sides). The rejected one matters: it is the first time on this repo the
  routing table said NO rather than defer, which is what §5 was rewritten for.

## 2.7.0 - 2026-08-29 - ascent

- **`coverage.mjs --next` was dead on every GROUPED context map, and it failed in
  the shape §1 exists to prevent.** The script read `map.contexts` only; a v2 map
  (and everything `project-populate` emits) nests contexts under `groups[]`, so it
  exited 2 with "no contexts in the map". That sentence reads as a fact about the
  repository, not about the reader, and the honest response to it - hand-pick a
  context - is exactly the un-auditable rotation the picker was written to
  replace. Fixed in 2.7.1 by flattening both shapes. The general lesson is
  sharper than the bug: **a tool that computes the round's scope must distinguish
  "there is nothing" from "I cannot see anything", because the loop cannot tell
  them apart and will proceed either way.** Same law as the skill's own
  `failure-not-empty-success` findings, turned on the skill's own instrument.

- **The undeclared sibling is where the unfixed copy of the defect lives.** This
  context declared 3 of the 4 routes that share one security gate; the 4th - found
  only by grepping the env var, not by walking the declared paths - was the one
  still carrying the `===` credential compare after the other three were being
  fixed. §4.6 says to grep the shared SYMBOL and diff its call sites; the
  strengthening is to grep it **outside the context's declared paths too**, because
  a path list is itself a hand-maintained list and §4.7 already tells us what those
  are worth. The out-of-context hit is not noise to be vetoed: it is the finding.

- **Two `unmeasurable` results were avoidable and one was not, and the difference
  was whether a figure existed anywhere.** "Clamp the chip by its own width" felt
  like taste until the placement was arithmetic on one concrete input (element at
  x=1500, viewport 1600, 7-char label -> 160px of drift), which turned it into an S
  that built. "9,600 persists under a 300s budget" stayed unmeasurable because the
  repo owns no timing harness for its own persist path. The tell: before writing
  `unmeasurable`, ask whether the claim is untestable or merely un-instrumented -
  the first is a judgement, the second is arithmetic you have not done yet.

- Yield: 11 findings + 1 rejected / 23 lens-passes = 0.52 per pass, 8 built. The
  three highest-impact findings all came from asking what two implementations of
  one rule disagree about (four copies of a gate; one seeder counting dedup, its
  sibling not; a test re-typing the list it was meant to check), which is §4.6 and
  §4.7 doing the work the deep tier did not.


## 2.7.1 - 2026-08-29 - kp (integrations-settings, --optimize, first sweep of the context)

- **Grep the context's own COMMENTS for a stated rule, then check the code delivers
  all of it.** This is a sharper instrument than §4.6's pair list on a
  heavily-commented codebase, and it was the single highest-yield probe across two
  rounds: 4 of 7 builds this round and 3 of 5 the round before came from a comment
  that named a hazard precisely and a code path that addressed half of it. The
  shape repeats because it is how careful work decays — the author understood the
  problem (that is why the comment exists), shipped the cheap half, and the comment
  now reads as if the whole thing were done, which stops the next reader from
  looking. Concrete instances: "a silently-empty form here is dangerous: saving it
  would overwrite the stored config with blanks" — followed by a toast and a live
  Save button; "identifiers rendered in mono type: named constants, not JSX text"
  — followed by four constants assigned from literals rather than from the
  authorities that existed; `onPaired(); // reload the bridge status either way`
  — sitting inside the try, after the throw. Each is a defect the comment
  ARGUES FOR, so the finding arrives pre-justified and the commit message writes
  itself. Suggested addition to §4.6 as its own bullet: a comment that states a
  rule is a testable claim about the code beneath it.

- **A "well-commented, obviously careful" context is a HIGH-yield target, not a
  low one.** The instinct is to expect little from code this reasoned — every file
  here opens with a paragraph on what it is the door for, and the one test file is
  genuinely excellent (set-equality against the code's own enums, both directions,
  all four locales, with a header explaining the 4-key-vs-13-kind bug that caused
  it). Seven builds came out of it anyway, including the sharpest structural find
  of either round: that same test guarded three of the context's four
  code-authoritative vocabularies and not the fourth — the only one a server-side
  validator rejects a save against. Care is unevenly distributed WITHIN a file and
  within a directory, and the gap between the guarded three and the unguarded
  fourth is invisible unless you enumerate. §4.7 already says to interrogate every
  hand-maintained list; the addition is to enumerate the list OF lists and ask
  which ones got the treatment.

- Yield: 13 findings / 23 lens-passes = 0.57 per pass; 7 built, 5 backlogged, 1
  rejected. Consistent with the previous round's 0.61 on a context of similar size,
  which is the first time two rounds on this repo have agreed on a rate.


## 2.7.1 - 2026-08-29 - ascent

- **The registry read can change the ROUTING of a finding, not just its wording, and §3
  undersells that.** §3 says each lens reads the governing subject's techniques and "judges
  the code against them" - which reads as a sharpening of the finding's TEXT. This round it
  reversed a build. The obvious S was "error.tsx only console.errors; global-error.tsx also
  calls captureException - add the capture and the three boundaries stop drifting". Reading
  `telemetry-pii-redaction` showed the repo has four emit sites and no outbound scrubber at
  all, so the fix would have ADDED a fifth unredacted channel; the subject's own stance is
  that a subsystem whose mistakes are permanent installs the cap first. The finding became a
  sequenced pair in the backlog and the build did not happen. Worth saying in §3 explicitly:
  **when the governing subject describes an ORDER of operations, check the fix against that
  order before classifying it as S** - an S that must follow an M is not an S this round.

- **A mangled pattern does not always arrive as control characters. Sometimes it arrives as
  valid, compiling, semantically-INVERTED code.** §7.6 describes the failure as `\b`
  reaching the file as 0x08, and prescribes the file-writing tool. The rule is right and I
  broke it; what is worth adding is the second failure shape, because the prescribed
  detection ("look for control characters") does not catch it. Authoring
  `.replace(/</g, "\\u003c")` through a Python heredoc dropped one backslash level, so the
  file received `"\u003c"` - a legal TypeScript escape that evaluates to `<`, i.e. an escaper
  that replaces the character with itself. tsc passed, eslint passed, and seven of the nine
  tests passed. **Only the fail-before caught it**, which is the whole argument for §7.6's
  seed-a-violation step: it is not a nicety on top of a green suite, it is the only step that
  distinguishes "the guard works" from "the guard compiles".

- **A lead that restates a technique is noise, and bar 3 earns its keep.** The mobile-nav
  finding felt like a lead ("assert every destination that a responsive collapse hides is
  reachable from the surviving chrome"). `app-shell/nav-hierarchy` already says it, in four
  words - "what collapse must not do: reorder or drop". Checking cost one grep and turned a
  would-be lead into a conformance citation, which is the more useful artifact anyway: it
  names the rule the code broke instead of proposing a rule the corpus has.

- Yield: 10 findings / 23 lens-passes = 0.43 per pass, 6 built, 2 backlogged, 2 rejected
  `not-better` (a JPEG named .png - nothing is broken today, browsers sniff, and renaming a
  public asset risks live unfurls; and an OG route missing a `runtime` export its four
  siblings declare, where the default resolves the same way). Both rejections came from
  taking the Before/After measurement seriously enough to find that nothing moved.

## 2.7.1 - 2026-08-29 - kp (lib-llm-config, --optimize, first sweep of the context)

- **After seeding a violation, assert the SEED LANDED — not just that the gate went
  red.** §7.6 says to seed the thing a checker looks for and watch it bite. It does
  not say to verify the seed applied, and a seed that silently no-ops is
  indistinguishable from a guard that works. Measured here: 3 drifts seeded into a
  new lockstep test, 2 turned red, 1 stayed green — and the green one was not a weak
  assertion, it was a scripted string replace that never matched because the file was
  CRLF on disk while my pattern used `\n`. Had I only checked "did the suite go red",
  the pass/fail mix would have read as success and I would have shipped one
  unverified guard. The rule that catches it costs one line: make the seeding script
  assert its own replacement changed the file (`assert s != before`), and read WHICH
  assertions failed rather than the summary count. This is the same CRLF hazard as
  the staged-diff lesson above wearing a different hat, which is the argument for
  naming it separately: the first instance corrupts a commit, this one corrupts a
  PROOF, and the proof is what the round's credibility rests on.

- **A generated context→subject join can be wrong, and §6 currently says to trust
  it.** The clause reads "If `.ai/registry-map.json` exists it already holds the
  context→subject join; take the subject's `file` VERBATIM from the index" — sound
  advice against building paths from slugs, but it also reads as "the join is
  settled". For this context the join offered `rate-limiting`, `codebase-scanning`,
  `webhook-ingestion` and two RECRUITING subjects, all at "probable" confidence,
  for a module set that is an LLM provider-config layer: keys, precedence, retry,
  usage ledger, telemetry. The scorer had matched on keyword overlap ("key",
  "request", "provider", "model", "scores"). Meanwhile `cost-metering`,
  `model-routing`, `retry-backoff` and `usage-analytics` all exist in the same
  bundle and govern it precisely; two of the round's four builds came from reading
  them. Suggested §6 addition: read the joined subjects' NAMES against what the
  context actually does before opening them, and when they are obviously off,
  resolve through `knowledge/<domain>/index.json` and SAY SO in the header — a bad
  join is not just this round's problem, it is the input `/conform` uses to decide
  what standard the context is evaluated against, so it belongs in the report as a
  finding rather than being silently worked around.

- Yield: 8 findings / 23 lens-passes = 0.35 per pass, against 0.57 and 0.61 on the
  two previous rounds. Not a worse pass — a genuinely tighter context: 18 files with
  a dense test suite (8 test files, including two that already read the Python source
  for lockstep) and comment density high enough that most hazards were already
  argued. The three findings that landed all came from the same probe: enumerate the
  lists of lists and ask which ones got the treatment the others did.

- **A transcript-scanning hook cannot see work done through the shell — and the
  quiet direction is the dangerous one.** kp's Stop hook walks the turn for
  `Edit`/`Write`/`MultiEdit` calls to check that source changes came with a doc
  update. This round's docs were written with `python` heredocs through the Bash
  tool, so the hook reported a missing doc update for a doc that had in fact been
  updated in all three commits. Harmless that way round. Reverse it — source
  edited only through the shell — and the hook goes silent on a change that
  genuinely has no doc, which is the failure it exists to catch. Same family as
  §7.6/§7.7 (a gate that cannot match reports a clean codebase in a voice
  indistinguishable from success), one layer up: not the checker's matcher, but
  the checker's INPUT, narrowed by a tooling choice the skill made for unrelated
  reasons. Worth a line in §7: when a repo's gates read the transcript rather
  than the tree, use the dedicated edit tools for anything a gate watches, and
  keep the shell for mechanical passes. And when such a hook fires against work
  you believe you did, verify with `git log -- <path>` and answer with the
  evidence — "no doc update needed" is a different claim, and an untrue one.

## 2.7.1 - 2026-08-29 - systedo-case

- **The repo's own mechanical ratchets decide the build list before the routing
  table gets a vote, and §5 had nothing to say about it.** This repo's agent-review
  rubric blocks any file under `src/components/` that ends a diff over 200 lines
  *and larger than it was*. The swept context's two central files were 658 and 339
  lines, so three findings that were `better` on a real measurement with no hard
  gate - a timeout card quoting a build constant the run does not use, three
  lifecycle cards with no live-region semantics, a non-JSON 5xx reported as a
  network failure - were unbuildable, while three others with the same routing
  verdict landed simply because their file had headroom. Nothing in §5 told me to
  look. Applied in 2.8.0: check each candidate's implementation SITE against the
  repo's declared gates before choosing what to build, and backlog the blocked ones
  naming that gate, so the operator reads "correct, safe, blocked by A1" instead of
  a silent absence. The escape hatches are worse than the block: shrinking the fix
  until it fits the line count optimises for the ratchet rather than the user, and
  extracting to a new file is veto 1 plus, here, a rise in a ratcheted unmapped-file
  count.

- **A composite gate script hides a skipped stage behind someone else's failure.**
  §7.2 already covers `tail` eating the exit code, `;` instead of `&&`, and a red
  that is not yours. It does not cover the fourth shape, which cost me a full
  verification here: `npm run check` is `typecheck && lint && build`, `lint` runs
  over the whole tree including a UAT run artifact with a parse error committed
  three days earlier, so lint failed and **the build never ran at all**. Confirming
  "the red is not mine" felt like the end of the analysis and was only half of it -
  the stage I actually needed was the one that got skipped. Applied in 2.8.0 as a
  fourth bullet in §7.2. Sharpened corollary for the same clause: when the round's
  gate is a composite, name in the report which stages actually executed, not which
  script you invoked.

- Yield: 12 findings / 23 lens-passes = 0.52 per pass over a 1612-line, six-file
  context, of which 3 built and 1 rejected as `not-better`. The tail earned its
  keep in an unusual way: seven lenses reported clean, and two of those clean
  verdicts (`analytics-planner`, `tech-debt-tracker`) were clean specifically
  because the finding belonged to another lens or to a deterministic gate - §4.9's
  "name the three things you checked" is what kept them from becoming duplicates of
  findings already written.


## 2.7.1 - 2026-08-29 - ascent (round 3)

- **§7.2's gate rule needs one more clause: run the CHANGED MODULE's own sibling suite, not
  only its consumers'.** Editing `src/lib/practice-artifact.ts` I gated on
  `src/lib/standard`, `src/lib/onboarding` and `src/lib/practices` - every consumer I had
  reasoned about - and committed green. The full suite then showed 9 failures in
  `src/lib/practice-artifact.test.ts`, the file sitting directly beside the one I changed,
  which pins each language's command tuple with `toEqual` twice over. The mistake is
  seductive because the consumer list feels like the thorough choice: it is the list you
  build by thinking about blast radius, and it systematically omits the one suite named after
  the file. **Cheap rule: before committing an edit to `x.ts`, run `x.test.ts` if it
  exists.** (The contract test was right to fail - §7.5 - and strengthening it was the fix.
  What is worth recording is that the gate never asked it.)

- **Authoring a regex through a shell-invoked interpreter failed THREE times in one round,
  in three different shapes, and each was caught by a different thing.** `\\u003c` through a
  Python heredoc arrived as `\u003c` - a legal escape for the character it was meant to escape
  (caught by a fail-before). `\\[Ascent\\]` through `node -e` arrived as `[Ascent](` - an
  unterminated group (caught by the parser). `/^(\\d+)/` through `node -e` arrived as
  `/^(d+)/` - a regex that compiles, runs, and matches nothing (caught by an assertion that
  happened to be strict). §7.6 already forbids this and I broke it three times, so the lesson
  is not the rule but its ERGONOMICS: the moment an edit contains a backslash, the cost of
  reaching for the file-writing tool is lower than the cost of verifying the shell round-trip
  - and the third shape (compiles, matches nothing) is the one no gate catches on its own.

- **A clean registry-conformance result is worth writing down as loudly as a deviation.**
  This context GENERATES a repo manifest standard, and `repo-manifest-standard` governs it
  with six named techniques. All six are implemented AND documented in the spec the kit ships.
  So the conformance lens returned nothing - and that nothing is the single most useful
  sentence in the round's report, because it relocates every finding: the six defects I did
  find are not deviations from the standard, they are failures to apply the repo's OWN rule
  consistently (the `evals` pointer lesson not carried to `generatedFrom`; the `ciSetup`
  escape-hatch not carried to the two sibling `ci`-keyed maps). §6 says to report a clean
  read; it is worth adding WHY: a conformant context tells you the remaining bugs are
  self-inconsistency, which is a different hunt with a different grep.

- **"Your own green build says nothing about a generated artifact" is a lens the package
  lacks.** Two of this round's six fixes (an EOL Node pinned into every adopting repo's CI; a
  placeholder provenance the generated doctor skipped) share one cause: the artifact executes
  in a CONSUMER's environment, so no gate in the producing repo can see it. A 7,900-test suite
  was green across both. Neither `dependency-auditor` nor `devops-optimizer` naturally asks
  "what did we generate, and what would it do somewhere else?" - it took reading the governing
  subject to get there. Worth considering as a lens key of its own for repos that emit code.

- Yield: 8 findings / 24 lens-passes = 0.33 per pass, 6 built, 1 backlogged, 1 rejected. The
  low rate is honest here: this is the most disciplined context the sweep has met (a suite
  that spawns the generated doctor as a subprocess and compiles its own parsers out of the
  emitted source), and §4.7's usual richest question - what enumerates the ground truth? -
  came back with a real answer three times over.


## 2.7.1 - 2026-08-29 - ascent (round 4)

### Redesign proposal: §7's parallel rule teaches the wrong mechanic

- **"Stage with explicit pathspecs only" is advice that CAUSES the failure it is trying to
  prevent, and I proved it twice in one sweep.** The rule reads as "scope your `git add`",
  so the natural shape is `git add -- <my files> && git commit -m "..."`. That commit has
  no pathspec: it takes the whole INDEX, including whatever a sibling session staged in the
  meantime. It happened in round 1 (a stray BOM fix) and again in round 4, where it swallowed
  another session's in-flight feature — a new 167-line script, its 155-line test, a 444-line
  `context-map.json` edit and an overlay change — into a commit whose message described a
  two-line comment fix. Recovered with `reset --soft HEAD~1` + a pathspec commit, their four
  files back in the index untouched, but the recovery is only available because I looked at
  the diffstat.
  **The rule should name the operation, not the discipline: `git commit -m "..." -- <paths>`,
  and do not `git add` at all.** One command, no window, and it cannot take anything you did
  not name. The current wording is why I used the safe form for some commits this round and
  the unsafe form for others: both feel like they satisfy it.

- **A seeded violation that does not go RED has told you nothing, and it looks exactly like
  success.** §7.6 says to seed a violation and watch the gate bite; what it does not say is
  to check that the seeded run actually failed. My first fixture for a threshold fix used
  20 x 0.4 = 8 against a single +9 — the old thresholdless code ranked them the same way the
  new code does, so the seed passed, and a green run after a green run reads as "verified".
  The fixture, not the code, was wrong. **Add to §7.6: after seeding, assert the run is RED;
  a passing seed means your case cannot distinguish the two implementations, and the honest
  next step is a fixture whose numbers are INVERTED against the property you are pinning.**

- **A repo-level structural gate that only runs at the END of a round is a gate that runs
  after the commits it governs.** Two test cases I added took a file from 291 to 307 lines,
  past the repo's 300-LOC rule — and I committed it, because the LOC check lives in the
  round's closing gate list. The repo's own instruction is literally "check before committing
  a file you grew". **The gate list in §7.2 should distinguish per-COMMIT gates (typecheck,
  the touched suite, lint, plus any structural rule on a file this commit grew) from
  per-ROUND ones.** Cost here was one extra split commit; on a rule with a harder remedy it
  would be a revert.

- **"Mapped to the wrong subject" is worse than "unmapped", and §6 has no state for it.**
  This context is an animated SVG star field. Its five registry subjects all matched on the
  word *fleet* — CI runner pools, device fleets — at scores of 254-300, against 615 / 490 /
  400 for the three previous rounds' genuine matches. §6 offers `registry: declared, unmapped`
  for a missing join, but a homonym join produces a subject list that LOOKS like governance,
  and a lens that dutifully reads it will conformance-check a star map against a runner pool.
  **Two additions worth making: a `declared, weakly mapped` header state, and the instruction
  that a homonym match is itself a FINDING about the map** (filed here as one) rather than a
  reason to degrade quietly. The tell is cheap — compare the top subject's score against the
  scores this repo's other contexts draw.

- Yield: 7 findings / 24 lens-passes = 0.29 per pass, 5 built (one of them repairing my own
  LOC breach), 2 backlogged, both `unmeasurable` for the same honest reason: the Before figure
  is solid and the After depends on a product decision that is not the sweep's to make. Three
  bounty-hunter hypotheses were traced and all three failed — a memoization cache that turned
  out to honor its documented bound, a hand-built org URL that turned out to be the landing
  URL rather than a tab href, and a double-click race that turned out to be guarded twice.
  Recording the failed hunts, because in a context this heavily worked (7 numbered prior
  findings, MAP-2..6, G8-16/18) they are most of the round's actual reading.


## 2.7.1 - 2026-08-29 - ascent (round 5)

### Redesign proposal: the loop has no way to notice its context is being DELETED

- **A concurrent session retired the entire context while I was sweeping it, and nothing in the
  method looked up.** Mid-round, another agent staged the deletion of `src/app/connect/` and all
  of `src/components/connect/` — the 19 files this round had just read — moving two survivors
  elsewhere. I found out only because an unrelated `tsc` run failed on a missing module and I
  went looking. By then one of my two landed fixes was already moot: it was committed into a
  file that no longer exists in the working tree.
  **§1 should end with a cheap liveness check, and §7 should repeat it before each commit:
  `git status --porcelain -- <the context's paths>`.** A `D ` or an `R ` on a file you are
  about to edit is not a merge hazard, it is a signal that the surface is being retired and the
  round should stop and re-pick. The check costs one command and would have saved most of a
  round. (§7's parallel rules already say to inspect status before staging — but only to protect
  OTHER sessions' work from mine. The reverse direction, protecting my round from a rug-pull, is
  not there at all.)

- **"Its file was deleted" is a distinct outcome from built / backlogged / rejected, and the
  ledger cannot express it.** I recorded the round `degraded: true` with a note, which is the
  closest available truth, but `fixed: 2` overstates it: one fix survives (it happened to live
  in a file the refactor kept and even carried forward), one is gone with its surface. A snapshot
  consumer counting `fixed` across rounds will now be wrong by one forever.
  **Worth a `moot` count in the snapshot schema** — work that landed and was then superseded —
  because the honest number is not zero (it shipped, it was correct) and not one (nobody will
  ever run it).

- **A pure-function seam tests the function, not the argument, and that is exactly where this
  round's biggest defect lived.** `installRouting.ts` was extracted VERBATIM from the page so its
  routing could be unit-tested, and `installRouting.test.ts` pins it across 8 cases — every one
  passing `authConfigured` as a literal. The function is correct. The page hands it
  `isAuthConfigured()`, the dormant custom-OAuth predicate, which is false in production, so
  every branch resolves the wrong way. The extraction that made the logic testable is the same
  move that made the bug invisible: the parameter boundary is where the test stops and nothing
  else starts. **Add to §4.7's list of questions: for every pure function extracted for
  testability, who supplies its arguments, and is THAT pinned anywhere?** The answer here was
  nobody, and the page even fixed the identical predicate one line above for a different gate.

- **A homonym registry match outranked a real one, for the second round running.** `p2p-networking`
  (385) beat `table` (238) and `file-browsing` (253) on the word "connect", for a filterable repo
  list with bulk actions. Round 4 saw the same shape with "fleet". Two rounds is a pattern, not a
  coincidence: **the map's scorer is matching page-title vocabulary against subject names**, and
  the cheap defence is the one I used both times — compare the top score against the scores this
  repo's other contexts draw (615 / 490 / 400 for genuine matches here) and treat anything in the
  250-390 band as unmapped until read.

- Yield: 4 findings / 23 lens-passes, 2 built (1 moot), 1 backlogged, 1 escalation. The round is
  not comparable to the others: it ended early, by choice, when the context stopped existing.


## 2.7.1 - 2026-08-29 - ascent (round 6)

- **The liveness check proposed one round ago paid for itself immediately, and it wants a THIRD
  outcome besides go/stop.** Round 5's proposal was: run `git status --porcelain -- <the
  context's paths>` before reading, and stop if the surface is being retired. Run here, it showed
  11 of 78 files mid-rewrite — the same refactor that had just eaten round 5's context, now
  rebuilding this one. Stopping would have been wrong (67 files were stable and one of them held
  the round's best finding); ploughing in would have been worse. **The right move was to
  partition: sweep the clean set, name the excluded files in the report and the snapshot note,
  and record the round as PARTIAL BY DESIGN rather than degraded.** So the check has three
  outcomes, not two — clean, partial (scope stated), retired (stop and re-pick) — and only the
  middle one needs the extra sentence in §8's header.

- **A conformance pass that comes back mostly clean is where the remaining findings are the
  ENFORCEMENT halves, and they are predictable enough to look for by name.** `guided-tours`
  scored 1068 here, the strongest map entry of the sweep. Four of its six techniques were
  conformant and several impressively so — the never-strand invariant held *by construction*
  because the product chose a non-blocking ring over a dimming veil. Both findings were the same
  shape: the subject asks for a MECHANISM (anchor-contracts wants a manifest extracted from the
  source plus a gate; overlay-precedence wants the tour registered into the product's band scale)
  and the repo had the intention without the mechanism — one anchor declared and never stamped,
  one z-index sitting above the modal band. **When a context reads as broadly conformant, stop
  auditing the behaviour and go straight to each technique's enforcement clause: "and a gate
  that…", "registered into…". That is where a well-built surface's remaining defects live.**

- **A prose guarantee of non-drift, in a repo where both halves of the contract are visible, is a
  reliable marker for an unenforced contract.** The constant said "one shared constant so the
  model and the DOM can't drift"; five of six were stamped and the sixth had pointed at nothing
  for as long as it existed. The same sentence pattern produced findings in three earlier rounds
  of this sweep (`scheduleLabel`'s "every schedule select renders options through this",
  `lib/site`'s "single-sourced so the shell can't drift", `LIBRARY_ROOTS`' "MUST track repo
  layout"). Filed as a registry lead, but it is a sweep heuristic too: **grep the codebase for
  claims of the form "so X can't drift" and check each one — it costs one grep and it has hit
  four times out of four.**

- **I cited commit shas in the outbox before the commits existed.** Two nodes and a registry lead
  carried guessed handles; the real shas differed. Nobody would have noticed until someone tried
  to follow one. §9's emit step runs after the builds, so the shas are always available — the
  mistake was writing the emit script from the plan rather than from `git log`. **Worth a line in
  §9: every sha in the outbox must be read back from git, never transcribed from intent.**

- Yield: 2 findings / 23 lens-passes = 0.09 per pass — the lowest of the sweep, and the honest
  reading is not that the pass was thin but that this is the most conformant subsystem it has
  met, measured against the strongest-matched subject it has had. Both findings were built, both
  gated against the product source, and both fail-befores reproduced the original defect by name.

## 2.8.0 - 2026-08-29 - systedo-case
- A cross-context "moonshot" round (develop strategy, two lenses, L+ only, ALL groups) does not fit the one-context-per-round loop: it was run as a per-group read-only subagent fan-out returning §4.10 cards, consolidated by the coordinator, then triaged one card at a time. Convergence across independent scouts (4 groups → the same spine, 5 → the same benchmark) turned out to be the strongest ranking signal and should be a first-class field on the card.
- An operator-named lens that is absent from references/lenses.md (here `moonshot-architect`) must be run as ad-hoc and labelled so in the header and snapshot; the coverage ledger must not count it as a registered lens pass.
### Redesign proposal
- Add an explicit `--groups all|<name>` + `--min-effort L` fan-out mode with a "corroborated-by" count in the emitted finding, so a portfolio-level develop round has a supported shape instead of an improvised one.

## 2.8.0 - 2026-08-29 - ascent
- Same moonshot shape as the systedo-case entry above, run the same day on a 54-context map: 11 group scouts → 45 L/XL cards → 37 deck items → 37 in-terminal decisions. Corroboration held again as the top ranking signal (4 scouts → the open corpus, 3 → the control-event ledger).
- **A background subagent's `.output` transcript file can be EMPTY after it completes** — 9 of 11 here were 0 bytes; the result existed only in the completion notification. In a fan-out, write each result to the scratchpad the moment its notification arrives (decode `&amp;`/`&lt;` HTML entities — the notification escapes them), or a context compaction erases the round's evidence. Never plan to "collect the transcripts at the end".
- The outbox's 30-findings-per-pass cap and a 37-decision deck do not fit: the durable record of a triaged moonshot round belongs in the repo's backlog doc (a decision table with contexts, size, gate, decision), with the outbox carrying the top-30 bodies. A deferred decision that lives only in an undrained outbox is a decision that will be re-proposed.
## 2.7.0 - 2026-08-29 - gravitone-gcloud

- **§2 loads the backlog digest but not the OUTBOX HEADROOM, and the outbox is
  the harder cap.** This repo's `.personas/memory-outbox.jsonl` was at 188 lines
  / 28 finding lines when the round began, against a documented ingest cap of 200
  lines and 30 findings. So the round had room for exactly TWO findings before it
  read a line of code, and no amount of good work could change that - the app
  drains the file on ingest and there is no bridge route that does (four
  candidates probed, all 404). Five findings were built and five backlogged;
  three of the five could not be recorded at all. The four rounds before this one
  each noted "outbox near cap" or "at cap" in their snapshot notes and each
  dropped findings the same way, while the coverage ledger recorded every context
  as swept. §9 handles this as a reporting footnote ("say which findings did not
  fit"), which is the right instruction at the wrong TIME: by then the analysis is
  paid for. **§2 should count the outbox's lines and finding lines alongside the
  digest, and a round that opens with fewer than ~4 finding lines of headroom
  should tell the operator BEFORE it scans**, because draining it is a ten-second
  UI action and the alternative is a round whose findings exist only in a
  transcript.

- **Some claims are witnessable by neither rung, and naming that is what selects
  the source ratchet.** A React external store read through `useSyncExternalStore`
  cannot be exercised by a Node probe lane with no DOM, and this repo's live lane
  explicitly refuses "claims about a module". The reflex is to call it ungateable
  and reach for veto 3. But the thing that actually decays is not the behaviour -
  it is the WIRING, and wiring is source-shaped: a fourth store added later and
  never joined to the surface's clear. Deriving the population off the filesystem
  turned an ungateable behaviour into a gateable invariant, and the failure message
  became the design question ("decide whether Clear must reset it") rather than an
  assertion. Worth stating as a move: before accepting veto 3, ask whether the
  DURABLE half of the claim is structural even when the dynamic half is not.

- **§7.6's "seed a violation" earns its keep on the ratchet half, not the direct
  half.** Both probes written this round were seeded. The direct assertions failed
  exactly as expected and taught nothing. The seeds that mattered were the ones
  that separated cases: drifting the opt-in id set by ONE card turned exactly one
  of six cases red and left the other five green, which is what proved the cases
  test different things rather than the same thing six ways. A probe suite that
  goes all-red under every seed is one assertion wearing six names.

- Yield: 10 findings / 23 lens-passes = 0.43 per pass. Five built. The two highest
  came from tracing a DOCUMENTED CLAIM to the code that was supposed to honour it
  ("a reload starts clean, which is what lib/jobs already tells the user happened"
  - it does not, for the only case a user meets) rather than from a defect shape.
  §4.6's pair-hunting names "a doc's stated rule vs the code" last in its list; on
  a codebase this heavily commented it should be first.

## 2.7.0 - 2026-08-29 - gravitone-gcloud (8-context loop to full 23/23 coverage)

- **One shape produced six of the eight builds, and §4.6 lists it last.** Across
  eight contexts of a heavily-swept repo, the highest-value finding was almost
  never a defect shape. It was A RULE THAT EXISTS AND IS NOT REACHED, in four
  sub-shapes: **computed and discarded** (`applyEdits` returned `chainBreaks`,
  detected them, explained them in a five-case probe — and `recalibrateFromPlan`
  dropped the field one line later, so the finding reached a test and nobody
  else); **parsed and discarded** (`EditPlan.unchanged`, required by the schema
  the model must satisfy, given no `description` unlike every sibling field, and
  read by nothing); **stated and unenforced** (`tokens.ts` described the grep
  that rechecks its own colour rule and nothing ran it; `FactSource` was created
  because "a rule with no field to live in is a comment" and then no surface
  drew it); and **fixed on one path, not its sibling** (google's `generate`
  carried a reference role map from the day it was written and `edit` — the
  heterogeneous call — did not; `ConfirmDelete` closed on the write's answer and
  the create/edit dialog twenty lines up did not). §4.6 already names the last
  of these and lists "a doc's stated rule vs the code" fifth. On any codebase
  disciplined enough to write its rules down, that clause should LEAD, and it
  should be widened from documents to any rule with no reader: **grep the
  producer of a rule for its consumers before reading the code around it.**

- **A pure-function probe passes against a caller that ignores the function, so
  the wiring is its own case.** Twice this round the assertion that mattered was
  not the rule but its use. Four cases over `buildEditPrompt` all pass against an
  adapter that builds its own text; five cases over `applyEdits` all pass while
  the result is thrown away — demonstrated by seeding the regression and watching
  the sibling probe stay entirely green. When a fix adds or moves a pure rule,
  add one case asserting the call site reaches it, on stripped source. It is six
  lines and it is the only case that fails for the original defect.

### Redesign proposal (not applied)
  §7.6 says "seed a violation to prove the gate still bites" and stops one step
  short. **A seed that silently fails to apply produces a gate that did not fire,
  which is byte-identical to a gate that is broken** — and it happened here: a
  `perl -0pi` seed against the trailer checker's exhaustiveness guard did not
  match, tsc stayed green, and the reasonable reading was "the compile-time
  device does not work". Re-run with the edit asserted first, it failed with
  TS2322 exactly as designed. Every later seed this session asserted its anchor
  before writing and printed SEED APPLIED. The clause should require it: seed,
  ASSERT THE SEED LANDED, then read the gate.

- Yield: 30 findings / 8 rounds, 9 built, 21 reported. 346 -> 374 probes. Note
  the distribution against a repo already swept twice over: the four contexts
  with dedicated regression harnesses yielded 1 build each, and every one of
  those came from the registry rather than from the code — the harness had made
  the code's own defects scarce, and only an outside standard still had
  something to say about it.

## 2.7.0 - 2026-08-30 - gravitone-gcloud (subagent wave, worktree isolation)

- **A worktree-isolated subagent may be branched from a STALE ref, and it will
  report gate numbers that look fine in isolation.** Four agents were dispatched
  with `isolation: worktree` from a session whose HEAD was 15 commits past the
  session's own start. THREE of the four worktrees were created at the START
  commit, not at HEAD — and two of those three *stated the correct base in their
  final report* while having actually worked on the old one. The tell was not the
  claim; it was the numbers: `346 passed / 325 files` and `348 passed / 326 files`
  against a tree that was at `374 / 333`. A subagent's "all gates green" is a
  truthful statement about the tree it was standing in, and says nothing about
  yours.

  Two consequences beyond the merge. First, the briefs went stale with the base:
  one agent was told to import a component and read a probe that had been written
  *this session* and did not exist in its worktree. (That agent was the only one
  of four that noticed, fast-forwarded itself to the stated base, and produced
  the one report whose numbers were right.) Second, an agent editing a file the
  parent had also edited was working from the pre-edit version, so the merge —
  not the agent — was the only thing standing between the parent's change and
  silent loss.

  **So: before dispatching, capture HEAD; on every return, verify
  `git -C <worktree> merge-base HEAD main` equals it, and re-run the full chain on
  the MERGED tree.** Four independently-green worktrees are not one green tree,
  and the per-worktree number is the one a reader will believe.

- **Cherry-pick, do not merge, when the parent has a dirty working tree it does
  not own.** One target file carried three uncommitted lines from a concurrent
  session. `git merge` refuses to touch a dirty path, and the tempting fixes
  (stash, checkout) both risk another session's work. What held: save that file's
  diff as a patch, restore the file, cherry-pick, re-apply the patch, then assert
  BOTH changes are present and the file is dirty again exactly as it was.

- Yield: 5 approved findings, 4 agents, 4 commits, 0 conflicts on merge, 380
  probes green on the merged tree (up from 374). The write sets were grouped by
  FILE rather than by context to make that true — two findings that both wanted
  `CardTile.tsx` went to one agent rather than two, which is the only reason there
  was nothing to resolve.

## 2.8.0 - 2026-09-01 - pof (harness-autonomy, --develop --one, first sweep, eval run)

- **`| grep` on a gate is the same defeat as `| tail`, and §7.2 lists only `tail`.** I ran
  `npx vitest run ... | grep -E "Tests |×" && git commit` and the commit landed on a red suite:
  grep matched the failure line, exited 0, and the chain proceeded. Caught only because the
  transcript showed the two `×` lines above the sha. Recovered with `reset --soft` (own branch,
  unpushed) and re-ran with the gate's stdout redirected to a file and its own status on the
  chain. Suggested wording for §7.2: *any* pipe on the gate takes the last command's status -
  redirect to a file, grep the file afterwards.
- **A scripted edit through `node - <<'EOF'` mangled a template literal three times in one
  round** (`$${x}` arrived as `${x}` and dropped the dollar signs from user-visible copy; a regex
  anchor with `\.` never matched; a heredoc with a stray quote failed to parse). §7.6 says use
  the file-writing tool for anything with a backslash - the dollar-in-template case is a fourth
  shape, and the safe form that held was writing the script to the scratchpad with the file tool
  and running `node <file>`. Also: files in this repo are CRLF, so a script that anchors on `\n`
  must normalize on read and restore on write, or its anchors miss silently.
- **Subagents were unavailable (concurrent-agent limit hit by the sibling run) and the sweep
  completed without them.** For a `--one` round the skill prescribes none anyway; recording that
  the full 23-lens pass over ~15k lines (72 files) was read by one session in ~4 h wall time.
- **The registry-map homonym band held again**: harness-autonomy's top joins were
  `test-harness` (409) and `eval-harness` (394); the governing subject `unattended-build-loop`
  ranked fifth at 265. The two subjects that actually fed the lenses produced 3 of 12 builds
  (gate coverage agenda, overshoot width, visual-gate self-certification) - the read side
  changed the findings, not just the wording, exactly as the 2026-08-29 ascent entry said.
- Yield: 23 candidates / 23 lens-passes = 1.0 per pass (20 within the `--one` budget), 12 built,
  8 backlogged, 1 rejected `not-better`, 2 over-budget candidates unrecorded. The highest-value
  builds were pairs: a route that computed `checkpoints` for a panel that read none of it, a
  guide renderer with two verdict words beside a summary renderer with three, and a `visual`
  gate branch still self-certifying under a header comment that said no gate does.

## 2.8.0 - 2026-09-01 - pof (Fable vs Opus bake-off, --develop --one harness-autonomy)
- Same context, both runs applied all 23 lenses: Fable 23 candidates / 12 built, Opus 26 / 6 built. Shared fixes: the visual gate self-pass and the phantom-catch 400. Only Opus found the self-heal re-verify running `exec` at Node's 1 MB `maxBuffer` against the gate's 10 MB (ENOBUFS turns a landed repair into a fresh failure) and the replayed `AGENTS.md` learnings spliced as bare instruction into a `--dangerously-skip-permissions` session. Only Fable shipped the durable-sidecar status GET and the run-end verdict tally. Both merged.
- The `--one` budget of 20 is below what a 23-lens package can produce (tier caps admit 46). Record the true count and `degraded: true`; never trim finished analysis to fit.
- §5 has no state for "approved and not built"; a `carry` disposition would make the next round build carries before finding anything new.
- Load `.ai/applied.jsonl` in §2: it is this repo's experiment log against the registry, with a `next_change` field. One run presented an owed item as a discovery until write-up.
- The seed's landing check is itself a source-scanning matcher: anchor it on the changed line or an inserted `SEEDED_` token, never on the rule's vocabulary, which the explaining comment satisfies.
- Two exhaustiveness claims over hand-written lists where the omitted member was the broken one (gate-honesty 6 of 10 gate types; cli-parity 2 of 4 surfaces). Derive the population from the type.
- Third sighting: reorder §4.6 so "a documented or computed rule with no reader" leads; four of six Opus builds and most of Fable's came from that shape, none from a defect-shape grep.
## 2.8.0 - 2026-09-01 - politicas
- Third moonshot-shaped run (10 group scouts → 47 L/XL cards → 9 themes). Corroboration held as the top signal a third time (5 scouts → as-of re-derivation from the bitemporal store; 5 → a claim address on every figure; 5 → one review door for every claim kind). Every scout wrote its deck to a scratchpad file BEFORE returning, so the 0-byte-transcript hazard from the ascent run never bit; keep that as the fan-out's contract.
- **Ranking lexicographically by (corroboration, impact) mis-ordered the outbox cut.** With a 29-body cap, a 4-scout impact-6 card (a sitemap) went into the outbox while a 2-scout impact-9 card (the vote→bill spine that three other cards depend on) did not. Corroboration should WEIGHT the rank, not dominate it - e.g. `impact * (1 + 0.25 * (corroboration - 1))` - and dependency edges between cards (card B "lands after" card A) should lift the prerequisite, because the deck's most valuable item may be the least-glamorous one everything else waits on.
- An ad-hoc lens needs a place in the snapshot that the coverage picker will not misread: `scope: "moonshot:all-groups"` + `lens_keys: []` left `coverage.mjs --next` unchanged (verified), which is the property to keep.

## 2.8.0 - 2026-09-01 - pumper
- Third run of the moonshot shape, this time UNATTENDED (no operator in the terminal): 8 group scouts -> 44 cards -> 37 deck items in ~10 minutes wall-clock, ~2.6M subagent tokens (240k-420k per scout; the largest read the whole core crate). With nobody to triage, the round's product is the ranked table with an empty `Decision` column in the repo doc, plus a backlog pointer and a MEMORY line saying "read this as the never-re-propose list". A moonshot round without a decision column is a round that will be re-run from scratch.
- Corroboration was computed mechanically (head + merged + related cards per spine, counted by distinct scout) and used as the FIRST sort key; the top three (WASM apps v2, transact v2, mesh) each drew four of eight scouts. Two scouts independently wrote near-identical transact-v2 cards from opposite ends of the stack (engine trait vs app), which is the strongest form the signal takes - a spine reachable from both sides.
- Every scout's result file landed on disk this time (the brief asked for a Write AND a return); zero transcripts had to be recovered from notifications.

## 2.8.0 - 2026-09-01 - lighttrack (moonshot-architect, 8 groups, 34 contexts)

- Third moonshot-shaped run (after systedo-case and ascent): 8 read-only group scouts → 41 L/XL cards → 30 deck items, 11 folded by spine. Corroboration held as the top ranking signal for the third time: 6 scouts independently hit the same class (a `Store` method the production Postgres backend silently inherits as `Unsupported`) as the thing capping their group; 2-scout agreement on four more spines (rollup primitive, alert ledger, one Claude spawn door, typed job queue). A `spine:` field on the card - "2-5 words naming the platform capability, pick the most general honest phrase" - is what made the fold mechanical; the redesign proposal from 2.8.0 systedo-case ("corroborated-by as a first-class field") is confirmed by a third run and should land.
- **A session-wide API rate limit kills background scouts silently and unevenly.** 3 of 8 scouts died with HTTP 429 / auth errors within the first minute, 5 survived. The notification arrives as a task failure; relaunching after the reset worked with no change to the brief. Write each surviving result to the scratchpad the moment it arrives (already the rule) AND check `ListAgents` before relaunching - the five survivors were still running and a blanket relaunch would have doubled cost.
- **§6's "take the subject's `file` verbatim from `.ai/registry-map.json`" does not match the current map shape.** Two scouts (Device Relay, Platform) reported `subjectIndex` maps slug → context ids, not files, and located subjects by walking `knowledge/<bundle>/.../<slug>/<slug>.md`. Either the map generator dropped the `file` field or §6 describes an older schema; either way the clause should say "if the index carries no path, resolve through `knowledge/<domain>/index.json`" as its first fallback rather than its second.
- Yield: 41 cards / 8 scouts = 5.1 per group, all L+, plus ~55 incidental S/M defects handed to the stabilize loop (the deck note lists the deduplicated top 20). Cost: ~2.1M subagent tokens for 8 scouts (130k-460k each; the Evaluation & Benchmarking and Platform groups with 7-8 contexts cost 3× the 1-2 context groups). Budget fan-outs by context count per group, not by group count.
- **Under a concurrent session, `git add <path>` + `git commit` is not per-file staging.** The round's first commit reached the hook carrying three files another session had staged in the shared index; only the repo's doc-sync hook (which asked for the docs those files owed) refused it. §7's parallel rules say "stage with explicit pathspecs" and "confirm the staged list" — the confirmation is necessary but the fix is `git commit --only <paths>`, which builds a temporary index from exactly those paths and runs the hooks against it. Worth a sentence in §7.
- **Check the outbox's FINDING count, not just its line count, before the round.** The moonshot round filled 29 of the 30 finding slots and a pre-existing finding took the last; this round's one backlog finding had nowhere to go and was routed to the repo's architect backlog. §2 names the digest; the two caps (200 lines / 30 findings) deserve the same pre-read, because a full finding cap silently turns "backlogged" into "unrecorded".
- **A probe over a store copy is the instrument for gate-precision claims.** The language-gate finding could be argued from three invented sentences; it was decided by running current-vs-patched over 1 966 reader-facing strings from a copy of the pass-74 store (13 → 9 withheld, 0 new English shown), and the middle variant (shape hits decide alone only from three) came from that run, not from taste. Two traps on the way: Git Bash rewrites robocopy's `/E` into a drive path (use PowerShell for robocopy), and a probe run from a scratch directory outside the repo cannot resolve `node_modules` — copy the probe into a throwaway dir inside the repo and delete it.

## 2.8.0 - 2026-09-02 - kp (moonshot-architect, 17 groups, 143 contexts)

- Fourth moonshot-shaped run: 17 read-only group scouts -> 85 L/XL cards -> 39 spines -> 30 outbox bodies + a BACKLOG decision table with an empty Decision column (unattended). Every scout wrote its result file before returning; 0 transcripts had to be recovered. Cost ~4.7M subagent tokens (186k-352k per scout); the 13-14 context groups cost ~2x the 3-5 context groups, confirming "budget by context count".
- **Corroboration of a PATTERN is not corroboration of a BUILD, and the rank formula cannot tell them apart.** Five scouts each proposed an append-only ledger for a different plane (stage transitions, identity audit, requisition lifecycle, ops events, scheduling outcomes). Folded on the shared shape they ranked #1 with corr=5 above spines that four scouts hit from opposite ends of ONE substrate (a durable job runtime). The fold criterion should be "would one build close all member cards" - if not, record the pattern as a note and rank the members individually. Annotated by hand this run; the formula should carry a `same_build` flag.
- A skill linked into `.claude/skills/` mid-session is not invocable through the Skill tool (the listing is loaded at session start); reading SKILL.md and following it by hand works, and the report should say so. The link itself was missing because the registry's `projects.json` did not declare this machine's checkout of the project - after a pull that replaces an in-repo skill copy with a registry link, check the fleet declaration before concluding the skill was deleted.
- kp keeps dated scan evidence out of the public tree by policy (`/docs/harness/` gitignored, durable outcome in `docs/BACKLOG.md`). The moonshot deck split cleanly along that line: full bodies local, decision table tracked, top-30 in the outbox. A consuming repo's evidence policy should be read before choosing the deck's home.

## 2.8.0 - 2026-09-02 - lighttrack (moonshot deck -> six build waves, 24 items, 24 merges)

- **The moonshot deck's L/XL items were buildable in waves of five by disjoint write set, and the merge cost was dominated by ONE file class: shared append-only tables.** `Store` trait, the capability manifest table, the route-scope table, the conformance driver/refusals, and the DDL tails conflicted on nearly every merge, always as additive-vs-additive hunks. Union resolution with a mechanical rule ("head + close the brace/tuple the shared tail was supplying + theirs") resolved ~60 hunks across 24 merges with two mistakes, both caught by the compiler. Telling builders "append your block at the END, never reformat" is what made the hunks unionable; a builder that reflowed an import list would have cost a manual merge every time.
- **Worktree subagents branched from a stale ref every single time (24/24).** Each reported HEAD at the session's start commit and fast-forwarded on instruction. The brief's first line must be the base sha + the `merge --ff-only` recipe, and the report must state the base worked on; without that the 2026-08-30 gravitone lesson repeats silently.
- **A session-wide rate limit kills builders mid-commit-series, and `SendMessage` to the same agent id resumes them with full context.** 3 of 5 wave-C builders died with partial commits + uncommitted edits; one resume message each ("here is what your worktree contains, finish and report") completed all three. Do not relaunch: the relaunch loses the worktree's uncommitted work and repeats the paid work.
- **Cross-builder struct-literal gaps are the residual merge cost the compiler owns.** Every wave produced 1-3 `missing field` errors in another builder's test fixtures (a new `Project`/`RevenueEvent`/`Score` field). Budget one compile-fix loop per merge; a `#[serde(default)]` on the new field does not help a struct literal.
- **The one merge that needed a builder, not a union, was a signature sweep (M17) landing on top of a same-wave feature (M24) that added methods in the old shape.** Handing "adapt M24 to M17's convention and finish the merge in the main tree" to a single agent (130k tokens) beat doing it by hand across six crates. Rule: when a wave contains a cross-cutting signature change, run it alone or after, and name in the other builders' briefs the exact parameter shape the coordinator will convert.
- **Builders' "gates all green" was true 24/24 for the tree they stood in, and the merged tree still failed 6 times** (locked `.exe`, cfg(test) dropped by a union, tuple close missing, fixture fields, a doc guard needing an entry, a CI gate table needing a row). Every one was found by re-running the FULL sweep on the merged tree before committing the merge; the sweep is not optional and it is cheap relative to a builder.
- Cost: ~7.6M subagent tokens for 24 builders (130k-510k each; ~320k median) + ~1.5M for scouts + 1 merge-finisher, over ~14 wall-clock hours including two rate-limit pauses. The coordinator's own context stayed under 1.2M by writing every scout/builder result to the scratchpad or vault on arrival and never reading transcripts.

## 2.9.0 - 2026-09-04 - pumper (api-surface, --develop, 20 lenses, 4 built / 9 backlogged / 1 rejected)

- **A "silently dropped on parse failure" finding must verify the parser's rejection predicate before it is built, not just the drop.** A CORS finding here ("an unparseable `cors_allowed_origins` entry is dropped by `.ok()`, and if it is the only entry the router silently takes the no-CORS path") was correct about the code and wrong about reachability: `http::HeaderValue`'s validator is `b >= 32 && b != 127 || b == b'\t'`, so it accepts spaces, smart quotes and every non-ASCII byte. Nothing an operator can type into a TOML string fails it, so the whole path was unreachable and the fix was pure churn. Written, tested, then reverted at §7.4 — three tests going red was what surfaced it. The generalization: for any finding of the shape *"X is discarded when it fails to Y"*, the Before figure is **what Y actually rejects**, and it must be taken from the library rather than assumed from the type's name.
- **The highest-yield finding class in a mature repo was a gate whose SCAN SURFACE had quietly stopped matching its claim** — twice in one round, both built, both fail-before-proven. One scanned a hand-listed `["routes", "mcp"]` and so never saw the auth middleware that produces the very refusals it polices; the other truncated each file at its first `#[cfg(test)]` on a written claim ("checked: no route file defines a function after its first one") that was false for three files, leaving ~2,750 lines unpoliced. §4.7 says to ask what enumerates the ground truth; the sharper question for a source-scanning gate is **"which files did this scan actually open, and does it say so?"** — a gate that returns the covered set, and a test that asserts a known-hard file is in it, converts the whole class from invisible to impossible.
- **A guard added near the top of a file can silently shrink another guard's coverage of that same file, in the same session.** Adding a small `#[cfg(test)]` module above the handlers cut the truncating lock-guard's view of that file from 52% to 4%, and nothing went red. When a round adds a test module, re-check the repo's existing source-scanning gates against the file it landed in.
- Practical note for any repo whose OpenAPI is generated from doc comments: a handler's doc comment is contract text, and re-wording one during an unrelated fix fails the spec-snapshot test and would restage every generated client. Filed as a registry lead rather than a method rule.
## 2.9.0 - 2026-09-04 - ascent (fleet-alerts-digests + members-access-control, 2 rounds)

- **A source-scanning gate is defeated by the prose that documents it, and this is the opposite failure from the one the method already warns about.** §7.7 says to strip comments so a file that TALKS about a rule cannot satisfy a check for it - written from a false-positive framing ("a probe passed against a deliberately broken subject"). The case here is the durable one: a repo whose house style is to explain each rule beside the code obeying it will, over time, accumulate gates that match the explanation. `id-routes-gated.test.ts` ran `src.includes(gateName)` over raw text; deleting the import AND both call sites from a route while leaving the three comment lines naming them kept the suite 21/21 green - a route with authorization entirely removed read as compliant. **The gate is most reliably blind exactly where the convention is best documented**, so comment density, which §4.6 already flags as hiding unfixed twins, also hides dead gates. Filed as a registry lead; `gate-liveness` and `vacuous-by-evaluation` cover the seeding half, nothing covered this direction.
- **The eight-lens stabilize deep tier was missing whole classes, and the yield clause could not see it** because §4.9 only asks whether a TIER reported nothing - not whether any lens in the package was looking for the defect at all. Five of the ten defects across both rounds were one rule with two implementations where only one was fixed (§4.6's pairs), which no lens owned; two were a swallowed error and a record the failure path skipped, which no lens owned; two were product copy asserting a removed mechanism, which `ux-reviewer` does not own (it owns flow). Added `parity-auditor`, `observability-auditor`, `visual-craft`, `state-coverage`, `copy-auditor` in 2.10.0 and raised the budget 12 -> 16, because §4.4's own rule (the budget must absorb the package) applies to the package the skill SHIPS, not only to one an operator narrows.
- **`references/lenses.md` carried a trailer claiming it was generated, and nothing in the registry generates it.** The generator is in a different repo (personas' `scan-agents-to-skills.mjs` reading `scan_agents.toml`) and writes into that repo's tree. A provenance line naming a build step that cannot run here is the same class of defect as a stale doc: the next editor either hunts for a source that will not be found, or edits by hand while believing the change is about to be overwritten. Corrected to say which file is the source and that adding a lens does not reach the Personas app's own scanner.
- **Never author a `\n` through a shell heredoc.** §7.6 already forbids backslashes there for regexes; the same escape eats `"\n"` inside ordinary code and arrives as a real line break, producing a transform error rather than a silent one - three times in one round. It is louder than the regex case and costs the same fix: use the file-writing tool, or `chr(92)+"n"`, for any string containing a backslash escape.
- **Two ratchets in one repo disagreed about which one owns a warning.** The consuming repo's overlay names `eslint --max-warnings=0` as a gate, and two files in the swept contexts carry pre-existing unused-var warnings that predate the round. Under §7.2 that gate cannot pass on those files at all, and treating it as red would have blocked correct fixes. Resolution used: assert 0 ERRORS on touched files, confirm the warning is pre-existing with `git show HEAD:<file> | eslint --stdin`, and say so in the report. Worth a method line - a gate the repo cannot currently pass on a given file is a gate whose scope must be narrowed explicitly, not one to be silently reinterpreted.

## 2.9.0 - 2026-09-04 - kp (llm-adapters-and-llm-registry, first sweep)

- **A checkout with an unconcluded merge cannot take an atomic commit at all, and the failure arrives only when you try to land the first fix.** `git commit -- <pathspec>` answers `fatal: cannot do a partial commit during a merge`; there is no pathspec form that works, and the only ways forward are to conclude someone else's merge (1876 staged files, under your commit message) or not to commit. §7's parallel-session rules cover STAGING and §7.2 covers VERIFICATION under a concurrent session; neither covers the state where committing is structurally impossible. Check `.git/MERGE_HEAD` in §1 alongside the context pick - it costs one `ls` and it changes the round's whole shape. If it exists, the honest round is: build ONE fix, verify it, leave it in the tree, declare degraded, and backlog everything else with measurements rather than stacking several findings' edits into one unlandable working state.
- **A `--stabilize` round on a heavily-swept-looking module still yields, because the pairs shape survives good comments.** This context is exceptionally well commented - most defect-shaped greps returned nothing - and the three real findings all came from §4.6: two implementations of one rule where only one was fixed (`gemini.py` models `finish_reason`/`truncated`, the shared adapter layer that replaced it does not; `_resolved_endpoint` routes through the memoized `.env` seam, its sibling `_resolved_api_version` does not; `useCases` fails loud, `keys` silently drops). Comment density is not coverage: the prose describing a fix is exactly what makes the UNfixed twin invisible.
- **`observed.issubset(declared)` between two hand-typed literals is the coverage-theater tell, and it reads as a real test.** §4.7 says to ask what enumerates the ground truth; here the answer was an AST walk over the modules that answer `availability()`, ~20 lines, and it changed a subset assertion between two literals into an equality assertion against the source. The seeded-violation step (§7.6) is what proved it - the original passed with a reason no adapter returns AND with an adapter returning a reason nobody declared.

## 2.10.0 - 2026-09-04 - registry (design review against /intake v2.5; redesign applied as 3.0.0)

- **Under `--develop` and `--optimize`, v2.x had no auto-build path at all, and the routing table hid it.** §5 sent every `unmeasurable` and every contract/policy change to a human, and those two strategies' deep tiers produce almost nothing else: a new capability was `unmeasurable` because it was new, a hardening was `unmeasurable` because "cleaner" has no figure. The 2026-08-29 retrospective already held the number - 21 of 46 `uncertain` items resolved to `unmeasurable` and zero to `better` - and the 2026-09-01 pof `--develop` round backlogged 8 of 20 for the same reason. The operator's ask was the fix: the method must TRY to measure before it may write `unmeasurable`, and the human gate is for architecture, direction, irreversibility and loosened policy only.
- **/intake solved the same problem one step earlier and the shape ports directly.** Its v2.5 admission gate replaced "which should I verify?" with a veto-first score after the ledger showed 134 of 149 human gates changed nothing; its Phase 7.5 makes an apply/A-B step mandatory with a mode ladder (`code` > `experiment` > `simulation` > `task`) and the rule "take the highest reachable mode and say why not the one above"; its Phase 5 keeps exactly four escalations (direction, taxonomy, law, XL) and a standing ship authorization for everything else; and its `fp` counter moves the accept threshold on evidence. All four landed here: §4.11 ladder (`gate` > `probe` > `experiment` > `simulation`), four escalations (`direction`, `architecture`, `irreversible`, `policy-loosen`) replacing the three hard gates, `contract` turned into a four-letter checklist that auto-accepts when it holds, and `auto=`/`fp=` in the snapshot with `coverage.mjs --next` printing `strict:` when three fps accumulate in five rounds.
- **The one rule that turns the ladder into a method: build the instrument when it is S.** A twenty-line test or counter is the difference between a human decision and a machine one, and the kp 2026-08-29 round had already recorded that two of three `unmeasurable` results were avoidable that way. Written into §4.11 and veto 3 ("no gate that can verify it AND none can be built at S").
- **Policy needed splitting, not softening.** Tightening a check is a change a reviewer only ever approves, so a test pinning it is the review; loosening one belongs to the data's owner. The v2.x `policy` gate treated both alike and sent an added audit row to the deck beside a removed auth check.
- **`carry` landed** (proposed 2026-09-01 pof): approved-and-unbuilt is a disposition the next round builds first, and `coverage.mjs` shows it as a column and on the pick line. Verified with a synthetic two-context history: strict fires at fp=3 with one trailing clean round, stays off at fp=0, and the carried count is read from the LATEST snapshot only.
- Not done, owed to the first real round under 3.0: a measured `auto=`/`fp=` pair on a `--develop` context to see whether the test-first figure actually produces `better` cards or whether executors demote them at the same ~7% as stabilize's; and whether `direction` is decidable from a context map entry alone on repos whose manifest carries no `scope` block (the fleet map says most do not).

## 3.0.0 - 2026-09-04 - gravitone-gcloud
- **A gate that resolves its input from its own location has no fixture seam, and the before-figure still comes free.** Seed the real input, run `git show HEAD:<script>` from a scratch path under that seed for the red-BEFORE, run the edited script for the green-AFTER, revert. One seed, both figures, no override needed - and the missing override is itself a test-strategist finding worth backlogging (measured: 3 gates, 0 probes, 3 hand seeds in one round).
- **The lens catalogue is live under a linked skill.** `coverage.mjs` printed `/23` on the pick line and `references/lenses.md` held 28 headings by emit time, because the registry checkout moved during the session. Take `lens_keys` from the file at emit time, never from the pick line, or the ledger under-records the tail that was actually run.
- **A hand-maintained detector list is the highest-yield pair on a gate script.** Asserting each bundle fingerprint present at source (comments stripped) before asserting it absent from output found a dead key on its first run - a literal that only ever existed in a comment. Filed as a registry lead; it generalises to every grep-shaped gate.

## 3.0.0 - 2026-09-04 - personas
- **Grep the catalog by English VALUE before proposing any i18n key.** In one 34-file context, 36 hardcoded literals split 21 : 15 — the 21 already had a translated key and wired as one S commit with zero translation cost; the 15 without one are blocked by the repo's all-locales pre-commit gate and belong to a translation workflow, not a sweep. The lint rule for hardcoded JSX text reported 0 on those files, so lint silence said nothing; the value-grep did.
- **A "renders nothing" primitive is a finding class, not a lint smell.** The repo's `LoadingSpinner` is a null shim; every `busy ? <Spinner/> : <Icon/>` and every status-icon `default:` branch that reached it was a vanishing glyph. Grep the shim's importers inside the context once and you get the whole class (12 sites here) with one read.
- **Animation hooks that accept "a number or a motion value" attach once.** A poll-driven gauge fed `useSpring(number)` froze at the first value and only a red/green render test proved it; the fix is `.set()` in an effect. Filed as a registry lead; the same shape exists in any follow-value API.

## 3.0.1 - 2026-09-05 - gravitone-gcloud
- **§7.2's pipe warning did not stop the pipe.** `npm test 2>&1 | tail -2 && git commit` landed a commit over a red suite minutes after the clause was read. What held for the next nine commits: `npm test > log 2>&1; S=$?; grep summary log; test $S -eq 0 && git add <paths> && git commit` — the redirect keeps the status the command's own and the summary still reaches the transcript. §7.2 should prescribe that shape verbatim rather than only naming the trap; a session recognises a recipe faster than a warning.
- **Measure the platform code before you key a classifier on it.** cmd.exe's "9009 for a name it cannot resolve" is what `%ERRORLEVEL%` shows at a prompt; through Node's `shell: true` the process exits 1 with the sentence on stderr. The first cut of the fix keyed on 9009, was green against its own probe, and would have missed every real case. One measured spawn before writing the mapping; the shell's sentence, not its number, is the signal.
- **A negative-control test for a stranded grandchild waits on `exit`, never `close`.** The orphan inherits the shell's pipes and holds them open, so `close` never fires while the defect is present — the control timed out at 30s and looked like a flake until that was seen. The fixed path can wait on `close` precisely because it only fires once nothing holds the pipes; the two waits are part of the assertion.


## 3.0.1 - 2026-09-05 - gravitone-gcloud (foundry-pipeline)
- **§7.2 silently degrades to nothing in a context whose language the gate suite does not cover, and the round reads as fully verified.** This repo's gates are `typecheck && lint:ratchet && npm test`; the swept context is 965 lines of Python. All three gates were green before and after every one of five commits and could not have gone red for any of them — yet every commit could honestly report "gates: 0/0/0". A degraded round and a clean one produced identical gate lines. §7.2 should require naming which of the touched files the gates actually read: a gate that cannot see the change is a gate that did not pass, exactly as the clause already says about a gate that could not be RUN. The failure mode is worse than an unrun gate because it looks like success.
- **The highest-yield context in a polyglot repo is the one no gate executes, and that is predictable before reading a line.** Five defects in 965 lines, two of them falsifying the README's two headline promises, in a context swept twice before under other strategies. The prior rounds' notes read "module sound" and "clean round earned". The cheap pre-read that would have flagged it: compare the languages the gate suite runs against the languages `git ls-files` finds under the context's paths. Worth a clause in §2 beside the backlog/gates/history loads — it costs one command and it re-ranks the whole picker.
- **When §4.11 says "build the instrument as its own S fix", the constraint to give the instrument is the one that decides its adoptability, not just its correctness.** The selftest here was written stdlib-only on purpose and then VERIFIED stdlib-only by re-running it with every third-party package blocked at `__import__`. That single property is what converts the follow-up card from "add a CI job (advisory, because pip is external)" to "add a CI job (blocking, same input shape as typecheck)" under the repo's own determinism doctrine. An instrument built without asking what would let it become a gate produces a card the operator cannot say yes to cheaply.
- **Three `not-better` rejections came from measuring hypotheses that all "read" like real findings** — a per-scene corpus re-parse (143ms against a 4-hour run), a hardcoded mechanism count that prints an identical string today, a validation-parity gap that would refuse 0 of 27 real catalogue entries. Each would have been a plausible backlog card under a routing rule that asked "does it sound better?". The figures took under five minutes each. This is v3.0's rule working as designed and worth recording as evidence for it.


## 3.0.1 - 2026-09-05 - ascent (Fleet Alerts & Digests)
- **A codebase's own transition notes are the best pair-hunting index §4.6 has.** Mature code records when a mechanism changed - "releaseAuditClaim used to DELETE a claim row; it now appends a `claim.released` record". Each such note names, in prose, the exact moment every OTHER reader of that rule could have silently gone stale, and the note is usually written at the site that WAS updated. Two of this round's seven fixes came from one: a route pre-check that read the audit trail for the claim marker was correct under delete-on-release and became a digest-dropping bug under append-on-release, and the feature doc still gave the delete as a design rationale. §4.6 says grep the shared SYMBOL and diff its call sites; this is cheaper and hits earlier - grep `used to|no longer|now appends|used to be`, and for each hit ask who else reads the rule it describes. On a repo swept several times, the symbol greps were clean and this one was not.
- **The fail-before proof needs the OLD source with the NEW test, and `git stash` gives you neither.** §7.5 and §4.11 both require watching the gate go red before it goes green, and the obvious reach - stash the round's work, run the test - reverts the TEST too, so the run reports "1 skipped" or a spurious pass and the proof is silently void. It also violates the parallel-session rule that forbids stash outright. The shape that works, and that the skill should prescribe where it asks for a fail-before: `cp <file> $TMP/new` -> `git show HEAD:<file> > <file>` -> run the single test by name -> `cp $TMP/new <file>`. One file reverted, the tests untouched, and the red is unambiguous.
- **A "defensive duplicate" and a "parity defect" look identical until you read the callee.** Two candidates this round were the same shape - a guard present at one call site and absent at its twin. One was real (sinkKind classified an unresolved value at two of four sites) and one was not (an unguarded `releaseAuditClaim` next to a `.catch(() => {})` sibling - the function wraps its entire body and cannot throw). The distinguishing read is thirty seconds in the callee, and it is the difference between a fix and churn. Worth naming in §4.6: a pair is only a defect once you have read what the two sites CALL, not just how they call it.

## 3.0.1 - 2026-09-05 - gravitone-gcloud (foundry-ui)
- **§7.6 says to seed a violation and watch the gate bite. Do it PER SURFACE, and treat it as the step that validates the probe rather than a formality.** Two probes written this round looked correct; one was vacuous, and the seeded control is the only thing that revealed it. A probe covering N surfaces needs N independent seedings: the upgraded `cull-keys` probe was only trustworthy once each of its two files had been made to fail alone. §7.6 currently reads as a rule about scripted edits to checkers; it is really a rule about every gate a round writes, and it should say "seed each surface the gate claims to cover, separately".
- **The mechanism §7.6 warns about is not only heredoc escaping — it is the comment stripper every source ratchet carries.** The idiom `.replace(/block/g,"").replace(/line/g,"")` strips blocks FIRST, so a block-open sequence inside a LINE comment opens a real block that runs to the next terminator. In a repo whose prose cites route globs, that hid a contiguous region of 14 of 268 files, up to 80% of one. No existing probe was blinded (checked three); the casualty was the probe being written. §7.7 tells a sweep to strip comments before matching — it should also say HOW, because the obvious two-line implementation is unsound and it is the one everyone writes. A scanner tracking the three quoting forms is ~30 lines.
- **A probe's own parser is a surface that can be defeated by the fix it demands.** Slicing a switch case to its first `break;` is fine until the fix adds a guard clause — `if (guard) break;` IS the first break, so the slice ended before the statement being ordered against and the ordering assertion compared against -1. The fix required brace-matching the case AND asserting the thing being ordered against is still present, or two absences read as correct order. Worth a line in §7.5 beside the contract-test rule: when you strengthen an assertion, check the parser that feeds it still spans what it used to.
- **`--optimize`'s "every hardening claim has a count" worked, and the counts that came back NEGATIVE were the useful ones.** Five hypotheses this round measured to zero — ledger vs style evidence 0 of 27 disagreements, a plan-field guard 0 of 2 plans affected, a validation-parity gap 0 of 27 styles refused, a per-scene corpus re-parse at 143ms against a 4-hour run, a duplicated constant printing an identical string. Each reads as a real finding in prose and each would have been a plausible backlog card under a "does it sound better?" rule. The measurement took under five minutes apiece. The deck the operator triages is better for their absence than it would have been for their presence.

## 3.0.1 - 2026-09-06 - gravitone-gcloud (research-step)
- **§4.6 tells a sweep to hunt PAIRS by grepping a shared symbol. On a well-swept codebase that battery is exhausted, and the instrument that replaced it is the PROSE.** This round's strongest pair candidate — a second run clock in a newer sibling surface — turned out to be a file that explicitly refuses to fork it and cites the original bug. All four fixes came from a different tell: **a docstring making a promise the code does not keep.** A wound function whose comment says "three beats away" and walks one hop; a notice titled with the field name of a count it does not use; a function stating "a dangling id gets REPORTED" with one branch that cannot; a docstring naming its own blind spot and asking, in words, for the ratchet nobody wrote. §4.6 should name this alongside the grep: on a repo whose comments are load-bearing, read the prose as a SPEC and diff it against the code. It is cheap, it needs no hypothesis, and the comment tells you what the correct behaviour is.
- **A stated limit is a finding, and the instrument IS the fix.** Two of four builds changed no source at all — they pinned an assumption the code silently depends on (a graph depth; a detector's documented blind spot). §4.11 already says to build the instrument when it is S-sized and then measure; it frames that as a step toward a fix. Sometimes there is no fix to reach: the code is correct BECAUSE of an unwritten property, and writing the property down as a gate is the whole deliverable. Worth stating in §5 so a round does not discard these as "no change, therefore not-better" — the before/after is *unpinned → pinned*, and the seeded control proves it.
- **Prove a ratchet with a seed that is one ORDINARY line, not an implausible one.** The depth ratchet looked speculative until the seed turned out to be `evidence: ["f-etf-lag"]` on a mechanism — a field the builder already reads, on a card three others already depend on. That single line moved the graph to depth 2 and broke the guard. The seed's plausibility is what separates a guard worth landing from ceremony, and it belongs in the commit message as evidence.
- **The finding budget is not the binding constraint; the OUTBOX LINE budget is.** §9 caps at 200 lines and 30 findings, and a full 28-lens round emits ~36 lines of which ~29 are per-lens coverage nodes. Three rounds fill the file. §9 tells a round to check whether the file was drained and to stop at the cap, but the arithmetic means a sweep loop on any repo hits it on round 3-4 every time, and the drain is a UI action no session can perform. §9 should say to check the LINE count in §2 (before reading code) and, when headroom is under one round, to emit findings plus the round node only and mark the snapshot degraded — rather than discovering it at emit time with the analysis paid for.

## 4.0.0 - 2026-09-06 - gravitone-gcloud
- **Three lanes, not two.** v3.0 had "build in-session" and "human", and measured on a real deck the entire S-sized backlog fell into neither: every S card was `Method: simulation` with its instrument named and unbuilt. Not risky - unmeasured. v4.0 adds Lane B, the A/B wave, carried over from intake's Phase 7.5/7.7: one Opus worker per write-set group in an isolated worktree, re-measure A, build the instrument, build B, same figure both arms, gates asserted, **seeded control red**, pathspec commit, director merges `--no-ff` / throws `not-better` with figures / escalates `unmeasurable`. The seeded control is the sweep's own addition and the reason the lane can be trusted: a probe that stays green on A is not an instrument.
- **`architecture` was doing two jobs and one of them was not a human's.** v3.0's veto 1 ("file outside my paths") was routed as `architecture`, so an out-of-scope fix looked like a product decision on the deck. It is a coordination fact about THIS session's hands: split into `out-of-scope` (Lane B, a worker that owns the context) and `architecture` (Lane C, XL / what the product IS). Three of twelve gravitone cards moved lanes on that split alone.
- **Name whose hands a Lane C card needs.** "Human" hid three different things on one deck: an ingest only the app can do, a scan that needs the bridge alive, a `pip freeze` on another machine. Added `operator-only act` as its own escalation so the card says which act, and a run does not re-derive an item nobody in a session can ever close.
- **A backlog's honest reading is "what the round could not measure", and that is a work queue, not a decision queue.** Twelve cards: zero Lane A (v3.0 already built everything a probe had measured), seven Lane B, four Lane C - and one of the four is a genuine policy conflict two rounds disagreed on, which is the kind of card the deck exists for.

## 4.0.0 - 2026-09-06 - gravitone-gcloud (golden-path-tests, --develop)
- **The `--develop` deep tier is chosen by strategy, not by the context's `category`, and on a `test` context the wrong eight lead.** feature-scout, growth-hacker, monetization-advisor and business-strategist had nothing real for a probe suite; all nine builds came from the five never-applied quality lenses and test-strategist. The "new capability" a test context can absorb is a new DERIVED probe over a population previously asserted only in prose (here: walking a public route's import graph). A `category: test` or `config` context should promote test-strategist / state-coverage / parity-auditor into the deep tier under every strategy and demote the market lenses to the tail.
- **A derived check that accepts a cleanup hook by PRESENCE is the coverage-theater shape §4.7 describes, one level up.** The check derived its population correctly (every probe that writes env) and then read the fix off a hand-shaped predicate (`test.afterEach(` exists). Ask of every derived check: does its acceptance predicate read the hook's BODY against the resource, or its name? Filed as a registry lead; recording it here because the §4.7 clause names lists and not predicates.
- **On a test context the operator's temp folder is an evidence surface.** 392 `gravitone-argv-*` directories were the measurement for a leak no lens looks for; a sweep of a `test` context should glance at `$TEMP` for the repo's prefix before declaring code-optimizer clean.

## 4.0.0 - 2026-09-06 - ascent (Members & Access Control, --develop)

- **"A gate you could not run is a gate that did not pass" needs a third branch: a gate that CANNOT
  be run, for reasons that will not clear.** §7.2's advice for a red whole-tree gate is "wait for the
  tree to settle." In a checkout several agents share, the tree does not settle: a foreign `next dev`
  rewrote `.next/dev/types/**` (which the repo's tsconfig *includes*) continuously for the whole
  round, leaving it truncated mid-write, while a second session half-applied a feature whose imports
  did not exist yet. Waiting is unbounded, and reporting DEGRADED for nine commits abandons the
  typecheck entirely. What worked, and what the skill should name: build a **closure typecheck** - a
  tsconfig extending the repo's, whose `files` are the round's changed files plus each one's
  CONSUMERS. TypeScript pulls the full import closure, so it is a real compile-time assertion on
  everything the change can break, and it is immune to unrelated churn. The trap worth writing down
  with it: **`exclude` cannot drop a transitively-imported tree** - excluding the foreign directory
  still typechecks it, because a non-excluded file imports it. `files` is the only lever.

- **Veto 1 (out-of-scope -> Lane B) mis-routes a change that the repo's OWN gate makes mandatory.**
  Adding a `recordOrgAudit` call site in this repo fails a static test unless a line is appended to a
  registry file in a DIFFERENT context. Read literally, veto 1 sends that to a Lane B worker who owns
  the registry's context - but that worker does not own the route, so neither of them can build the
  finding, and it is unbuildable forever. The distinction the section needs: a file outside your paths
  that you are changing to **alter another context's behaviour** is veto 1; one you are changing
  because **a gate in your own path names it as the mechanical consequence** is part of your atomic
  unit. The test for it is objective - would the repo's gate go red without the second edit? If yes,
  it is one change; declare the crossing in the commit and keep the edit minimal.

- **`--develop` found its best forward-building item by grepping for a field's CONSUMERS, not by
  imagining a feature.** Four of the nine builds were the same shape: a value the backend already
  computes, stores and documents, with zero readers in the UI (`emailed`, `invitedBy`, and the
  audit action that was never recorded). The repo's own backlog had named that class after a UAT
  measured 22 instances of it. A `--develop` round should run the zero-consumer grep over the
  context's exported fields, route response keys and db columns BEFORE opening the market lenses:
  a capability the product has already paid for and not delivered outranks one it has not built, it
  is always inside declared scope (so never a `direction`), and its Before figure is a grep count -
  which is exactly the `gate`-rung evidence the market lenses cannot produce.

- **A test file split under a LOC cap is a warning-generating event.** Splitting a jsdom test into
  sibling theme files copies the whole preamble into each, and most of it is dead in each half. Eight
  unused-helper warnings shipped in one commit before the next `eslint` over the directory caught
  them. Run the linter over the DIRECTORY immediately after any split, not over the changed files.

## 4.0.0 - 2026-09-06 - pumper (app-runtime, --develop)

- **A single-file context inverts the A/B ratio, and veto 1 is why — not measurability.** Six of twelve findings went to Lane B, and every one of them was `better` with a real figure already taken (`probe` on four of them). None was routed there because the evidence was thin; all were routed there because the fix's write set crossed the one path the context declares. SKILL 5's Lane B trigger table reads as if B is mostly "the round could not measure it", and on a narrow context that is inverted: B fills up with fully-measured work whose only defect is that this session does not own the second file. Worth saying in the trigger table, because a director reading `A:6/B:6` on a one-file context should not read it as six weak findings.
- **4.11's "build the instrument when it is S" converts the parity class specifically, and that is its highest-value use.** A `parity-auditor` finding where the two implementations are *currently equivalent* has no red-then-green available: the duplicate guard rejected the same inputs as the shared one, so any test written against the behaviour passes on both arms. It reads as `unmeasurable`. Building the S instrument first (a test driving the second door) changes the question from "does this door reject `..`" to "is this door reaching the SHARED guard" — and that one IS gate-measurable, by seeding the shared guard and watching the previously-green test go red. The generalisation: for a parity finding, the fail-before seed goes in the SHARED implementation, never in the call site, or the seed proves nothing.
- **Two of six fixes were text, and both shipped to an end user through a path no lens is pointed at by default.** A thirty-space run inside a string literal (a wrapped source line whose indentation landed in the string) reached the operator's job receipt verbatim, and a merge had orphaned a function's doc comment onto the next item so rustdoc described a routing enum as build identity. Neither is reachable by reading for correctness; `copy-auditor` and `documentation-auditor` found them only because the tail was driven at something specific per 4.9. Cheap heuristic worth adding to `copy-auditor`: grep the context for runs of two or more spaces inside string literals, and for two doc-comment blocks with no item between them.

## 4.0.0 - 2026-09-06 - gravitone-gcloud (shared-notebook, --develop)

- **A probe that drives an extracted predicate is not a probe of the fix.** The round's first build removed a condition that existed twice (a rail's pill list and the section it jumps to) by extracting one predicate. The probe drove the predicate over a synthetic notebook and passed five assertions — and reverting the COMPONENT to map the unfiltered list left every one of them green, because the probe did the filtering itself. §7.6 says to seed the defect; what this adds is WHERE: when a fix is an extraction, the seed must be applied at the CALL SITE, not to the extracted unit, and the probe needs a second assertion that reads the call site. Filed as a registry lead.
- **§4.6's "docstring as spec" tell has a second direction the clause does not name: a comment asserting a defect that has been FIXED.** Two files here carried "app/api/recalibrate/route.ts does not send conclusions" months after it started to. That is not a harmless stale comment — it is shaped exactly like a live finding, so the next reader (or sweep) either re-fixes it or distrusts a working path. Worth adding to §4.6: grep a context's headers for claims about OTHER files, and check each in both directions. Four of five builds this round came from that one grep.
- **A countable claim in prose is a finding waiting to happen, and the fix is a walk, not a corrected number.** "The thirteen other call sites … assets.ts (3)" was 21 across 5 files with assets.ts at 8. Correcting the number would have restarted the same clock; replacing it with a derived population found a real violator the paragraph's own rule forbids. The `--develop` recipe in references/evidence.md should name this explicitly: on a context whose value is a CONTRACT, "new capability" usually means turning one of its stated rules into a walked population with a listed-exemption map.
- **The outbox cap is now a hard stop on this fleet's largest consumer, and the skill has no back-pressure.** Two consecutive rounds have been degraded for it; this one had a single line and spent it on the round node, so five verified fixes have no progress node anywhere but git history. §9 tells a run to "say in the report which findings did not fit", which is honest and does not help the NEXT run. Worth a redesign look: §9 could route overflow to a repo-local file the ingest also drains, the way `.claude/scan-history/lanes.jsonl` already absorbs routing rows with no cap.

## 4.0.0 - 2026-09-06 - pumper (archive-engine, --develop)

### Redesign proposal

- **SKILL 6's read side is ordered wrong for anything security- or contract-shaped, and this run paid for it.** The skill says to resolve the governing subject before judging (§4.3), which I did — for the subject the map ranked highest. But a lens does not know which technique governs its *fix* until the fix has a shape, and by then the code is written. This round built a credential-header guard as a substring denylist, committed it, and only afterwards found `broker-proxy-attaches-secret`, which forbids denylists by name and gives the reason ("the header added to the protocol next year is forwarded by default"). Four real secret-bearing header names walked straight through the shipped version. The correction cost a second commit and is now the more interesting of the two. Proposal for §7: **before committing a fix whose shape is a policy decision — an allow/deny set, a retry rule, a validation boundary, a redaction — grep the registry for the technique that governs THAT SHAPE, not the one that governs the context.** The context-level read (§4.3) and the fix-level read are different lookups, and only the first is currently in the skill.
- **A round's leads should be checked against the corpus before they are written, not after — and three of three dying there is a healthy result worth reporting as one.** All three lead candidates this round turned out to be in the bundle already, stated better: `_laws.md#unknown-is-not-a-value` and error-handling's "one observable, four answers" cover the two-facts-one-message rule; `broker-proxy-attaches-secret` covers third-party header forwarding. §6's bar 3 ("novel against the corpus") reads like a formality next to the other three bars and is in fact the expensive one, because clearing it honestly means reading subjects the round did not otherwise need. Worth saying in §6 that a round filing zero leads after checking is a *better* outcome than one filing two unchecked, and that the check often pays for itself in the read direction — here it did, by correcting a build.
- **The strongest single-file findings this run were all "two states, one observable value".** Across two contexts: an inverted date range answered like an empty archive; an unreadable index reported as an unarchived URL; a discarded poisoned checkpoint indistinguishable from a first attempt; a blank credential reported as ready; over-cap schedule requests counted nowhere. Five of eleven builds, from four different lenses, all one shape — and `state-coverage`'s current blurb frames it as a UI concern ("a screen that renders as though nothing is wrong"), which is why three of the five were found by other lenses instead. Proposal: generalise that lens's description from surfaces to **observables** — for each value a caller can see, ask which distinct runtime states produce it, and treat any two that a caller would act on differently as the finding. It is the highest-yield question available on a mature backend context, and today the skill only asks it about screens.

## 4.0.0 - 2026-09-06 - ascent (Org Import/Scan/Watchlist, --develop)

- **The zero-consumer scan is not a dead-code check, it is a DEFECT check, and the docstring is the
  tell.** Round 2's lesson proposed grepping a context's exported fields for readers. Run three times
  now, the refinement that matters is which survivors to look at: a field that is merely unused is
  usually fine (queue-row internals, DB-only columns), while a field whose DOCSTRING ASSERTS A
  PURPOSE and has no reader is where the defects are — because the docstring is the consumer nobody
  wrote, and the code around it was designed on the assumption that consumer exists. Three examples,
  ascending in cost: `OrgBenchmark.corpusBasis` ("a percentile without its basis is not an auditable
  number") — nobody renders the basis; `TeamRollup.onboardedRepos` ("reported separately") — nobody
  reports it; `ScanJob.creditCharged` ("the single record of the reservation - a process kill leaves
  it attributable") — nobody read it, so a process-killed worker's job reserved a SECOND credit on
  retry, up to five times for one repo. The first two are gaps. The third is money. **Sort the
  survivors by how strongly their docstring claims a consumer, and start at the top.**

- **A `.catch(() => <empty>)` is safe on a read that feeds a DISPLAY and unsafe on a read that feeds
  a DECISION TO WARN.** `/api/org/scan` computes its unfinished-work remainder as
  `(await listJobsForRun(...).catch(() => [])).filter(...).length`, then emits its "N still queued"
  frame only `if (remaining > 0)` — so a failed read is indistinguishable from a finished run, two
  lines below a comment explaining that a remainder which "only ever existed in a lost frame is
  exactly the silence this fixes". Worth adding to `error-handler` / `observability-auditor` as a
  standing question: for each swallowed error, is the fallback VALUE rendered, or does it select a
  BRANCH? A fallback that selects the quiet branch converts a failure into a false all-clear, and no
  test will ever see it because the catch makes the function total.

- **`--develop` on an `api`-category context produces safety work, and that is the correct result,
  not a strategy failure.** All three builds were correctness/observability (a money double-charge, a
  half-applied org-row stamp, an invisible failure mode); the eight market lenses produced nothing
  real between them. A queue, a cron and a fan-out pool have no user-facing capability of their own —
  their "new capability" is always someone else's render. This is now the second `--develop` round
  (with gravitone's `test` context) where the deep tier was wrong for the context's CATEGORY. The
  skill should let `category` reorder the deep tier under any strategy: `api`/`data` promote
  parity-auditor, observability-auditor, risk-assessor and test-strategist and demote the market four.

### Redesign proposal — the skill should say where NOT to run the gate

- **§7's parallel-session rules cover STAGING and VERIFICATION, and miss the third hazard: WHERE the
  verification runs.** Shipping three rounds from a checkout shared with another live agent cost two
  self-inflicted repo injuries, both from running gates in the wrong place rather than from any code
  change. (a) The repo's test suite contains git-fixture tests that COMMIT into whatever branch the
  tree they run in has checked out — run inside a worktree on `master`, they buried the real tip
  under 19 fixture commits and set `core.bare=true` on the shared config, breaking `git status` for
  the other session. (b) Junctioning `node_modules` into a scratch worktree and then
  `git worktree remove --force` deleted THROUGH the link, destroying the real `.bin` and several deep
  packages and breaking `npm`/`npx` repo-wide.
  Neither is exotic: any repo whose suite shells out to `git`, and any Windows worktree with a
  linked `node_modules`, has both. The generalizable rules are short enough to state:
  **run a whole-repo gate in a `--detach`ed worktree** (fixture commits then cannot move a branch
  ref), **never link a dependency tree into a worktree you will force-remove** (unlink first), and
  **after any whole-suite run in a shared checkout, re-check `git rev-parse --is-bare-repository`
  and the branch tip you care about** before trusting either.
  §7 already tells the sweep to stage by explicit pathspec and to distrust a red whole-tree gate that
  is not its own. It should also tell it that running the gate can itself be the destructive act.

- **A pre-push gate that runs in the working tree cannot verify a push from a shared checkout.** This
  repo's hook runs `npm run verify` where the push is issued, not on the ref being pushed — so with
  the checkout on a sibling session's branch it verifies the wrong tree, and a green result is
  evidence about someone else's work. The honest route (run each stage against the exact commit in a
  detached worktree, then use the documented skip flag and record the stage-by-stage evidence where
  the repo keeps such records) is worth naming in §7 as the shared-checkout push procedure.

## 3.0.1 - 2026-09-07 - personas
- **A single-lens `--lenses` round has no tier caps that fit it.** §4.3 caps the deep tier at 3 findings per lens; an operator who narrows the package to ONE lens on a 34-file context would get three findings from a full read. Treated the requested lens as the whole package and let the budget absorb it (12 findings, 8 built). §4.4 already says the budget must absorb the package; §4.3 should say the per-lens cap applies only when the package has more than one lens.
- **A whole-tree gate served from a warm daemon is a moving target under a concurrent session.** Three census drifts in one round, all in a sibling's uncommitted files, each verified by a cold single-rule run and a listing check against my own dirty files. The §7.2 rule covers the exit code and the composite; it should add: when the gate is a delta engine, re-run the flagged rule cold and confirm your files are absent from its listing before treating it as foreign.
- **§7.2's own defeat is still the easiest one to make.** Wanting to trim output, I wrote `npm run gate | tail -4 && commit` and committed over a red census. The rule was known and still lost to ergonomics; a recipe line (`cmd > log 2>&1; rc=$?; tail log; test $rc = 0 && commit`) would have held.

## 3.0.1 - 2026-09-09 - ai-registry

- Architecture review: the shared reflection clause assumed a writable registry link in every installation. Replaced that assumption with installation-aware scope and explicit adoption. This records an instruction audit, not a field effectiveness result.

## 3.1.0 - 2026-09-17 - skillbench

- **"Most of the tail will honestly report 'nothing real', and that clean verdict IS coverage worth recording" manufactured exactly the padding §4.9 forbids.** ~31 judge verdicts read the 28-lens "all clean" list as rubber-stamped ("it records 28 lenses as '0 findings; clean' with no evidence of real reading"). The prose rule bound the report; the ledger still accepted a bare key. 3.2.0: the coverage ledger records only lenses **pointed at a named artefact** (a file read, a grep run, a hypothesis traced), each naming what it checked; a lens with no surface goes to `lens_no_surface[]` and earns no credit; §3, §4.9, §9's coverage node and §10's snapshot schema all changed together, and the round close reports the two counts separately.
- **The picker had no size floor while §4.8's yield floor assumed ten files or more.** ~11 verdicts: "picked a trivial thin route shell and ran 28 lenses over it". Measured: 28 lenses over a 38-line route shell. §1 now sizes the context first - under ~10 files or ~200 LOC, sweep it with its siblings as one round (preferred) or run the matched tier only and say so.
- **The ratchet / declared-paths veto split the judges in both directions** (~16 verdicts): "the structurally blocked finding was sensibly proposed, not built" against "deferring solely because of a LOC ratchet does not establish an allowed escalation". Two rules now: a coupled doc, test, locale entry or generated artefact the fix REQUIRES is part of the fix - build it and name the extra path in the commit body, veto 1 is for a change that wanders; and a ratchet blocks only the change that would breach it - measure the headroom, build under the ceiling, backlog only the candidate whose own site is at the line.
- **The round ledger row was left uncommitted.** Measured on athena: gpt-5.5@high committed its fixes and left the appended `.claude/scan-history/scan-sweep.jsonl` row dirty; the file is tracked in some repos and the next picker reads it from HEAD. §10 now says the row rides in the round's last fix commit, or in a closing `chore(<context>): ... ledger` commit when the round built nothing.
- **"each grounded in `file:line`" never said from where** - 22 of the corpus's ~116 unresolved-anchor complaints were scan-sweep's, clustered in multi-package repos where `limiter.ts:41` is ambiguous. §4.3 now defines the anchor as a path relative to the repository root exactly as `git ls-files` prints it, binding findings, evidence, commit bodies and report alike.
- **Caches were left inside the swept tree.** ~10 verdicts found 12k-file build/test/package caches (`CARGO_HOME`, `UV_CACHE_DIR`, pytest temp roots) written under the repository, after which `git status` cannot tell work from litter. New §7.7: caches go to the OS temp dir, and `git status --porcelain` is checked clean of them before the round's last commit.

## 3.3.0 - 2026-09-18 - kp (CandiDate)

- **Same class as the personas 3.3.0 lesson, on this checkout.** A `--develop` coordinator wave produced 955 findings; 30 fit the outbox; waves 4–6 built the lowest-risk autos; ~710 remain. They lived in a Grok session `all-findings.jsonl` that the next `/scan-sweep` would never see. Wrote `.claude/scan-history/open-backlogs.jsonl` plus `leftover-develop-2026-09-17.jsonl` and pointed the overlay at them so §0 has a file to read.

## 3.3.0 - 2026-09-18 - personas

- **An unworked backlog was invisible to the next sweep.** One `--develop --ideas-only` wave produced 1,040 findings; the outbox cap admitted 30 and the other 1,010 lived only in a scratch directory, named once in a report. Nothing in the skill looked for them on the next invocation, and sweeps on this repo run weeks apart. New §0: before scoping, read the open-backlog register, the undrained outbox, the digest's pending count, ideas-mode history rows and stray `scan-sweep-*/all-findings.jsonl` files, and print an `OPEN BACKLOG` notice first - ask when attended, repeat it per round when not. §9 now writes a register row whenever findings do not reach the outbox; new overlay key `openBacklogs`; new `--backlogs` invocation. Instruction change from one operator request and one measured run, not a field effectiveness result.

## 3.4.0 - 2026-09-22 - kp (first --challenge run: 6-context cohort, 12 cards, 3 waves)

- **Shape held end to end on its first run.** 6 read-only scouts (Opus 5.5) -> 12 cards -> an independent critic on a different model (Fable 5.1) that re-read every cited line: 0 false premises, 0 void, 2 revised, means ambition 3.75 / grounding 4.83 / falsifiability 4.25. 3 waves of 4 builders in ONE shared checkout (worktrees cannot run kp's unit suite): 11 landed, 1 partial, 0 demoted, 0 reverted; 97 acceptance cases, 94 red-before, 97 green-after; ~118 min wall clock; scouts 1.33M / critic 0.23M / builders 2.28M tokens. `git commit -- <paths>` + the `mkdir` lock had zero cross-builder contamination across 44 commits; one builder waited out a lock another held for 11 minutes rather than stealing it.
- **The critic's grades predicted nothing about the build, and that is information.** The lowest-ambition card (a2, channels relay cache) landed flawless; the highest (a5, apply filing core, L) was the one partial. Grounding 4.83 matched 0 premise failures at build. Keep ideas and execution as two scores; do not fold them.
- **Every integration break (6) was a guard living OUTSIDE the folder it guards**: a repo-wide `@ts-expect-error` ratchet, a repo-wide hand-typed-recipe ratchet, a source-guard test in a sibling feature folder pinning the OLD expression of a correctly refactored route, and whole-shell import-graph budgets. Builders ran their own folders green every time. Adding "full unit suite + whole-tree budgets before the last commit" to the brief after wave 2 took wave 3 to zero test failures (two budget overages remained, both self-reported). Applied as 3.4.1 (§7 step 4).
- **The "every case red-before" flawless rule punished good test design.** Two builders wrote no-regression guard cases (green before by construction). 7/12 flawless leniently, 5/12 strictly. 3.4.1 asks for guards to be declared up front and both numbers reported.
- **Whole-tree budgets turn into ceiling raises under a challenge run.** The run moved five perf-budget ceilings (each with its why, none silently): per-route modules for a new leaf module every route reaches, and KB on the workspace page three times. A proving ground that builds 12 M/L items in one day will grow a shell graph; budget the raise as an expected integration step, not a builder failure (3.4.1: combined-growth breaks are attributed to no one).
- **A fallback wake-up that names the stage goes stale and reads as an instruction.** The heartbeat prompt "proceed to the critic once all six are in" fired twice during wave 2-3. 3.4.1: the prompt names the run directory, never the stage.
- **Two measured bugs in my own tooling, both the known backslash trap**: `node -e` in Git Bash ate `\` in a regex (caught by a SyntaxError, not silently), and bash process substitution `<(...)` does not exist there (`/proc/.../fd` missing) - `git commit-tree -F <(...)` failed and left HEAD unmoved. Script files via the Write tool for anything with a backslash or a pipe to a file descriptor.

## 3.5.1 - 2026-09-23 - ascent (second --challenge run: 6 hosts + 3 riders, 12 cards, 3 waves)

- **3.4.1's full-suite clause held: zero integration gate failures across three waves** (kp's first run had six). Every builder ran the whole suite before its last commit, and each combined-tree gate came back green. 12/12 landed, 0 demoted, 0 reverted; 86 acceptance cases, 84 red-before, 86 green-after; critic (Fable 5.1) 0 premise-false, 0 void, 4 revised, idea 3.92 / 4.75 / 4.50; execution 7/12 flawless.
- **Proposal: the brief should say "full suite in the background" from the start.** Four builders running a 5.6-minute suite concurrently in one checkout starved past the agent's 600 s stream watchdog, and two wave-1 builders were killed mid-build. Their uncommitted work survived in the tree and a SendMessage resumed each. The rule was added to the brief after wave 1, and no builder stalled after that.
- **Proposal: the brief should give the untracked-file form of the pathspec commit.** `git commit -- <paths>` refuses a path git does not track yet, so every builder that created a file improvised its own `git add`. `git add -N -- <exact path>` then `git commit -- <paths>` keeps only-paths semantics.
- **A repo convention enforced by a reporter, not a gate, escapes builders and costs flawless at integration.** Builders re-introduced a copy rule no gate checks; the coordinator's one integration fix was stripping it, which took three otherwise-flawless cards out of the count. Proposal: the overlay's challenge block should list the repo's non-gated conventions next to its gates.
- **Critic ambition again predicted nothing about the build.** Three of the four ambition-3 cards landed flawless; one of the three ambition-5 cards did not. Keep the idea score and the execution score separate (confirms 3.4.0).

## 4.3.0 - 2026-10-04 - statreel (first adoption, --stabilize loop over all 23 contexts)

- **Run shape:** 20 rounds over 23 contexts (three small-context pairs and one trio merged), in 5 waves of 4 general-purpose round-agents in ONE checkout. A director owned the ledger, the register, the consult and lead files, and the Biome baseline, and ran the full offline gate after each wave. Result: 346 findings, 208 built, 7 rejected, 112 Lane B, 19 Lane C, 256 commits. All gates passed on the final tree, and the replay e2e passed 13/13. Pathspec commits (`git commit -m … -- <paths>`) caused no cross-agent contamination. 2 of 20 agents stalled on the 600 s stream watchdog and resumed cleanly from a SendMessage. 4.4.0 adds a "Director-run fan-out" rule block to §7, because the skill said nothing about who writes the shared files under fan-out.
- **Lane B piled up silently.** Without `--ab`, each round recorded its B cards and no step added them up. The loop closed with 112 open, more than half as many as were built. 4.4.0 puts a running Lane B total in the round close-out (§8), a drain prompt at half the built count or 25 items (§5), and makes the closing report lead with the pile.
- **An overlay gate made a live network ingest.** `uv run --project pipeline pytest`, run from the repo root, loaded no pytest config, so the `live` marker ran: 5 polite requests and a new raw snapshot. Nothing was published and the warehouse was untouched, but it was an act the repo law asks the owner about. The repo fix was a conftest hook. 4.4.0 adds §7.9: dry-run each overlay gate before round 1 and check what config it loaded. A gate that can spend money or hit the network must refuse that from inside the test tree.
- **I misread the registry map.** I reported "the map truncates each context's paths to 12" as a registry bug. It is a documented sample (`build-registry-map.mjs`, `check-context-coverage.mjs`), and the full file list lives in `context-map.json`. The round brief already took the file list from there, so no round was harmed. 4.4.0 adds a line to §6 saying so, so the next sweep does not file the same lead.

## 4.5.0 - 2026-10-10 - bp (first adoption: a UI-lens pass, then --optimize over all 11 contexts)

- **Run shape:** two passes in two days, both director-run fan-outs with one git worktree per round and merges after every wave. Pass 1, operator-narrowed (5 UX/UI lenses, 5 findings per context, Sonnet executors): 39 of 39 routed findings landed. Pass 2, `--optimize` (8 lenses, depth 8 to match the package): 69 built by rounds plus 3 director integration fixes, 5 rejected with figures, 16 Lane B, 1 Lane C (closed by the director), fp 0, 7 new gates wired into the overlay.
- **A dead-code deletion is only proven against the wave's merged tree.** In one wave, the standard round deleted an exported constant after a correct zero-consumer grep, while the tooling round in a sibling worktree made the same constant the single source for two scripts. Each branch was green alone; the merge was red (typecheck exit 2, the health check exit 1). The zero-consumer grep in §4.5 ran against the round's base, not against what the wave was about to land. Proposal: under a director fan-out, re-run every deletion's zero-consumer grep on the combined tree before the wave's integration gate, and say which deletions a sibling revived.
- **Cross-context duplicates need deduping at routing, not at build.** In pass 1, four analysts found the same light-theme text-contrast failure in four contexts, and two found the same tab-strip keyboard defect. The director merged them into one shared-token contract plus waves ordered by dependency (the context that owns the token builds first). Without that step, four executors would have each invented a token.
- **Worktree rounds and package installs.** Four parallel `npm ci` runs took about 12 minutes and stalled two executors on the stream watchdog (resumed cleanly). A `node_modules` junction to one install runs the node gates but not a Turbopack dev server, and in git-bash an unquoted `cmd //c mklink //J` loses its backslashes and links nowhere, so worktree gates silently resolved the parent checkout's packages. Repo-specific detail went to the overlay; the general point: verify what a worktree's gates actually load (§7.9 already says so for configs).
- **A gate that cannot fail was the most common optimize finding.** Three rounds independently found checks that exited 0 on a seeded failure (a health check below its own target, screenshot probes, a manifest gate missing from the always-list). Seeding the failure (§7.6) is what found each of them.
