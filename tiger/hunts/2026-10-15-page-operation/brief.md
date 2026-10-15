# Territory dossier - page operation (WebMCP bridge, generic hands, browser lane)

Commit: 9bd3cce - written 2026-10-15

Area paths: `packages/athena-bridge/`, `src/athena/lane/`, `examples/demo-kit/src/webmcp/`,
`apps/desktop/src/lib/{hands,bridge,manifest}.ts`, `apps/desktop/src/stores/{run,tools}.ts`,
`apps/desktop/src-tauri/src/{bridge,hands}.rs`, and the page-specific parts of
`src/athena/core/catalog.py`, `src/athena/harness/hooks.py`, `src/athena/contracts/manifest.py`.

## Why this area

Athena's one-line pitch is "an agent that works inside the web apps you already use, and stops
to ask before anything it cannot take back" (README.md:3-4). Page operation is the "works inside"
half: README section 1 says a chatbot cannot do the user's cross-app chores "because the work is
inside the apps" and Athena can "because the apps are her environment, not her plug-ins"
(README.md:96-98). The onboarding ladder's tier 1 "acts" is exactly this area (README.md:100-103),
and demo acts 1-2 are built on it (README.md:105-110). Hunt evidence (`tiger.mjs hunt`, 180 days):
the context-map group "Page Bridge and Demo Kit" carries 4 declared use cases and the
`page-operation-via-webmcp`, `gated-action-approval` and `injection-resistance` flows; the bp
product tree lists `page-bridge` as a major-tier live feature (`.ai/lens-scan/app-structure.json`).
Heat is moderate (group heat 28 of 98 max) - the area is built and stable, which is why the
operator chose it: it is the differentiator, and work has recently gone elsewhere (Chores).

## Who uses it, for what

- The user (README.md:91-94): a freelancer or two-person studio whose work is spread across web
  apps they do not control (invoicing, bank portal, CRM, support inbox). Weekly cross-app chore:
  read state in one app, decide, act in another, keep a record of what was done and why.
- uat Characters (`uat/characters/`): ana, jonas, juror, mira, priya. Journeys touching this area:
  J3 (a gated card), J4-trust-record ("page's tools and the generic hands show their gate class"),
  J5-workday-main ("whether she has hands or tools there").
- Done well, to them: Athena can act on any page they have open, uses the app's own semantic tools
  when the app offers them, falls back to DOM hands when it does not, and every irreversible step
  shows up as a card with a picture of the page, runs exactly what was approved, once.
- Second consumer: example host apps (Ledgerbox, TidyCRM, Hirelane, Atlas) that register WebMCP
  tools via the shared demo kit - i.e. the "app developer" side of the protocol.

## What it does today

Three tiers, one gate (README.md:187-198). This area owns tiers 1 and 2.

**Tier 1 - the page's own WebMCP tools.**
1. A page registers tools with `useWebMCPTool` (`examples/demo-kit/src/webmcp/hooks.ts:64-100`) on
   `document.modelContext` (`modelContext.ts:127-137`); it emits standard hints plus a
   non-standard `athena:{reversible, side_effects}` block (`hooks.ts:57-62`, `:88`). `execute`
   runs through `runTool` (`door.ts:83-96`): schema validation, in-band errors, 16,384-char cap
   (`door.ts:11`); lists use `{showing, of, items}`, page size 40 (`bounded.ts:23-38`).
   Example: Ledgerbox classes are one data table (`examples/ledgerbox/lib/tool-classes.ts:19-52`).
2. `packages/athena-bridge/inject.js` runs at document start in the page's main world
   (`inject.js:17-34`): no install in frames or twice (`:39-42`), native registry if present else
   polyfill (`:44-47`, `:221-263`), strict message guards source/origin/namespace (`:52-58`),
   answers `list` with page identity from `athena:app*` meta + tools (`:79-81`, `:153-209`),
   posts `toolchange` (`:68-70`), runs `call` under a 1..30000 ms deadline with AbortController
   race (`:95-120`, `:280-283`), flattens output to a string (`:291-305`). Whole install in one
   `try`; a hostile page yields zero tools, not an error (ADR 0008).
3. Relay `apps/desktop/src-tauri/src/bridge.rs`: injects inject.js byte-for-byte (`:73`), plus a
   per-tab forwarder with tab id + 128-bit nonce (`:186-224`, `:112-118`); ids `<tab>:<n>-<random>`
   (`:126-129`); page webviews may call exactly one command, `bridge_reply` (`:16-19`, `:328-336`);
   35 s relay timer over inject's 30 s (`:66`). TS wrapper `apps/desktop/src/lib/bridge.ts:65-86`;
   `stores/tools.ts:67-99` refreshes a tab's tools and drops late answers after navigation (`:97`).
