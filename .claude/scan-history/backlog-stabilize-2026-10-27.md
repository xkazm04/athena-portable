# Backlog - scan-sweep --stabilize, 2026-10-27

Run: `.claude/scan-sweep/runs/stabilize-2026-10-27/` (3 waves, 12 rounds, 17 contexts). Cards not built: Lane B (A/B-drainable with `/scan-sweep --ab-only`) and Lane C (owner calls). Full cards (Summary/Description/Flow/Expected impact/Evaluation, evidence) are in `findings/<context>.jsonl`.

## Lane C - owner calls (16)

| Context | Card | Size | Gate | Result |
| --- | --- | --- | --- | --- |
| adopt-engine | A case file's receipts list grows without bound and is rewritten whole on every write | M | irreversible | unmeasurable |
| core-brain-memory | Promote and erase rewrite write-once memories that replication cannot carry | L | architecture | unmeasurable |
| core-brain-memory | Erasing a project leaves its memory keys in sleep journals and conflict copies | M | irreversible | unmeasurable |
| core-sleep-and-vitals | This PC's gate trusts its latest reading at any age | S | policy-loosen | unmeasurable |
| desktop-avatar | Motion channels a track omits reach the face as 0, not as 'no say' | M | architecture | unmeasurable |
| desktop-avatar | A face card whose form fails to load is a blank, still-choosable box | S | direction | unmeasurable |
| desktop-avatar | Her face pops in: the canvas flips from hidden to visible with no ease | S | direction | unmeasurable |
| desktop-chores-adopt-intake | Say 'known' only for confirmed slots and name lane states in words | S | none | unmeasurable |
| desktop-chores-adopt-intake | Let a chore adopted from a project carry its space_id to POST /adopt | S | direction | better |
| desktop-companion-surfaces | Welcome promises 'no cloud' and 'nothing leaves' while her engine is a cloud model | S | direction | unmeasurable |
| desktop-tasks-and-due | Stop counting failed and killed tasks as "finished" in the task summary | XS | direction | unmeasurable |
| desktop-tasks-and-due | Say the dock's due line without two different "more"s | XS | direction | unmeasurable |
| peer-devices | Let old wrong codes age out instead of closing a later pairing window | S | policy-loosen | better |
| proving-chores-uat | both benches judge Claude with a single Claude judge and no drift anchors | L | direction | unmeasurable |
| proving-chores-uat | the judge's voice check refuses outside 60-260 words but says 80-200 | XS | direction | unmeasurable |
| proving-docread | The docread verdict passes on a point ratio its own interval cannot resolve | M | direction | unmeasurable |

## Lane B - drainable (48)

