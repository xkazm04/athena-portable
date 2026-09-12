# The shell at the end of phase 1

Phases P1 to P5 are done. This document is the status of the desktop half of that: what is
claimed, the command that checks each claim, the window's geometry, the affordances a developer
gets, the modules that exist, and what is not built yet.

Nothing below is claimed without the command that verifies it. The rows marked **walked by hand on
2026-09-12** were checked in the real window, at 1280 px, in both themes, and link to the
screenshot that was taken while doing it (`docs/shots/`).

---

## 1. What one gated turn takes, in three commands

```bash
uv sync --extra dev && pnpm install --frozen-lockfile
cd apps/desktop
ATHENA_SMOKE=turn node scripts/smoke.mjs
```

The last one serves `scratch/webmcp-page.html`, builds and starts the shell against it, points the
daemon at a recorded round (`scratch/gated-round.jsonl`, ADR 0019), runs one turn, answers the card
it files, and prints:

```
[smoke] turn: manifest tools=3
[smoke] turn: tool.call invoice_list ok=true
[smoke] turn: decision apr_8c95fa146668 declined
[smoke] turn: ledger user_denied=1
```

To walk it rather than watch it, start the same shell without the smoke and type into the Panel:

```bash
ATHENA_START_URL=http://localhost:8731/webmcp-page.html \
ATHENA_ENGINE_SCRIPT=apps/desktop/scratch/gated-round.jsonl \
pnpm tauri dev
```

(any static server on `scratch/` will do; `localhost` and not `127.0.0.1`, because
`HostManifest.validate` takes a page origin only over https or `http://localhost`.)

---

## 2. The verification table

One row per claim P4 and P5 make, and every command below was run to write this table.

`pnpm test …` and `node …` run from `apps/desktop`, where `pnpm test <pattern>` is `vitest run`
and filters by file name; `cargo test …` runs from `apps/desktop/src-tauri`; `uv run pytest …` and
`pnpm --filter …` run from the repository root.

### P4 — the shell skeleton

| Claim | Verified by |
|---|---|
| The window is one bar plus one module, and every rectangle is arithmetic with no window in it | `cargo test layout` |
| The launch module is spelled the same in Rust and TypeScript | `cargo test the_selection_starts_on_the_launch_module`, `pnpm test registry` |
| Every module renders against every fixture with no store, no IPC and no shell | `pnpm test registry` |
| A tab is a page webview, and the tab list is Rust's | `cargo test tabs` |
| `inject.js` runs in a page before the page's own scripts, and the relay matches an answer to the request waiting on its id | `node scripts/smoke.mjs` → `[smoke] tab 1: ok=true tools=3 transport=webmcp-polyfill` |
| A page webview can call exactly one command, and a wrong nonce or a foreign id is dropped in Rust | `cargo test bridge`, `pnpm --filter @athena/bridge test` |
| The sidecar spawns `athena serve`, learns the port from the ready line, and holds the token | `cargo test daemon::tests` |
| A hard kill of the shell takes the daemon's whole process tree | `cargo test closing_the_job_takes_the_whole_tree` |
| The store is one described schema behind four commands, and `null` is the only empty value | `cargo test store::tests`, `pnpm test ipc` |
| The Settings and Setup modules render the engine, the theme and the readiness stations | `pnpm test settings readiness` |
| **The window opens, shows the module bar, and the Browser module opens a real site** | walked by hand on 2026-09-12 — [`panel-tools-dark.png`](shots/panel-tools-dark.png) shows the bar and the daemon `ready`; the tab it names is the served scratch page |

### P5 — the MVP checkpoint

