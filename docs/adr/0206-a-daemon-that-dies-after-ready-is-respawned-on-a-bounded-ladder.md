# 0206. A daemon that dies after ready is respawned on a bounded ladder

Date: 2026-10-25

Amends ADR 0015 (the shell owns the sidecar's whole life): who restarts it, how often, and what
is never retried.

## Context

After the daemon was ready, the supervisor in `apps/desktop/src-tauri/src/daemon.rs` waited for
its stdout to close and then wrote `health=failed, error="the daemon exited"`. Nothing ever
spawned again on its own. The only recovery was Restart in Settings, and her window (the ambient
window the person actually lives in) is granted `daemon_status` but deliberately not
`daemon_restart` (`capabilities/athena.json`), so an engine CLI that segfaulted or an OOM left
Athena dead until somebody found the main window.

Separately, `start()` ran shutdown, bumped the generation, spawned and only then stored the child,
with no lock across the four. Two starts racing (launch and a Restart, or two Restarts) could both
see an empty slot, and the second store overwrote the first child unkilled: two daemons, one of
them unreachable (stabilize-2026-10-16 backlog, "Overlapping daemon starts can leave the first
child running beside the second").

## Decision

1. **The policy is a pure module.** `ladder.rs` takes how a run ended (`Ending::AfterReady {
   ready_for }`, `BeforeReady`, `Refused`, `Unauthorized`) and returns `Plan::Respawn { attempt,
   after }` or `Plan::GiveUp(Verdict)`. No process, no clock: every rule is a unit test.
2. **Bounded.** Delays double from 1 s with a 30 s ceiling; five consecutive unproductive deaths
   are absorbed (1, 2, 4, 8, 16 s); the sixth gives up with "the daemon exited 5 times in a row;
   restart it from Settings", and nothing further is scheduled.
3. **Reset by a productive round.** A run that stayed ready for 60 s did real work; its death
   starts again at the first rung. A run that connected and died a second later is one more rung.
4. **A declared verdict is never retried.** A refusal line (`{"ok": false}`) or a 401 from
   `/health` gives up at once and the status keeps the daemon's own sentence. A person's start
   that dies before it is ever ready is a broken install, not a crash, and is reported the same
   way; a respawn that dies before ready is one more rung.
5. **Starts are serialised.** A start lock is held across shutdown, generation bump, spawn and
   store, and by every shutdown. A small `Process` trait stands between `Daemon` and
   `std::process::Child`, so the race is a unit test with a fake process.
6. **Cancellation is the generation.** A pending respawn waits on its own thread, re-reads the
   generation every 50 ms, and spawns only under the start lock and only if the generation is
   still the one that died. A person's Restart (which also resets the ladder) and the app's exit
   both bump it, so neither can be overtaken by a rung, and no spawn happens after `shutdown`
   returns. A daemon a person stopped is never restarted.
7. **The status says every rung.** While healing: `health=starting`, `url=null`,
   `error="the daemon exited; starting it again in 1s (attempt 1 of 5)"`, and a new additive
   `attempt` field (0 for a person's start). `health` keeps its four values, so the TS store,
   which shows `error` while not ready, renders the sentence with no change. A respawn mints a
   fresh token, as Restart does.

ADR 0085 (an engine change restarts only on the person's say-so, because a restart cuts a running
turn) is not crossed: a process that has already exited has no running turn.

## Consequences

- A crash in a long evening costs a second of "starting" instead of a dead assistant, and her
  window recovers without the capability it was deliberately not given.
- A daemon that crashes on every start costs six spawns over about 31 s, then stops and says so.
- The double-daemon race is closed; `daemon::tests::two_racing_starts_leave_one_live_child`
  pins it.
- A run that hangs (stdout open, not answering) is not a death and is not healed; liveness by
  heartbeat is a separate decision.