4. `packages/athena-bridge/gate.js` (surface side, never the page): flags -> AUTO/GATED
   (`gate.js:43-74`), unknown flags -> GATED (`:61`), a surface override may only tighten, a
   loosening is refused as `refused_loosening` (`:88-101`), closed refusal vocabulary (`:149-169`,
   anything else -> `unknown` `:176-180`) pinned to Python `ERROR_REASONS` by
   `tests/test_refusal_parity.py` (ADR 0009), 8-byte fence nonce (`:195`), 50-call per-origin budget
   (`:313`).

**Tier 2 - nine generic DOM hands** (`apps/desktop/src-tauri/src/hands.rs:77-144`), offered on every
tab with an origin (ADR 0065): `page_read`, `page_find`, `page_wait`, `page_scroll` (AUTO),
`page_click`, `page_fill`, `page_select`, `page_submit` (GATED), `page_screenshot` (AUTO, shell-run,
ADR 0025: PrintWindow of the window cropped to the page, focused tab only, `:302-355`). Hands work by
minted refs (`page_find` returns refs, others take a ref up to 64 chars; schemas `:193-233`). A hand
never returns an error, refusals map onto the closed vocabulary (`:236-266`, `:393-403`); hand
answers capped at 8000 chars (`:41`); hands.js read/find/label caps 4000/20/120. Hands appended to
the manifest by `withHands` (`apps/desktop/src/lib/hands.ts:156-159`); `callOnPage` routes hands to
`hands_call`, everything else to `bridge_call` (`hands.ts:170-184`).

**Catalog, gate and turn (shared with the core).**
5. `lib/manifest.ts:105-124` builds `POST /manifest`; a page naming no app gets
   `web_<scheme>_s<host>` (ADR 0065, `manifest.ts:53-77`; prefix unclaimable `:65-67`). Daemon
   `routes.py:407-493` validates (`contracts/manifest.py:195-262`, caps 96 tools / 24 params,
   `maxItems` required on arrays `:255-256`) and merges into the catalog as `host.<app>.<tool>`
   (`core/catalog.py:290-371`); class = AUTO only if reversible and not external
   (`manifest.py:127-131`). No host tool may hold an executor (`registry.py:275-276`, ADR 0010).
6. One snapshot per exchange (ADR 0067, `stores/run.ts:350-375`, `:794-799`): manifest, disabled
   origins, first-sight gated origins (ADR 0063), user pins, routing list. Per request one capture
   of the focused tab (`run.ts:734`, `hands.ts:98-131`, 8 s timeout).
7. `BrowserLane.run` (`src/athena/lane/browser_lane.py:209-261`) records last turn's results as
   episodes tagged with tier (`:372-388`), composes the frame (`turn_frame.py:121-141`, results capped
   1600 chars with `(showing N of M)` `:46`, `:67-95`). Capabilities block
   (`catalog.py:461-544`): GATED, READ, AUTO order, 12,000-char bound (ADR 0070), page text
   neutralised not fenced (ADR 0068: one line, desc 240, param text 40, 12 enums).
8. The model writes an `OP:` line (`harness/op_grammar.py:170`); `rounds.py:286-334` calls the gate
   (`harness/hooks.py:111-151`): validator, class, `_tightened` for first-sight origins and pins
   (`:264-275`). Allowed host calls are held by the surface and run by `onPage` (`run.ts:666-714`)
   after the turn; at most 8 rounds per turn (`rounds.py:54`) and 8 surface continuations
   (`run.ts:41`).
9. A GATED call files a card with the tab capture (`hooks.py:84-93`, `:133-143`). On approval
   (`run.ts:831-918`, `routes.py:733-857`) the lane replays the gate with `approval_id`
   (`browser_lane.py:265-368`); `_check_grant` matches action + params (`hooks.py:185-218`);
   `approvals.consume` is one conditional UPDATE so a grant is spent exactly once
   (`core/approvals.py:456-472`, ADR 0038); the `Execute` instruction carries params from the
   approval row, not the request (`browser_lane.py:128-152`).

**What it does unusually well** (evolve these):
- No host executor exists daemon-side; a gated page action can only run as an `Execute` after a
  replay that spends a single-use, parameter-bound grant. Parameters cannot drift after approval.
- Pages, flags and settings can only tighten: unknown flags -> GATED, first-sight origin -> all
  GATED, a loosening override is refused and reported, lists too long are refused not cut, an
  unreadable origins table fails closed (`run.ts:459`).
- The tab is read once per exchange, closing manifest/gated-list/route splits.
- Defence in depth on the bridge: one IPC command, per-tab nonce, unguessable ids, frame and
  source/origin guards, two layered timers.
