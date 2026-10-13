# 0090 — Depths are ported one at a time behind a bridge, and the console is opt-in

## Context

ADR 0087 replaces the module bar with the depth stage. The five modules hold the app's behaviour
and 159 tests; the stage cannot be built in one commit, and every commit must leave an app that
works (AGENTS.md: one commit per feature, the gate before claiming anything).

## Decision

The console (`src/console/`) mounts the stage with the real stores, and is **opt-in** until the
cutover: `pnpm tauri:console` (`VITE_ATHENA_UI=console`) or `athena.ui = console` in the webview's
storage; the module bar stays the default (`lib/ui.ts`). Inside the console, `scenes.tsx` maps a
depth path to its scene. A root whose own scene has been ported is drawn by it; any other is drawn
by **the bridge**: its module's existing `Live` view inside the depth, so no capability is ever
unreachable while the matrix is being filled. `PORTED` lists the roots that have left the bridge.
Each module's model, fixtures and tests stay; only views are replaced, and a module's selector is
shared with its scene through a hook (`useSetupModel`), not copied.

A scene's behaviour that differs between the bar and the console is passed in, never branched on
globally: Setup's `finish` takes `afterFinish`, because the bar leaves into the Browser (a Rust
`browser` selection that shows a page) and a scene must not.

## Consequences

- Every phase ships and can be tried in the real window with `pnpm tauri:console`.
- The bridge is temporary and visibly so: the last port empties `PORTED`'s complement, and the
  cutover deletes `lib/ui.ts`, the bridge, `ModuleBar`, `registry.ts` and the Rust `browser` alias.
- A bridged depth looks like the old module inside the new frame; the Browser's page mode does not
  work through the bridge (a page needs the page shape), which is why Apps is the first depth
  ported after the first act.
