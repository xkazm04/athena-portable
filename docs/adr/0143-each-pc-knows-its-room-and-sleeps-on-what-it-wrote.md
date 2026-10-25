# 0143. Each PC knows its room, and sleeps on what it wrote

Date: 2026-10-24 (spark device-vitals)

Builds on [0141](0141-a-turn-locks-its-thread-and-athena-delegates.md): the task cap of 3 stays the
ceiling and the cost control; the gate below can only lower it. Builds on
[0140](0140-one-athena-pairs-devices-over-a-private-overlay.md): the vitals ride the presence
probe's authorized hello. Adds two members to the closed reason vocabulary of
[0005](0005-approvals-and-the-ledger-live-in-the-brains-index.md)'s ledger.

## Context
Since 0141 a PC runs up to three delegated tasks beside the person's own threads, and each holds an
engine child (`claude.exe` peaked at 370-570 MB across 7 processes, measured 2026-10-24 on one
Windows PC). Nothing looked at the machine before starting one. On a PC that is already short of
RAM, busy compiling, on a low battery or out of disk, a task started anyway and died blank: the
engine said nothing, hit the wall, or was stopped by the plan's usage limit. Each still cost a turn,
and the ledger filed all of them as `engine_error`, beside an engine that could not start at all.
So nobody could see how many runs ended with nothing, and nothing kept the next one from starting
into the same lack of room.

Every PC already runs its own daemon, its own ledger (ledgers are not replicated) and a presence
probe that says hello to each paired PC every 30 s. The standard library can read every figure the
gate needs; ADR 0002 keeps it that way (no psutil).

## Decision

### Vitals: one reading, stdlib only
- `athena.vitals.probe.Probe` reads CPU load, cores, RAM total and *available*, NVIDIA GPUs, mains
  or battery and the charge, and free disk on the brain's volume. Windows uses `ctypes` on
  `kernel32` (`GlobalMemoryStatusEx`, `GetSystemTimes`, `GetSystemPowerStatus`); Linux
  `/proc/meminfo`, `/proc/stat` and `/sys/class/power_supply`; macOS `sysctl`/`vm_stat` for RAM only.
  Disk is `shutil.disk_usage` everywhere. The GPUs come from one `nvidia-smi --query-gpu=...` with a
  3 s timeout (67 ms measured); a machine without `nvidia-smi` is remembered as such for the life
  of the process.
- **Every failure is `None`, never a raise, and `None` is never zero.** `gpus` is `[]` when the
  query ran and listed nothing. CPU is `None` on the first reading, because a load is a difference.
- A sampler thread reads every 5 s (the GPUs every 30 s) and keeps only the latest reading. It runs
  in `athena serve` only.

### The gate: slots, room and a named reason
- One `Gate` per PC holds background work, with hysteresis, on RAM >= 92% (resumes below 85%), CPU
  >= 90% for 3 readings in a row (resumes below 70%), battery below 30%, and less than 1024 MB of
  free disk. A sleep cycle (`held(sleep=True)`) is held by RAM alone (amended 2026-10-24, owner
  decision): its heavy work is a model leg elsewhere and its local part one CLI child of about
  330 MB, and in the smoke a workstation saturated by unrelated work held it on CPU two runs in
  three. A busy CPU, a battery or a fullish disk would have starved the maintenance that keeps
  memory healthy on exactly the PCs that work hardest.
- `held` is a sentence for a person that starts "Waiting for room" and names the figure, e.g.
  "Waiting for room: RAM is at 93% (resumes below 85%)." The windows show it verbatim.
- `slots = min(3, running + floor(max(0, ram_total * 85% - used) / charge))`, where `running` is the
  tasks running plus a running sleep cycle, and `charge` is the median `peak_mb` of the ledger's
  newest 20 measured turns (600 MB until one is measured). `room` is `full` when held, `tight` when
  `slots <= running`, else `ok`.
- **Unknown fails open.** A figure that could not be read holds nothing. Unknown RAM leaves the
  slots at the cap and `room` at `null`.
