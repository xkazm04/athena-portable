/**
 * What reaches what. Edges are between COMPONENTS only; the system-level and layer-level edges
 * L1 draws in its margin rails are derived from these (`./index.ts`), so there is one source of
 * truth and a system edge cannot exist without a module that makes it.
 *
 * The direction is "depends on": `from` cannot do its job without `to`. Read down the stack of
 * README §3.1 — surfaces reach into channels, channels into the lane, the lane into the harness,
 * the harness into core, and everything bottoms out in contracts, which reaches nothing at all
 * (ADR 0002: "the contracts import nothing"). An edge that runs UP the stack is a finding, not a
 * feature, so it is DECLARED (`up: true`) and never left for the rail to discover: there is one,
 * `daemon/server.py`'s local import of `athena.wiring`, and the margin rail draws it on the left.
 *
 * EVERY EDGE SAYS WHAT CARRIES IT (`via`, ADR 0202). An arrow between two Python modules is an
 * import, a port the composition root binds (`through` names the port — the shape README §3.1
 * builds the lane and the harness on), or an import through one named module; a hop over HTTP,
 * SSE, a WebSocket or Tauri IPC is a `wire` with its protocol. `test/edges.test.ts` asks the tree
 * whether each Python claim holds and reports the rest as skipped with the reason.
 */
import type { Edge } from "./types";