| Context | Card | Size | Gate | Instrument |
| --- | --- | --- | --- | --- |
| adopt-engine | A closed adopt session's in-flight round keeps running model legs | M | none | tests/adopt: a FakeTransport whose run() blocks on an Event per call; close the session while the first leg blocks, release it, drain, and c |
| adopt-engine | Approving the same rev twice in one session writes two approvals and two episodes | S | none | tests/adopt/test_cases.py: approve_one(), then POST approve {rev: 1} again on the same session; assert len(approvals) == 1 and one approval  |
| adopt-engine | Brief writer and setup lines disagree on a reopened guessed slot | S | none | tests/adopt/test_brief_honesty.py: parametrize all 3 statuses x 6 sources; assert prompts._origin and slots.provenance put each pair in the  |
| adopt-engine | A 401 sent before the body is read aborts the client socket on Windows | S | none | loop the POST-without-token request 200 times against a live daemon on Windows and count ConnectionAbortedError (control red: >0 today under |
| adopt-engine | An every-N-days chore set without a start counts from the UTC date, not hers | S | none | tests/adopt/test_chores.py: set_cadence via case_route with a fake clock at 03:00 UTC and timezone 'Test/Euro' or a UTC-7 fixture zone; asse |
| core-brain-memory | Promoting a closed memory to core answers 200 and then hides it everywhere | M | none | probe: write fact old in space A, newer in A supersedes it, promote_to_core(old) -> recall(core) serves old? (today False/False); plus a rou |
| core-sleep-and-vitals | A probe that cannot read RAM fails open in silence | S | none | capsys test: Probe with a raising memory reader sampled 10x through Sampler.sample -> count stderr lines; Before 0, After 2 (turn unknown, r |
| core-sleep-and-vitals | A sampler that keeps failing prints every 5 s and never says why | S | none | capsys test: Sampler(every_s=0.01) over a gate whose observe raises, run 20 ticks -> count lines and check the message is present; Before 20 |
| core-sleep-and-vitals | Forget bars and the degraded merge scan every live memory per call | M | none | pytest timing harness: Brain with 5,000 facts + 3 forget markers; time cycle._by_key(18 candidates) and book.bars(); Before/After ms, plus t |
| core-sleep-and-vitals | A failed cycle stamped ahead of the clock reads 'failed 1 min ago' | XS | none | copy test_a_cycle_stamped_ahead_of_the_clock_still_holds_and_says_so with a failed row (_failed_row hours_ago=-3) asserting the new sentence |
| voice-face-sidecar | Count the phones the helper shapes as 'E' because it has no entry for them | S | none | a test over visemes_of with a phone missing from VISEME asserting the answer carries an unknown count (or a stderr line); red today |
| voice-face-sidecar | The motion worker's cancelled-id set only ever grows | S | none | a MotionWorker test with a stub Motion (no torch) that cancels N sentences and asserts `cancelled` is empty once each is skipped or finished |
| desktop-chores-adopt-intake | Put the studio's entrance and loop durations on the motion tokens | S | none | adopt.css.test.ts: count literal durations outside var() in adopt.css; 5 before, 0 after; a seeded literal goes red |
| desktop-chores-adopt-intake | Mark a refused composer line as not sent and let it be sent again | M | none | studio.test.tsx + intake.test.tsx: a refused composer line is drawn 'not sent', Send again posts it, Just decide stays shut on a refused-onl |
| desktop-chores-adopt-intake | Leave a trace when closing an adopt or intake session fails | S | none | a session test with a close that rejects: the failure is recorded once per site (0/8 -> 8/8); needs the repo's chosen client-diagnostics sin |
| desktop-client-lib | Setup's engine count still divides by engines the desktop cannot launch | S |  | a case in src/modules/setup/engine-state.test.ts: probes [claude_code not_found, codex not_found, nebius found, muse_code found], claude_cod |
| desktop-client-lib | Up to five long-lived /events streams share one host's six-connection pool | M |  | an e2e probe against the real daemon: mount Main on Mind (devices + sleep) and Surface (tasks) and her window (run + tasks), count concurren |
| desktop-client-lib | Five copies of the daemon HTTP door disagree on what a failed fetch is | M |  | a test per client that feeds a fetch which rejects with TypeError('Failed to fetch') and one that answers 200 with a non-JSON body, assertin |
| desktop-client-lib | The console stage reads Calm once per render and misses an OS reduced-motion change | S |  | a Console test: motion setting 'system', fake matchMedia reduced=false, render; flip it to true and fire 'change'; assert Stage's calm prop  |
| desktop-companion-surfaces | Her depth pages are announced as 'Record' and 'Origins', twice each | S | none | views.test.tsx: the record and origins levels expose aria-label 'The record' / 'The apps she may act on' once (no nested region of the same  |
| desktop-companion-surfaces | A refused tab read tells the person 'read it with page_read' | S | none | translate.test.ts: translate(`tabs.read → not read: <each tabReadRefusal detail>`) has no snake_case token in title or sub; seeded red on to |
| desktop-companion-surfaces | Code inside bold in her markdown prints its backticks | S | none | rich.test.tsx: richText('**see `x`**') renders <strong>see <code>x</code></strong>; seeded red on today's literal backticks |
| desktop-companion-surfaces | Flipping a decision card leaves keyboard focus on the face turned away | S | none | jsdom slip test: press 'Read it first' -> document.activeElement is 'Back to the decision' and .sl-front is inert; press it -> focus returns |
| desktop-companion-surfaces | The engine line's live region wraps its own buttons | S | none | welcome render test: the [role=status] node contains no button; seeded red on today's EngineFact |
| desktop-mind-devices-sleep | A paired PC that removed this one reads as not checked yet, forever | M | none | devices.test.tsx render cases with a peer carrying link.state removed_there / awaiting_key / stale (fixtures + lib/fleet.ts PeerView.link):  |
| desktop-mind-devices-sleep | The online link's flow animates stroke-dashoffset forever, off the motion contract | S | none | a mind.css source-guard test (no @keyframes on stroke-dashoffset, durations from tokens) seeded red on today's CSS, plus a perf trace of the |
| desktop-mind-devices-sleep | A refused join clears the code the person typed, and Ask to join never reads its busy flag | S | none | a driven devices.test.tsx case: type a code, press Ask to join, re-render with errors.join -> the code still in the field (red today); with  |
| desktop-mind-devices-sleep | The Undo bar announces a bare count with a trailing separator: "Forgetting 1 ·" | S | none | sleep.test.tsx: the status span's text for forget-1, keep-all-3 and keep-one-contradiction carries a noun and no trailing separator (red tod |
| desktop-mind-devices-sleep | The RAM bar turns to the warning hue at 85%, a line the gate does not hold work on | XS | none | devices.test.tsx: a drawer at RAM 88% with held null and one at 93% held - the hue follows the chosen rule (one case is red today whichever  |
| desktop-mind-devices-sleep | A refused "Sleep now" keeps its old reason beside the button after she has slept | S | none | sleep.test.tsx: a refused answer plus a view whose last cycle is newer than the one current at the answer -> the refusal text absent (red to |
| desktop-mind-devices-sleep | The sky's legend names three link styles; the sky draws six | S | none | devices.test.tsx: for the typical fixture plus a pending request, every distinct data-state on .sky__link has a legend li (red today: none/p |
| desktop-mind-devices-sleep | A sleep proposal reads a per-proposal busy flag the store never sets | XS | none | the zero-writer grep (done), then typecheck/lint/test green with the read removed |
| desktop-tasks-and-due | Say a failed claim in her window: the runner's problem and run phases have no reader | S | none | companion/tasks.test.tsx: claimTask rejects -> the strip shows the runner's sentence while a task is queued; red on today's tree |
| desktop-tasks-and-due | Read the task runner's tab deadlines from its injectable clock, not Date.now | S | none | task-runner.test.ts: a fake ms clock advanced by wait(); the never-appearing tab fails with no_page in <100 ms real time |
| peer-devices | Show the requester's overlay address and the paired device it would replace | M | contract | pytest: pending_view carries `address` (the PeerRequest.client of the request) and `replaces` (the existing row's name when device_id matche |
| peer-devices | Answer pre-trust refusals after a fixed delay, as timing-defenses asks | M | policy-tighten | pytest over a real peer socket: a wrong_code / wrong_nonce / wrong_secret / 401 answer takes >= the documented delay, a success does not, an |
| peer-devices | Write an audit row for every mint, claim, revoke and pre-trust refusal | M | policy-tighten | pytest: approve, decline, claim, claim_spent, revoke, lapse and each pre-trust refusal append exactly one row (cause, pairing or peer id, re |
| peer-devices | Keep the peer tick's reap and reconcile off its outbound pair-back calls | M | none | pytest: a pair-back whose deliver_to is a socket that accepts and never answers; measure tick() wall time and the delay before an expired ro |
| peer-devices | Scope the phone page's live region to the conversation, not all of main | S | none | a jsdom harness for app.js (jsdom is in node_modules) that counts text inserted under aria-live regions during one scripted streamed turn an |
| peer-devices | Forget the phone's token in memory too when the beacon removes it | S | none | the same jsdom harness for app.js: a 401 on /peer/hello, then a visibilitychange to visible - count the requests that still carry the old be |
| proving-adopt-tiers | pick's incumbent delta is read over unpaired runs while the pick reads paired cells | S | none | a pick test with uneven coverage (opus-low 18 cells, haiku-low 12) asserting pick.runs and delta are over the 12 paired cells |
| proving-chores-uat | store.create sits outside the try in run_pair, run_interview and run_shape | S | none | a test whose SessionStore.create raises: assert a dump/record with the failure is written and the mkdtemp root is gone |
| proving-chores-uat | legs-per-interview formula is kept twice by hand and derived from neither loop | S | none | a test driving tests/proving/*/conftest FakeModel through 1, 3 and MAX_ROUNDS cards and counting legs against the formula |
| proving-adopt-tiers | the tier pick ranks configs without checking the order beats run-to-run noise | M | none | a script over a proving-runs/adopt-tiers/<date>/ dir computing per-config within SD of first_text_ms and round_ms against the between-config |
| proving-adopt-tiers | audit usage counts the brief writer's legs while audit p50 leaves them out | S | none | a score_interview test with audit and brief legs and their ledger rows asserting usage legs == latency legs for the audit role |
| proving-chores-uat | the numbers audit's desktop mirror is pinned by hand, with no test derived from the TS | M | none | a vitest emitting every shipped playbook's page lines from worth.ts/model.ts to a JSON fixture, and a pytest comparing numbers.headline over |
| proving-forge | A generator call that failed is a permanent refusal against the model | S | none | a ScriptedRole generator that fails 1 of 4 calls with engine_error, run through stage_forge twice (second as a resume): valid_rate and the c |
| proving-docread | An oversized picture's no-call row is charged as an unpriced call on resume | XS | none | a ledger.jsonl holding one over-edge docread.vl row: Budget.calls(NEMOTRON) after restore_budget on both arms, plus the live session's figur |

## Owner triage of Lane C - 2026-10-27

Approved to build (14): bound case receipts; promote/erase replicate; erase scrubs journals; adopt keeps project (space_id); gate ignores stale reading; wrong codes age out; docread UNRESOLVED verdict; omitted motion channel = no say; face fades in; judge word range (enforce 80-200); welcome cloud claim; 'known' means confirmed; failed not 'finished'; one 'more' in the due line.

Declined (2): judge drift anchors (both benches); failed-form fallback in the waking Face step.

Dispatch: after Lane B, folded into the same write-set group as the Lane B cards that share their files.

## Owner decisions - 2026-10-27 (after Lane B)

- First-paint ceiling raised to 167,200 B (owner): build the shared daemon request door and the console reduced-motion fix.
- Build: omitted motion channel with face.rs (Rust granted); tier pick ties on run-to-run noise.
- Declined: forge failed generator call stops counting as a refusal (today's rule stands).

## Status - 2026-10-28

Audited against git history: all 16 Lane C and all 48 Lane B cards are built (61) or declined (3: judge drift anchors, failed-form fallback in the waking Face step, forge failed-generator rule). None is open. Cards are matched to commits by title (see `git log --since=2026-10-27`); each card's instrument test was not re-run in the audit.
