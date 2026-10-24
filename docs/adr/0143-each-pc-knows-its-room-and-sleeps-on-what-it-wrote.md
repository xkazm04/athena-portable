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
  >= 90% for 3 readings in a row (resumes below 70%), battery below 30% for a task and any battery
  for a sleep cycle (`held(sleep=True)`), and less than 1024 MB of free disk.
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

## Athena knows her fleet (WP2)
_Placeholder: the Director merges WP2's section here._

## Sleep (WP3)
_Placeholder: the Director merges WP3's section here._

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