| Claim | Verified by |
|---|---|
| One run loop owns the conversation, and no view talks to the daemon | `pnpm test run` (the whole loop against `src/test/fake-daemon.ts`) |
| One AUTO round trip: the gate allows it, the page runs it, the result rides the next round | `pnpm test run`, and `ATHENA_SMOKE=turn node scripts/smoke.mjs` → `turn: tool.call invoice_list ok=true` |
| One gated decline: the card waits, the page never ran it, the ledger says `user_denied` | `pnpm test run`, and `ATHENA_SMOKE=turn …` → `turn: decision … declined`, `turn: ledger user_denied=1` |
| A user override tightens a class and can never loosen one | `pnpm test run`, `pnpm --filter @athena/bridge test` |
| The card carries its action, its parameters and the options the daemon offered — from the record, not from a slot that empties | `pnpm test panel run` |
| An answer later in the record resolves the line that raised the card | `pnpm test panel` |
| The engine probe is the daemon's, and `null` is not an empty list | `uv run pytest tests/daemon/test_scripted.py`, `pnpm test daemon`, `cargo test the_engine_probe_is_read_off_the_health_body` |
| A daemon boots on a recorded transcript and `/run` streams it | `uv run pytest tests/daemon` |
| The transcript the shell ships still addresses the tools the scratch page registers | `uv run pytest tests/daemon/test_scripted.py` |
| A gated call becomes an approval row that `GET /decisions` lists | `uv run pytest tests/daemon` |
| The `origins` save publishes the row the table holds, stamps included | `pnpm test origins` |
| **Act 1: the Panel opens on launch with the page's tools and the class the gate derived** | walked by hand on 2026-09-12 — [`panel-tools-dark.png`](shots/panel-tools-dark.png), [`panel-tools-light.png`](shots/panel-tools-light.png) |
| **Act 2, typed: a message streams, the AUTO call runs on the page, the card appears with its parameters** | walked by hand on 2026-09-12 — [`panel-card-light.png`](shots/panel-card-light.png) |
| **Act 2, answered: approving runs the call on the page and the turn continues** | walked by hand on 2026-09-12 — [`panel-approved-dark.png`](shots/panel-approved-dark.png), [`panel-approved-light.png`](shots/panel-approved-light.png) |
| **The Origins module lists the origin, with its sightings and the count of rulings** | walked by hand on 2026-09-12 — [`origins-dark.png`](shots/origins-dark.png) |
| **Settings and Setup show the engines the daemon probed, with their versions** | walked by hand on 2026-09-12 — [`settings-dark.png`](shots/settings-dark.png), [`setup-dark.png`](shots/setup-dark.png) |

### The gate every one of these runs under

```bash
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest
pnpm typecheck && pnpm lint && pnpm test
cd apps/desktop/src-tauri && cargo check && cargo clippy --all-targets -- -D warnings && cargo test
```

---

## 3. The layout

Three rectangles, and which shape the window is in is the selected module. The numbers are
`src-tauri/src/layout.rs` and the arithmetic is `rects()`, which has no window in it and is tested
on its own.

| Rectangle | In browser mode, with a tab | In every other module |
|---|---|---|
| chrome webview | full width × `CHROME_HEIGHT` (76) at (0, 0) | the whole window |
| module area | full width × (height − `BAR_HEIGHT`) at (0, 36) | the same |
| page webview | full width × (height − 76) at (0, 76) | absent |

| Constant | Value | What it is |
|---|---|---|
| `BAR_HEIGHT` | 36 | the module bar. The shortest band a 12 px label with its padding and a focus ring fits in, and the only place left to grab a window whose decorations are off |
| `STRIP_HEIGHT` | 40 | the Browser module's tab strip — the only part of a module the chrome shows in browser mode |
| `CHROME_HEIGHT` | 76 | both bands, on the 4 px rhythm |
| `DEFAULT_MODULE` | `panel` | the module the window comes up on. `modules/types.ts::DEFAULT_MODULE_ID` and `stores/shell.ts` spell the same word, and a test in each language says so |

One privileged webview and not two: the bar and the module are one React tree, which is what lets
the app root start the app-wide stores (ADR 0013, ADR 0017). The cost is that the bar is a band
across the top rather than a rail down the side, because an L-shape is not a rectangle.

---

## 4. Dev affordances

