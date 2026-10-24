# Athena in parallel, everywhere - v2 concept

Status: **concept, not built** (2026-10-24). This is the second half of the fleet-surfaces spark. v1
(ADR 0141, built in the same package) gives Athena a lock per thread, a composer that never
closes, and up to three delegated tasks, each driving an app on a tab of its own. v2 is what the
operator asked for beyond that. Tasks reach other computers. Voice works for parallel work. The
main window, her window and the phone page show the same tasks in the same words, with the same
three controls.

**How to read the citations.** A bare path is this repository at `550d107e`, the v1 wire-contract
commit, so the line numbers do not move under v1's builders. A path that starts with `personas:`
is the Personas repository (`C:\Users\kazda\kiro\personas`) at `4ae23c82ca` (2026-10-24). Personas
is read as evidence of a working design, not as a dependency. The design decisions say outright:
no hand-off to Personas. Registry subjects are named by slug.

## The problem

Before v1, Athena did one thing at a time on one computer, and the person could see that only
in the window that was doing it.

- One daemon-wide lock serialises every turn: `src/athena/daemon/server.py:258-259` ("One turn at a
  time"). It is held for the whole turn, typed or spoken (`src/athena/daemon/routes.py:894-905`).
- Her composer closes while a turn runs: `apps/desktop/src/companion/model.ts:1306-1309` returns
  "A turn is already running.". The run store has one phase and one request in flight
  (`apps/desktop/src/stores/run.ts:86`, `:1286`).
- Each round is a fresh CLI process (`src/athena/harness/transports.py:210-222`). The CLI session
  ids it resumes from live in a dict in memory (`src/athena/harness/cli_harness.py:331-332`).
- Another device's message works only while the target's window is open to take it. It is
  offered for 3 s, every 0.5 s (`src/athena/peer/remote.py:127-130`), then refused with `409
  window_closed` (`:397-400`). It is held in memory only (`:191-192`). Nothing waits for the
  window to come back.
- The phone page has cards, a conversation and a composer, and nothing else
  (`src/athena/peer/mobile/app.js:434`). Its Send button is disabled while a message is out
  (`:463-466`), and a busy computer is reported as "Athena is busy with something else" (`:489`).

v1 fixes the first two on one computer. v2 is about the rest: more than one computer, the voice,
and the three surfaces.

## What v1 ships

The fleet-surfaces design decisions (operator, 2026-10-24), as the wire contract commit fixes them:

- **A lock per thread.** A second `/run` into a running conversation gets `409 thread_busy` before
  any SSE header. `POST /run/stop` gains `conversation_id` beside `origin`
  (`apps/desktop/src/lib/api.ts:367`).
- **The composer never closes.** A message typed mid-turn is classified as interrupt or queue. A
  queued message is shown in a visible list and drained when the turn ends.
- **Only Athena delegates.** `core.delegate` files a task, `core.tasks` lists them and
  `core.task_stop` kills one. The user has no "run in background" button; the operator ruled that
  out.
- **Tasks are durable rows that her window executes.** Six statuses
  (`apps/desktop/src/lib/tasks.ts:12`). At most 3 run and 10 wait (`:14-15`). Each task has its
  own conversation, `conv_task_<hex>`, and one tab. The window claims, runs and finishes a task
  through `/tasks*` (`apps/desktop/src/lib/api.ts:370-389`). Every status change is published as
  `task.changed` (`apps/desktop/src/lib/fleet.ts:153-155`). When the daemon starts, rows that
  were running are marked `interrupted`. A finished task leaves a system episode in the parent
  thread.
- **Tasks are visible in two places.** A strip above her composer
  (`apps/desktop/src/companion/tasks.tsx:1-6`) and a row beside her illustration on the main page
  (`apps/desktop/src/scenes/surface/tasks.tsx:1-7`). Both read one store
  (`apps/desktop/src/stores/tasks.ts:15-25`) and both offer kill and ask.
- **Presence per peer.** `online | asleep | unreachable | null`, from a daemon probe every 30 s
  (`apps/desktop/src/lib/fleet.ts:44-48`).

v1 rejected cross-device dispatch, the outbox, a task UI on the phone, changes to voice, warm CLI
processes and cost caps beyond the cap of 3. All of them are here.

## The transparency contract

Every surface where Athena appears lets the person do three things about parallel work, each in
one step from where the surface rests:

| Verb | What the person gets | The one source |
| --- | --- | --- |
| **See** | What is running, what is waiting and its place in line, on which computer, for how long, and what ended in the last day and how. | `GET /tasks` and `task.changed` (v1). Remote rows are added in Pillar 1. |
| **Ask** | "How is <title> going?" goes to Athena as an ordinary message in the thread the person is in. She answers from `core.tasks` and the task's own conversation. | The message path the surface already has. |
| **Stop** | The task is stopped. Its tab is kept, the row reads `killed`, and the parent thread gets one line. Stopping is idempotent: one that had already ended answers `stopped: false` (`apps/desktop/src/lib/api.ts:387-389`). | `POST /tasks/<id>/stop` (v1), forwarded for remote rows. |

Three rules hold on every surface:

1. **No silent outcome.** A refusal (`queue_full`, an unreachable computer, a missing app) is shown
   in words where the person asked. A message the surface queued is visible until it is sent. This
   is the "never discard silently" rule of `conversation-orchestration` ("Conversing while busy").
2. **Unknown is said as unknown.** A remote task whose last report is older than its freshness
   window reads "no word from <computer> since 14:02", never "running". Personas gives a quiet
   remote session `unknown` after 45 s, three 15 s health ticks
   (`personas:src-tauri/engine/src/p2p/remote_sessions.rs:52-55`).
3. **One vocabulary.** The six task statuses get one set of words and one set of colours, defined
   once and used by all three surfaces (Pillar 3). This is the `status-vocabulary` standard.

## Pillar 1 - Cross-device dispatch

### Today

A PC reaches another PC only through the remote composer. The message is a request into the other
computer's panel, not a job. It needs that computer's window to accept within 3 s
(`src/athena/peer/remote.py:15-24`, `:213-240`). It holds no more than 32 messages at a time
(`:137`) and keeps a turn for 10 minutes after its last event (`:131-132`). It lives only in
memory, so a restart on either side loses it. The asking side can come back to a stream it has
partly read, with `from=<n>` (`:46-51`). That is the one piece of resume the composer has. The
composer device chip and auto-routing are not built (ADR 0140,
`docs/adr/0140-one-athena-pairs-devices-over-a-private-overlay.md:240-242`).

Since device-vitals (ADR 0143), each PC already knows every paired PC's room: the authorized hello
carries a vitals snapshot (RAM, CPU, GPU, power, disk, task slots, why work waits), `GET /devices`
shows it for 90 s, and Athena is told it in `frame.fleet` and through `core.devices`. She advises
where work would fit; nothing sends it there. Dispatch inherits this as its input: the receiver's
own gate already holds a task it has no room for, with a reason the sender can show.

### What Personas does

- **A persisted outbox.** A job sent to a paired device that is not connected is written as
  `queued` and drained, oldest first, when the link next comes up. A send that gets no answer goes
  back to `queued` instead of failing ("waiting for a peer is a suspension, not a failure")
  (`personas:src-tauri/engine/src/p2p/remote_jobs.rs:60-69`). The flow, with the offline branch, is
  drawn at `:25-45`.
- **Bounded exchanges.** The ack must arrive within 15 s and a resume exchange may take 30 s
  (`:112-115`). A steering command gets 10 s, under the ack timeout, so the originator hears a
  refusal instead of timing out (`:116-119`).
- **Exactly once, by the schema.** Every progress note is written before it is sent. On reconnect
  the originator sends the highest contiguous note it holds, and the runner replays what is above
  it. Notes are keyed `(job_id, seq)`, so a redelivered note is ignored (`:71-83`). Accepting a
  job is idempotent on its id (`:66-68`).
- **A trust gate in one place.** Every job frame from a sender without an `owned_devices` row is
  refused, with a reason (`:47-58`).
- **The runner's end.** A remote instruction runs as a real Athena turn with her full set of
  operations and her own approval rows. It writes one closing episode on the device that did the
  work, so that device can say what it has been doing
  (`personas:src-tauri/src/companion/remote_jobs.rs:7-14`, `:27-39`). A job can never be left
  `Running`. The turn runs in an inner task whose panic is caught. It has a 27-minute ceiling
  (`:83-88`). At startup, every inbound job still marked `Running` is failed with a plain reason
  (`:41-59`, `:690-712`).
- **The originator's end.** The other device's result becomes an episode in this Athena's memory
  (`:15-18`). A `fleet_session` result is checked before it is remembered: the pushed SHA is
  fetched and verified (`:19-25`, `:586-590`). This is the `result-harvest` technique.
- **Live views beside the durable lane.** A latest-wins mirror of the remote session is persisted
  on the originator so that a restart paints a tile. An output tail is lossy and bounded: 64
  entries, 4 frames a second (`personas:src-tauri/engine/src/p2p/remote_sessions.rs:7-16`,
  `:37-48`). A finished session stays listed for an hour (`:56-57`).
- **Liveness.** Each device sends a snapshot of itself on every 15 s health tick, on link-up and
  on change. The snapshot is not persisted and not replayed
  (`personas:src-tauri/engine/src/p2p/mesh.rs:5-25`). It counts as live by the receiver's clock
  for 45 s (`:27-34`, `personas:src-tauri/core/src/models/device_mesh.rs:37`).
- **Moving queued work.** A queued local entry can move to a paired device. The local entry is
  cancelled only after the peer accepts. If the peer is offline, no job is created, because an
  outbox job would wake later and leave two live copies
  (`personas:src-tauri/src/mesh/queue_move.rs:1-15`).

### v2 mechanism

A remote task is a v1 task whose executor is another computer. The task row on the target is an
ordinary row. The originator keeps an **outbound row** in a durable outbox. The target admits it,
and its window claims it like any local task.

1. **Admission on the target, not on a window.** v1 already made the daemon the admission
   authority with durable rows. A remote task therefore needs only the target **daemon**, not its
   window: the row waits `queued` until that window lives and claims it. This removes the 3 s
   window-open requirement for tasks. Chat keeps it.
2. **The outbox on the originator.** `core.delegate` gains `device: <peer_id> | null`. A non-null
   device writes an outbound row (`outbound_tasks`: job id, peer id, title, brief, app id, status,
   last note seq, last mirror, timestamps) before anything is sent. If the peer is not `online` by
   the v1 presence probe, the row stays `queued` and the call returns "queued for <name>". The
   presence probe's change to `online` (published as `peer.changed`) is the drain trigger, oldest
   first. Personas drains on link-up. This overlay has no persistent link, so the presence edge
   stands in for it.
3. **A peer verb, closed and granted.** `POST /peer/tasks {job_id, title, brief, app_id}` creates
   the target row, idempotent on the originator's `job_` id. `job_` is the id kind the remote
   composer already mints for "a job one device hands another" (`src/athena/peer/remote.py:13`).
   The target refuses at the door, before persisting, when the app is not installed there
   (`app_not_here`) or its queue is full (`queue_full`, v1's cap). Personas refuses a
   `fleet_session` whose project is missing in the same way, at admit
   (`personas:src-tauri/src/companion/remote_jobs.rs:119-131`). The verb needs a new grant,
   `delegate`, beside `chat`, `approve` and `memory` (`src/athena/peer/registry.py:58`). The
   listener checks grants in one place (`src/athena/peer/listener.py:15-18`). This is the
   `device-pairing` verb-allowlist rule: a paired device's authority is a written list of verbs.
4. **Reports pulled, numbered and resumable.** The target writes numbered notes for each remote
   task: status changes, a one-line progress note per round, the result. The originator reads
   `GET /peer/tasks/<job_id>?from=<seq>`. This is the `from` discipline `/peer/turns` already has
   (`src/athena/peer/remote.py:46-51`), applied to a durable table. Notes are keyed
   `(job_id, seq)` on both sides, which makes redelivery harmless, as in Personas. With no
   persistent link, the originator polls while the row is active and the peer is online, and
   stops when it is not.
5. **Stop is a forwarded verb.** `POST /tasks/<id>/stop` on an outbound row sends
   `POST /peer/tasks/<job_id>/stop`. The row reads `stopping` until the target's note says
   `killed`. If the peer is unreachable, the outbound row is marked `killed (not confirmed)` and
   the stop is retried on the next drain. The originator never pretends the remote work stopped.
6. **Cards stay where the work runs.** A gated action raised by a remote task goes into the
   target's card stack. A device holding `approve` can already answer it there
   (`src/athena/peer/remote.py:53-59`). The originator's task row shows "waiting for you on
   <name>" with the card, answered through `/devices/<peer>/...` like the remote composer's relay.
7. **Harvest on the originator.** A terminal note writes one system episode into the parent thread
   on the originating computer. The target writes its own closing episode. Personas does the same
   with one episode at each end (`personas:src-tauri/src/companion/remote_jobs.rs:7-18`).
8. **Restart on either side.** On the target, v1's sweep marks running rows `interrupted` and that
   becomes the remote task's terminal note, replayed on the next pull. Personas does the same in
   `sweep_interrupted` (`:690-712`). On the originator, outbound rows survive because they are
   rows. Pulls resume from the stored seq.

The remote composer stays as it is for chat. One cleanup follows from v1. Local typing now waits
behind a remote exchange because the daemon ran one turn at a time
(`docs/adr/0140-one-athena-pairs-devices-over-a-private-overlay.md:339-342`). With a lock per
thread, a remote exchange can run in a conversation of its own, and the person's typing no longer
queues behind it.

## Pillar 2 - Voice-first parallel work

### Today

- Voice is a transport, not a feature. A spoken utterance runs the same turn generator as typed
  text, under the same lock and the same gate (`src/athena/channels/voice/gateway.py:3-5`). Once
  v1 has a lock per thread, a spoken turn takes its thread's lock and no other.
- One worker per connection runs utterances one at a time. One speaker plays lines in order
  (`gateway.py:26-31`). Barge-in is a generation counter: an interrupt stops the line playing and
  every line queued behind it (`gateway.py:33-37`, `apps/desktop/src/stores/voice.ts:22-24`).
- What an utterance is gets decided exactly, never fuzzily. A stop word means stop only while
  something is being spoken. "approve" answers the newest card. Everything else is a message
  (`src/athena/channels/voice/commands.py:5-16`, `:39-42`, `:81-96`).
- The halo, the edge glow on every screen, is ADR 0027. Her window is its only producer
  (`apps/desktop/src/athena.tsx:60-61`). It has five phases, with `gate` shown whenever a card
  waits (`apps/desktop/src/lib/halo-signal.ts:13`, `:53-57`). It carries a phase, a level, a card
  count and a caption (`:30-36`). At rest it costs nothing: with nothing waiting, the overlays
  hide 4.5 s later
  (`docs/adr/0027-athena-is-ambient-a-halo-on-every-screen-and-the-summon-chord-held-is-push-to-talk.md:67-70`).
  ADR 0138 is her voice's tone (`halo` vs `natural`,
  `docs/adr/0138-athena-speaks-with-a-halo.md:24-28`). It is not the ambient signal.

### v2 mechanism

- **Ask by voice.** This needs no new recogniser. "How is the invoice task going?" is a message.
  It reaches Athena in the person's thread, and she answers from `core.tasks`. What v2 adds is a
  spoken shape for that answer: one sentence per active task, title, state and elapsed time, at
  most three before "and two more waiting". Status words come from the shared vocabulary.
- **Stop by voice, through her.** "Stop the invoice task" is a message, and Athena calls
  `core.task_stop`. A new exact recogniser kind is the alternative: "stop task" plus an exact
  title, beside `stop` and `answer`. It would bypass the model but has to match a title exactly,
  and the commands module refuses fuzzy matching on purpose (`commands.py:13-16`). Recommendation:
  go through her, since she can ask "the invoice one or the reminder one?". The bare stop words
  keep their meaning: they stop her speech, never a task.
- **Hearing a completion: one arbiter.** v2 adds speech that no turn asked for, such as "the
  invoice task is done". The `voice-io` standard requires one arbiter: at most one voice audible,
  priority by declared class, and the global mute absolute (`voice-io`, techniques
  `voice-ux-integration` and `unattended-caller-attribution`). Today the speaker only orders one
  connection's own reply lines (`gateway.py:29-31`). This is a known gap: there is no arbiter for
  speech that is not a reply. v2 puts a small arbiter in front of the speaker. A completion notice
  is the lowest class. It is never spoken over the person or over a reply. It waits for a gap, or
  becomes text only after 30 s. Under mute it is never spoken. One of the same kind replaces
  another waiting, so a burst of three completions becomes "three tasks finished".
- **The halo shows outcomes, not activity.** A running background task does not light the
  edges. Lighting them would break "rest costs nothing" and make every task an ambient alarm. A
  task that finishes, fails or stops shows a two-line caption ("Invoice reminders - done"), using
  the `caption` field that already exists. A task's card shows as `gate` pink, as every card does
  today. `HaloSignal` keeps its five phases and gains nothing.
- **Push-to-talk during a task.** Hold-to-talk composes into the thread the person is looking at,
  under that thread's lock (`conversation-orchestration`: "voice affordances share the same
  locks"). A task never owns the microphone.

## Pillar 3 - One task language on three surfaces

### The three surfaces

| Surface | Where it lives | v1 task UI | Executes tasks |
| --- | --- | --- | --- |
| Main window | `scenes/surface` | tasks row beside her illustration | no |
| Her window | `companion/` | strip above the composer | yes (claims, binds a tab, runs) |
| Phone page | `src/athena/peer/mobile/`, served at `/m/` (ADR 0140) | none (`app.js:434`) | never: no tabs, no hands |

The phone page is hand-written HTML, CSS and one ES module, with no build step and no dependency
(`docs/adr/0140-one-athena-pairs-devices-over-a-private-overlay.md:246-249`). It asks for `chat`
and `approve` (`src/athena/peer/mobile/app.js:24`). It polls cards every 5 s while visible
(`app.js:22`, `:380`).

### v2 mechanism

- **One status vocabulary.** Each status has one entry with its word, its tone token and its
  sentence form:

  | Status | Word | Spoken / sentence |
  | --- | --- | --- |
  | `queued` | waiting (2nd) | "waiting, second in line" |
  | `running` | working, 4 min | "working for four minutes" |
  | `done` | done | "done" plus the result line |
  | `failed` | failed | "failed:" plus the error line |
  | `killed` | stopped | "stopped by you" |
  | `interrupted` | cut off | "cut off by a restart" |

  The table lives once in TypeScript beside `lib/tasks.ts`. The phone page cannot import it
  because it has no build step. It carries a copy, and a test holds the two equal. Remote rows add
  one qualifier, "on <computer>", plus the unknown state from the contract.
- **The phone gets See, Ask and Stop.** A task section sits under the cards, using the same 5 s
  poll. It reads `GET /peer/tasks` under `chat`. Ask is a normal phone message. Stop is
  `POST /peer/tasks/<id>/stop`. Which grant Stop needs is an open question.
- **The same composer rules everywhere.** The phone's Send button stops being disabled while a
  message is out (`app.js:463-466`). A second message is shown as queued and sent when the first
  exchange ends, so the phone follows `conversation-orchestration` like her window does. "Busy"
  stops being a refusal (`app.js:488-489`) because a lock per thread leaves nothing to be busy
  with.
- **Same quality bar.** The main window and her window share `components/TaskRow.tsx` (v1). The
  phone page mirrors its anatomy: title, app, device, status word, elapsed time, Stop and Ask, in
  the same order, at 12 px or larger. The UAT pass for v2 walks each of the three verbs on all
  three surfaces, nine cells, and a missing cell blocks the release.

## Pillar 4 - The engine room

### Warm CLI processes per thread

- Today each round spawns the CLI (`src/athena/harness/transports.py:210-222`). The static half of
  the prompt goes to the first invocation and later turns resume
  (`src/athena/harness/cli_harness.py:10-13`). Codex never resumes (`:17`).
- Personas keeps one long-lived `claude --input-format stream-json` process per conversation for
  the person's own turns. Measured: a warm turn shows first text in about 2 s against 3.4-5.0 s
  cold (`personas:src-tauri/src/companion/session/warm.rs:1-7`, `:11-20`). It writes only a stable
  prefix to the system prompt and puts the per-turn context at the top of the user message
  (`:21-31`). Athena's two-output composer (ADR 0006) already splits the prompt the same way. It
  warms only `User` turns, never autonomous or background ones, so a background tick cannot hold
  the person up (`:32-35`). Interrupt is a stream-json `control_request` that ends a turn in about
  150 ms (`:36-41`). Idle processes are reaped after 20 minutes (`:85-87`). A process is never
  asked for two turns at once because the per-conversation turn lock serialises them (`:19-20`).
  v1 gives Athena that precondition.
- **v2:** warm the person's focused thread only, on the Claude dialect only. Tasks stay
  spawn-per-round because they are background work. Interrupt becomes a control line instead of a
  process kill.

### Durable resume of in-flight tasks

- v1 marks running rows `interrupted` at daemon start and stops there. Resuming needs two things
  that are in memory today: the CLI session id per conversation
  (`src/athena/harness/cli_harness.py:331-332`) and the page sessions, which are in memory on
  purpose (`src/athena/daemon/sessions.py:3-8`). Personas persists the CLI session id per
  conversation (`personas:src-tauri/src/companion/session/transcript.rs:117-125`).
- **v2:** persist `conversation_id -> cli session id` for `conv_task_*` only. Page sessions stay
  in memory, matching the reason recorded for them. An interrupted task whose last round left no
  host call unanswered goes back to the head of the queue as `queued` with a `resumed` note. Its
  first round is told the page was reloaded and asked to check where it was. A task interrupted
  with a host call outstanding stays `interrupted`, with a Resume action for the person: nobody
  can know whether the page ran that call.

### Cost caps

- Today the ledger writes one row per model invocation, with `conversation_id` and `cost_usd`
  (`src/athena/core/ledger.py:1-6`, `:94`, `:101`). A task's spend is therefore already a
  `SUM(cost_usd) WHERE conversation_id = 'conv_task_<hex>'`. Nothing caps it. Rounds are bounded
  by `MAX_CONTINUATIONS = 8` per exchange (`apps/desktop/src/stores/run.ts:78`), not by money.
- Personas passes `--max-budget-usd` per spawn
  (`personas:src-tauri/engine/src/prompt/cli_args.rs:132-139`). It also has a run-level ledger
  whose ceiling is a launch gate, not a kill, because a spawn's cost is known only after it ends
  (`personas:src-tauri/src/engine/run_budget_DESIGN.md:38-40`). Enforce mode is opt-in and off by
  default (`personas:src-tauri/core/src/run_budget.rs:81-87`). That module's header still says
  "warn-only (today)" (`:20-24`).
- **v2:** each task carries a `budget_usd` set by `core.delegate`, with a default from settings.
  The daemon checks the task's ledger sum before admitting each continuation `/run` for a
  `task_id`. It refuses with `budget_spent` and the task fails with "stopped at its $0.50 budget".
  The Claude dialect also passes `--max-budget-usd` with what is left. Unpriced rows
  (`cost_usd` NULL) count as unknown: a task whose spend is unknown is shown so and is not
  treated as $0.

### Priority and fairness

- v1 promotes the oldest queued row (`POST /tasks/claim`), first in, first out.
- Personas' fleet door promotes in rank order and skips rows whose time gate is ahead
  (`personas:src-tauri/src/commands/fleet/queue.rs:16-24`). It refuses at a depth bound with a typed
  `queue_full` that names the cap (`:53-63`, `:392-404`). Persona executions have three named
  priorities (`personas:src-tauri/engine/src/queue.rs:16-29`). An entry evicted from a full queue
  is owed a refusal (`:69-72`). Backfill ages an unfit entry out after 5 skips or 30 minutes
  (`personas:src-tauri/src/commands/fleet/budgets.rs:55-58`).
- **v2:** two named priorities, `now` ("the person is waiting on this") and `background`, set by
  Athena when she delegates. Fairness across parent threads: while another thread's task waits,
  one thread holds at most 2 of the 3 running slots. Waiting work is aged: a `background` task
  passed over for 15 minutes is treated as `now`. This is the `admission-queue` technique
  `priority-and-fairness`.

### A CPU and RAM governor

- Personas samples host load every 3 s. It pauses new admissions at 70% CPU or 90% RAM and
  resumes below 55% and 88%. Running work is never interrupted
  (`personas:src-tauri/src/engine/resource_governor.rs:1-16`, `:26-35`). Its fleet door also
  charges each dispatch in machine and plan units, not a bare count
  (`personas:src-tauri/src/commands/fleet/budgets.rs:1-21`).
- **v2:** a governor in front of `POST /tasks/claim` only. Running tasks are never touched. A
  claim refused for load reads "waiting: this computer is busy". Core Python is stdlib only
  (ADR 0002), so the sample comes from `ctypes` on Windows (`GlobalMemoryStatusEx`,
  `GetSystemTimes`), not from a package. On other platforms there is no sample, and the governor
  says so instead of passing silently. This is the `admission-queue` technique
  `load-aware-admission`.

## Standards this binds

- `conversation-orchestration` - "Conversing while busy": the thread lock, the open composer,
  honest interrupt, voice under the same locks. v1 closes the deviation on her window. v2 extends
  it to the phone.
- `fleet-orchestration` - `durable-fleet-state` (outbound rows and notes are rows; terminal states
  are not lossy), `parallel-dispatch` (one door, queued rows keep their identity when promoted),
  `result-harvest` (an episode at each end; a remote result that never came is reported as such).
  `.ai/registry-map.json` records this subject as not-applicable to daemon-service. That verdict
  assumed no fleet: its evidence is the one writer lock at `src/athena/daemon/server.py:258`. It changes with v1 and should be re-judged with `/conform`.
- `admission-queue` - `priority-and-fairness`, `load-aware-admission`, `depth-bounds-and-shed`.
- `device-pairing` - `verb-allowlists` (the `delegate` grant and the closed `/peer/tasks` verbs).
- `voice-io` - `voice-ux-integration` (one arbiter, absolute mute), `unattended-caller-attribution`
  (unrequested speech ranks last).
- `status-vocabulary` - one table of words for six statuses on three surfaces.

## Open questions

1. **Which grant may stop a task from the phone?** `approve` already means "this device decides
   here". A new `tasks` grant would be narrower, but every phone already paired would have to ask
   for it again.
2. **Can a phone delegate?** Today only Athena delegates, by operator decision. A phone message
   that makes her delegate is consistent with that. A phone "run this in the background" button
   would not be.
3. **Auto-routing.** Should Athena pick the computer for a task from presence and installed apps,
   or only when the person names one? ADR 0140 leaves auto-routing unbuilt
   (`docs/adr/0140-one-athena-pairs-devices-over-a-private-overlay.md:242`).
4. **Remote task freshness window.** Personas uses 45 s. The overlay probe here runs every 30 s, so
   the window is probably two probes plus one poll, about 75 s. This should be measured on a real
   tailnet.
5. **Resume after an outstanding host call.** Is a manual Resume enough, or should the task's
   first round read the page and decide? The second is cheaper for the person and riskier for a
   gated app.
6. **Spoken completions with her window hidden.** ADR 0027 runs a push-to-talk turn with her
   window hidden
   (`docs/adr/0027-athena-is-ambient-a-halo-on-every-screen-and-the-summon-chord-held-is-push-to-talk.md:58`). Is a
   completion spoken then, or only shown as a caption until the person next speaks?

## Non-goals

- Handing tasks to Personas, or running Personas' fleet. The two products stay uncoupled.
- A user-triggered "run in background". Only Athena delegates (v1 operator decision).
- CLI-native subagent fan-out inside one turn.
- Tasks executed on the phone. It has no tabs and no hands, and it sees, asks and stops only.
- HTTPS for the phone page through `tailscale serve`. ADR 0140 declined it for security reasons
  (`docs/adr/0140-one-athena-pairs-devices-over-a-private-overlay.md:263-274`), and nothing here reopens that.
- Live terminal mirroring of remote tasks. Personas' output tail serves terminal sessions. A task
  here drives a web app, and its progress note per round is enough.
- Moving a running task between computers. Only queued work moves, and only after the peer
  accepts, as Personas does (`personas:src-tauri/src/mesh/queue_move.rs:8-14`).

## Phased order

1. **v2.0 - the contract on all three surfaces.** The status vocabulary table and its parity test,
   the phone's task section with See, Ask and Stop (local rows only), the phone composer never
   disabled. Small, and it makes v1 visible everywhere before anything new can go wrong.
2. **v2.1 - money and restart.** Task budgets checked against the ledger, a persisted CLI session id
   for `conv_task_*`, and resume for interrupted tasks. Remote tasks live longer than local ones,
   so both must hold before Pillar 1.
3. **v2.2 - cross-device dispatch.** The `delegate` grant, `/peer/tasks*`, the outbound table, the
   drain on the presence edge, numbered notes, forwarded stop, harvest at both ends, and remote
   rows on all three surfaces with the unknown state. Which PC to send to reads the vitals the
   hello already carries (ADR 0143), and a held receiver keeps the job queued with its reason.
4. **v2.3 - voice.** The speech arbiter, spoken task summaries, completion notices, halo captions
   for outcomes.
5. **v2.4 - speed and fairness.** A warm process for the focused thread, priorities and the
   per-thread share, the claim governor. Each can be measured on its own: time to first text,
   wait per class, refusals under load.