- `POST /tasks/claim` asks the gate (`Tasks.room`). When it holds, or the slots the RAM allows are
  taken, it answers `{"task": null, "held": "<sentence>"}`; `held` is `null` on a claim that worked
  and when the cap itself is the limit (the queue working, not a PC short of room). `GET /tasks`
  gains `slots` and `held`. With no gate both behave as before.
- `GET /vitals` answers `{"vitals": VitalsView}`; a change of `room`, `held` or `slots` publishes
  `vitals.changed {room, held, slots}` on the event bus, and only then.

### The fleet: vitals on the hello
- The authorized `GET /peer/hello` carries this PC's `vitals`. The presence probe keeps each peer's
  latest with the moment it arrived, re-typed key by key (a peer's answer is data). Older than 90 s
  it is not shown or told: a stale "room ok" is worse than none. A phone has none.
- `GET /devices` shows `vitals` on each peer row and on `self`. `peer.changed` fires when a peer's
  `room` or `held` changes, not on every number.
- `VitalsService.fleet()` lists this PC first, then each paired device with its presence and fresh
  vitals: the `FleetSource` Athena's prompt and `core.devices` read.

### Blank runs are counted, by the PC that ran them
- `ERROR_REASONS` gains `no_answer` (a turn with no text and no tool calls, which was
  `engine_error`) and `usage_limit` (the CLI's `limit` failure class, which was `engine_error`).
- `companion_turn` gains `peak_mb INTEGER`, the peak working set of the engine child for the turn:
  `PeakWorkingSetSize` from `GetProcessMemoryInfo` on a handle opened at spawn and held across the
  exit on Windows, the largest `VmHWM` sampled from `/proc/<pid>/status` on Linux, `NULL` elsewhere
  and for an API engine. It is added by `ALTER TABLE` guarded by `PRAGMA table_info`.
- `Ledger.runs_summary(hours=24)` is the vitals' `runs`: `blank` = `no_answer` + `timeout` +
  `usage_limit` + `tasks_empty` (tasks that finished `done` with no result), `failed` = every other
  error. Rows with zero rounds (a declined card) are records, not runs, and are not counted. There
  is no device column: each PC's ledger already holds only its own turns.

## Athena knows her fleet

Each PC's room reaches Athena two ways. Neither of them can start work anywhere.

**`frame.fleet`, in every turn.** `compose(..., fleet=...)` adds a frame block headed
"## Your devices", placed after `frame.project`. It is omitted when `fleet` is `None` or blank. The
body is written by `athena.lane.fleet.FleetPrompt` (the `lane.ports.FleetPort` protocol,
`prompt_text() -> str | None`). `FrameBuilder.fleet` asks it once per frame and never remembers the
answer: the block is short and is rendered whole, so it has no delta to keep. The body is:

- one lead line: "Each PC's room now, as its daemon measured it; a figure left out is unknown.";
- one line per device, this PC first. For example:
  - `This PC (studio): room ok - RAM 40% of 64 GB, CPU 10%, RTX 4090 1.5/24 GB VRAM, mains; 3 task slots. Slept 5 h ago.`
  - `laptop: room full - RAM 90% of 16 GB, battery 40%; waiting for room: RAM is at 93% (resumes below 85%).`
  - `Pixel: a phone; no vitals.`
  - `office: no vitals (unreachable).`
- a `(showing N of M)` footer. The cap is 8 devices and 900 characters of lines. The block's
  budget is `BUDGETS["frame.fleet"] = 1_200`.

Choices:
- **It is a frame block, never a static one.** The room moves between turns, and a static block
  that moved would freeze in a resumed CLI session (README §3.5). `assert_split` holds, and a test
  shows the static hashes do not move when the room does.
- **Rounded so it moves when the room did.** RAM and CPU are rounded to 5%, VRAM to 0.5 GB, and
  RAM size to whole GB. A sleep age is given in whole hours ("under an hour", "N h", "N days").
  Two samples a few percent apart render the same line.
- **Unknown is left out, never written as zero.** A `None` figure is dropped from the line. A
  device whose vitals are `None` says why in words: a phone, asleep, unreachable, "online, sends no
  vitals", or "not heard lately". Free disk is named only under 10 GB, where it starts to matter.
  The block is omitted entirely when no device has vitals. A list of "no vitals" lines would only
  cost tokens.
- **Not fenced, like `frame.project` and `frame.setup`.**
  - The figures are measured by this daemon and by the user's own paired daemons, so they are
    not page text.
  - The free text in the block is a device's name, a GPU's name or a held reason. Each is
    flattened to one capped line (40, 32 and 160 characters; control characters and U+2028/9
    become spaces), so a name cannot open a heading or a list.
  - The block is in the frame, so a fence would cost no cache. It would still tell the model to
    distrust numbers that are ours.
- **It never fails a turn.** `prompt_text()` catches a failing source and returns `None`. The
  fleet is advice.

**`core.devices`, on request.** This is a `READ` core tool: no card, params `{}`, closed schema.
It returns `{"devices": [DeviceVitals, ...]}`, this PC first, with the full wire figures. The frame
is the summary; the tool is the detail.
- Its cap is `DEVICES_CAP = RECALL_CAP` (4,800). At 1,600, one device's few hundred characters of
  JSON would cut the third PC mid-object.
- The executor packs whole devices under the cap, so the answer is always valid JSON. Devices
  that do not fit are counted in a `note` that carries `(showing N of M)`.
- With no fleet source wired in, it answers `{"devices": [], "note": "No device vitals are
  attached ..."}` rather than an empty list that would read as "you have no devices".
- A failing source is `engine_error` (ADR 0076).
- The description says what the tool is for: read it before deciding how many tasks to run at
  once or which PC work would fit on. "You advise; you cannot send work to another PC."

**The law.** `constitution/law.md` gains a "Your devices" section of one paragraph:
- she sees each PC's room in the "Your devices" block and through `core.devices`;
- she delegates fewer tasks when this PC is tight, and says why;
- she says plainly which PC has room, and that the person can open that PC's composer from
  Devices;
- she cannot send work to another PC, and never says she has or will.

The constitution's version is its content hash, so the ledger records turns under the new law
without a version bump by hand.

**Not done (non-goals of this ADR):**
- dispatch to another PC (v2.2);
- a task cap she sets herself. The gate's `slots` and `held` are what bound tasks; she only reads
  them.

## Each PC sleeps on what it wrote

**Context.** Every PC's brain gathers episodes: its own turns, and copies of its paired PCs'
turns through replication (ADR 0140). Until now nothing consolidated them. Facts were written only
when a person approved a `core.write_fact` card, no writer ever set importance to 0, and the
`cycles/` and `reflections/` directories were walked by the rebuild but never written. The
registry's *autonomous-cycle-hosting* and *consolidation* techniques are the standard here. This
section ports Personas' sleep cycle: two legs, pressure admission, and the 40k / 6 h / 72 h / 2k
thresholds. It adapts the cycle to markdown-is-truth and to write-once replication.

**Decision.**

1. **One cycle per PC, over its own episodes, with no election.** Pressure is the body characters
   of the episodes whose file says `device:` = this PC (or that carry no `device:` key, before the
   PC pairs). It counts episodes after the boundary, oldest first. The device stamp is on disk
   only, so the walk reads each file's header once and caches it by id: files are write-once.
   Each measurement walks at most 480 of this PC's episodes and 20,000 rows. A walk that hits a
   ceiling never claims `too_little`, so a backlog of a peer's episodes cannot starve the cycle.
2. **One owner admits** (`core/sleep/admission.py`). The ladder runs in this order:
   `sleeping`, `turn_live`, `recent_turn` (120 s), `no_room` (RAM alone), `floor`
   (6 h), `failed_recently` (1 h, doubled per failure in a row up to 24 h: ADR 0190), `too_little` (2,000 characters). It admits on `pressure`
   (40,000), then `first`, then `stale` (72 h); otherwise the answer is `not_yet`. A person's force
   skips the floor, the failure backoff and the minimum, and nothing else. The claim lives in
   process memory and is taken as the first step: acquire-or-refuse is one act, and the claim is
   released on every exit. The floor keys on the newest `completed` or `partial` row by
   `finished_at`. A row left `running` by a dead process is kept as evidence and never read by
   admission.
3. **One read, drained forward.** The window that admits a cycle is the window the cycle reads,
   taken in one SQLite snapshot. Compress takes the oldest episodes up to 120 episodes, 30,000
   characters and 2,000 per episode. The boundary is stored as a position, `<created>|<id>`, so
   two episodes with the same instant are never skipped. It moves only when a cycle settles, and
   only to the newest row read or passed. A cut window is `partial`, and what it left is the next
   cycle's oldest material. `episodes_available` counts the whole window, not the capped fetch.
4. **Two legs through the adopt door (ADR 0097)**: `sleep.compress` and `sleep.merge`, both at
   `claude-opus-5-5`, effort `low`. That is the audit pick, the bench's judgment leg over a
   structured record. Neither leg is benched. Each leg has a 300 s timeout, a JSON schema check
   and one retry, and writes one ledger row with `trigger` `sleep.compress` or `sleep.merge` on
   surface `sleep`. Every id a model returns is checked against what it was shown: sources against
   the read window, targets against that candidate's FTS shortlist of 4 live memories with
   200-character excerpts. Unknown ids are dropped and counted. The verdict has three slots, and
   the code applies them in this order: contradiction, then supersede, then duplicate.
5. **Output by kind.**
   - New facts and procedurals are additive. They are written through `write_fact` and
     `write_procedural`, so they pass the provenance gate, and at most 12 facts and 6 procedurals
     are written per cycle.
   - A supersede is the new memory's frontmatter `supersedes: [ids]`, at most 8 links per cycle.
   - A contradiction writes the candidate and opens a `contradiction` proposal.
   - A duplicate is not written; the journal records it as confirmed.

   A failed compress writes nothing and leaves the boundary alone. If merge fails after compress
   succeeded, the cycle degrades to the deterministic prefilter: an exact key match counts as a
   duplicate and anything else is written as new. The journal says so and the cycle is `partial`,
   so the compressed candidates are neither lost nor written twice.
6. **Supersedence and retirement live on disk.** `supersedes: [ids]` and `retired: true` sit after
   `sources` and before `every_turn` and `device`, and are written only when present, so older
   files keep their bytes. `companion_supersede(node_id, superseded_id)` is in `INDEX_TABLES` and
   is rebuilt by reconcile. A retired memory is indexed at importance 0. Recall never serves a
   superseded id. Replication carries both keys, because they are ordinary frontmatter on
   write-once files.
7. **Fade ranks memories and never hides them.** Once per 30 days of disuse, a live memory older
   than 30 days fades one step, to at most 3. Recall in both distilled lanes ranks by the value
   model, whose decay axis is the fade step. A recall hit records `companion_recall_seen` and
   deletes the fade row, using a write that waits at most 0.25 s for the lock and otherwise drops
   the hit.
   **The value model** (amended 2026-10-25 after `/conform` recorded that the keyword lane ranked
   by fade before match and never read confidence). Ranking by `importance - steps` first and BM25
   second broke the promise above: with any-word matching (ADR 0042), six unfaded memories sharing
   one common word with the question filled the six slots ahead of a memory faded one step that
   answered every word of it, so the memory asked about was hidden. `athena.core.brain.value.score`
   is now the one ranking, pure and clock-free: match x confidence x decay x use. Match is BM25
   against the best row of a bounded candidate page (`slots x 8` rows), floored at 0.4; the always
   tier passes 1. Confidence is the stored 0-1, unknown read as the 0.7 default. Decay halves per
   fade step for a fact and per two for a procedural. Use is a log bonus of at most +25%, so hits
   never overturn a confidence gap. The 0.4 floor sits between one and two fact half-lives: a best
   match faded once still outranks a bare match, so a fade never hides it, and faded twice it
   ranks below, so a fade still ranks. Importance decides the population (served above 0, every
   turn at 4 and above) and is no longer a ranking axis. Each promise is held by a test in
   `tests/core/test_recall.py` and `tests/core/test_brain_value.py`. Forgetting's own predicate
   (`forget_candidates`) may adopt the same function later; the janitor imports the read path's
   model, never the reverse.
8. **Forgetting and contradictions are proposals and are never applied by a cycle.** A fully faded
   fact at no more than the default importance is offered once as a `forget` proposal. At most 20
   proposals are open at once; they expire after 14 days and are dismissed when their memory is
   gone. A person's `forget` writes a fact `forgotten:<key>` with `supersedes: [id]` and
   `retired: true`, which cites the forgotten memory's own live episodes. It is a normal write, so
   it replicates and hides the same memory on every PC. The forgotten file stays.
   **The marker also bars the key** (amended 2026-10-24 after `/conform` found forgetting had no
   bar on re-derivation). The episodes that grounded the memory stay, so without a bar the next
   cycle would learn it again and the person would see the correction reversed. Before the merge,
   a cycle drops every candidate whose kind, scope and key (case and spacing ignored) a marker
   bars, counts it as `barred` and lists it in the journal under "Not learned again". The bar is
   keyed on the key, never the wording, which would also bar a restatement's negation. Only the
   person lifts it, by writing under that key again through an approved `core.write_fact`; a cycle
   never can, and a fade, a cap or a supersede writes no marker, so none of them bars anything.
9. **The record.** Runtime tables, outside `INDEX_TABLES`: `companion_cycle`,
   `companion_proposal`, `companion_recall_seen`, `companion_fade`. The journal is
   `cycles/<date>-<cyc id>.md`, a readable markdown record of what was read, written, confirmed,
   superseded, contradicted, faded, proposed and dropped. It holds keys only, never episode
   bodies. It is indexed as `cycle_report`, the same row the rebuild makes, and is not replicated.
   The id kinds are `cycle` (`cyc_`) and `proposal` (`prp_`).
10. **Hosting.** The daemon's `SleepService` serves the `/sleep*` routes. A check thread asks
    admission every 600 s; it measures once at start-up and never starts a cycle then. It
    publishes `sleep.changed` when a cycle starts, at each phase, when it finishes, and when a
    proposal is decided or swept. The vitals gate charges a running cycle one task slot through
    `running()`.

**Consequences.**
- The thresholds are Personas', and nobody has measured them here.
- Two PCs can still mint near-duplicates before replication lands. The merge only catches what
  sits in this PC's index at the moment it runs.
- A cycle killed mid-write leaves real memories and a `running` row. The next cycle re-reads the
  same window, and its merge sees the earlier writes in the shortlists. It does not resume the
  dead cycle.
- Fade is one step per month, not one per cycle. With cycles every 6 h or more, one step per
  cycle would reach 3 steps within a day of the first.
- The sleep legs always run on the `claude` CLI tiers, whatever engine the daemon's turns use, as
  adopt's legs do. The brief's "the daemon's configured engine" was replaced by the seam's
  one-door rule.

**The legs run through the adopt studio's door, not the daemon's engine.** `sleep.compress` and
`sleep.merge` are `LegRunner` kinds (ADR 0097): the Claude CLI on the subscription, a tier per kind
in `tiers.json`, a schema check with one retry, one ledger row per leg. A daemon configured for
another engine still sleeps on the Claude CLI; where that CLI is missing, the cycle fails with that
said, and the next try waits out the failed-cycle backoff.

## Consequences
- A task no longer starts into a PC that has no room for it. It waits with a reason the person can
  read, and starts on the next claim once the figure falls back past its resume line.
- Thresholds are Personas', copied and not measured here. The charge is measured, per PC, from its
  own turns; the default is one PC's measurement.
- The engine child's peak misses its grandchildren. `claude.exe` is a native binary, so the miss is
  small; a CLI started through a shim (a `.cmd`, an interpreter) is measured as the shim.
- Non-Windows probe paths are tested with recorded text, not on the platform. macOS reports RAM only.
- A peer's vitals are at most 30 s old when fresh (the hello's period) and gone after 90 s.
- `no_answer` and `usage_limit` are new values a surface may meet in `turn.error.reason`; the
  JavaScript copy of the vocabulary (`packages/athena-bridge/gate.js`) and the panel's plain
  sentences change with them.