- Every cut is announced with the same `(showing N of M)` footer across JS, Rust and Python.
- One refusal vocabulary in three languages, drift tested.
- The approval card carries a shell-taken picture of the page (not page-provided).
- Graceful two-tier capability: semantic tools where the app offers them, DOM hands everywhere.

## Measured state

- Tests (run 2026-10-15): `uv run pytest tests/lane` 43 passed; `tests/test_refusal_parity.py` 4
  passed; `packages/athena-bridge` `node --test` 24/24; desktop vitest `src/lib/hands.test.ts` 15,
  `src-tauri/src/hands.test.ts` 27; demo-kit `node --test test/*.test.ts` 140/140. Rust tests by
  count (`#[test]`): bridge.rs 7, hands.rs 23 (not run - needs a build). No `bridge*.test.ts` in
  apps/desktop.
- WebMCP tools per example app (count of `useWebMCPTool` sites + 4 zoom tools each): Ledgerbox 23
  (3 GATED), TidyCRM 22 (3 GATED), Hirelane 16 (3 GATED), Atlas 12 (0 GATED).
- Registry (`.ai/registry-map.json`, 2026-10-14): page-bridge `mcp-tools` = **deviation**
  (`inject.js:129` dispatches without validating input against the schema it publishes at `:205`;
  unknown-tool `:98` and handler fault `:116` share one uncoded `{ok:false,error}` shape).
  demo-kit-ui-webmcp `mcp-tools` = **deviation** (`door.ts:27` ignores `maxItems` from
  `types.ts:104` and silently slices; `door.ts:92` awaits the handler with no time limit and
  `hooks.ts:89` drops the abort signal). desktop-client-lib `mcp-tools` = **deviation**
  (`lib/bridge.ts:83` toolchange re-lists with no pin or diff of descriptions; consent is per origin
  on first sight only, so a page can later rewrite a description). browser-lane `agent-memory` =
  **deviation** (`browser_lane.py:383` raw tool output appended as episode bodies);
  `module-design` = conformant.
- Lens-scan (`.ai/lens-scan/scan.db`): page-bridge loc 1197, test ratio 63.3%, 12 flow tests, 3
  untested paths; webmcp kit loc 2925, test ratio 11.0%, 2 flow tests, 13 untested paths.
  Recorded limitations of page-bridge: iframe tools never exposed; 30 s hard cap per call; fixed
  50-call budget per origin; a tool can only be tightened; non-text output dropped. Unhandled case:
  a consequential tool that outlives 30 s is recorded as `timeout` while it may still complete
  (e.g. a send). Low security note: an `athena` block claiming `{reversible:true,
  side_effects:'none'}` yields AUTO; the comment at `inject.js:12-13` overclaims. browser-lane
  unhandled: a cancelled replay of an approved card writes only a ledger row, no episode tells the
  model.
- Proving Ground (README.md:399-420, :542-548): 306 hostile turns over three seeds, 0 breaches;
  surfaces `page_state`, `tool_result`, `memory` (`src/athena/proving/gauntlet/attacks.py`).
  Attacks enter through `POST /run` / `POST /manifest`; **inject.js, gate.js and the hands are not
  exercised by the Gauntlet** (no reference in `gauntlet/*.py`). On the Claude row 0 of 75 turns
  even attempted a gated call, so the gate was untested by an attempt there (README says so).
- UAT r1 (`uat/runs/2026-10-01-r1/SUMMARY.md`): J4 fail (per-app switch off was cosmetic, since
  fixed - ADR 0063); jonas-2 (high, uncertain): the generic hands were not distinguished from page
  tools; juror-8 (medium): the card does not say which app/origin it acts in; uat-2: a second tab of
  the same app breaks turns. Page webviews are not CDP targets - reachable only via `tabs_list` and
  `bridge_call`. r2 verified the switch-off fix on the prompt side only.
- Usage, latency, success rate of page calls in real use: **not measured**. No per-tool success /
  refusal statistics exist outside the ledger rows.

## Recent history

- 2026-09-12: bridge foundation - inject.js `b89c89d`, gate.js `ea1aa3f`, relay `54aece6`, browser
  lane `e15b7d7`, eight hands `f7b7d5e`, screenshot hand `03577f6`.
- 2026-10-01..10: gate hardening - switched-off app refused `c7a4b48`; approval spent on pass
  `8ed9d1f` (ADR 0038); refused replay can be re-answered `c31ef60`; GATED on first sight + pins
  `32a77c5` (ADR 0063).
- 2026-10-10..11: hands on every origin `2c52cde` (ADR 0065); capture on gated cards `bf72a39`
  (ADR 0066); hands as tier 2 in the manifest `24a9375`; capture sweep keeps the 64 MiB cap `173f313`.
