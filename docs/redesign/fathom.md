# Fathom: redesigning the desktop app as one scene with depths

README section 3.1 (surfaces) and 3.5 (module-first window); ADR 0087 to 0089.

This is the project plan for moving Main's UI from a module bar over five pages to one
presence-led scene whose capabilities are depths you dive into and rise out of. It was chosen in
the `athena-console` design contest (variant A/1, "Fathom"; the owner's reason: the animation
and transition quality and the feel of speed). The contest source is kept under
`reference/fathom/` as prior art to read. **Never paste from it**: it is 1,800 lines of
imperative string-templated DOM with fixture data, and none of it meets the quality bar below.

## 1. The idea in one paragraph

Today Main is a 36 px module bar and one of five full-width modules. Fathom replaces the bar with
**depth**. The surface is Athena, drawn as a living bell with one tendril per app or account she
may touch, and the conversation. Everything else is a light on the seabed beneath her: Apps,
Chores, Accounts, Voice, Mind. You dive into one, and a nested level opens under it (an app, then
its tools; a chore, then its run). Escape rises one level. A breadcrumb, a Rise button and a
depth gauge are always there, and a dock keeps her one click away. Setup is the first act of the
same scene: choosing an engine lights her core, switching apps on lights tendrils, a voice adds
ripples, and then she wakes.

## 2. What must not change

Everything in `docs/redesign/parity.md` (the feature matrix, one row per capability, each with its
file today and the proof that it still works) plus these hard constraints, all read off the code:

1. **The page rectangle is native.** In Browser with a focused tab, `chrome` is the top 76 px and
   `page-<id>` fills the rest (`layout.rs`). No scene can paint under it. See ADR 0088.
2. **Two interactive windows.** `chrome` (Main) and `athena` (her own window) are separate JS
   runtimes. Main learns her state only through `athena:status`. The `run` and `voice` stores live
   in `athena` alone (ADR 0026). See decision D1 below.
3. **Views stay pure functions of a view-model**, with `empty`, `typical`, `heavy`, `degraded`
   fixtures and `preview.html` rendering them with no Tauri. Fathom's scenes are views; the
   contest page had no such seam and that is the main thing its port must add.
4. **The app root starts app-wide stores; a view never does.**
5. **Decisions are daemon-confirmed.** Nothing is stamped until the daemon accepts; a refusal
   keeps the card and says why.
6. **Confirm-before-act stays:** two-press Forget and Disconnect, Close with a card waiting, the
   writes switch and allow-list, onboarding Finish gated by readiness.
7. **Honest copy stays:** the records notice cannot be dismissed, seals state their limits, the
   OpenAI key is never shown back, the Playbooks "simulated" line stays, designed art is labelled
   stylised.
8. **Both themes stay token-only** and `prefers-reduced-motion` is honoured. The contest cut the
   light theme; the port does not.
9. **Keyboard parity**: Ctrl+Shift+Space, Ctrl+Alt+A/D, Esc, A, D, the voice studio keys, replay
   arrows, address field Enter/Escape, all unchanged.

## 3. The depth model

One pure reducer, `src/depth/model.ts`, is the whole navigation. State is a path; the URL hash
mirrors it so a depth is a link.

```
D0  surface        her, the conversation (mirror, see D1), the waiting slips, the dock
D1  apps | chores | accounts | voice | mind        the five lights on the seabed
D2  app/<id> | chore/<id> | account/<id> | engine | brain | look | data
D3  apps/<id>/tool/<name> | apps/<id>/page | chores/<id>/run/<n> | accounts/<id>/allowlist
```

- Every capability is at most three moves from D0 (the contest's own rule, and the bar here).
- `rise()` is Escape and the Rise button; `dive(to)` is a click, Enter, or a number key.
- The reducer is total, interruptible (a dive during a rise lands where the user last asked), and
  testable without a DOM. `crumbs(path)`, `gauge(path)` and `shape(path)` are pure functions of it.
- `shape(path)` returns `scene` or `page`. It is the only thing Rust needs (ADR 0088).

Nothing in `depth/` imports a store, Tauri or a view.

## 4. Architecture

```
chrome.tsx            app root: starts the same app-wide stores as today (no new owner)
 src/depth/           model.ts (reducer, crumbs, gauge, shape) + hash.ts (url <-> path)
 src/stage/           the one scene host: Backdrop, Gauge, Crumbs, Rise, Dock, Transition
 src/bell/            Bell (SVG), tendrils driver, state -> pose; shared with the companion seal
 src/scenes/<name>/   model.ts, fixtures.ts, view.tsx, index.ts   <- the module contract, unchanged
 src/art/             one stylised glyph per depth and per item kind, labelled stylised
```

A scene is exactly today's module contract (`model.ts`, `fixtures.ts`, `view.tsx`, `index.ts`
with `Live`). The five modules' **models, selectors, fixtures and tests are kept** and moved or
re-exported; only their views are replaced. That is how features are not sacrificed: the
behaviour layer is not rewritten, so its 159 module tests keep guarding it, and each new view
adds its own `renderToStaticMarkup` tests over the same fixtures.

