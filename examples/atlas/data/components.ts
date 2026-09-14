/**
 * The modules themselves — what Atlas opens at L2.
 *
 * Each one names what it ENFORCES rather than what it contains, because "what would go wrong if
 * this file were deleted" is the only question a map of a machine has to answer. The sentence is
 * read from the module's own first docstring line (README §7 makes every module carry one), from
 * the ADR that decided it, or from the README section both cite.
 *
 * `concepts` is what the lens reads: the claims this module is the enforcement of. It is
 * deliberately sparse — a module tagged with eight concepts lights on every lens and therefore
 * tells a reader nothing. If a module merely *touches* an invariant it is not tagged; it is
 * tagged where it is the place the invariant would be violated.
 */
import type { Component } from "./types";

export const COMPONENTS: Component[] = [
  /* ====================== surfaces / the composition root ======================= */
  {
    id: "cmp-wiring",
    part: "C-066",
    system: "sys-wiring",
    name: "wiring.py",
    enforces:
      "The one place the real classes are bound together, so every other package can depend on ports and nothing else.",
    file: "src/athena/wiring.py",
    concepts: ["inv-noprovider"],
    adrs: [2],
    status: "built",
  },
  {
    id: "cmp-cli",
    part: "C-067",
    system: "sys-wiring",
    name: "cli.py",
    enforces:
      "serve, doctor and rebuild — the three things a person does to an Athena without a window open.",
    file: "src/athena/cli.py",
    concepts: ["act-setup"],
    adrs: [],
    status: "built",
  },

  /* ============================ surfaces / the shell ============================ */
  {
    id: "cmp-shell-lib",
    part: "C-001",
    system: "sys-shell",
    name: "lib.rs",
    enforces:
      "The window is one module bar plus one full-width module; the browser is a registry entry, not a frame that hosts a panel.",
    file: "apps/desktop/src-tauri/src/lib.rs",
    concepts: ["dec-module-first"],
    adrs: [13, 24],
    status: "built",
  },
  {
    id: "cmp-shell-tabs",
    part: "C-002",
    system: "sys-shell",
    name: "tabs.rs",
    enforces:
      "A page lives in its own webview with its own origin; host state names the open tabs so a turn knows where it is.",
    file: "apps/desktop/src-tauri/src/tabs.rs",
    concepts: ["act-setup"],
    adrs: [14],
    status: "built",
  },
  {
    id: "cmp-shell-bridge",
    part: "C-003",
    system: "sys-shell",
    name: "bridge.rs — the relay",
    enforces:
      "A page webview is granted exactly one command (allow-bridge-reply); the request-id map lives in Rust, never in the page.",
    file: "apps/desktop/src-tauri/src/bridge.rs",
    concepts: ["tier-act"],
    adrs: [14],
    status: "built",
  },
  {
    id: "cmp-shell-hands",
    part: "C-004",
    system: "sys-shell",
    name: "hands.rs — the nine hands",
    enforces:
      "Tier 2 on a page that registered nothing: nine generic DOM hands with minted refs, every one GATED on first sight for a new origin.",
    file: "apps/desktop/src-tauri/src/hands.rs",
    concepts: ["tier-act", "act-command"],
    adrs: [25],
    status: "built",
  },
  {
    id: "cmp-shell-capture",
    part: "C-005",
    system: "sys-shell",
    name: "capture.rs",
    enforces:
      "A screenshot is taken before every gated proposal, of the window cropped to the page, so no page can photograph itself.",
    file: "apps/desktop/src-tauri/src/capture.rs",
    concepts: ["act-command", "inv-gate"],
    adrs: [25],
    status: "built",
  },
  {
    id: "cmp-shell-daemon",
    part: "C-006",
    system: "sys-shell",
    name: "daemon.rs — the sidecar",
    enforces:
      "One daemon per shell and none that outlives it: a Windows job object with kill-on-close, and the token handed over in a file rather than argv.",
    file: "apps/desktop/src-tauri/src/daemon.rs",
    concepts: ["act-setup"],
    adrs: [15],
    status: "built",
  },
  {
    id: "cmp-shell-store",
    part: "C-007",
    system: "sys-shell",
    name: "store.rs",
    enforces:
      "One SQLite file with every table created at once, behind exactly four generic key/value commands instead of a command pair per surface.",
    file: "apps/desktop/src-tauri/src/store.rs",
    concepts: ["dec-module-first"],
    adrs: [16],
    status: "built",
  },

  /* ============================ surfaces / the modules ========================== */
  {
    id: "cmp-mod-registry",
    part: "C-008",
    system: "sys-panel",
    name: "modules/registry.ts",
    enforces:
      "Every module in one list, each a ModuleEntry; adding a surface is adding a row, not editing the window.",
    file: "apps/desktop/src/modules/registry.ts",
    concepts: ["dec-module-first"],
    adrs: [13],
    status: "built",
  },
  {
    id: "cmp-mod-panel",
    part: "C-009",
    system: "sys-panel",
    name: "the Panel module",
    enforces:
      "The run loop: a turn's channel events become a conversation, and a decision card is one frame of it. Renders headless against a fake daemon.",
    file: "apps/desktop/src/modules/panel",
    concepts: ["act-command", "inv-gate"],
    adrs: [12, 24],
    status: "built",
  },
  {
    id: "cmp-mod-browser",
    part: "C-010",
    system: "sys-panel",
    name: "the Browser module",
    enforces:
      "The browsing surface with a doorway and an origins-backed app ledger: which apps were visited, what each offered, at which tier.",
    file: "apps/desktop/src/modules/browser",
    concepts: ["act-record", "tier-native"],
    adrs: [13, 24],
    status: "built",
  },
  {
    id: "cmp-mod-connectors",
    part: "C-011",
    system: "sys-panel",
    name: "the Connectors module",
    enforces:
      "Health is three-valued and rendered with its age, probed on events and never on render; readiness names its own remediation.",
    file: "apps/desktop/src/modules/connectors",
    concepts: ["tier-beside"],
    adrs: [21],
    status: "built",
  },
  {
    id: "cmp-mod-setup",
    part: "C-012",
    system: "sys-panel",
    name: "the Setup module",
    enforces:
      "First launch with no key typed: the engine probe's answer, rendered, and the mic check beside it.",
    file: "apps/desktop/src/modules/setup",
    concepts: ["act-setup", "inv-noprovider"],
    adrs: [24],
    status: "built",
  },

  /* ============================ surfaces / the bridge =========================== */
  {
    id: "cmp-inject",
    part: "C-013",
    system: "sys-bridge",
    name: "inject.js",
    enforces:
      "The page half never throws in a page it does not own: a native modelContext, a sealed slot or a hostile frame yields a calm zero tools.",
    file: "packages/athena-bridge/inject.js",
    concepts: ["tier-act", "tier-native", "act-setup"],
    adrs: [8, 14],
    status: "built",
  },
  {
    id: "cmp-gate-js",
    part: "C-014",
    system: "sys-bridge",
    name: "gate.js",
    enforces:
      "The surface's half of the gate: flagsOf then classify, the same rule as the catalog, and the same closed refusal vocabulary in a second language.",
    file: "packages/athena-bridge/gate.js",
    concepts: ["inv-gate", "inv-bounded", "dec-onegate"],
    adrs: [4, 9],
    status: "built",
  },
  {
    id: "cmp-protocol",
    part: "C-015",
    system: "sys-bridge",
    name: "protocol.md",
    enforces:
      "The wire format between the page and the relay, as the source of truth both halves are written against.",
    file: "packages/athena-bridge/protocol.md",
    concepts: ["tier-act"],
    adrs: [14],
    status: "built",
  },

  /* ============================ surfaces / the studio =========================== */
  {
    id: "cmp-kit-webmcp",
    part: "C-016",
    system: "sys-studio",
    name: "useWebMCPTool",
    enforces:
      "A capability is registered with the page's own reversible / sideEffects claim, carried both as standard annotations and as an athena block.",
    file: "examples/demo-kit/src/webmcp/hooks.ts",
    concepts: ["tier-native", "inv-gate"],
    adrs: [17],
    status: "built",
  },
  {
    id: "cmp-kit-bounded",
    part: "C-017",
    system: "sys-studio",
    name: "bounded / boundedPage",
    enforces:
      "One truncation envelope for every list a tool returns: showing, of, items — so 'how many did I not see' has one answer in every app.",
    file: "examples/demo-kit/src/webmcp/bounded.ts",
    concepts: ["inv-bounded"],
    adrs: [17],
    status: "built",
  },
  {
    id: "cmp-kit-zoom",
    part: "C-018",
    system: "sys-studio",
    name: "the zoom model",
    enforces:
      "Three levels and one reducer, so 'open a group' means the same thing on every surface; plus the nine rules of the layered-UI formula as primitives.",
    file: "examples/demo-kit/src/zoom/index.ts",
    concepts: ["tier-native"],
    adrs: [17],
    status: "built",
  },
  {
    id: "cmp-kit-seed",
    part: "C-019",
    system: "sys-studio",
    name: "the shared world",
    enforces:
      "One studio, fifteen clients, one billing contact each: a fact Athena learns in one tab is checkable in the next.",
    file: "examples/demo-kit/src/seed/companies.ts",
    concepts: ["tier-remember", "act-command"],
    adrs: [17],
    status: "built",
  },
  {
    id: "cmp-app-ledgerbox",
    part: "C-020",
    system: "sys-studio",
    name: "ledgerbox",
    enforces:
      "Act 1's surface: money gates, tone as a parameter, matching as a long job. Anything that reaches a payment is external and therefore GATED.",
    file: "examples/ledgerbox",
    concepts: ["tier-native", "act-command", "inv-gate"],
    adrs: [17, 18],
    status: "built",
  },
  {
    id: "cmp-app-hirelane",
    part: "C-021",
    system: "sys-studio",
    name: "hirelane",
    enforces:
      "Act 2's surface: judgment with evidence, per-row decisions, and a gate on anything that reaches a candidate.",
    file: "examples/hirelane",
    concepts: ["tier-native", "act-command"],
    adrs: [17],
    status: "built",
  },
  {
    id: "cmp-app-tidycrm",
    part: "C-022",
    system: "sys-studio",
    name: "tidycrm",
    enforces:
      "Act 3's surface: provenance at scale, the merge-vs-delete gate, and a fact from act 1 applied in act 3.",
    file: "examples/tidycrm",
    concepts: ["tier-native", "act-agent", "inv-provenance"],
    adrs: [17],
    status: "built",
  },
  {
    id: "cmp-app-atlas",
    part: "C-023",
    system: "sys-studio",
    name: "atlas",
    enforces:
      "The formula's objective test: an app built only through the kit's primitives, whose count of local workarounds is the distance from a reusable formula. This page.",
    file: "examples/atlas",
    concepts: ["tier-native"],
    adrs: [17],
    status: "built",
  },

  /* ============================ surfaces / the journey ========================== */
  {
    id: "cmp-journey-surface",
    part: "C-024",
    system: "sys-journey",
    name: "the surface",
    enforces:
      "The four acts run against the REAL gate; only the approval step and the connectors are fakes, and they are fakes at the seam.",
    file: "examples/journey/src/surface.ts",
    concepts: ["inv-gate", "dec-onegate"],
    adrs: [17],
    status: "built",
  },
  {
    id: "cmp-journey-contracts",
    part: "C-025",
    system: "sys-journey",
    name: "the act contracts",
    enforces:
      "Each act is field access over what the apps actually answer, so a broken act fails as an assertion rather than as a screenshot nobody looks at.",
    file: "examples/journey/src/contracts.ts",
    concepts: ["act-setup", "act-command", "act-agent", "act-record"],
    adrs: [17],
    status: "built",
  },

  /* ============================ channels / the daemon =========================== */
  {
    id: "cmp-daemon-server",
    part: "C-026",
    system: "sys-daemon",
    name: "server.py",
    enforces:
      "ThreadingHTTPServer, one writer behind a lock, a read-only connection per read, Connection: close, and the starvation test written before the server.",
    file: "src/athena/daemon/server.py",
    concepts: [],
    adrs: [3, 11],
    status: "built",
  },
  {
    id: "cmp-daemon-routes",
    part: "C-027",
    system: "sys-daemon",
    name: "routes.py",
    enforces:
      "No unauthenticated route, /health included; POST /run streams each ChannelEvent verbatim as one SSE frame, with no second wire vocabulary.",
    file: "src/athena/daemon/routes.py",
    concepts: ["inv-gate", "act-command"],
    adrs: [11, 12],
    status: "built",
  },
  {
    id: "cmp-daemon-sessions",
    part: "C-028",
    system: "sys-daemon",
    name: "sessions.py",
    enforces:
      "Who is talking to the daemon, keyed by the origin they are pinned to — so a class tightened for one origin cannot leak to another.",
    file: "src/athena/daemon/sessions.py",
    concepts: ["dec-onegate"],
    adrs: [11],
    status: "built",
  },
  {
    id: "cmp-daemon-ready",
    part: "C-029",
    system: "sys-daemon",
    name: "ready.py",
    enforces:
      "How a parent process learns where the daemon is, without a port scan and without a race.",
    file: "src/athena/daemon/ready.py",
    concepts: ["act-setup"],
    adrs: [11],
    status: "built",
  },
  {
    id: "cmp-daemon-connectors",
    part: "C-030",
    system: "sys-daemon",
    name: "connectors.py — the routes",
    enforces:
      "What is connected and the acts that change it; the consent flow is a route, and the credential never crosses it.",
    file: "src/athena/daemon/connectors.py",
    concepts: ["tier-beside"],
    adrs: [21],
    status: "built",
  },

  /* ============================ channels / voice ================================ */
  {
    id: "cmp-voice-gateway",
    part: "C-031",
    system: "sys-voice",
    name: "gateway.py",
    enforces:
      "Voice is a transport around the one lane on the daemon's existing port: no second gateway, no second event vocabulary, the same approvals and ledger.",
    file: "src/athena/channels/voice/gateway.py",
    concepts: ["act-command"],
    adrs: [19, 20],
    status: "built",
  },
  {
    id: "cmp-voice-ws",
    part: "C-032",
    system: "sys-voice",
    name: "ws.py",
    enforces:
      "RFC 6455 in the standard library — the invariant that the core needs no dependency, held at the one place it is most tempting to break.",
    file: "src/athena/channels/voice/ws.py",
    concepts: ["inv-noprovider"],
    adrs: [19],
    status: "built",
  },
  {
    id: "cmp-voice-tts",
    part: "C-033",
    system: "sys-voice",
    name: "tts.py",
    enforces:
      "The TTS: first-line rule and the cap on what is spoken, so a spoken answer is bounded like every other bounded thing.",
    file: "src/athena/channels/voice/tts.py",
    concepts: ["inv-bounded"],
    adrs: [19],
    status: "built",
  },
  {
    id: "cmp-voice-commands",
    part: "C-034",
    system: "sys-voice",
    name: "commands.py",
    enforces:
      "What an utterance is before it is a turn — so a spoken 'yes' answers a card rather than starting a second turn.",
    file: "src/athena/channels/voice/commands.py",
    concepts: ["act-command", "inv-gate"],
    adrs: [19, 20],
    status: "built",
  },

  /* ============================ channels / MCP ================================== */
  {
    id: "cmp-mcp-server",
    part: "C-035",
    system: "sys-mcp",
    name: "mcp.py",
    enforces:
      "request_guidance and request_approval from another agent file cards on the same approval table and block until the user answers. Designed in §3.4, listed in §6; no such file is in the tree.",
    file: "src/athena/channels/mcp.py",
    concepts: ["act-agent", "dec-onegate"],
    adrs: [],
    status: "planned",
  },

  /* ================================== the lane ================================== */
  {
    id: "cmp-lane",
    part: "C-036",
    system: "sys-lane",
    name: "browser_lane.py",
    enforces:
      "One turn, streamed, holding no gated executor: up to eight provider rounds make one turn and one ledger row.",
    file: "src/athena/lane/browser_lane.py",
    concepts: ["inv-gate", "inv-cost", "act-command"],
    adrs: [10],
    status: "built",
  },
  {
    id: "cmp-turnframe",
    part: "C-037",
    system: "sys-lane",
    name: "turn_frame.py",
    enforces:
      "The surface's half of one turn, composed: host-state delta, last turn's tool results, active project — everything that can move, out of the system prompt.",
    file: "src/athena/lane/turn_frame.py",
    concepts: ["tier-remember"],
    adrs: [6],
    status: "built",
  },
  {
    id: "cmp-lane-ports",
    part: "C-038",
    system: "sys-lane",
    name: "lane/ports.py",
    enforces:
      "The lane depends on ports, never on concrete classes — which is what makes ADR 0010's 'no gated executor here' a type-level fact.",
    file: "src/athena/lane/ports.py",
    concepts: ["inv-gate"],
    adrs: [10],
    status: "built",
  },

  /* ============================== harness / runner ============================== */
  {
    id: "cmp-cli-harness",
    part: "C-039",
    system: "sys-runner",
    name: "cli_harness.py",
    enforces:
      "One harness, two dialects: swapping claude for codex changes nothing about policy, because the gate is outside the engine.",
    file: "src/athena/harness/cli_harness.py",
    concepts: ["inv-noprovider", "inv-gate"],
    adrs: [7],
    status: "built",
  },
  {
    id: "cmp-engines",
    part: "C-040",
    system: "sys-runner",
    name: "engines.py",
    enforces:
      "An engine is declarative configuration, and the probe answers 'is this usable on this machine' — which is how act 1 finds a subscription with no key typed.",
    file: "src/athena/harness/engines.py",
    concepts: ["inv-noprovider", "act-setup"],
    adrs: [7],
    status: "built",
  },
  {
    id: "cmp-op-grammar",
    part: "C-041",
    system: "sys-runner",
    name: "op_grammar.py",
    enforces:
      "The OP: line grammar a CLI engine calls tools through — one parse, so a tool call cannot arrive in a shape the gate has never seen.",
    file: "src/athena/harness/op_grammar.py",
    concepts: ["inv-gate"],
    adrs: [7],
    status: "built",
  },
  {
    id: "cmp-transports",
    part: "C-042",
    system: "sys-runner",
    name: "transports.py",
    enforces:
      "How a CLI is actually run, behind one port, so the harness never holds a subprocess API of its own.",
    file: "src/athena/harness/transports.py",
    concepts: ["inv-noprovider"],
    adrs: [7],
    status: "built",
  },

  /* =============================== harness / hooks ============================== */
  {
    id: "cmp-hooks",
    part: "C-043",
    system: "sys-hooks",
    name: "hooks.py",
    enforces:
      "The three hooks every engine runs behind: the gate, the ledger row, and the truncation that announces its own N of M.",
    file: "src/athena/harness/hooks.py",
    concepts: ["inv-gate", "inv-cost", "inv-bounded"],
    adrs: [4, 7],
    status: "built",
  },
  {
    id: "cmp-policy",
    part: "C-044",
    system: "sys-hooks",
    name: "policy.py",
    enforces:
      "Four structural rules that run BEFORE the gate — including that a connector: entry is permitted only while the vault says the connection is live now.",
    file: "src/athena/harness/policy.py",
    concepts: ["inv-gate", "tier-beside"],
    adrs: [4, 21],
    status: "built",
  },

  /* ================================ core / brain ================================ */
  {
    id: "cmp-brain-store",
    part: "C-045",
    system: "sys-brain",
    name: "store.py",
    enforces:
      "The markdown file is written before the index transaction, and write_fact REJECTS a fact that does not cite live episodes. No bypass, not even for tests.",
    file: "src/athena/core/brain/store.py",
    concepts: ["inv-disk", "inv-provenance", "tier-remember"],
    adrs: [3],
    status: "built",
  },
  {
    id: "cmp-brain-schema",
    part: "C-046",
    system: "sys-brain",
    name: "schema.py",
    enforces:
      "The index tables are exactly what a reconcile may clear; approvals and the ledger are deliberately outside them.",
    file: "src/athena/core/brain/schema.py",
    concepts: ["inv-disk"],
    adrs: [3, 5],
    status: "built",
  },
  {
    id: "cmp-brain-reconcile",
    part: "C-047",
    system: "sys-brain",
    name: "reconcile.py",
    enforces:
      "The index is rebuildable from the markdown tree — which is the whole proof that disk is truth.",
    file: "src/athena/core/brain/reconcile.py",
    concepts: ["inv-disk"],
    adrs: [3],
    status: "built",
  },
  {
    id: "cmp-brain-frontmatter",
    part: "C-048",
    system: "sys-brain",
    name: "frontmatter.py",
    enforces:
      "The memory file format: fenced frontmatter then a body, so a brain stays readable by a person with a text editor.",
    file: "src/athena/core/brain/frontmatter.py",
    concepts: ["inv-disk"],
    adrs: [3],
    status: "built",
  },
  {
    id: "cmp-brain-paths",
    part: "C-049",
    system: "sys-brain",
    name: "paths.py",
    enforces:
      "Where a brain lives and what its directory looks like — so 'portable by copying the directory' is one definition, not a convention.",
    file: "src/athena/core/brain/paths.py",
    concepts: ["inv-disk"],
    adrs: [3],
    status: "built",
  },

  /* =============================== core / catalog =============================== */
  {
    id: "cmp-catalog",
    part: "C-050",
    system: "sys-catalog",
    name: "catalog.py",
    enforces:
      "The ONLY module that assigns a ToolClass. AUTO only if reversible and side_effects is not external; a manifest that fails validation is refused whole.",
    file: "src/athena/core/catalog.py",
    concepts: ["inv-gate", "dec-onegate", "dec-connector-data"],
    adrs: [4],
    status: "built",
  },
  {
    id: "cmp-validators",
    part: "C-051",
    system: "sys-catalog",
    name: "validators.py",
    enforces:
      "Parameter validation is the last line of the gate: an AUTO tool fires only after its validator passes.",
    file: "src/athena/core/validators.py",
    concepts: ["inv-gate"],
    adrs: [4],
    status: "built",
  },

  /* =============================== core / record ================================ */
  {
    id: "cmp-approvals",
    part: "C-052",
    system: "sys-record",
    name: "approvals.py",
    enforces:
      "The gate's durable half: describe proves the approval was granted for THIS action and THESE parameters before anything executes.",
    file: "src/athena/core/approvals.py",
    concepts: ["inv-gate", "dec-onegate", "act-agent"],
    adrs: [4, 5],
    status: "built",
  },
  {
    id: "cmp-ledger",
    part: "C-053",
    system: "sys-record",
    name: "ledger.py",
    enforces:
      "One row per model invocation, failures included, with a reason from a closed set — and it survives a reconcile.",
    file: "src/athena/core/ledger.py",
    concepts: ["inv-cost", "act-record"],
    adrs: [5, 9],
    status: "built",
  },

  /* =============================== core / composer ============================== */
  {
    id: "cmp-prompt",
    part: "C-054",
    system: "sys-prompt",
    name: "prompt.py",
    enforces:
      "Two outputs: static blocks for the system prompt, a turn frame in the user message. Nothing that can move is ever composed into the system prompt.",
    file: "src/athena/core/prompt.py",
    concepts: ["inv-bounded", "tier-remember"],
    adrs: [6],
    status: "built",
  },
  {
    id: "cmp-recall",
    part: "C-055",
    system: "sys-prompt",
    name: "recall.py",
    enforces:
      "Three blocks, each bounded and each announcing its own M — the invariant stated once and then obeyed three times in one function.",
    file: "src/athena/core/recall.py",
    concepts: ["inv-bounded", "tier-remember"],
    adrs: [6],
    status: "built",
  },
  {
    id: "cmp-constitution",
    part: "C-056",
    system: "sys-prompt",
    name: "constitution.py",
    enforces:
      "The law and the identity resolved from INSIDE the installed package, never from a parent directory — so a moved checkout cannot change Athena's law.",
    file: "src/athena/core/constitution.py",
    concepts: ["inv-noprovider"],
    adrs: [6],
    status: "built",
  },
  {
    id: "cmp-fence",
    part: "C-057",
    system: "sys-prompt",
    name: "fence.py",
    enforces:
      "Untrusted content arrives inside a nonce-tagged fence, minted fresh per turn, so page text cannot close its own quotes.",
    file: "src/athena/core/fence.py",
    concepts: ["inv-bounded", "inv-gate"],
    adrs: [9],
    status: "built",
  },

  /* ============================== core / connectors ============================= */
  {
    id: "cmp-conn-spec",
    part: "C-058",
    system: "sys-connectors",
    name: "spec.py",
    enforces:
      "A connector is data: one JSON spec declaring its auth methods, the hosts the broker will ever dial, its probe, and a few intent-shaped tools.",
    file: "src/athena/connectors/spec.py",
    concepts: ["dec-connector-data", "tier-beside"],
    adrs: [21],
    status: "built",
  },
  {
    id: "cmp-conn-vault",
    part: "C-059",
    system: "sys-connectors",
    name: "vault.py",
    enforces:
      "The one door a credential is ever behind: an executor says 'call Gmail with this request' and never holds a token. Credentials never enter a brain.",
    file: "src/athena/connectors/vault.py",
    concepts: ["dec-connector-data", "inv-disk"],
    adrs: [21],
    status: "built",
  },
  {
    id: "cmp-conn-service",
    part: "C-060",
    system: "sys-connectors",
    name: "service.py",
    enforces:
      "A connector presents a manifest of the same shape as a page and merges the same way — so it can never become a second gate.",
    file: "src/athena/connectors/service.py",
    concepts: ["dec-connector-data", "dec-onegate"],
    adrs: [21],
    status: "built",
  },
  {
    id: "cmp-conn-port",
    part: "C-061",
    system: "sys-connectors",
    name: "port.py",
    enforces:
      "The connector seam — list_tools and call — reserved at P1 so the origin kind existed before any connector did.",
    file: "src/athena/connectors/port.py",
    concepts: ["tier-beside"],
    adrs: [21],
    status: "built",
  },

  /* ============================ contracts / the seams =========================== */
  {
    id: "cmp-c-registry",
    part: "C-062",
    system: "sys-seams",
    name: "registry.py",
    enforces:
      "ToolEntry refuses to construct a host entry with an executor — the lane CANNOT run a gated host action, as a type error rather than a rule.",
    file: "src/athena/contracts/registry.py",
    concepts: ["inv-gate"],
    adrs: [10],
    status: "built",
  },
  {
    id: "cmp-c-manifest",
    part: "C-063",
    system: "sys-seams",
    name: "manifest.py",
    enforces:
      "A page and a connector describe themselves in ONE shape, which is why one catalog can class both.",
    file: "src/athena/contracts/manifest.py",
    concepts: ["dec-onegate", "dec-connector-data", "tier-native"],
    adrs: [4, 21],
    status: "built",
  },
  {
    id: "cmp-c-channel",
    part: "C-064",
    system: "sys-seams",
    name: "channel.py",
    enforces:
      "What a turn emits and every surface renders: one event vocabulary, streamed verbatim as SSE frames.",
    file: "src/athena/contracts/channel.py",
    concepts: ["act-command"],
    adrs: [12],
    status: "built",
  },
  {
    id: "cmp-c-harness",
    part: "C-065",
    system: "sys-vocab",
    name: "harness.py",
    enforces:
      "One turn in, a stream of channel events out — and the closed ERROR_REASONS set, declared here and mirrored into JavaScript with a test that fails on drift.",
    file: "src/athena/contracts/harness.py",
    concepts: ["inv-bounded", "inv-cost"],
    adrs: [9],
    status: "built",
  },

  /* ======================= contracts / the vocabulary =========================== */
  {
    id: "cmp-ids",
    part: "C-068",
    system: "sys-vocab",
    name: "ids.py",
    enforces:
      "Every id prefix in one place, because the first build minted them in two and the two disagreed.",
    file: "src/athena/contracts/ids.py",
    concepts: [],
    adrs: [],
    status: "built",
  },
];
