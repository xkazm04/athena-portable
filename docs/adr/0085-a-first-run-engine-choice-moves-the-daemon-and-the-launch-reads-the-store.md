# 0085. A first-run engine choice moves the daemon, and the launch reads the store

Implements README 3.5 (the engine is configuration). Amends ADR 0026's launch line.

## Context

The first-run-setup council (lite r1, value-1) found that choosing Codex in Setup does not move
the daemon. `start_at_launch` always started on `DEFAULT_ENGINE` and never read the store;
Setup's `chooseEngine` and the welcome's `useEngine` only wrote the `settings/engine` row; and
`engineFact` marked the chosen engine done from the probe alone. A Codex-only person was told
the machine was ready, and her first turn went to Claude Code, which she does not have. The
restart notice that could have caught it renders only in the Settings mood.

## Decision

1. **The app launches on the stored engine.** `daemon.rs` has a pure `launch_engine(stored)`: a
   JSON string that is a known id once trimmed gives that id, anything else gives
   `DEFAULT_ENGINE`. `start_at_launch` reads `settings/engine` through the store and treats any
   error as null, so a store that did not open still gives a daemon on the default. The known
   ids are named once in `daemon.rs`, beside a note pointing at `lib/engines.ts`.
2. **A first-run choice moves the daemon at once.** `chooseFirstRunEngine` (`stores/settings.ts`)
   writes the row through `setEngine`, then restarts the daemon when its engine differs. Setup's
   `chooseEngine` uses it while `onboarded` is false, and so does the welcome's `useEngine`.
   Once onboarded, choosing in Settings only writes the row and the existing restart notice asks
   the person to press Restart.
3. **Never "ready" on a mismatch.** `engineFact` gives `done` only when the chosen engine's probe
   is found and the running engine is the chosen one and is ready. Otherwise it is `todo` and
   says which engine is running, so `isReady` is false. The welcome's `engineView` takes the
   running engine and says "Switching to ..." instead of ready.

## Alternatives that lost

- **The panel restarting after settings hydrate.** Two spawns at every launch, one on the default
  and one on the stored engine.
- **Restarting on every change, Settings included.** It cuts a running turn; after the letter a
  restart is the person's call.
- **The status quo.** A stored row the launch ignores.

## Consequences

- A returning person's daemon comes up on the engine she chose, with one spawn.
- A first-run choice costs one restart, which drops nothing: conversations are on disk.
- The known-id list now exists in Rust and in TypeScript; the comment names the pair, and
  an unknown stored value falls back to the default rather than failing the launch.
- While the restart runs, "Start using Athena" is disabled and the engine line says why.
