# Territory dossier - Chores and playbooks

Areas: `apps/desktop/src/scenes/chores/` (with `adopt/`, `intake/`), `apps/desktop/src/lib/playbooks.ts`,
`apps/desktop/src/modules/playbooks/`, `apps/desktop/src/stores/playbooks.ts`, `src/athena/adopt/`,
`src/athena/proving/playbooks/`, `playbooks/` (100 playbook directories).

Commit: 9beaef313d - written 2026-10-22

## Why this area

The README sells "an agent that works inside the web apps you already use"; Chores is where that
becomes a *job you hand her*: a library of 100 benched playbooks (recover, claim, contest, comply)
across 10 areas, a front door that turns a need into a chore (ADR 0098), and a studio that turns a
chore into *your* case (ADR 0097). It is the area that makes Athena something a person returns to
rather than a demo of a gate. Evidence: it is the largest feature-data investment in the repo (191
commits in the area 2026-10-07..10-21, 133 scoped `playbooks`; `git log -- <area>`), the bp tree marks
`chores-depth` and `playbook-bench` as major features (`.ai/lens-scan/app-structure.json`), and the
`agent-turn-execution`, `playbook-execution` and `gated-action-approval` flows run through it
(`context-map.json`). The operator picked this area from a ranked shortlist on 2026-10-22. Page
operation (WebMCP bridge, hands, approval cards) was hunted 2026-10-15 and is not this hunt.

## Who uses it, for what

The uat Characters (`uat/characters/*.md`, field `motivation.chore`) all hire Athena for a recurring
job:
- **mira** (primary user, studio owner): chase every invoice over 30 days, one personalised message
  each; 45 min -> 8 min.
- **jonas** (skeptic): hands off repetitive CRM cleanup only if he can prove what ran and what was
  refused; 60 -> 15 min.
- **ana** (keyboard-only, low vision): the same weekly admin without a mouse; 50 -> 20 min.
- **priya** (non-technical, Codex CLI only): help on her invoicing tool without learning a tool;
  30 -> 10 min.
- **juror** (external evaluator): decides in five minutes whether the product is real.

The playbooks themselves name a persona and a money job: lien-desk, clinic-denials,
estate-settlement, change-order-notices, customs-protests top the ranking. "Done well" = the job is
found in full (recall), nothing false is filed, every irreversible step waits for a card, and the
person can see what it was worth.

## What it does today

**A playbook is data, benched by the real Athena (ADR 0040).** `playbooks/<id>/` = `playbook.json`
(showcase: brief, persona, command, apps, steps, gates, traps, economics, edge, expectation, caveat;
required fields `src/athena/proving/playbooks/spec.py:307`), `world.json` (simulated portals, phases,
tables, tools with READ/WRITE/PERMANENT/REACHES_A_PERSON kinds, `src/athena/proving/manifests.py:30-35`;
a tool is gated unless reversible with no external effect, `spec.py:114-116`), `truth.json` (answer
key: eligible targets with `value_usd`, traps, forbidden; read only by the scorer), `bench.json` (last
12 runs), `evidence.json` + `thumb.jpg` + `story/*.webp`. Area/job taxonomy: `playbooks/taxonomy.json`,
enforced by `check` (`spec.py:525-544`, ADR 0096). Authoring floors: >= 2 portals, >= 8 traps
(`spec.py:86-87`); bar recall >= 0.75, 0 false claims, <= 60 min (ADR 0057).

**The bench** runs a real Athena on a throwaway brain through the daemon's own routes on the `claude`
CLI (`bench.py:76-82`, model hard-coded `sonnet`, `cap_usd` 5.0), phase by phase, with nudges
(`bench.py:66,302-306`), regex-read tab switches (`bench.py:172-187`), and `approve="none"` - no card is
answered. Score comes from filed cards, never prose (`bench.py:402-501`), plus a `prose_audit` of any
total she states (`bench.py:531-554`); verdict exceeds/meets/short (`bench.py:557-601`). **Rank**
(ADR 0056, `rank.py:34-121`): money, time and edge points, log-scaled and clamped 0-5; disqualified when
short, trap-filed, false-claimed or unsourced.

