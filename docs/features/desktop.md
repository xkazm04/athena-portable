# The desktop: shell, modules, companion and halo

`apps/desktop/`: a Tauri v2 shell in Rust (`src-tauri/src/`) and a React 19 + zustand front end
(`src/`). Two windows (ADR 0026): **Main**, the workhorse with the modules, and **Athena**, her own
small window, plus a click-through **halo** on every screen.

## The shell (Rust)

| File | Job |
|---|---|
| `layout.rs` | owns every rectangle; Main sized to the screen |
| `tabs.rs`, `bridge.rs` | page webviews, `inject.js` as their initialisation script, the relay |
| `hands.rs`, `hands.js` | nine generic DOM hands (`page_read`, `page_find`, `page_fill`, `page_click`, `page_select`, `page_submit`, `page_scroll`, `page_wait`, `page_screenshot`); a screenshot is captured before every gated proposal (ADR 0025) |
| `daemon.rs` | the daemon as a sidecar with a minted token file, restart on engine change, and exit hygiene (tree kill, a Windows job object, ADR 0015) |
| `store.rs` | one SQLite store behind four generic commands (ADR 0016): settings, origins, projects, activity, captures with an LRU sweep |
| `companion.rs`, `halo.rs`, `hotkeys.rs`, `tray.rs`, `capture.rs` | her window, the screen-edge light, the summon chord, the tray, window capture |

## The module contract

Each module is `model.ts` (a pure view-model), `fixtures.ts`, `view.tsx` (a pure function of the
model) and `index.ts` (the one file that touches a store). Every module renders without Tauri in
`preview.html?module=&fixture=&theme=`. A module is two layers (ADR 0029): an overview that only
reads, and a layer for every write.

| Module | What it shows |
|---|---|
| **Browser** | the ledger of registered apps (Open, Details); registering and an app's switch or Forget happen in layers |
| **Playbooks** | the edge map (difficulty × usefulness, an "only Athena" corner), the record across the latest runs, a grid filtered by home or work and ordered by edge, money or hours, and each playbook's layer: an abstract with a line per part, each part one level down (ADR 0053): story, command, portals, gates, traps, then the proof (money, cards, the traps she walked past, the replay of the run, the runs over time, what it taught Athena, the economics). See [playbooks.md](playbooks.md). |
| **Connectors** | emblem tiles per service and a layer per connector ([connectors.md](connectors.md)) |
| **Setup** | seven cards for the machine's facts (engine, brain, voice, theme...), each its name large over its drawing faint behind, with a layer each; the theme's layer also sets the text size, comfortable or compact (ADR 0054); onboarding inline on first run |
| **Voice** | a studio to pick and hear her voice and test the microphone, then the settings (ADR 0028) |

`components/` holds the shared parts (`Tile`, `Layer`, `Emblem`, `PillGroup`, `SectionCard`...);
`styles/app.css` holds the token layer, dark and light.

## The run loop

`stores/run.ts` is the only run loop: it posts `/run` with the focused page's manifest, holds host
calls until the turn ends, runs the page's tools, continues with the answers, and is bounded at
eight continuations. A handed-over playbook rides every turn as the active project (ADR 0044).

## Athena's window, the companion

`src/companion/`: a pure state machine (`machine.ts`) whose form is derived, not stored: `seal`,
`tape`, `hear`, `slip` (a card), `welcome`, `ledger` (Talk, Record, Origins) and `tab` when docked.
The seal shows her state as a mood. Talk is the conversation and the composer; a playbook handed
from Main arrives as a drafted command, a "Working on" chip, and, before the first turn, her plan:
steps, the tabs she will ask for, and where she stops for a signature. Record lists every call and
decision; Origins lists the apps she can reach.

## The halo

A click-through light on the edges of every monitor, painted by phase (listening, working,
waiting on a card), with a caption that lingers four seconds. Holding the summon chord is
push-to-talk without showing her window (ADR 0027).

## Tests

443 tests in 39 files (vitest): module models and views as static markup, the companion machine on
a virtual clock, the run loop against a fake daemon, the bridge and hands.
