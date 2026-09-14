/**
 * The six layers of README §3.1 and the eighteen systems that realise them.
 *
 * The layer blurbs are README §3.1's own words for each line of its stack diagram, kept verbatim
 * where they fit on one line, because the whole value of an atlas is that it does not paraphrase
 * the thing it maps. The stack is printed top-down in the order the README prints it: surfaces at
 * the top, contracts at the bottom, and "packages depend on ports, never on concrete classes".
 *
 * A SYSTEM IS A DIRECTORY WITH ONE JOB. Where a layer's directory has two jobs, it is two systems
 * — `harness/` is the runner and the hooks, and they are laid side by side at L1 precisely so a
 * reader can see that the engine is configuration and the gate is not. That is the L1 argument:
 * one layer, its systems laid out to compare.
 */
import type { Layer, System } from "./types";

export const LAYERS: Layer[] = [
  {
    id: "surfaces",
    part: "L-1",
    name: "surfaces",
    blurb:
      "the Tauri desktop shell (chrome, page webviews, the panel), the bridge in the page, other agents over MCP, a voice client",
    source: "README §3.1",
    file: "README.md",
  },
  {
    id: "channels",
    part: "L-2",
    name: "channels",
    blurb: "daemon (HTTP + SSE, token, CORS, Connection: close), mcp (JSON-RPC), voice (WebSocket)",
    source: "README §3.1",
    file: "README.md",
  },
  {
    id: "lane",
    part: "L-3",
    name: "lane",
    blurb: "the browser lane: one turn, streamed; never holds a gated executor",
    source: "README §3.1",
    file: "README.md",
  },
  {
    id: "harness",
    part: "L-4",
    name: "harness",
    blurb:
      "CLI harness in two dialects (claude, codex), hooks (gate, ledger, truncation), structural policy, the OP grammar, engine probes",
    source: "README §3.1",
    file: "README.md",
  },
  {
    id: "core",
    part: "L-5",
    name: "core",
    blurb: "brain, recall, catalog, approvals, ledger, constitution, prompt composer",
    source: "README §3.1",
    file: "README.md",
  },
  {
    id: "contracts",
    part: "L-6",
    name: "contracts",
    blurb:
      "dataclasses and Protocols only: ToolEntry, HostManifest, channel events, Harness, ERROR_REASONS, every id prefix",
    source: "README §3.1",
    file: "README.md",
  },
];