**Chores depth (desktop).** One of five depth roots (`apps/desktop/src/scenes/depth/model.ts:22`); the
view is a pure function of `{model, path, go}` (`scenes/chores/view.tsx:12`) routing catalogue / `new` /
topic / adopt / run (`view.tsx:67-178`). Playbooks are bundled with `import.meta.glob`, ~2.7 MB, no
daemon needed to browse (`lib/playbooks.ts:13-17,562-583`; `stores/playbooks.ts:4-5`).
- **Catalogue** (`catalogue.tsx`): area tabs with counts, job chips, three orders (Best edge, Most value,
  Most time saved, `catalogue.tsx:37-41`), rows with still, portals, "6h -> 4m" and annualised value
  (`catalogue.tsx:82-167`), totals "N playbooks · X of Y benched exceed the bar · $Z found on the bench"
  (`model.ts:93-102`).
- **Topic page** (`topic.tsx:81-212`): brief, stills + lightbox, KPIs (value, time saved, traps avoided),
  "How it runs" blueprint with amber "Athena asks you first" gate diamonds (`flow.tsx:96-127`), "See it
  run" gallery, and "Make it yours" (talk it through / watch the run / copy the command).
- **Replay as a place** (`replay.tsx:4-14,44-70`, ADR 0093): each bench turn has its own URL
  `chores/<id>/run/<n>`; route rail, per-turn state dots, Play/Pause, "$ found so far, on the bench",
  ledger of every card. Play state lives outside the component and survives the remount.
- **Front door / intake** (`intake/intake.tsx`, ADR 0098): "What do you need done?" -> <= 3 rounds of
  question cards -> verdict `template` (a library chore, why, what would differ, <= 2 alternates, held to
  real ids by the daemon, `src/athena/adopt/intake.py:283`) or `custom` (an editable command). The leg
  reads a fenced ~10k-token library summary every round (`intake.py:75-130`).
- **Adopt studio** (`adopt/studio.tsx:4-10`, ADR 0097): an opus-low interview fills slots (Portals,
  Approvals, Facts, Traps, `adopt/state.ts:320-325`; <= 12 slots, `src/athena/adopt/slots.py:56`) while
  research lanes run (rules via web search, accounts, memory, dropped documents; 4 at once, 270 s each,
  `src/athena/adopt/lanes.py:54-56`). An auditor confirms only from the person's literal words
  (`prompts.py:49-135`). A brief with a `rev` is approved (`loop.py:134-146`); its command is the
  playbook's command plus a "My case:" block (`loop.py:357-416`). Approval plays the recorded run with the
  person's portal names swapped in (`adopt/state.ts:350-382`), then a **rehearsal** on a world shaped like
  their case (`showcase.py:68,136,446-449`; "Rehearsal on invented data… nothing was sent",
  `showcase.tsx:31-39`). "Start for real" hands the command to Athena's composer (`showcase.tsx:109-121`
  -> `modules/playbooks/index.ts:25-29` -> `lib/companion.ts:136-139`); the person presses send.
- **The real run** carries `active_project: {kind:"playbook", id, title, goal}` on every turn
  (`apps/desktop/src/stores/run.ts:874-879`, ADR 0044); the daemon passes it through
  (`src/athena/daemon/routes.py:803-813,848-857`) into a `## Active project` prompt block
  (`src/athena/core/prompt.py:380-386,485`). Nothing in core, harness, lane or ledger special-cases a
  playbook; gated calls become cards through the ordinary gate (`src/athena/harness/hooks.py:198-249`).

**What it does unusually well** (evolve these): (1) every claim is measured or says it is not - an
unbenched chore "claims nothing measured: a zero would be a lie" (`modules/playbooks/model.ts:12-15`),
stills are captioned "on an invented portal world" (`topic.tsx:150`); (2) answer keys separate from the
showcase, scored on cards not words; (3) rehearsal-before-reality on the person's own shaped case;
(4) a replay turn is a navigable place; (5) intake and studio share one reducer "so the two pages
cannot disagree" (`intake/state.ts:2-9`) and reconnects are idempotent on `seq` (`adopt/state.ts:190`);
(6) every leg is one ledger row with surface `adopt` (`legs.py:655-672`); (7) gates are pre-confirmed
in the slots as "She asks you first, every time" (`slots.py:126-162`).