- 2026-10-14: lens-scan fixes - demo-kit execute door validates/catches/caps `d4c8a2a` (kept);
  bridged calls validated against inputSchema with coded reasons `8cdf1e9` **reverted** in
  `9b95915` because `/conform` still judged a deviation and because the new reason codes sat outside
  gate.js's closed vocabulary, so gate.js and hands.rs folded them back to `unknown`. A redo must
  extend the vocabulary in Python first (ADR 0009) or it will be reverted again.
- Open lens-scan proposals: tabs accept only http/https (p-7b2253); "relay could not read the page"
  instead of "offers no tools" (p-6d437e); `FrameBuilder.forget` drops switched-off origins
  (p-bfd37e); page-written tool output stored as an untrusted episode, not role=system (p-a038ea).
- Rejected / non-goal directions - do not propose: Athena registering herself as a WebMCP tool on
  pages (README.md:335); per-project browsing profiles (README.md:336); a screen grab instead of
  PrintWindow, or letting the page photograph itself (ADR 0025); fencing page text in the
  capabilities block (ADR 0068, breaks the prompt hash); running host executors in the daemon, or
  optimistically when a tool claims reversibility (ADR 0010); polling a page global with `eval`
  (ADR 0014); routing every refusal through the daemon / generating JS from Python (ADR 0009); a
  pin control on the tool level without its own ADR (ADR 0091 - allowed if the proposal says it
  needs an ADR). Owner taste: bold moves over polish; revert a direction that degrades a working
  baseline.

## Known limits and open questions

- The page calls and the hands are one call per OP, one turn per page step; a multi-step form or a
  sequence across a page is many gated cards and many rounds (8-round cap, `rounds.py:54`).
- Hands address the DOM by refs minted per `page_find`; there is no memory of how a given app's
  page is operated from one session to the next (the brain records episodes, `browser_lane.py:383`,
  but no procedural "how to operate app X" is derived from them).
- The 30 s cap and `timeout` on a consequential call that may still complete (unknown outcome is
  reported as failure).
- `toolchange` re-lists without diffing descriptions; consent is per origin at first sight only.
- iframe tools never exposed; non-text output dropped; only `none|internal|external` side effects
  (`gate.js:25`) while the demo kit authors `"data"` (`types.ts:9`), silently ignored in favour of
  hints.
- The Gauntlet never drives inject.js / gate.js / the hands; there is no adversarial page fixture
  in the browser path.
- Card legibility: juror-8 - the card does not name the app/origin; jonas-2 - hands vs page tools
  not distinguished for the user.
- Open questions nobody has answered: how often real users hit tier 1 vs tier 2; how many page steps
  a typical chore needs; whether real third-party sites (not the three example apps) will ever ship
  WebMCP tools, and what Athena offers them in return.

## Constraints

- Stack: Python 3.11+ stdlib-only core (`athena.contracts`, `athena.core` import only the standard
  library, ADR 0002; third-party code only as lazily imported extras); Tauri v2 Rust shell with one
  webview per tab; React 19 panel; the bridge is plain JS with no build step. Windows is the primary
  desktop platform (PrintWindow capture).
- Wire contract `packages/athena-bridge/protocol.md` must stay compatible: envelope
  `{__ns:"athena-webmcp", dir, id}`, the two message guards, `output` always a string, `toolchange`
  with `id:null`, 30 s / 35 s timers. Extensions are additive.
- Refusal vocabulary: Python `ERROR_REASONS` (`src/athena/contracts/harness.py`) is the authority;
  gate.js and hands.rs must match (`tests/test_refusal_parity.py`). New reasons start in Python.
- Six invariants (README.md:115-129) hold for every change: disk is truth; provenance mandatory;
  policy in the gate never in the model (a GATED tool never executes without a resolved decision);
  bounded and honest cuts; no provider mandatory; one ledger row per model call.
- Page webviews keep exactly one IPC command (ADR 0014); the lane holds no host executor (ADR 0010).
- Licence Apache-2.0. Single-user desktop; no cloud deployment of the companion; the user's own
  Claude Code / Codex CLI is the daily engine (no API key).
- Registry standards (subscribed `software-engineering`): the relevant golden path is `mcp-tools`
  (techniques `tool-schema-design`, `server-composition`, `untrusted-result-handling`,
  `budgeted-partial-response`, `write-freshness-gate`, `tool-identity-vs-tool-name`,
  `client-integration`); the four deviations above are open findings any proposal may close.
- Out of scope for this hunt: Chores / adopt front door, voice, connectors (tier 3), Proving Ground
  internals except as a test bench for this area, the scene/UI redesign of the main window.