export const SYSTEMS: System[] = [
  /* ---------------------------------- surfaces ---------------------------------- */
  {
    id: "sys-wiring",
    part: "S-00",
    layer: "surfaces",
    name: "The composition root",
    blurb:
      "The one place the real classes are bound together, and the command line that boots them. Above every layer because it is what reaches into all of them.",
    home: "src/athena",
    source: "README §3.1, §7",
    file: "src/athena/wiring.py",
    status: "built",
  },
  {
    id: "sys-shell",
    part: "S-01",
    layer: "surfaces",
    name: "The shell",
    blurb:
      "The Tauri window: chrome, page webviews, the relay, the nine hands, the capture and the daemon sidecar.",
    home: "apps/desktop/src-tauri/src",
    source: "README §3.1, surfaces; §3.5",
    file: "apps/desktop/src-tauri/src/lib.rs",
    status: "built",
  },
  {
    id: "sys-panel",
    part: "S-02",
    layer: "surfaces",
    name: "The modules",
    blurb:
      "The window's front end: a thin module bar and one full-width module, each a view-model, fixtures and a pure view.",
    home: "apps/desktop/src/modules",
    source: "README §3.5; ADR 0013, 0024",
    file: "apps/desktop/src/modules/registry.ts",
    status: "built",
  },
  {
    id: "sys-bridge",
    part: "S-03",
    layer: "surfaces",
    name: "The bridge",
    blurb:
      "The two halves in the page: the WebMCP polyfill and relay that reads a page's tools, and the gate every surface runs.",
    home: "packages/athena-bridge",
    source: "README §3.3, §3.4 tier 1",
    file: "packages/athena-bridge/protocol.md",
    status: "built",
  },
  {
    id: "sys-studio",
    part: "S-04",
    layer: "surfaces",
    name: "The studio",
    blurb:
      "Four example host apps that ship without Athena, and the scaffold they share: one seed, one WebMCP layer, one zoom model.",
    home: "examples",
    source: "ADR 0017; examples/README.md",
    file: "examples/README.md",
    status: "built",
  },
  {
    id: "sys-journey",
    part: "S-05",
    layer: "surfaces",
    name: "The journey",
    blurb:
      "The four acts automated: three real apps in a real Chromium, the real bridge, the real gate, approvals and connectors as fakes at the seam.",
    home: "examples/journey",
    source: "ADR 0017; docs/demo.md",
    file: "examples/journey/README.md",
    status: "built",
  },

  /* ---------------------------------- channels ---------------------------------- */
  {
    id: "sys-daemon",
    part: "S-06",
    layer: "channels",
    name: "The daemon",
    blurb:
      "One Athena on 127.0.0.1 beside whatever page is open: threaded, token-checked, one request per connection.",
    home: "src/athena/daemon",
    source: "README §3.5; ADR 0011, 0012",
    file: "src/athena/daemon/server.py",
    status: "built",
  },
  {
    id: "sys-voice",
    part: "S-07",
    layer: "channels",
    name: "Voice",
    blurb:
      "A WebSocket under /voice on the daemon's own port: PCM16 in, audio and events out, wrapping the one lane.",
    home: "src/athena/channels/voice",
    source: "ADR 0019, 0020",
    file: "src/athena/channels/voice/gateway.py",
    status: "built",
  },
  {
    id: "sys-mcp",
    part: "S-08",
    layer: "channels",
    name: "MCP",
    blurb:
      "The JSON-RPC channel another agent calls: request_guidance and request_approval file on the same approval table. Named in §3.1 and §6; not in the tree.",
    home: "src/athena/channels",
    source: "README §3.1, §3.4, §6",
    file: "README.md",
    status: "planned",
  },

  /* ------------------------------------ lane ------------------------------------ */
  {
    id: "sys-lane",
    part: "S-09",
    layer: "lane",
    name: "The browser lane",
    blurb:
      "One turn, streamed, holding no gated executor: up to eight provider rounds make one turn and one ledger row.",
    home: "src/athena/lane",
    source: "README §3.2; ADR 0010",
    file: "src/athena/lane/browser_lane.py",
    status: "built",
  },

  /* ----------------------------------- harness ---------------------------------- */
  {
    id: "sys-runner",
    part: "S-10",
    layer: "harness",
    name: "The runner",
    blurb:
      "One CLI harness in two dialects, behind one transport port, calling tools through the OP line grammar. An engine is configuration.",
    home: "src/athena/harness",
    source: "README §3.1; ADR 0007",
    file: "src/athena/harness/cli_harness.py",
    status: "built",
  },
  {
    id: "sys-hooks",
    part: "S-11",
    layer: "harness",
    name: "The hooks",
    blurb:
      "The three hooks every engine runs behind, and the four structural rules that run before the gate.",
    home: "src/athena/harness",
    source: "README §3.2 steps 3–6, §3.3; ADR 0004",
    file: "src/athena/harness/hooks.py",
    status: "built",
  },

  /* ------------------------------------ core ------------------------------------ */
  {
    id: "sys-brain",
    part: "S-12",
    layer: "core",
    name: "The brain",
    blurb:
      "One markdown file per memory, a rebuildable SQLite index beside it, and a write that refuses a fact with no episodes.",
    home: "src/athena/core/brain",
    source: "README §2 invariants 1 and 2; ADR 0003",
    file: "src/athena/core/brain/store.py",
    status: "built",
  },
  {
    id: "sys-catalog",
    part: "S-13",
    layer: "core",
    name: "The catalog",
    blurb:
      "The one module that assigns a ToolClass, and the parameter validation that is the last line of the gate.",
    home: "src/athena/core",
    source: "README §3.3, §3.4; ADR 0004",
    file: "src/athena/core/catalog.py",
    status: "built",
  },
  {
    id: "sys-record",
    part: "S-14",
    layer: "core",
    name: "The record",
    blurb:
      "The gate's durable half and the cost of every turn: two tables in the brain's index, outside the tables a reconcile clears.",
    home: "src/athena/core",
    source: "README §2 invariant 6, §3.2 steps 4 and 6; ADR 0005",
    file: "src/athena/core/approvals.py",
    status: "built",
  },
  {
    id: "sys-prompt",
    part: "S-15",
    layer: "core",
    name: "The composer",
    blurb:
      "Two outputs — a static system prompt and a per-turn frame — plus the law, the bounded recall blocks and the nonce fence.",
    home: "src/athena/core",
    source: "README §3.2 step 2; ADR 0006",
    file: "src/athena/core/prompt.py",
    status: "built",
  },
  {
    id: "sys-connectors",
    part: "S-16",
    layer: "core",
    name: "Connectors",
    blurb:
      "A third-party service as one JSON spec plus a credential in one vault, presenting a manifest of the same shape as a page.",
    home: "src/athena/connectors",
    source: "README §4; ADR 0021",
    file: "src/athena/connectors/spec.py",
    status: "partial",
  },

  /* ---------------------------------- contracts --------------------------------- */
  {
    id: "sys-seams",
    part: "S-17",
    layer: "contracts",
    name: "The seams",
    blurb:
      "Dataclasses only: the registry row a gate hands on, the host manifest a page or a connector presents, and the events a turn emits.",
    home: "src/athena/contracts",
    source: "README §3.1; ADR 0002",
    file: "src/athena/contracts/__init__.py",
    status: "built",
  },
  {
    id: "sys-vocab",
    part: "S-18",
    layer: "contracts",
    name: "The vocabulary",
    blurb:
      "The words the whole system agrees on: the harness Protocol, the closed ERROR_REASONS set mirrored into JavaScript, and every id prefix.",
    home: "src/athena/contracts",
    source: "README §3.5; ADR 0009",
    file: "src/athena/contracts/harness.py",
    status: "built",
  },
];
