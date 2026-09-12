# Athena Portable

A single-user agent that treats the web applications a person already uses as her environment.
This repository is the hackathon rebuild of [athena-everywhere](https://github.com/xkazm04/athena-everywhere):
an empty tree, new code, the same design, one commit per feature, and the structural debts the
first build found fixed on day zero.

This README is the solution and architecture review the build is executed against. The full
chronology is `hackathon/hackathon-build-plan.md` in the reference repository; the phased order
with its continue-or-stop gates is `hackathon/architecture-timeline.html` there.

---

## 1. The problem and the user

A freelancer or a two-person studio whose work is spread across web apps they do not control: an
invoicing tool, a bank portal, a CRM, a support inbox. None of those apps has an agent, none will
get one, and the user will not switch tools. Every week the same cross-app chore: read state in one
app, decide, act in another, and keep a record of what was done and why.

A chatbot cannot do it because the work is inside the apps. A per-app copilot cannot do it because
the work spans them. Athena can, because the apps are her environment, not her plug-ins.

**The onboarding ladder** is the product pattern: tier 0 remembers (a brain that carries a fact
from one app into a decision in another), tier 1 acts (generic hands on any page, the page's own
tools where it registers them), tier 2 is native (the app hosts Athena's chat itself), and tier 3
reaches beside the browser (third-party connectors: mail, calendar, storage).

**The demo, four acts, under five minutes.**

| Act | What the audience sees |
|---|---|
| 1. Setup | First launch: the engine probe finds the user's Claude subscription, no key typed; two tabs, one per real app; the panel shows the page's own tools on one and nine generic hands on the other, all `GATED` on first sight |
| 2. Command | Push-to-talk: "Find every invoice over 30 days and draft a chase for each in the support inbox." Athena reads the first page, opens the second, fills the drafts; each fill is a decision card with the page screenshot beside it; two approved by voice, one declined |
| 3. Another agent | A coding agent in a terminal calls Athena's MCP server for guidance; the question is a card in the approvals inbox citing the fact from act 2. Its later `request_approval` for a payment is declined |
| 4. Record | The activity module shows every call by app, tier and surface with its cost; both declines are ledgered `user_denied`; the origins module shows the fact Athena wrote, with the episode it cites |

---

## 2. Six invariants

Every change is reviewed against these. They are not features; they are what makes the features
trustworthy.

| # | Invariant | Where it is enforced |
|---|---|---|
| 1 | Markdown on disk is truth; SQLite is a rebuildable index. A brain is portable by copying the directory. | `core/brain/` |
| 2 | Provenance is mandatory: a fact that does not cite live episodes is rejected at write. No bypass, not even for tests. | `Brain.write_fact`, `write_procedural` |
| 3 | Policy lives in the gate, never in the model. A `GATED` tool never executes without a resolved decision. | `core/catalog.py`, `harness/hooks.py` |
| 4 | Bounded and honest: every truncated block announces `(showing N of M)`; every registry name appears in the composed prompt. | `PromptBlock`, `ExecResult` helpers |
| 5 | No provider is mandatory. The core is stdlib-only; engines, transports and clouds are extras imported lazily. | ADR 0002 |
| 6 | Cost is visible: one ledger row per model invocation, failures included, with a reason from a closed set. | `core/ledger.py`, `LedgerHook` |

---

## 3. Architecture

### 3.1 Layers

```
Surfaces      the Tauri desktop shell (chrome, page webviews, the panel), the bridge in the page,
              other agents over MCP, a voice client
channels      daemon (HTTP + SSE, token, CORS, Connection: close), mcp (JSON-RPC), voice (WebSocket)
lane          the browser lane: one turn, streamed; never holds a gated executor
harness       CLI harness in two dialects (claude, codex), hooks (gate, ledger, truncation),
              structural policy, the OP grammar, engine probes
core          brain, recall, catalog, approvals, ledger, constitution, prompt composer
contracts     dataclasses and Protocols only: ToolEntry, HostManifest, channel events, Harness,
              ERROR_REASONS, every id prefix
```

Packages depend on ports, never on concrete classes. `wiring.py` is the one place that binds them.

### 3.2 How a turn flows

1. The surface sends a user message with `host_state` (open tabs, active project), bounded and
   fenced with a fresh nonce.
2. The prompt composer produces two outputs: **static blocks** (constitution, identity,
   capabilities) for the system prompt, and a **turn frame** (host-state delta, last turn's tool
   results, active project) that rides in the user message. Nothing that can move is ever composed
   into the system prompt, so a resumed CLI session always sees current state.
3. The harness runs the turn. Up to eight provider rounds make one turn and one ledger row.
4. Every tool call passes the gate. `READ` executes synchronously and its capped answer becomes a
   system episode. `AUTO` executes if its validator passes. `GATED` writes an approval row and
   emits `decision.requested`.
5. Host tools have no executor in the lane. The gate allows them, the lane emits `tool.call`, the
   surface runs them on the page and returns the result in the next request, fenced.
6. The gated path closes through `POST /decisions/<id>`: the gate is replayed with the approval
   id, `describe` proves it was granted for this action and these parameters, and the surface
   receives an `execute` instruction.

### 3.3 The gate in one page

| Class | Meaning | Where the answer goes |
|---|---|---|
| `GATED` | approval row and a decision card; executes only after a resolved decision | the executor, or the host on `execute` |
| `READ` | synchronous, capped at 1,600 chars, announces truncation | a system episode |
| `AUTO` | fires after its validator passes | the executor, or the host |

A page's tools enter the catalog through a manifest. The class is derived from the manifest's own
flags: `AUTO` only if `reversible: true` and `side_effects` is not `external`; otherwise `GATED`
regardless of what the host prefers. A manifest that fails validation is refused whole. A surface
may tighten a class per origin but never loosen one below what the flags imply. Generic hands are
`GATED` on first sight for every new origin.

### 3.4 Three tiers of capability, one gate, one approval table

| Tier | Source | Origin | Executor |
|---|---|---|---|
| 1 | the page's own WebMCP tools, through `inject.js` and the relay | `host:<app_id>` | the page, on `execute` |
| 2 | nine generic DOM hands with minted refs (`page_read`, `page_find`, `page_fill`, `page_click`, ...) | `host:<app_id>` | the shell's `hands_call`, with a screenshot captured before every gated proposal |
| 3 | third-party connectors (section 4) | `connector:<id>` | the vault, in the daemon's process |

Other agents queue at the same gate: the MCP server's `request_guidance` and `request_approval`
file cards on the same approval table and block until the user answers.

### 3.5 Day-zero decisions carried in from the first build

| The first build found | This build decides at commit zero |
|---|---|
| The daemon was single-threaded behind one SQLite connection; a long `/run` stalled every read | one writer behind a lock, a read-only connection per read request, `ThreadingHTTPServer`, `Connection: close`, and the starvation test written before the server |
| A resumed CLI session kept its first system prompt | the two-output composer of 3.2 |
| Orphaned daemons after one evening | sidecar lifecycle is one Rust module with a tree kill and a Windows job object, tested in the commit that first spawns it |
| Seven panel surfaces in a 380 px column | module-first window from the start; the browser is one module among them; each module is a view-model, fixtures and a pure view |
| No automation seam for the panel | every module renders in `preview.html?module=&fixture=` without Tauri; a headless test drives the run loop against a fake daemon |
| Ids minted in two places with two prefixes | one `ids.py`, one `ids.ts`, a parity test |
| Screenshots never cleaned, capture-to-approval link approximate | captures in a table with a size cap and an LRU sweep; the daemon mints the approval with the capture id in its params |

---

## 4. Third-party connectors: the seam this build reserves

Connectors are built by a separate team in the reference repository (`src/athena/connectors/`,
`docs/connectors/design.md`). This build does not port them; it reserves the seam so they land
without a merge fight. The principles below are fixed here so the two halves agree.

- **A connector is data, not code.** One JSON spec per service (Gmail, Notion and Exa in the MVP)
  declares its auth methods, the hosts the broker will ever dial, the probe that admits a
  credential, and the few intent-shaped tools it yields. "Search mail", not nine endpoints.
- **It enters the catalog like a page.** A connector presents a manifest of the same shape as a
  host page: tools with `reversible` and `side_effects`, an origin of `connector:<id>`. The same
  merge, the same class decision. A connector cannot argue itself out of `GATED` any more than a
  page can.
- **It has an executor, unlike a page.** The executor is a `ConnectorPort` (`list_tools`, `call`)
  that runs in the daemon's process. The vault brokers every outbound call: an executor says
  "call Gmail with this request" and never holds a token.
- **Reads are `READ`, writes are `GATED` and more.** Writes sit behind a per-connector switch that
  is off by default and an egress allow-list gated from the arguments (recipients or resources).
  The switch layers on the approval gate, never replaces it.
- **Secret surfaces are absent, not gated.** No tool returns, lists, mints or rotates a credential.
  Credentials live in one user-level vault under `ATHENA_HOME/connectors/`, never in a brain, so a
  brain stays portable by copying.
- **Health is three-valued** (`healthy`, `broken`, `unknown`), rendered with its age, probed on
  events and never on render. Readiness is derived and names its remediation.
- **Structural policy checks liveness on every call.** A `connector:` entry is permitted only if
  the vault says the connection is live now; a disconnect takes effect on the next call.

What this build ships for it: the origin kind and `ConnectorPort` declared in the catalog commit
(P1), the `connector_enabled` rule in structural policy (P2), and tier 3 rendered in the activity
explorer and the approvals inbox, empty and labelled so, when the record lands (P7). Nothing in the
demo depends on a connector; if one is ready, act 2's chase drafts go through the mail connector and
the card names it as the thing that will act.

---

## 5. Build order and the stop rule

Nine phases of three or four components each. Phases 1 to 5 are the end-to-end MVP: one path,
nothing optional, the smallest thing worth submitting. Phases 6 to 8 add one act or one criterion
each, sorted by demo value. Phase 9 is reserved and starts at hour 44 from whatever is done.

| Phase | Hours | Latest start | Components | What the demo gets |
|---|---|---|---|---|
| P1 Foundation | 0–4 | 0 | repo + CI gate, contracts + ids, brain + recall, catalog | nothing visible; everything imports this |
| P2 The gate and the model | 4–10 | 6 | approvals + ledger, constitution + two-output composer, hooks + OP grammar, CLI harness (Claude dialect) | a turn on a fake model with the gate in front of it |
| P3 One turn end to end, no browser | 10–17 | 13 | browser lane + policy, daemon server with the starvation test, daemon routes, bridge `inject.js` + `gate.js` | `curl` runs a turn and answers a decision |
| P4 The shell skeleton | 17–25 | 20 | window + module bar + browser module, relay, sidecar with exit hygiene, store + Settings + Setup | tabs on real sites, the daemon beside them, a page reporting its tools |
| **P5 MVP checkpoint** | 25–31 | 28 | panel run loop, decision card + tool list, headless run-loop test, phase-1 status doc | act 1 and a typed act 2 on the page's own tools |
| P6 Hands and projects | 31–37 | 34 | nine hands + captures, projects, approvals inbox + pending store, tab awareness | act 2 for real: hands on a page that registered nothing |
| P7 Other agents and the record | 37–41 | 39 | MCP server + demo agent script, activity module, surfaces and tiers in the record | acts 3 and 4 |
| P8 Voice | 41–44 | 42 | voice gateway + one backend, push-to-talk + mic check, spoken card answers | act 2 without a keyboard |
| P9 Ship | 44–48 | 44 | bundle + smoke, demo script + ten runs, README + video | a bundle that installs and a script run ten times |

**The stop rule.** At the end of every phase, read the clock once. If the next phase's latest
start is ahead of the clock, continue. If it is behind and the phase is a value phase (P6 to P8),
skip it and everything after it, go to P9, and spend the recovered hours on demo runs. If it is
behind and the phase is an MVP phase (P1 to P5), finish it anyway and cut every value phase
instead; there is no demo without it. Within a phase the fourth component is the first thing
dropped. Never cut: the starvation test, exit hygiene, the headless panel test, the
`(showing N of M)` footers, the screenshot on a gated proposal, or the ten demo runs.

---

## 6. Repository layout at the end

```
pyproject.toml           uv + hatchling; extras: dev, vec
package.json             pnpm workspace: packages/*, apps/*
src/athena/
  contracts/             registry.py, manifest.py, channel.py, harness.py, ids.py
  core/                  brain/, catalog.py, validators.py, approvals.py, ledger.py, constitution.py, prompt.py
  harness/               ports.py, hooks.py, policy.py, cli_harness.py, op_grammar.py, engines.py
  lane/                  browser_lane.py, turn_frame.py
  daemon/                server.py, routes.py, sessions.py, ready.py
  channels/              mcp.py, voice/
  connectors/            port.py only; the connectors themselves live in the reference repository
  wiring.py, cli.py
constitution/            law.md, identity.md
packages/athena-bridge/  inject.js, gate.js, protocol.md, test/
apps/desktop/
  src-tauri/src/         lib.rs, tabs.rs, bridge.rs, hands.rs, hands.js, daemon.rs, store.rs, tray.rs, layout.rs
  src/                   app.tsx, lib/, stores/, modules/<name>/{model,fixtures,view,index}, preview.tsx
scripts/                 build-sidecar.py, sidecar_entry.py
tests/                   core/, harness/, lane/, daemon/, test_contracts.py, test_ids_parity.py
docs/                    design.md, adr/, demo.md
```

---

## 7. The quality bar for every commit

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy                                   # strict on src/athena
uv run pytest                                 # every test, no provider needed
pnpm typecheck && pnpm lint && pnpm test      # bridge and panel
cargo check && cargo clippy --all-targets     # from P4 on
```

One commit per feature: the code, its tests, and the doc line that describes it. The commit
message is `type(scope): what changed, as a sentence`; the body names the design section, the
tests added, and what was verified by hand, if anything. Any choice a later reader could question
gets an ADR in the same commit. Contracts change only with a test and a changelog line. Every
module's first docstring line names the design section it implements. No machine paths in
committed files.

---

## 8. Non-goals

The Strands API engine, the sleep cycle, Athena registering herself as a WebMCP tool on pages,
speech-to-speech voice models, telemetry mirrors, cloud deployment, per-project browsing profiles,
the connectors themselves (section 4), and any example host app. Real sites are the environment;
a scratch page proves a claim, a real app proves the demo.
