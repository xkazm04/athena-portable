# The Athena exposure standard

What it means for a web or Tauri app to be **ideally exposed to Athena**: she can open it in her tab,
find her way around it from tool results alone, read what the person is asking about, propose every
change as a card the person approves, and never fight the app's navigation, her own caps or her trust
model. Written from the first full exposure (the Shadowrunr console, Overlord, 2026-10-23/24) and from
Athena's own code and ADRs. `/open` follows it; a deviation from it is a finding, not a preference.

Layers, as the organization's registry uses them: this file is the **golden path**; each
`techniques/<slug>.md` is one concern stated as "when X, do Y, because Z" with its evidence; the
Shadowrunr console is the first **application** and is cited as evidence, never as a mandate.

---

## 1. Golden path

### What an app owes Athena

1. **A page she can open, on an origin she admits.** The app's UI runs in her tab at `https://<host>`
   or `http://localhost:<port>`, never `127.0.0.1`, never only inside its own Tauri window. Its data
   path works from a plain browser tab. (surface-selection)
2. **A name and an opt-in.** `<meta name="athena:app">` (a slug), `athena:app-name` and
   `athena:app-version`; a visible toggle, off by default, that registers the catalogue and
   unregisters all of it with one abort. Outside Athena the toggle is not rendered and the catalogue
   code is never loaded. (page-identity-and-opt-in)