## Measured state

- Tests at 9beaef31, re-run 2026-10-22: `uv run pytest tests/proving/test_playbooks.py
  tests/proving/test_playbooks_authoring.py tests/proving/test_playbooks_rank.py
  tests/proving/test_evidence.py tests/adopt -q` -> 502 passed, 31 s. `pnpm exec vitest run
  src/scenes/chores src/lib/playbooks src/modules/playbooks src/stores/playbooks` (apps/desktop) -> 14
  files, 229 passed, 7.7 s. `uv run python -m athena.proving.playbooks check` -> 100 load;
  `rank --check` -> current; `evidence --all --verify` -> 100 of 100 current.
- Bench (aggregate of the 100 committed `playbooks/*/bench.json`, runs 2026-10-07..10-11, all `sonnet`
  on `claude_code`, n=1 run per playbook): 99 exceeds, 1 short (osha-300-log, 7 of 10 items, 70% of value
  vs 75% bar); 599 of 608 eligible items found; 0 false claims, 0 traps filed; total $160.98, median
  $1.38 and 143 s per run.
- Adopt tier bench (gitignored `proving-runs/adopt-tiers/2026-10-15/report.md`, 9 scenarios x 6
  configs, 108 interviews; paid, not re-run): interview accuracy opus-medium 84.9%, opus-low 82.5%,
  sonnet-low and haiku-low 78.5%; **every config disqualified** (false clears or repeats); shipped
  tiers are hand picks (`src/athena/adopt/tiers.json:3-9`). Intake tier: never benched.
- Lens-scan store (2026-10-14/15): chores-depth 5,570 LOC, flow tests 22 / untested paths 3,
  unhandled cases 5; open proposals p-4c2530 (show the playbooks load failure instead of loading
  forever), p-a99f91 (bench reads filed cards from TurnRecord, not per-driver copies). Perf gate for
  Chores exists (`apps/desktop/scripts/perf-chores.drive.mjs`, budgets frame p95 <= 20 ms) - not
  measured, no committed reading.
- Registry map (`.ai/registry-map.json`, 2026-10-21, none stale): `proving-playbooks-bench` has three
  recorded **deviations** - eval-harness (`rank.py:165` ranks on one run, `ranking.json` carries no n or
  spread, "the published order is a sorted draw"), model-routing (`bench.py:78` hard-codes `sonnet`),
  audit-logging (`__main__.py:222` rescore overwrites the report instead of appending a correction).
  `desktop-playbooks-panel` is `governance: weak`. Usage of Chores by real users: not measured.

## Recent history

- 10-07..10-14: bench built (44028171), then the library authored - 112 world commits, each
  "benched to exceeds"; evidence films 10-09, six-still storyboards 10-14 (adc91912).
- Chores depth rewritten twice in two days: 10-13 "a field with the map as its hero" + replay place
  (56159ea5); 10-14 "the field is a ledger you pick from" (217f9167), then catalogue + topic page
  (b0d8d8be); dead map/grid/totals removed 10-16 (ab98760a). **Rejected direction: the edge map / field
  as the Chores hero.** `docs/features/desktop.md:36` still describes it (stale).
- 10-14: the inline "fit" form was replaced by the adopt studio conversation (c0cb4958). **Rejected
  direction: a form to fit a chore to a person.**
- 10-15: front door / intake (2b0b18d2, ADR 0098). 10-16 stabilize wave; 10-21 two belays.
- No reverts in the area. No perfect directions ledger exists. Owner lessons from authoring
  (2026-10-09): a $0 world always benches short; an eligible document must carry no doubt; a rules
  page that invites an act needs the truth to hold it; truth is frozen at first bench.

## Known limits and open questions

- **"Chores" are the user's recurring jobs in name only.** There is no scheduler, cadence, due date or
  trigger anywhere (grep of `src/athena` and the scene); `economics.per` / `times_per_year` are value
  units for display and ranking (`modules/playbooks/model.ts:100-106`, ADR 0056:59-75).
  `TurnContext.trigger` documents "later `mcp` and `schedule`" and nothing sets it
  (`src/athena/contracts/registry.py:207-210`). README:195-198: another tab's tools may "only be proposed,
  never run unattended".
