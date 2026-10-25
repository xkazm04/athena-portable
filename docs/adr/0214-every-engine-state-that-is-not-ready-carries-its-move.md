# 0214. Every engine state that is not ready carries its move

Date: 2026-10-25

Builds on ADR 0085 (choosing an engine after the letter writes the row, and the restart notice
says the daemon is still on the old one). README section 3.5.

## Context

Whether a turn can run is decided by eight inputs: the probe's word on the chosen engine, whether
a check is in flight or failed, whether the daemon has reported, the stored engine, the engine the
daemon is on, and its health. The setup module read them in four parallel if-chains (`startFailure`
and `pendingEngineOf` in `model.ts`, `engineFact` and `notReadyBecause` in `readiness.ts`), each
over a different subset in a different order. Two combinations they missed were dead ends a person
reaches in ordinary use:

- After the letter, a person chooses Codex and does not restart; the Claude Code daemon then fails
  or stops. `startFailure` required the daemon to be on the stored engine, the restart notice
  required health `ready`, and the engine fact's mismatch branch ran before any health check, so
  the screen said "Codex is chosen, but Athena is still running on Claude Code" over a dead daemon
  and offered no button. Pressing Codex again only rewrote the row.
- A daemon that failed before naming an engine read "still starting up on it": a failure dressed
  as a wait.

## Decision

1. **One union.** `modules/setup/engine-state.ts` exports `engineStateOf(inputs)`, a pure function
   that returns one of `unchecked | checking | check-failed | not-installed | signed-out |
   other-chosen | awaiting-daemon | starting | pending-switch | down-on-other | failed | stopped |
   running`, each with its `move` (`check | restart | choose | sign-in | install | wait`, `null`
   only for `running`) and the engine fact's standing and words.
2. **The words sit at the leaf that decides the state.** A state cannot be reached without its
   sentence, and the first frame carries one decision tree, not a tree and a switch over it.
   `engineFact` returns the state's words; `pendingEngine` is the `pending-switch` state;
   `notReadyBecause` reads `checking` and `check-failed` off it; `startFailure` exists exactly
   when the move is `restart` and the daemon is failed or stopped.
3. **A failure on the engine the daemon was still on is a start failure.** `down-on-other` says
   "Athena stopped on Claude Code." (or "Athena is not running.") with the daemon's reason and
   "Start on Codex"; its action is the existing restart, which starts on the stored engine. The
   test that pinned this case to `null` is flipped by name.
4. **`wait` is a move only while something is in flight**: a check, a start, or the first daemon
   reading. A table of 960 input combinations pins that every state that is not done has a move,
   that no failed or stopped daemon is described as running or starting, and that readiness, the
   not-ready sentence, the restart notice and the start failure agree with the state.

## Consequences

- The dead end closes on both surfaces that draw `startFailure` (the first act's engine step and
  Mind), with no scene edit: their retry is already `actions.restart`.
- The next engine-state bug is a missing row in one union rather than a fifth chain.
- Every sentence for a state that was already covered is byte-identical; the fixtures read as
  before.
- First paint grows by about 256 B gzipped (the union's kind and move strings): `selectSetup` and
  `engineFact` are first-frame code.
- The respawn rung (ADR 0206) is not yet a state: the daemon view does not carry the attempt.
  When it does, `respawning` is one more leaf.