3. **Orientation in results, not descriptions.** `where_am_i` (the view, the ids in view, the tools
   that fit here), `app_map` (an index, then topics: a page's route grammar, a glossary, recipes) and
   `go_to` (a validated deep link). Reads that have a view move the app to it (`show`, default true).
   No tool reads an ambient selection. (orient-tools)
4. **Honest classes.** Every tool states both standard hints and the `athena` block. Reads are
   `reversible: true, side_effects: "none"`; a reversible in-app move is `internal`; anything that
   cannot be undone, or reaches a person, a payment or a public URL, is GATED. (tool-classes)
5. **A catalogue that fits her.** Descriptions of at most 240 chars that say what the consumer cannot
   infer; the whole catalogue at most 5,000 chars of her capability block as her own renderer draws
   it; every array parameter with `maxItems`; closed schemas; at most 96 tools and 24 params per tool.
   (description-budget, capability-footprint, manifest-validity)
6. **Answers that fit her.** Every result is at most 1,500 chars of JSON at realistic size (her cut is
   1,600); lists are bounded and say "showing N of M"; documents come a page at a time with an outline;
   an answer that cannot fit is refused with what to ask instead, never cut mid-JSON. (result-budget)
7. **Writes she proposes and the person signs.** Every write is GATED and lands as a card; long
   documents change by find/replace against a base digest, so the card shows a readable change and a
   stale write is refused. (digest-guarded-edits, approval-cards)
8. **A backend that admits only her tab, and no token in the page.** The app's own daemon allows the
   page's origin and refuses every other browser origin; Athena's trust is the person's registration of
   the origin plus per-contract acceptance; nothing secret travels through the page. (trust-and-pairing)
9. **Proof at four levels.** Producer catalogue tests at realistic fixture size; a keyless scripted
   harness; a live pilot with a per-case report; the real desktop e2e through her UI. (verification-ladder)
10. **Walkthroughs that cannot hurt.** Scratch copies of everything writable, a digest guard on the real
    tree, isolated instances for repeated runs, cleanup on failure too. (walkthrough-operations)

### What a principal practitioner holds true

- **The consumer's acceptance rules are the spec.** Her caps (240, 1,600, 12,000), her validator and
  her trust model decide whether anything works; read them from her code at the start of every run
  (section 2), because the Shadowrunr scout knew the 240-char cap and missed the other three, and each
  miss was found only at the seam.
- **Failure at her door is total and silent.** One array without `maxItems` refuses every tool. One tool
  past the block bound drops every tool after it. One result over 1,600 chars is cut where she cannot
  parse it. None of these produce an error the producer sees, so each needs a producer-side test.
- **She has no eyes in the app except what the tools return.** A gap in the catalogue does not stop
  her; she reads the page with DOM hands instead, slower and with different line numbers. A hand call in
  a pilot is a missing-tool finding.
- **Orientation is a cost, measured in calls before content.** The design goal is zero or one
  orientation call before the first content-bearing call; the live pilot measures it per case.
- **The person signs every change, and signs something readable.** A card that shows a whole document
  is a card nobody reads. A find/replace pair is.
- **Trust is the person's act, in Athena's UI, never the page's claim.** The page claims flags; the
  person registers the origin and accepts the contracts; a page can tighten nothing and loosen nothing.
- **A green suite that ran nothing is the most dangerous result.** Assert the count of tests that ran
  (measured 2026-10-24: run from a worktree, the Shadowrunr suite resolved its sibling checkout to a
  path that does not exist and skipped all 13 tests with exit 0).
- **Numbers carry their measurement.** Every figure here names its run and date; a cost or a call count
  from one pilot case is n=1.

---

## 2. Athena's acceptance rules (read them fresh each run)

The values as of athena-portable `5c1a449d` (2026-10-24). `/open` re-reads each from its source at the
start of a run and records the commit in the plan's `athena_rules_read_at`; when a value moved, the
plan, the tests and this table move with it.

| Rule | Value | Source | Consequence for the app |
|---|---|---|---|
| Registry location | `document.modelContext` (native first, else the `inject.js` polyfill); `navigator.modelContext` is only reported | `packages/athena-bridge/inject.js:54-57`, `:201` | register there, with `{ signal }` |
| Admitted page origins | `https://<host>`, or `http://localhost[:port]` only; `127.0.0.1` and `[::1]` refused | ADR 0119; `src/athena/contracts/manifest.py:55`; `apps/desktop/src/lib/manifest.ts` `registrable` | serve on `localhost` |
| App id | `athena:app` slug; else derived from the origin (`web_` prefix reserved) | ADR 0065 | publish the meta tag |
| Class derivation | AUTO iff reversible and `side_effects` not `external`; else GATED. A page tool is never READ in her catalogue | `HostTool.default_class` `manifest.py:152-156`; `gate.js` `classify`; ADR 0004 | READ is the producer's own label |
| Flags read | `athena` block first, then `consequentialHint`/`readOnlyHint`; `destructiveHint` is not read; unknown is GATED | `gate.js` `flagsOf` `:43-62` | state both hints and the block |
| First sight | an origin with no row: every tool GATED, reads included | ADR 0063 | the pairing guide registers the origin |
| Contract trust | SHA-256 of `{name,title,description,inputSchema,annotations,athena}`; accepted on Enable or after an approved ok call; a new or changed contract asks again | ADR 0100; `apps/desktop/src/lib/contract.ts:76-96`; `stores/run.ts` `contractDriftsOf` | re-trust after tools change |
| Description | cut at 240 chars (cut, not refused) | `DESCRIPTION_CAP` `src/athena/core/catalog.py:79`; ADR 0068 | write at most 240 |
| Param text, enum | param text 40 chars; enums show 12 values then "+N more" | `PARAM_TEXT_CAP`, `ENUM_SHOWN` `catalog.py:80-81` | at most 12 enum values |
| Capability block | 12,000 chars; core entries always kept; foreign entries greedy in GATED, READ, AUTO then name order; the first that does not fit is cut with every one after it | `CAPABILITIES_CHARS` `catalog.py:89`, `_CLASS_ORDER` `:91`, `render_capabilities` `:602-689`; `core/prompt.py:137`; ADR 0070 | at most 5,000 chars per app |
| Manifest validator | refused whole on any problem: at most 96 tools, 24 properties per tool, unique names, slug app id, admitted origin, every top-level array param has `maxItems` | `HostManifest.validate` `manifest.py:220-288` (`:50-51`, `:281-282`); `daemon/routes.py:567-574` | producer test for each |
| Tool name | `[A-Za-z0-9_-]{1,64}`; cross-origin collisions refused | `_TOOL_NAME` `catalog.py:74` | |
| Result cap | 1,600 chars per host tool result, cut with "(showing N of M)"; at most 32 results per frame | `RESULT_CAP` `src/athena/lane/turn_frame.py:47`; `TOOL_RESULT_LIMIT` `core/prompt.py:154`; ADR 0043 | answer in at most 1,500 |
| Call timeout | 30 s in the page (`timeout_ms` may shorten it), 35 s at the relay; a timed-out non-read is `outcome_unknown` and a `late` answer is heard | `inject.js:26`; `bridge.rs:66`; ADR 0101 | long work returns a handle and is polled |
| Approval binding | an approved card runs only on the tab and document it was proposed on; a top-level navigation or reload since refuses it | ADR 0103 | never reload the document as a side effect of a read |
| Session pinning | a session is pinned to its page's app; another tab's tools are cards; text read from another tab taints the turn | ADR 0105, ADR 0106 | one app per conversation |
| Other surfaces | no MCP client in Athena; connectors need a spec plus a code provider in her repo | README "Deferred surface"; ADR 0021; `src/athena/connectors/service.py:48` | WebMCP is the only third-party door today |

---

## 3. Techniques

| Slug | The rule, in one line |
|---|---|
| [surface-selection](techniques/surface-selection.md) | When an app is opened to Athena, publish WebMCP tools from its own UI in her tab, because it is the only third-party surface she consumes and the only one that also moves the UI the person sees. |
| [page-identity-and-opt-in](techniques/page-identity-and-opt-in.md) | When the page detects a WebMCP registry, offer a default-off toggle that loads the catalogue chunk and registers every tool under one abort signal, because the person decides when the app is driven and the app pays nothing outside Athena. |
| [orient-tools](techniques/orient-tools.md) | When an agent must find its way, give it `where_am_i`, `app_map` with topics and `go_to`, carry the map in results, and never let a landing route override a set route, because descriptions are capped and every orientation call is a call not spent on content. |
| [tool-classes](techniques/tool-classes.md) | When a tool is declared, state its reversibility and externality explicitly and derive the class from them, because Athena's gate reads the claim and unknown is GATED. |
| [description-budget](techniques/description-budget.md) | When a description is written, spend its 240 chars on what the tool returns and the one constraint the consumer cannot infer from the rendered line, because nested constraints are invisible in her capability block. |
| [capability-footprint](techniques/capability-footprint.md) | When a catalogue is sized, render it with a port of her renderer and hold it to 5,000 chars, because the block is greedy and a tool past the bound vanishes with every tool after it. |
| [manifest-validity](techniques/manifest-validity.md) | When a catalogue ships, test her validator's rules producer-side and post the real manifest once at the seam, because one problem refuses every tool. |
| [result-budget](techniques/result-budget.md) | When a tool answers, fit 1,500 chars at realistic size, bound and page, and refuse with what to ask instead, because her 1,600 cut is silent and lands mid-JSON. |
| [digest-guarded-edits](techniques/digest-guarded-edits.md) | When a long document is changed, take find/replace against a base digest, exactly one match, with backup and validate-or-restore, because the card stays readable and a stale write is refused. |
| [approval-cards](techniques/approval-cards.md) | When a tool writes, make it GATED, give its card the arguments a person can judge, and answer a write that ran as done, because the card is the only place the person sees the change. |
| [trust-and-pairing](techniques/trust-and-pairing.md) | When an app is paired, register the origin, switch the opt-in on, then re-trust, and let the app's backend admit only that origin with no token in the page, because trust is per origin and per contract. |
| [verification-ladder](techniques/verification-ladder.md) | When an exposure is verified, climb producer tests, keyless harness, live pilot, real desktop, and assert that each level ran something, because each catches what the one below cannot. |
| [walkthrough-operations](techniques/walkthrough-operations.md) | When a walkthrough runs, write only to scratch copies, guard the real tree by digest, prefer an isolated instance, and clean up on failure, because the harness approves every card and a persistent conversation grows the cost of every turn. |

---

## 4. Where this standard meets the registry

Subjects read on 2026-10-24 through `ai-registry/knowledge/software-engineering/index.json`.

| Subject / technique | Verdict | Why |
|---|---|---|
| `mcp-tools` (golden path: "few tools, sharply named, at the altitude of user intent") | **agrees** | 25 curated tools plus one allowlisted read router, against ~100 RPCs; the generated one-tool-per-RPC catalogue was rejected. |
| `mcp-tools/tool-schema-design` ("constrain in the schema, not the prose"; demote to the description only when the host strips it) | **stricter, and different** | Athena does not strip `maxItems`, she *requires* it, and its absence refuses the whole catalogue. And her renderer shows only top-level types, so a constraint nested in `items` reaches the model only if the description restates it (`leave_feedback`'s tags). A value list too long for the footprint (the 30-method `query` allowlist) moves to an `app_map` topic, and the refusal names that topic. |
| `mcp-tools/catalog-projection-modes` ("compress because a ceiling outside your control forbids it") | **agrees, with a number** | Her 12,000-char block is that ceiling; the per-app share (5,000) is derived the way the subject derives a publisher limit: the host ceiling minus the core, the shell's hands, and room for a second app. |
| `mcp-tools/ambient-selection-is-not-an-argument` | **agrees** | No tool reads "the current" anything; `where_am_i` returns the ids in view. |
| `mcp-tools/write-freshness-gate` | **agrees** | `base_digest` from the newest read; a stale write is `conflict`. |
| `mcp-tools/caller-differentiated-capability` | **agrees** | `start_sim` refuses unless the daemon is scripted: the agent's reach is a strict subset by subtraction. |
| `mcp-tools/transport-selection` (local HTTP needs origin validation, on by default) | **agrees** | The app's daemon refuses browser origins it does not list. |
| `tool-result-economy` (cost is end to end; the way back must be advertised) | **stricter** | A hard per-result cap (1,600) the subject does not set. Exactness is kept *across* pages (digest, offsets, outline) rather than in one result, because a document cannot be exact-preserved in one. |
| `hitl-approval` ("actions that cannot change the world need no gate"; approval binds to what was approved; the surface shows the actual change) | **agrees** | Reads run unattended once trusted; contracts and the document binding (ADR 0103) are the binding; find/replace is the readable diff. First sight gating reads too is the subject's "first exposure" trigger. |
| `device-pairing` (a ceremony mints a bound token; the human approval is on a surface the requester cannot draw) | **agrees on the surface, deviates on the token** | Athena's registration and Origins page are her UI, which the page cannot draw. But the app's loopback daemon carries no token, only an Origin allowlist: Shadowrunr rejected a token ceremony because the daemon has no auth subsystem. This standard accepts that floor for a loopback, single-operator backend, and requires a ceremony when the backend listens off loopback or brokers spend or credentials. Recorded as a deviation, not as a lowered standard. |
| `agent-browser-control/agent-actionable-errors` | **agrees** | Every refusal is `<code>: <message>` and says what to ask instead (`too_large`, `conflict` with counts, unknown topic with the legal list). |
| `agent-browser-control/references-over-selectors` | **agrees, as the fallback** | DOM hands with minted refs exist; this standard treats every hand call as a catalogue gap. |
| `agent-addressable-ui` (keep the fact the build knew instead of reconstructing it; zero cost via a double gate) | **agrees** | The route grammar is published by `app_map` rather than reconstructed by page reading; the catalogue is a dynamic chunk behind registry-present AND opt-in (entry +1.5 KB measured on the console). |
| `test-harness` (fidelity ladder; a lane earns trust green on good and red on bad; zero selected tests exits green) | **agrees** | The verification ladder; the opt-out and decline cases are negative controls; the worktree skip measured above is the subject's zero-selected failure. |
| `eval-harness` (one optimized metric, the rest thresholds; read the transcripts) | **agrees** | The pilot optimizes calls-before-content with cost and unknown-tool thresholds; per-case figures are n=1 and reported as such. |

CDP automation of a WebView2 app is not covered by any subject read; the raw page-level transport is
filed as a lead (see `LESSONS.md` and `.ai/registry-leads.jsonl`).
