# The evidence ladder - how a finding earns its route

Read from `SKILL.md` §4.11 and §5. This file is the long form: what each rung
is, when it is reachable, what the verdict is read from, and what the figure
looks like per strategy and lens. The ladder is borrowed from `/intake`'s
Phase 7.5 apply modes (`code` > `experiment` > `simulation` > `task`), renamed
for a sweep that already stands in the tree it measures.

## The rungs

Take the highest reachable rung. The Method line says which one and why the
one above was out of reach. A rung skipped without a reason is a finding
routed on a story.

| Rung | What A and B are | Verdict read from | Reachable when |
| --- | --- | --- | --- |
| `gate` | the tree as it is (A) vs with the change (B), under a test or repo gate | red-then-green on a test that pins the claim; or the gate's exit code on both sides | a test exists or can be written at S; the repo has a gate that can see the surface; the tree takes a commit |
| `probe` | the same small sample on both sides - three call sites, one timed path, one reproduced flow, one store copy | the same figure taken twice on the same sample | the claim has a figure and the sample is real; no test can pin it cheaply |
| `experiment` | the same inputs run twice through a harness that ships nothing - a script over a copy, a replayed session, a hook dry-run against recorded actions | the harness's output, counted with its predicate | the effect is observable without shipping: prompts, thresholds, routing, gates, hooks |
| `simulation` | three concrete cases from THIS tree or its history - a real incident, a real PR, a real failing run - walked under A and B, one paragraph each | your own reasoning, labelled as such, with what would falsify each prediction | nothing above is reachable in the round: no instrument, a foreign tree, or the cost exceeds the round |

A simulation with three cases from the real tree beats a probe against a toy.
A simulation with invented cases is an opinion and routes as `unmeasurable`.

**Build the instrument when it is S.** The rule that turns this ladder from a
vocabulary into a method: when the only thing between a claim and its `gate`
or `probe` figure is an S-sized instrument - a test file, a fixture, a
counter, a timing wrapper, a script that enumerates the population - build it
as its own S fix, commit it, then measure. The instrument is a finding in its
own right (a missing test IS a defect under `test-strategist`) and it
converts a human decision into a machine one. Measured 2026-08-29: two of
three `unmeasurable` results in one round were avoidable this way.

**Re-measure at build.** The probe routes the item; the gate on the real
change lands it. §7.1 requires the After to be taken again on the actual
diff. An After that comes back `not-better` is a demotion and a false
positive for the snapshot's `fp`.

## What the figure is, per strategy

### `--stabilize`

| Lens family | Before / After figure | Usual rung |
| --- | --- | --- |
| bounty-hunter, error-handler, parity-auditor | the reproduced failure and its absence; the count of implementations of one rule that agree | `gate` (a red-then-green test) |
| code-optimizer | renders, queries, allocations, ms on one timed path | `probe` |
| ux-reviewer, visual-craft, state-coverage | states reachable vs states handled; the reproduced broken state | `gate` (a state test) or `probe` (a reproduced flow) |
| copy-auditor | strings asserting a behaviour the code no longer has, counted | `probe` |
| accessibility-checker | violations counted by the checker the repo already runs, or by axe over one page | `gate` |
| test-strategist | the population a hand-list omits vs the population the type enumerates | `gate` (seed a violation, watch it go red) |
| security-auditor, observability-auditor | a check present on N of M doors; an error swallowed on N paths | `gate` for tighten; loosen escalates regardless |
| risk-assessor | single points of failure counted; a failover exercised on a copy | `experiment` or `simulation` |

### `--develop`

The figure for a new capability is a **behaviour test the sweep writes
first**, from the finding's own Flow section: Before = `0 of N cases pass`,
After = `N of N`. That is `gate`, and it is reachable for almost every S or M
feature inside scope. The card also says WHICH scope line the capability
serves; a capability that serves none is a `direction` and escalates.

