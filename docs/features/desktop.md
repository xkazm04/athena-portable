# The desktop: shell, depths, companion and halo

`apps/desktop/`: a Tauri v2 shell in Rust (`src-tauri/src/`) and a React 19 + zustand front end
(`src/`). Two windows (ADR 0026): **Main**, the workhorse (the depth console), and **Athena**, her own
small window, plus a click-through **halo** on every screen.

## The shell (Rust)

| File | Job |
|---|---|
| `layout.rs` | owns every rectangle; Main sized to the screen |
| `tabs.rs`, `bridge.rs` | page webviews, `inject.js` as their initialisation script, the relay |
| `hands.rs`, `hands.js` | ten generic hands (`page_read`, `page_find`, `page_fill`, `page_click`, `page_select`, `page_submit`, `page_scroll`, `page_wait`, `page_screenshot`, `tabs_read`); a screenshot of the focused tab is captured before each request and filed on a gated card (ADR 0025, ADR 0066); `hands_describe`, the panel's only, tells a card what its refs name (`button - Send reminder`) and is no hand (ADR 0099); a `page_read` or `page_find` too long for one 1,500-character packet starts with a `cursor:` line and continues from a snapshot of that document (4 per tab, 3 idle minutes, dropped on navigation, else `unknown_ref`) so every packet survives the lane's 1,600-character cut (ADR 0102); `tabs_read(url, query?, cursor?)` reads another open tab's text through that tab's own `hands.js` without acting there, only when its web origin is an enabled origins row (else `foreign_origin`, nothing read; a url no tab is at is `unknown_ref`, the focused tab `validator_failed`), its first line `from <origin> - <title> (<url>)`, a query keeping only the rows that mention it; the result carries `source` (`host:<app>`) for the record, and until the user's next message every request says `tainted_by`, so every call on the page files a card that says `uses text read from <origin>` (ADR 0105) |
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
| **Chores** | the playbooks' edge map as the hero, a drawing for every chore, a chore's own scene with its facets, and the replay of a run as a place of its own. A chore's page names your saved case and "Open your case" reopens the studio on it at `chores/<id>/case/<proj>` (ADR 0123); under it, "Your runs" lists each run's receipt, and "Start for real" files the run's every turn under the case, closed by "done" on her project chip (ADR 0124). The shipped set loads lazily (2.7 MB of JSON). See [playbooks.md](playbooks.md). |
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

A card for the focused app is bound to the tab it was proposed on and that tab's document (the
shell's per-tab navigation count, `nav` on `tabs_list`): it says "Proposed on tab 2 of ledger.test"
beside the app line, an approval runs on that tab even while another is focused, and a tab that
closed, reloaded or navigated refuses the approval with `unknown_ref` before the daemon is asked or
anything is dispatched; "Go to that tab" focuses it (ADR 0103).

Cards one turn files for one app and tab arrive as one sheet, in proposal order, at most 12 rows
(`(showing 12 of N)` past that, the rest stay cards). Every row is the card in full with a tick;
"Approve k of n" declines the unticked rows, then walks the ticked ones through the same per-card
answer, each spending its own grant, stops at the first that is not ok (`ran k of n` and why; the
rest wait unspent), and the model continues once. The acting hands take an optional `expect`, the
label `page_find` gave, and do nothing (`validator_failed`) when the element reads otherwise (ADR 0104).

Each exchange also publishes the manifest of every other open tab whose origin is an enabled row
(one tab per app, the one focused last; first-sight and switched-off tabs never) and sends them as
`open_apps` with their tab id and `nav`. A tool of one may be proposed from the focused tab: the
gate makes every such call a card, `READ` and `AUTO` included, bound to that tab (no picture:
proposed on another tab), and the answer is stated in that tab's name. One request's cards across
apps are one checklist, rows labelled by app and tab in proposal order, each run on its own tab
with its own grant; a tool of a tab not listed stays `foreign_origin` (ADR 0106).

## The halo

A click-through light on the edges of every monitor, painted by phase (listening, working,
waiting on a card), with a caption that lingers four seconds. Holding the summon chord is
push-to-talk without showing her window (ADR 0027).

## Tests

About 1,100 tests in 70 files (vitest): the depth model and every scene as static markup and, where a
control must be proved wired, driven in jsdom; the companion machine on a virtual clock, the run loop
against a fake daemon, the bridge and hands. `pnpm perf:all` holds the motion and weight budgets.