- **Nothing about the person's chore persists.** Adopt and intake sessions are in memory, 2 h TTL, lost
  on restart (`src/athena/adopt/session.py:71-82`, ADR 0097:99-100). The approved brief is not stored;
  the "My case" exists only as the text handed to the composer. Client memory is module variables, no
  storage (`scenes/chores/memory.ts:22-35`).
- **A real run is not linked back to its chore.** The playbook id reaches the prompt and nowhere else -
  not the ledger, not an episode, not the Chores scene. Replay and "$ found" show bench and rehearsal
  traces only; the person never sees "your last run of this chore found X". The goal rides every turn
  until "done" is pressed (ADR 0044:40-41).
- The bench answers no card, so card-dependent actions score as missed (docs/features/playbooks.md:450-454);
  portals are simulated models of real sites; one run per playbook drives the published ranking.
- Intake sends the whole library each round; "a larger library would need a shortlist step" (ADR 0098).
- Wired but not drawn: `actions.open` (open a portal, `modules/playbooks/index.ts:49`), `PlaybookView.verdict`
  badges and `EvidenceView` video/narration (`modules/playbooks/model.ts:43-67`); `art/chore.tsx` is
  imported only by its test.
- Open questions nobody has answered: what a chore's *second* run looks like; how the person learns a
  chore is due; whether the rehearsal's numbers and the real run's numbers are ever compared.

## Constraints

- Stack: Python 3.11+ stdlib-only core (`athena.contracts`, `athena.core` import only the standard
  library, ADR 0002); third-party code only as lazily imported extras. Tauri v2 Rust shell, React 19
  desktop, Vite/Vitest. Windows is the primary desktop platform.
- Six invariants (README.md:115-129) hold for every change: (1) markdown on disk is truth, SQLite a
  rebuildable index; (2) provenance mandatory - a fact must cite live episodes, no bypass; (3) policy in
  the gate, never in the model - a GATED tool never executes without a resolved decision; (4) bounded and
  honest cuts `(showing N of M)`; (5) no provider mandatory; (6) one ledger row per model call, failures
  included.
- **Nothing irreversible runs unattended.** Any scheduled or proactive behaviour may prepare, read and
  propose; a gated action still needs the person's resolved card. README:195-198 stands.
- The user's own Claude Code / Codex CLI is the daily engine (no API key, ADR 0007); adopt legs use the
  tiers in `src/athena/adopt/tiers.json`. Single-user desktop; no cloud deployment of the companion.
- Playbook data format (`playbook.json`, `world.json`, `truth.json`, `bench.json`) is consumed by the
  bench, rank, evidence and the desktop; changes are additive. `truth.json` is never shown to a leg or
  the UI. A frozen truth is not re-edited (ADR 0057 errata rule).
- Bench and adopt-tier runs cost real money (~$1.4 per playbook run, up to $0.28 per interview); a
  proposal that needs a full re-bench of 100 playbooks says so and prices it.
- Registry standards (subscribed `software-engineering`; text in the sibling `ai-registry` checkout, not
  in this worktree): `scheduling` (store the schedule as durable data - `next_run_at`, `last_run_at`,
  enabled - and run a reconciliation loop; advance before dispatch; every fire decision explainable;
  techniques next-run-computation, missed-run-semantics, overlap-and-reentrancy, schedule-observability),
  `proactive-nudges` (machine-initiated contact is a budgeted privilege: attention-budgets, quiet-windows,
  nudge-identity-dedup, efficacy-feedback), `eval-harness` (comparability across time; reliability-
  aggregation, selection-over-noise, judge-stability), `hitl-approval`, `durable-agent-operations`,
  `session-resume`. The three recorded deviations above are open findings a proposal may close.
- Out of scope: the page-operation lane (bridge, hands, approval-card design - hunted 2026-10-15),
  voice, Gmail/Notion connectors, re-authoring individual playbooks' worlds, and another redesign of
  the Chores hero (the field / edge map was rejected twice).