| Lens | The measurable | Escalates when |
| --- | --- | --- |
| feature-scout | the N cases in the Flow, as a test | the feature is outside the context's declared scope (`direction`), or L |
| onboarding-designer | steps to first success counted on a walked path; empty states handled vs reachable | never on its own - a state test is a gate |
| integration-planner | calls that fail the contract today vs after; consumers enumerated | the contract is another repository's (veto 2) |
| ux-reviewer | flow steps, dead ends, states | never on its own |
| growth-hacker, monetization-advisor, business-strategist | a funnel step, a plan tier, a pricing rule - measured only when the repo already emits the number | `direction` almost always; `irreversible` when it changes what is paid for |
| innovation-catalyst | a benchmark the repo already has, run on both sides | `architecture` almost always; the card should say so rather than pretend a figure |

Under v2.x every card from this tier was `unmeasurable` on arrival and the
strategy had no auto-build path. The test-first figure is what gives it one,
and the `direction` escalation is what keeps the human where `/intake` also
kept them: on capabilities the owner never declared.

### `--optimize`

| Lens | The measurable | Not-better when |
| --- | --- | --- |
| tech-debt-tracker | duplicated sites, workaround count, lines behind an abstraction vs at its call sites | the count is the same on both sides (pure churn) |
| dependency-auditor | the audit line, the version delta, the gate green after the bump | the bump changes nothing the repo reaches |
| devops-optimizer | pipeline duration, step count, cache hit, a flaky job's failure rate over the last N runs | no run history exists and none can be taken |
| documentation-auditor | a rule the doc states checked against the code it describes - `parity-auditor`'s figure applied to prose | the doc and code already agree |
| mobile-specialist | a reproduced viewport at a named width; touch targets under the threshold counted | the surface has no mobile route |
| observability-auditor | errors swallowed on N of M paths; audit rows written on N of M mutations | tighten builds; what gets LOGGED more is `policy-tighten`, what gets logged LESS is `policy-loosen` |

"Cleaner", "more maintainable", "safer" with no count is `not-better`, never
`unmeasurable`. The `unmeasurable` drawer is where this strategy's whole
output went under v2.x, and none of it came back as `better`.

## The contract checklist

An in-tree contract change - schema, IPC or public API, generated binding,
persisted format - is auto-accepted only when every letter holds. The card
names the first letter that fails.

- **(a) consumers enumerated by instrument** - grep for the shared symbol,
  the generated client's call sites, the migration's readers; the list is in
  the evidence; every one is updated in the same commit.
- **(b) generated artefacts regenerated** by the repo's own step, committed
  beside the change, never hand-edited.
- **(c) a contract test pins the new shape AND forbids the old** (§7.5) -
  seed the old shape and watch it go red.
- **(d) the gate is green**, asserted by exit code (§7.2).

A contract another repository consumes fails (a) by construction and is veto
2. A persisted-format change with existing data and no migration is
`irreversible`, not `contract`.

## Policy: tighten vs loosen

| Change | Escalation | Why |
| --- | --- | --- |
| adds an auth check, narrows a permission, adds an audit row, redacts a field from a log | `policy-tighten` - builds with a test | a reviewer would only ever say yes; the test is the review |
| removes or weakens a check, widens access, logs, stores or sends more, changes what is paid for | `policy-loosen` (or `irreversible` for spend) - human | the decision belongs to the owner of the data or the bill |
| swaps one check for an equivalent one | `policy-tighten` when the test proves equivalence on the same inputs; `policy-loosen` otherwise | equivalence is a claim; measure it |

## The self-correction

The snapshot carries `auto=<accepted>/<rejected>/<escalated>` and `fp=<n>`.
`scripts/coverage.mjs --next` sums `fp` over the repo's last five rounds and
prints `strict:` when three or more have accumulated without three clean
rounds since; under strict, auto-accept requires Method `gate`, and `probe`
routes to the deck with its figures. The threshold moves on evidence in both
directions, the way `/intake`'s admission threshold does, so a run that
accepts too much tightens itself before an operator has to notice.