`ModuleEntry` grows one optional field, `depth`, naming the depth the scene answers to. The
module bar and `registry.ts` stay until cutover so every phase ships a working app.

### D1: where does she talk? (owner decision, default chosen)

Fathom's centre is a conversation with approvable slips. Today that lives in her own window
because the `run` store and the microphone have one owner (ADR 0026), and two owners would
double-answer decisions (invariant 3's cousin: one decision, one signature).

- **Default for v1 (recommended):** Main's surface is a **mirror**: her pose from `athena:status`,
  the waiting count, the last step, and an input that hands the text to her window through the
  existing `athena:offer`. Slips are answered in her window as today. Nothing about ownership
  changes, and no decision can be answered twice.
- **Later, behind an ADR and a prototype:** a Main-hosted conversation. It needs the `run` store
  to have exactly one owner at a time and a handover protocol; it is a different project and is
  not required to ship the redesign.

This is the one place the redesign could contradict an accepted ADR, so it is called out rather
than decided silently.

## 5. Performance: blazing fast is a requirement with numbers

"Cool" is the contest's win; "fast" is what the port must prove. Budgets, enforced by a gate
(`pnpm perf`, section 7), measured on the WebView2 build the app actually ships:

| Budget | Number | Why |
|---|---|---|
| Depth transition | 360 ms ease, 60 fps, interruptible, final state under reduced motion (not a faster animation) | `layered-ui-formula.md` guardrails |
| Animated properties | `transform` and `opacity` only | no layout, no paint on the move |
| Animated `filter` | none on a scene-sized layer | the contest's `blur(10px)` keyframes force a full-surface raster per frame; use a pre-softened layer cross-faded by opacity |
| Long tasks during a transition | 0 over 50 ms | |
| rAF loops | at most 1 in the whole window, a shared scheduler, stopped when the tab is hidden, the scene is calm or nothing moves | the contest ran two |
| Idle cost | no frame callbacks when nothing is moving | a settled scene must cost ~0 CPU |
| React renders per frame | 0: the bell, tendrils and backdrop are driven imperatively (refs, WAAPI, CSS variables), never by state | the contest redrew 30 SVG paths with `setAttribute` at 30 Hz; the port moves that to one transform-composited layer or a canvas |
| Cold chrome to interactive | under 300 ms after the webview loads | the surface is the only eager chunk |
| First-paint JS | under 150 kB gzip; each depth is `React.lazy`, preloaded on hover or focus of its light | |
| Scenes mounted | surface + the active depth (+ the one it came from during the move) | rising must be instant, so the surface is kept alive |
| Long lists | `content-visibility: auto` plus `contain-intrinsic-size`; the Apps ledger and the Record already hold hundreds of rows | |
| Text | 12 px floor at every width, 14 px for reading text | the contest's 8 to 10 px did not pass |

`Calm` (the contest's toggle) becomes a real setting in `settings` beside the theme and the text
scale, defaulting to the OS preference.

## 6. Phases

One commit per feature, each shippable: the old bar and modules stay live until Phase 9. Each
phase names the proof it must carry.

| # | Phase | What lands | Proof |
|---|---|---|---|
| 0 | Gate first | `pnpm perf` harness (frame times, long tasks, rAF count, idle CPU) over the preview harness; `src/lib/motion.ts` shared scheduler and `prefers-reduced-motion` + Calm setting; token additions (`--depth-*`, `--ease-*`, `--dur-*`, derived from the existing palette only) | the gate runs red on a deliberately janky fixture and green on a still page; token test |
| 1 | Depth model | `src/depth/` reducer, hash mirror, `crumbs`/`gauge`/`shape`; property tests (Escape from anywhere reaches D0, interrupted dives, deep links, unknown ids fall back) | unit tests, no DOM |
| 2 | Stage | Backdrop (one canvas, visibility-paused), Gauge, Crumbs, Rise, Dock, Transition (transform/opacity); `preview.html?scene=` | gate: transition budget; screenshots at 1280x800, 1920x1080, 390x844 |
| 3 | Bell | `src/bell/`: the bell, tendril driver, pose per athena state (resting, reading, working, asking, speaking); the companion's seal reuses it | gate: 0 renders per frame, idle CPU; pose table test |
| 4 | Layout shape (Rust) | `layout.rs` keyed by depth shape, `browser` id kept as an alias; the 76 px band carries Rise, crumbs, tab strip, address, tools | `layout.rs` tests for both shapes; `capture.rs` crop unchanged; cargo clippy |
| 5 | Setup as the first act | Mind (engine), Reach (apps + connectors), Voice as the opening of the surface; the old letter's readiness model is reused as is | the first-run tests; B5 acceptance (three actions to a loaded app) |
| 6 | Apps depth | the registered-apps field, app layer (on/off, Open, two-press Forget, overrides), tool level, empty/first-run/degraded | browser module tests moved; fixtures render; Forget needs two presses |
| 7 | Chores depth | the playbooks field and map, chore layer, replay (arrows), the simulated line, Hand to her | playbooks tests moved; replay keyboard test |
| 8 | Accounts + Voice depths | connectors (records notice, writes gate, allow-list, connect forms, two-press disconnect); voice studio and settings with its keys | connectors and voice tests moved; the notice is not dismissable |
| 9 | Mind depth + cutover | engine, brain, look (theme, text scale, Calm), microphone, data; **delete** ModuleBar, the old views and their CSS; the parity matrix fully green | `pnpm typecheck && lint && test`, `cargo check && clippy`, perf gate, a hand pass of the matrix |
| 10 | Polish | light theme art pass, a11y cluster (backlog B10: live regions, focus return, 150% fit), idle illustration, Calm | NVDA and 150% rig (backlog M2) |

Phases 5 to 8 are independent once 1 to 4 are in and can run in parallel branches.

**Progress:** phase 0 done (the gate, the clock, Calm, the tokens); phase 1 done (`src/depth/model.ts`: a fixed path grammar, the reducer, hash, crumbs, `shapeOf`).

## 7. How it is checked

- `src/depth/*.test.ts`: the reducer, exhaustively.
- Per scene: the existing model tests move with the model; new `view.test.tsx` renders every
  fixture and asserts the capabilities in the parity matrix are present and wired to their actions.
- `scripts/perf-gate.mjs` (Playwright, run from the shell's own dev server): drives the same path
  every time (D0, dive, D2, D3, Escape, Escape, plus one interrupted dive), samples frame times
  with `requestAnimationFrame`, collects `longtask` entries, counts rAF callbacks and checks the
  idle window. It fails the run when a budget in section 5 is missed and writes the numbers next to
  the screenshots, the way `layered-ui-formula.md` scores its rounds.
- `docs/redesign/parity.md`: the matrix. A phase is not done until its rows say how each was
  proven (test name or the hand check performed). A row without proof is a regression.
- The dev inspector (ADR 0086) is the tool for pointing at a component while iterating.

## 8. Risks and what we do about them

| Risk | Handling |
|---|---|
| The native page rectangle breaks the "one scene" illusion on entering Browser | ADR 0088: the page shape keeps the scene's band (Rise, crumbs, tabs) and the transition ends on it; the dive into a tab is a zoom into that band, not into the page |
| D1 (conversation ownership) | the default is a mirror; the alternative is a separate, ADR-gated project |
| The contest looks good in stills and janks in motion on a real WebView2 | Phase 0 builds the gate before any scene; no phase merges red |
| Illustration weight (the winner is 280 kB of source) | art is SVG symbols in `src/art/`, one sprite, lazy per depth; budgets above |
| Losing small behaviours in the rewrite | the models and their tests are kept; the parity matrix names each capability and its proof |
| Two copies of the palette | tokens only in `app.css`; the contest's literal hexes are replaced by variables at port time |
| A decision card and the depth scene fight for focus | arrival never takes focus (already the rule, `takes_focus(Arrival)=false`); the dock shows the waiting count and a slip rises into the surface only on request |

## 9. Decisions

Decided by the owner on 2026-10-13:

1. **D1: mirror in v1.** Main's surface mirrors her and hands text to her window. A Main-hosted
   conversation is a separate, ADR-gated project, not part of this one.
2. **Names: the contest's.** The depths are **Apps, Chores, Accounts, Voice, Mind**, because they
   sound friendlier than Browser, Playbooks, Connectors and Setup. The module ids stay as they are
   in code (`browser`, `playbooks`, `connectors`, `setup`, `voice`) so Rust and the stores do not
   move; only the words a user reads change.

Still owed and untouched here: close behaviour (backlog B3/C5).