| Variable | What it does |
|---|---|
| `ATHENA_START_URL` | the page the shell opens a tab on at launch. The first non-flag argument wins over it |
| `ATHENA_SMOKE=1` | one `bridge_list` against that tab, one line on stdout, exit 0 or 1. Made in Rust (`bridge::smoke_if_asked`) |
| `ATHENA_SMOKE=turn` | one gated turn through the run store, four lines on stdout, exit 0 or 1. Made in the chrome webview (`src/smoke.ts`), because the run store is the thing under test |
| `ATHENA_ENGINE_SCRIPT` | a recorded transcript the sidecar hands the daemon as `athena serve --script`, so a turn replays instead of spawning `claude`. Debug builds only, or a release build that has opted in with `ATHENA_DEV_FALLBACK` (ADR 0019) |
| `ATHENA_DEV_FALLBACK` | lets a release build run `uv run athena serve` from a checkout when no frozen sidecar is beside it |

The daemon's own half of the last one is `athena serve --script <path>`, or
`ATHENA_SCRIPTED_TRANSPORT=<path>`. It is refused on the failure line when the file is not there,
so a bad path never becomes a failing turn.

---

## 5. The modules

Every module is a directory of four files — `model.ts`, `fixtures.ts`, `view.tsx`, `index.ts` —
and the view is a pure function of the view-model. `preview.html?module=<id>&fixture=<id>&theme=dark`
renders any of them in a plain browser with no Tauri, no IPC and no daemon, which is what makes a
surface reviewable before a window exists.

| Module | What it is | Fixtures |
|---|---|---|
| `panel` | the conversation, the page's tools, and the gate between them. The launch module | `empty`, `typical`, `heavy`, `degraded`, `first-sight`, `no-bridge` |
| `browser` | the tab strip and the address field; the one module whose area a page webview takes | `empty`, `typical`, `heavy`, `degraded`, `no-bridge` |
| `origins` | every page Athena has been on, the ruling on each, and Forget | `empty`, `typical`, `heavy`, `degraded`, `no-page` |
| `settings` | the engine, the theme, and where this machine keeps its data | `empty`, `typical`, `heavy`, `degraded` |
| `setup` | what this machine still needs before a first turn, derived and never stored | `empty`, `typical`, `heavy`, `degraded` |

`degraded` means what it means in this app and never "some fields are empty": the daemon offline, a
route refusing, an origin that is not enabled, a page with no bridge, a shell that has not
answered. Every surface can be asked to render in that state, so every surface answers.

```bash
pnpm dev   # then open http://127.0.0.1:1431/preview.html?module=panel&fixture=degraded&theme=light
```

---

## 6. What is not built yet

| Not here | The phase that builds it |
|---|---|
| The nine generic hands with minted refs, and the screenshot captured before every gated proposal | P6 |
| Projects: the module, `project_id` on a run, the per-project engine override | P6 |
| The approvals inbox and the pending store — today a card lives in the Panel and the daemon's table, and no surface lists every open card across origins | P6 |
| Tab awareness: the panel reacting to a tab the user navigated under it mid-turn | P6 |
| The MCP server, so another agent queues at the same gate | P7 |
| The activity module: what was called, through which app, tier and surface, and what it cost | P7 |
| Third-party connectors — the seam is reserved (README section 4) and nothing in the demo depends on one | outside this build |
| Voice: the gateway, push-to-talk, spoken card answers | P8 |
| A bundle that installs, and the ten demo runs | P9 |

Two smaller things are known and not fixed:

- **An origin takes a row when the user rules on it, not when Athena visits it.** The Origins
  module's empty state says a page opened in the Browser module takes a row there, and it does
  not: `stores/origins.ts` writes only on a save. Making a sighting write a row would make
  `records[origin]` exist for a page nobody has ruled on, and the Panel reads exactly that to
  decide whether a `GATED` tool is gated *because this origin has never been seen* — so the fix is
  a change to what `known` means and not a line in the run loop.
- **The `heavy` and `degraded` fixtures are the only place several module states have been seen.**
  They render (`pnpm test registry`), and no by-hand row above claims more than that.