export const EDGES: Edge[] = [
  /* --- the shell holds the window together --- */
  { from: "cmp-shell-lib", to: "cmp-mod-panel", kind: "calls", via: "wire", protocol: "IPC (a Tauri webview the shell creates)", note: "her window is a second webview the shell creates and places" },
  { from: "cmp-shell-lib", to: "cmp-shell-tabs", kind: "calls", via: "import", note: "opens and closes page webviews" },
  { from: "cmp-shell-lib", to: "cmp-shell-daemon", kind: "calls", via: "import", note: "spawns the sidecar and owns its lifetime" },
  { from: "cmp-shell-lib", to: "cmp-shell-store", kind: "calls", via: "import", note: "four generic key/value commands" },
  { from: "cmp-shell-lib", to: "cmp-shell-bridge", kind: "calls", via: "import", note: "bridge_list and bridge_call stay in the trusted chrome webview" },
  { from: "cmp-shell-bridge", to: "cmp-inject", kind: "calls", via: "wire", protocol: "IPC (the bridge relay into the page webview)", note: "the relay speaks to the page half" },
  { from: "cmp-shell-bridge", to: "cmp-protocol", kind: "implements", via: "wire", protocol: "the bridge protocol", note: "the wire format both halves are written against" },
  { from: "cmp-inject", to: "cmp-protocol", kind: "implements", via: "wire", protocol: "the bridge protocol", note: "the page half of the same format" },
  { from: "cmp-shell-hands", to: "cmp-shell-capture", kind: "calls", via: "import", note: "a screenshot before every gated proposal" },
  { from: "cmp-shell-capture", to: "cmp-shell-store", kind: "calls", via: "import", note: "captures in a table with a size cap and an LRU sweep" },
  { from: "cmp-shell-daemon", to: "cmp-daemon-server", kind: "calls", via: "wire", protocol: "IPC (a child process in a job object)", note: "the sidecar is the daemon, in a job object" },
  { from: "cmp-shell-daemon", to: "cmp-daemon-ready", kind: "reads", via: "wire", protocol: "IPC (the ready line on the child's stdout)", note: "the ready line is how the shell learns the port" },
  { from: "cmp-shell-lib", to: "cmp-halo", kind: "calls", via: "import", note: "one overlay per monitor, created with the windows" },
  { from: "cmp-mod-panel", to: "cmp-halo", kind: "streams", via: "wire", protocol: "IPC (a Tauri event)", note: "her window reduces the voice and the run to one signal; the overlays only listen" },
  { from: "cmp-inject", to: "cmp-kit-webmcp", kind: "reads", via: "wire", protocol: "WebMCP (document.modelContext, in the page)", note: "a page's own registrations are what tier 1 reads" },

  /* --- the depths are the front of the window, each over a module's model --- */
  { from: "cmp-mod-registry", to: "cmp-mod-browser", kind: "reads", via: "import", note: "the Apps depth draws the browsing model" },
  { from: "cmp-mod-registry", to: "cmp-mod-connectors", kind: "reads", via: "import", note: "the Accounts depth draws the connectors model" },
  { from: "cmp-mod-registry", to: "cmp-mod-setup", kind: "reads", via: "import", note: "the Mind depth's engine section reads the setup model" },
  { from: "cmp-mod-panel", to: "cmp-daemon-routes", kind: "calls", via: "wire", protocol: "HTTP + SSE", note: "POST /run, then the SSE stream of the turn" },
  { from: "cmp-mod-panel", to: "cmp-c-channel", kind: "reads", via: "wire", protocol: "SSE (a ChannelEvent as one frame)", note: "a decision card is one channel event" },
  { from: "cmp-mod-panel", to: "cmp-shell-hands", kind: "calls", via: "wire", protocol: "IPC (a Tauri command)", note: "host tools have no executor in the lane; the surface runs them" },
  { from: "cmp-mod-browser", to: "cmp-shell-tabs", kind: "reads", via: "wire", protocol: "IPC (a Tauri command)", note: "the open tabs are host state" },
  { from: "cmp-mod-browser", to: "cmp-ledger", kind: "reads", via: "wire", protocol: "HTTP (the daemon's ledger route)", note: "the app ledger: every call by app, tier and surface" },
  { from: "cmp-mod-connectors", to: "cmp-daemon-connectors", kind: "calls", via: "wire", protocol: "HTTP", note: "the list is asked for on mount and again on ready" },
  { from: "cmp-mod-setup", to: "cmp-engines", kind: "reads", via: "wire", protocol: "HTTP (the daemon's probe answer)", note: "the probe's answer, rendered — no key typed" },

  /* --- the bridge derives the same class the catalog does --- */
  { from: "cmp-gate-js", to: "cmp-c-manifest", kind: "implements", via: "wire", protocol: "the bridge protocol (a manifest's flags, as JSON)", note: "flagsOf then classify, over the same manifest shape" },
  { from: "cmp-gate-js", to: "cmp-c-harness", kind: "implements", via: "wire", protocol: "the bridge protocol (the refusal reasons, as strings)", note: "ERROR_REASONS, member for member, in a second language" },
  { from: "cmp-gate-js", to: "cmp-catalog", kind: "implements", via: "wire", protocol: "the bridge protocol (the class, derived on both sides of it)", note: "the same rule, stated twice and pinned by a parity test" },

  /* --- the studio: four apps on one scaffold --- */
  { from: "cmp-kit-webmcp", to: "cmp-c-manifest", kind: "implements", via: "wire", protocol: "WebMCP (the annotations, as JSON)", note: "the annotations a manifest is read from" },
  { from: "cmp-kit-bounded", to: "cmp-c-harness", kind: "implements", via: "wire", protocol: "the truncation notice, as text", note: "the truncation notice, in the apps' language" },
  { from: "cmp-app-ledgerbox", to: "cmp-kit-webmcp", kind: "calls", via: "import", note: "registers the books on document.modelContext" },
  { from: "cmp-app-ledgerbox", to: "cmp-kit-zoom", kind: "calls", via: "import", note: "The Lanes is the zoom model, rendered" },
  { from: "cmp-app-ledgerbox", to: "cmp-kit-seed", kind: "reads", via: "import", note: "the studio's fifteen clients" },
  { from: "cmp-app-ledgerbox", to: "cmp-kit-bounded", kind: "calls", via: "import", note: "every list a tool returns" },
  { from: "cmp-app-hirelane", to: "cmp-kit-webmcp", kind: "calls", via: "import", note: "registers the pipeline" },
  { from: "cmp-app-hirelane", to: "cmp-kit-zoom", kind: "calls", via: "import", note: "The Board is the zoom model, rendered" },
  { from: "cmp-app-hirelane", to: "cmp-kit-seed", kind: "reads", via: "import", note: "KESTREL_APPLICANT is the thread act 2 pulls on" },
  { from: "cmp-app-tidycrm", to: "cmp-kit-webmcp", kind: "calls", via: "import", note: "registers the cleanup" },
  { from: "cmp-app-tidycrm", to: "cmp-kit-zoom", kind: "calls", via: "import", note: "The Blocks is the zoom model, rendered" },
  { from: "cmp-app-tidycrm", to: "cmp-kit-seed", kind: "reads", via: "import", note: "PINEGROVE_ALIAS is the thread act 3 pulls on" },
  { from: "cmp-app-atlas", to: "cmp-kit-webmcp", kind: "calls", via: "import", note: "registers the reads and the moves; there is nothing here to write" },
  { from: "cmp-app-atlas", to: "cmp-kit-zoom", kind: "calls", via: "import", note: "built only through the kit's primitives — that is the test" },
  { from: "cmp-app-atlas", to: "cmp-kit-bounded", kind: "calls", via: "import", note: "every read announces (showing N of M)" },

  /* --- the journey drives the real gate --- */
  { from: "cmp-journey-surface", to: "cmp-gate-js", kind: "calls", via: "import", note: "the real gate decides what may run" },
  { from: "cmp-journey-surface", to: "cmp-inject", kind: "calls", via: "wire", protocol: "the bridge protocol, injected into a real Chromium", note: "the real bridge in a real Chromium" },
  { from: "cmp-journey-surface", to: "cmp-journey-contracts", kind: "reads", via: "import", note: "an act passes or fails as an assertion" },
  { from: "cmp-journey-contracts", to: "cmp-app-ledgerbox", kind: "reads", via: "wire", protocol: "HTTP (the app's pages, in Chromium)", note: "act 1" },
  { from: "cmp-journey-contracts", to: "cmp-app-hirelane", kind: "reads", via: "wire", protocol: "HTTP (the app's pages, in Chromium)", note: "act 2" },
  { from: "cmp-journey-contracts", to: "cmp-app-tidycrm", kind: "reads", via: "wire", protocol: "HTTP (the app's pages, in Chromium)", note: "act 3" },

  /* --- the daemon is the one door --- */
  { from: "cmp-daemon-server", to: "cmp-daemon-routes", kind: "calls", via: "import", note: "one request per connection, token checked before the route" },
  { from: "cmp-daemon-server", to: "cmp-daemon-ready", kind: "calls", via: "import", note: "prints where it bound" },
  { from: "cmp-daemon-server", to: "cmp-wiring", kind: "calls", via: "import", up: true, note: "athena serve composes the daemon through the composition root: one local import, the model's one up edge" },
  { from: "cmp-daemon-routes", to: "cmp-lane", kind: "calls", via: "import", through: "src/athena/daemon/server.py", note: "POST /run is one turn" },
  { from: "cmp-daemon-routes", to: "cmp-c-channel", kind: "streams", via: "import", note: "each ChannelEvent verbatim as one SSE frame" },
  { from: "cmp-daemon-routes", to: "cmp-approvals", kind: "calls", via: "import", through: "src/athena/daemon/decisions.py", note: "POST /decisions/<id> replays the gate with the approval id" },
  { from: "cmp-daemon-routes", to: "cmp-daemon-sessions", kind: "reads", via: "import", note: "who is talking, and the origin they are pinned to" },
  { from: "cmp-daemon-connectors", to: "cmp-conn-vault", kind: "calls", via: "import", note: "the consent flow; the credential never crosses the route" },

  /* --- voice wraps the one lane --- */
  { from: "cmp-voice-gateway", to: "cmp-daemon-server", kind: "implements", via: "import", note: "a WebSocket on the daemon's existing port, not a second gateway" },
  { from: "cmp-voice-gateway", to: "cmp-voice-ws", kind: "calls", via: "import", note: "RFC 6455 in the standard library" },
  { from: "cmp-voice-gateway", to: "cmp-voice-commands", kind: "calls", via: "import", note: "an utterance becomes a turn, or answers a card" },
  { from: "cmp-voice-gateway", to: "cmp-voice-tts", kind: "calls", via: "import", note: "the TTS: first-line rule and the cap on what is spoken" },
  { from: "cmp-voice-gateway", to: "cmp-lane", kind: "calls", via: "import", through: "src/athena/daemon/server.py", note: "the same single lane, approvals and ledger" },
  { from: "cmp-voice-gateway", to: "cmp-approvals", kind: "calls", via: "import", through: "src/athena/daemon/server.py", note: "a spoken yes resolves a decision on the daemon's approval table, by the button's path" },

  /* --- MCP: designed, not built --- */
  { from: "cmp-mcp-server", to: "cmp-approvals", kind: "calls", via: "import", note: "another agent's card, on the same approval table" },
  { from: "cmp-mcp-server", to: "cmp-catalog", kind: "calls", via: "import", note: "and at the same gate, with no second policy" },

  /* --- the lane holds no gated executor --- */
  { from: "cmp-lane", to: "cmp-turnframe", kind: "calls", via: "import", note: "the surface's half of the turn, composed" },
  { from: "cmp-lane", to: "cmp-cli-harness", kind: "calls", via: "port", through: "src/athena/lane/ports.py", note: "up to eight provider rounds make one turn" },
  { from: "cmp-lane", to: "cmp-c-harness", kind: "implements", via: "import", through: "src/athena/lane/ports.py", note: "one turn in, a stream of channel events out" },
  { from: "cmp-lane", to: "cmp-c-channel", kind: "streams", via: "import", note: "tool.call, decision.requested, and the rest" },
  { from: "cmp-lane", to: "cmp-lane-ports", kind: "calls", via: "import", note: "ports, never concrete classes" },
  { from: "cmp-lane-ports", to: "cmp-c-registry", kind: "implements", via: "import", note: "a host entry cannot be constructed with an executor" },
  { from: "cmp-turnframe", to: "cmp-prompt", kind: "calls", via: "import", note: "the dynamic half of the two-output composer" },
  { from: "cmp-turnframe", to: "cmp-fence", kind: "calls", via: "import", through: "src/athena/core/prompt.py", note: "host state is bounded and fenced with a fresh nonce" },

  /* --- the harness runs behind the hooks --- */
  { from: "cmp-cli-harness", to: "cmp-hooks", kind: "gates", via: "import", through: "src/athena/harness/rounds.py", note: "every tool call passes the gate before anything runs" },
  { from: "cmp-cli-harness", to: "cmp-engines", kind: "reads", via: "port", through: "src/athena/harness/cli_harness.py", note: "an engine is configuration: a dialect, not a class" },
  { from: "cmp-cli-harness", to: "cmp-transports", kind: "calls", via: "import", note: "how a CLI is actually run, behind one port" },
  { from: "cmp-cli-harness", to: "cmp-op-grammar", kind: "calls", via: "import", through: "src/athena/harness/rounds.py", note: "the OP: line a CLI engine calls tools through" },
  { from: "cmp-engines", to: "cmp-api-harness", kind: "calls", via: "import", note: "an API engine is one more row of the engine table" },
  { from: "cmp-api-harness", to: "cmp-c-harness", kind: "implements", via: "import", note: "the same TurnResult a CLI turn returns" },
  { from: "cmp-hooks", to: "cmp-catalog", kind: "gates", via: "port", through: "src/athena/harness/ports.py", note: "the class, derived in one module and nowhere else" },
  { from: "cmp-hooks", to: "cmp-policy", kind: "gates", via: "port", through: "src/athena/harness/hooks.py", note: "four structural rules, before the gate" },
  { from: "cmp-hooks", to: "cmp-ledger", kind: "calls", via: "port", through: "src/athena/harness/ports.py", note: "one row per invocation, failures included" },
  { from: "cmp-hooks", to: "cmp-approvals", kind: "calls", via: "port", through: "src/athena/harness/ports.py", note: "GATED writes an approval row and emits decision.requested" },
  { from: "cmp-hooks", to: "cmp-c-harness", kind: "reads", via: "import", note: "the closed refusal vocabulary and the truncation notice" },
  { from: "cmp-policy", to: "cmp-conn-vault", kind: "reads", via: "port", through: "src/athena/harness/policy.py", note: "a connector: entry is permitted only while the connection is live NOW" },

  /* --- the catalog is the policy --- */
  { from: "cmp-catalog", to: "cmp-validators", kind: "calls", via: "import", note: "AUTO fires only after its validator passes" },
  { from: "cmp-catalog", to: "cmp-c-manifest", kind: "reads", via: "import", note: "the class is derived from the manifest's own flags" },
  { from: "cmp-catalog", to: "cmp-c-registry", kind: "calls", via: "import", note: "the registry row the gate hands on" },
  { from: "cmp-catalog", to: "cmp-conn-service", kind: "reads", via: "port", through: "src/athena/connectors/port.py", note: "a connector merges exactly like a page" },
  { from: "cmp-validators", to: "cmp-c-manifest", kind: "reads", via: "import", note: "enums and maxItems are part of the contract" },

  /* --- the record outlives a reconcile --- */
  { from: "cmp-approvals", to: "cmp-brain-schema", kind: "reads", via: "import", through: "src/athena/core/brain/store.py", note: "companion_approval sits outside INDEX_TABLES on purpose" },
  { from: "cmp-approvals", to: "cmp-ids", kind: "calls", via: "import", note: "one prefix, minted in one place" },
  { from: "cmp-ledger", to: "cmp-brain-schema", kind: "reads", via: "import", through: "src/athena/core/brain/store.py", note: "companion_turn, likewise outside" },
  { from: "cmp-ledger", to: "cmp-c-harness", kind: "reads", via: "import", note: "the reason comes from the closed set" },

  /* --- the composer has two outputs --- */
  { from: "cmp-prompt", to: "cmp-recall", kind: "calls", via: "port", through: "src/athena/core/prompt.py", note: "three blocks, each announcing its own M" },
  { from: "cmp-prompt", to: "cmp-constitution", kind: "calls", via: "import", note: "the law and the identity, from inside the wheel" },
  { from: "cmp-prompt", to: "cmp-fence", kind: "calls", via: "import", note: "nothing untrusted arrives unfenced" },
  { from: "cmp-prompt", to: "cmp-catalog", kind: "reads", via: "port", through: "src/athena/core/prompt.py", note: "every registry name appears in the composed prompt" },
  { from: "cmp-recall", to: "cmp-brain-store", kind: "reads", via: "import", note: "what Athena remembers, bounded" },

  /* --- the brain: disk first, index second --- */
  { from: "cmp-brain-store", to: "cmp-brain-frontmatter", kind: "calls", via: "import", note: "the markdown file is written first" },
  { from: "cmp-brain-store", to: "cmp-brain-schema", kind: "calls", via: "import", note: "then the index transaction" },
  { from: "cmp-brain-store", to: "cmp-brain-paths", kind: "calls", via: "import", note: "where a brain lives" },
  { from: "cmp-brain-store", to: "cmp-ids", kind: "calls", via: "import", note: "episode and fact prefixes" },
  { from: "cmp-brain-reconcile", to: "cmp-brain-schema", kind: "calls", via: "import", note: "rebuild clears exactly INDEX_TABLES" },
  { from: "cmp-brain-reconcile", to: "cmp-brain-frontmatter", kind: "reads", via: "import", note: "the tree on disk is the input" },
  { from: "cmp-brain-reconcile", to: "cmp-brain-paths", kind: "reads", via: "import", note: "the directory shape" },

  /* --- connectors enter the catalog like a page --- */
  { from: "cmp-conn-service", to: "cmp-conn-spec", kind: "reads", via: "import", note: "one JSON spec per service" },
  { from: "cmp-conn-service", to: "cmp-conn-vault", kind: "calls", via: "import", note: "the executor never holds a token" },
  { from: "cmp-conn-service", to: "cmp-conn-port", kind: "implements", via: "port", through: "src/athena/connectors/port.py", note: "list_tools and call" },
  { from: "cmp-conn-service", to: "cmp-c-manifest", kind: "implements", via: "import", note: "the same manifest shape a page presents" },
  { from: "cmp-conn-vault", to: "cmp-brain-paths", kind: "reads", via: "import", note: "credentials live under ATHENA_HOME, never in a brain" },

  /* --- wiring is the one place the classes meet --- */
  { from: "cmp-wiring", to: "cmp-lane", kind: "calls", via: "import", note: "binds the lane to its ports" },
  { from: "cmp-wiring", to: "cmp-cli-harness", kind: "calls", via: "import", note: "binds the harness" },
  { from: "cmp-wiring", to: "cmp-catalog", kind: "calls", via: "import", note: "binds the catalog" },
  { from: "cmp-wiring", to: "cmp-brain-store", kind: "calls", via: "import", note: "binds the brain" },
  { from: "cmp-wiring", to: "cmp-conn-service", kind: "calls", via: "import", note: "binds the connectors, when there are any" },
  { from: "cmp-cli", to: "cmp-wiring", kind: "calls", via: "import", through: "src/athena/daemon/server.py", note: "serve, doctor and rebuild all start here" },
  { from: "cmp-cli", to: "cmp-daemon-server", kind: "calls", via: "import", note: "athena serve" },
  { from: "cmp-cli", to: "cmp-brain-reconcile", kind: "calls", via: "import", note: "athena rebuild" },
  { from: "cmp-cli", to: "cmp-engines", kind: "reads", via: "import", note: "athena doctor" },
];
