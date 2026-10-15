# The desktop: shell, depths, companion and halo

`apps/desktop/`: a Tauri v2 shell in Rust (`src-tauri/src/`) and a React 19 + zustand front end
(`src/`). Two windows (ADR 0026): **Main**, the workhorse (the depth console), and **Athena**, her own
small window, plus a click-through **halo** on every screen.

## The shell (Rust)

| File | Job |
|---|---|
| `layout.rs` | owns every rectangle; Main sized to the screen |
| `tabs.rs`, `bridge.rs` | page webviews, `inject.js` as their initialisation script, the relay |
| `hands.rs`, `hands.js` | nine generic DOM hands (`page_read`, `page_find`, `page_fill`, `page_click`, `page_select`, `page_submit`, `page_scroll`, `page_wait`, `page_screenshot`); a screenshot of the focused tab is captured before each request and filed on a gated card (ADR 0025, ADR 0066); `hands_describe`, the panel's only, tells a card what its refs name (`button - Send reminder`) and is no hand (ADR 0099); a `page_read` or `page_find` too long for one 1,500-character packet starts with a `cursor:` line and continues from a snapshot of that document (4 per tab, 3 idle minutes, dropped on navigation, else `unknown_ref`) so every packet survives the lane's 1,600-character cut (ADR 0102) |
| `daemon.rs` | the daemon as a sidecar with a minted token file, restart on engine change, and exit hygiene (tree kill, a Windows job object, ADR 0015) |
| `store.rs` | one SQLite store behind four generic commands (ADR 0016): settings, origins, projects, activity, captures with an LRU sweep |
| `companion.rs`, `halo.rs`, `hotkeys.rs`, `tray.rs`, `capture.rs` | her window, the screen-edge light, the summon chord, the tray, window capture |

## The depths

Main is one scene (ADR 0087, planned in [`../redesign/fathom.md`](../redesign/fathom.md)): Athena at
the surface, drawn as a bell of light with a tendril per app and account, and five depths beneath
her. The depth is a path with a fixed grammar (`src/depth/model.ts`): a root (Apps, Chores,
Accounts, Voice, Mind), an item, and a sub-level, so every capability is at most three moves away.
Escape rises one level and never closes the window. `apps/<app>/page` is the one place a native
page webview owns the window, and the stage then draws only a band over it (ADR 0088).

Each depth keeps a module's behaviour (`model.ts`, `fixtures.ts`, `index.ts` with the hook that
builds the model from the stores) and draws it as a scene (`src/scenes/<depth>/`): a pure view of
`{ model, path, go }`, fixtures, a `live.tsx` the running app imports (its view a lazy chunk) and an
`index.tsx` with the fixtures for the preview harness and the tests (ADR 0090, 0091). Every scene
renders without Tauri in `preview.html?scene=<depth>&fixture=&theme=`.

| Depth | What it shows |
|---|---|
| **Apps** | registered apps as windows of light whose standing is a shape and a word; an app with its switch, Open and two-press Forget; what its open page registered as tools (as claims, never a class); the band over a page: tabs, address, tools |
| **Chores** | the playbooks' edge map as the hero, a drawing for every chore, a chore's own scene with its facets, and the replay of a run as a place of its own. The shipped set loads lazily (2.7 MB of JSON). See [playbooks.md](playbooks.md). |
| **Accounts** | a drawing per connector, a staged connect, the gated writes switch, the allow-list, a records notice that cannot be dismissed ([connectors.md](connectors.md)) |
| **Voice** | the studio as a staged act and settings as two instruments, with the keys and one frame loop (ADR 0092) |
| **Mind** | the engine, the brain, the look (theme, text size and Calm motion), the data and the microphone; the first act (Mind, Reach, Voice) opens the same scene on first run |

## The card

A decision card names the app (`In ledger.test`, decoded from the catalog id the page was filed
under) and whose tool it is: the app's own (tier 1), Athena's generic hand (tier 2) or a connector
(tier 3), the tier the catalog reported. A ref parameter shows what the page says it names, as the
page's claim; when the page cannot say, the raw ref stays and the card says so. The activity row of
an answered card keeps that tier (ADR 0099).

Trust is per origin and per contract (ADR 0100). Enabling an app accepts the contracts (name,
description, schema, flags, SHA-256 over canonical JSON) of the tools it lists then; a tool whose
contract later differs, or that appeared after trust, is sent in `gated_tools` until an approved
call of it runs, and its card shows the old description beside the new one, cut with
`(showing N of M)`.

## The halo

A click-through light on the edges of every monitor, painted by phase (listening, working,
waiting on a card), with a caption that lingers four seconds. Holding the summon chord is
push-to-talk without showing her window (ADR 0027).

## Tests

About 1,100 tests in 70 files (vitest): the depth model and every scene as static markup and, where a
control must be proved wired, driven in jsdom; the companion machine on a virtual clock, the run loop
against a fake daemon, the bridge and hands. `pnpm perf:all` holds the motion and weight budgets.
