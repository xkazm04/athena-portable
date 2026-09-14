/**
 * What reaches what. Edges are between COMPONENTS only; the system-level and layer-level edges
 * L1 draws in its margin rails are derived from these (`./index.ts`), so there is one source of
 * truth and a system edge cannot exist without a module that makes it.
 *
 * The direction is "depends on": `from` cannot do its job without `to`. Read down the stack of
 * README §3.1 — surfaces reach into channels, channels into the lane, the lane into the harness,
 * the harness into core, and everything bottoms out in contracts, which reaches nothing at all
 * (ADR 0002: "the contracts import nothing"). An edge that runs UP the stack is a finding, not a
 * feature; the test does not forbid one, but there are none here, and the margin rail draws
 * up-edges on the left and down-edges on the right so a reader would see one immediately.
 */
import type { Edge } from "./types";

export const EDGES: Edge[] = [
  /* --- the shell holds the window together --- */
  { from: "cmp-shell-lib", to: "cmp-mod-registry", kind: "reads", note: "the module bar is the registry, rendered" },
  { from: "cmp-shell-lib", to: "cmp-shell-tabs", kind: "calls", note: "opens and closes page webviews" },
  { from: "cmp-shell-lib", to: "cmp-shell-daemon", kind: "calls", note: "spawns the sidecar and owns its lifetime" },
  { from: "cmp-shell-lib", to: "cmp-shell-store", kind: "calls", note: "four generic key/value commands" },
  { from: "cmp-shell-lib", to: "cmp-shell-bridge", kind: "calls", note: "bridge_list and bridge_call stay in the trusted chrome webview" },
  { from: "cmp-shell-bridge", to: "cmp-inject", kind: "calls", note: "the relay speaks to the page half" },
  { from: "cmp-shell-bridge", to: "cmp-protocol", kind: "implements", note: "the wire format both halves are written against" },
  { from: "cmp-inject", to: "cmp-protocol", kind: "implements", note: "the page half of the same format" },
  { from: "cmp-shell-hands", to: "cmp-shell-capture", kind: "calls", note: "a screenshot before every gated proposal" },
  { from: "cmp-shell-capture", to: "cmp-shell-store", kind: "calls", note: "captures in a table with a size cap and an LRU sweep" },
  { from: "cmp-shell-daemon", to: "cmp-daemon-server", kind: "calls", note: "the sidecar is the daemon, in a job object" },
  { from: "cmp-shell-daemon", to: "cmp-daemon-ready", kind: "reads", note: "the ready line is how the shell learns the port" },
  { from: "cmp-inject", to: "cmp-kit-webmcp", kind: "reads", note: "a page's own registrations are what tier 1 reads" },

  /* --- the modules are the front of the window --- */
  { from: "cmp-mod-registry", to: "cmp-mod-panel", kind: "reads", note: "one ModuleEntry" },
  { from: "cmp-mod-registry", to: "cmp-mod-browser", kind: "reads", note: "one ModuleEntry; the browser is not special" },
  { from: "cmp-mod-registry", to: "cmp-mod-connectors", kind: "reads", note: "one ModuleEntry" },
  { from: "cmp-mod-registry", to: "cmp-mod-setup", kind: "reads", note: "one ModuleEntry" },
  { from: "cmp-mod-panel", to: "cmp-daemon-routes", kind: "calls", note: "POST /run, then the SSE stream of the turn" },
  { from: "cmp-mod-panel", to: "cmp-c-channel", kind: "reads", note: "a decision card is one channel event" },
  { from: "cmp-mod-panel", to: "cmp-shell-hands", kind: "calls", note: "host tools have no executor in the lane; the surface runs them" },
  { from: "cmp-mod-browser", to: "cmp-shell-tabs", kind: "reads", note: "the open tabs are host state" },
  { from: "cmp-mod-browser", to: "cmp-ledger", kind: "reads", note: "the app ledger: every call by app, tier and surface" },
  { from: "cmp-mod-connectors", to: "cmp-daemon-connectors", kind: "calls", note: "the list is asked for on mount and again on ready" },
  { from: "cmp-mod-setup", to: "cmp-engines", kind: "reads", note: "the probe's answer, rendered — no key typed" },

  /* --- the bridge derives the same class the catalog does --- */
  { from: "cmp-gate-js", to: "cmp-c-manifest", kind: "implements", note: "flagsOf then classify, over the same manifest shape" },
  { from: "cmp-gate-js", to: "cmp-c-harness", kind: "implements", note: "ERROR_REASONS, member for member, in a second language" },
  { from: "cmp-gate-js", to: "cmp-catalog", kind: "implements", note: "the same rule, stated twice and pinned by a parity test" },

  /* --- the studio: four apps on one scaffold --- */
  { from: "cmp-kit-webmcp", to: "cmp-c-manifest", kind: "implements", note: "the annotations a manifest is read from" },
  { from: "cmp-kit-bounded", to: "cmp-c-harness", kind: "implements", note: "the truncation notice, in the apps' language" },
  { from: "cmp-app-ledgerbox", to: "cmp-kit-webmcp", kind: "calls", note: "registers the books on document.modelContext" },
  { from: "cmp-app-ledgerbox", to: "cmp-kit-zoom", kind: "calls", note: "The Lanes is the zoom model, rendered" },
  { from: "cmp-app-ledgerbox", to: "cmp-kit-seed", kind: "reads", note: "the studio's fifteen clients" },
  { from: "cmp-app-ledgerbox", to: "cmp-kit-bounded", kind: "calls", note: "every list a tool returns" },
  { from: "cmp-app-hirelane", to: "cmp-kit-webmcp", kind: "calls", note: "registers the pipeline" },
  { from: "cmp-app-hirelane", to: "cmp-kit-zoom", kind: "calls", note: "The Board is the zoom model, rendered" },
  { from: "cmp-app-hirelane", to: "cmp-kit-seed", kind: "reads", note: "KESTREL_APPLICANT is the thread act 2 pulls on" },
  { from: "cmp-app-tidycrm", to: "cmp-kit-webmcp", kind: "calls", note: "registers the cleanup" },
  { from: "cmp-app-tidycrm", to: "cmp-kit-zoom", kind: "calls", note: "The Blocks is the zoom model, rendered" },
  { from: "cmp-app-tidycrm", to: "cmp-kit-seed", kind: "reads", note: "PINEGROVE_ALIAS is the thread act 3 pulls on" },
  { from: "cmp-app-atlas", to: "cmp-kit-webmcp", kind: "calls", note: "registers the reads and the moves; there is nothing here to write" },
  { from: "cmp-app-atlas", to: "cmp-kit-zoom", kind: "calls", note: "built only through the kit's primitives — that is the test" },
  { from: "cmp-app-atlas", to: "cmp-kit-bounded", kind: "calls", note: "every read announces (showing N of M)" },

  /* --- the journey drives the real gate --- */
  { from: "cmp-journey-surface", to: "cmp-gate-js", kind: "calls", note: "the real gate decides what may run" },
  { from: "cmp-journey-surface", to: "cmp-inject", kind: "calls", note: "the real bridge in a real Chromium" },
  { from: "cmp-journey-surface", to: "cmp-journey-contracts", kind: "reads", note: "an act passes or fails as an assertion" },
  { from: "cmp-journey-contracts", to: "cmp-app-ledgerbox", kind: "reads", note: "act 1" },
  { from: "cmp-journey-contracts", to: "cmp-app-hirelane", kind: "reads", note: "act 2" },
  { from: "cmp-journey-contracts", to: "cmp-app-tidycrm", kind: "reads", note: "act 3" },

  /* --- the daemon is the one door --- */
  { from: "cmp-daemon-server", to: "cmp-daemon-routes", kind: "calls", note: "one request per connection, token checked before the route" },
  { from: "cmp-daemon-server", to: "cmp-daemon-ready", kind: "calls", note: "prints where it bound" },
  { from: "cmp-daemon-routes", to: "cmp-lane", kind: "calls", note: "POST /run is one turn" },
  { from: "cmp-daemon-routes", to: "cmp-c-channel", kind: "streams", note: "each ChannelEvent verbatim as one SSE frame" },
  { from: "cmp-daemon-routes", to: "cmp-approvals", kind: "calls", note: "POST /decisions/<id> replays the gate with the approval id" },
  { from: "cmp-daemon-routes", to: "cmp-daemon-sessions", kind: "reads", note: "who is talking, and the origin they are pinned to" },
  { from: "cmp-daemon-sessions", to: "cmp-catalog", kind: "reads", note: "a class may be tightened per origin, never loosened" },
  { from: "cmp-daemon-connectors", to: "cmp-conn-vault", kind: "calls", note: "the consent flow; the credential never crosses the route" },
  { from: "cmp-daemon-connectors", to: "cmp-conn-service", kind: "calls", note: "what is connected, and its health" },

  /* --- voice wraps the one lane --- */
  { from: "cmp-voice-gateway", to: "cmp-daemon-server", kind: "implements", note: "a WebSocket on the daemon's existing port, not a second gateway" },
  { from: "cmp-voice-gateway", to: "cmp-voice-ws", kind: "calls", note: "RFC 6455 in the standard library" },
  { from: "cmp-voice-gateway", to: "cmp-voice-commands", kind: "calls", note: "an utterance becomes a turn, or answers a card" },
  { from: "cmp-voice-gateway", to: "cmp-voice-tts", kind: "calls", note: "the TTS: first-line rule and the cap on what is spoken" },
  { from: "cmp-voice-gateway", to: "cmp-lane", kind: "calls", note: "the same single lane, approvals and ledger" },
  { from: "cmp-voice-commands", to: "cmp-approvals", kind: "calls", note: "a spoken yes resolves a decision" },

  /* --- MCP: designed, not built --- */
  { from: "cmp-mcp-server", to: "cmp-approvals", kind: "calls", note: "another agent's card, on the same approval table" },
  { from: "cmp-mcp-server", to: "cmp-catalog", kind: "calls", note: "and at the same gate, with no second policy" },

  /* --- the lane holds no gated executor --- */
  { from: "cmp-lane", to: "cmp-turnframe", kind: "calls", note: "the surface's half of the turn, composed" },
  { from: "cmp-lane", to: "cmp-cli-harness", kind: "calls", note: "up to eight provider rounds make one turn" },
  { from: "cmp-lane", to: "cmp-c-harness", kind: "implements", note: "one turn in, a stream of channel events out" },
  { from: "cmp-lane", to: "cmp-c-channel", kind: "streams", note: "tool.call, decision.requested, and the rest" },
  { from: "cmp-lane", to: "cmp-lane-ports", kind: "calls", note: "ports, never concrete classes" },
  { from: "cmp-lane-ports", to: "cmp-c-registry", kind: "implements", note: "a host entry cannot be constructed with an executor" },
  { from: "cmp-turnframe", to: "cmp-prompt", kind: "calls", note: "the dynamic half of the two-output composer" },
  { from: "cmp-turnframe", to: "cmp-fence", kind: "calls", note: "host state is bounded and fenced with a fresh nonce" },

  /* --- the harness runs behind the hooks --- */
  { from: "cmp-cli-harness", to: "cmp-hooks", kind: "gates", note: "every tool call passes the gate before anything runs" },
  { from: "cmp-cli-harness", to: "cmp-engines", kind: "reads", note: "an engine is configuration: a dialect, not a class" },
  { from: "cmp-cli-harness", to: "cmp-transports", kind: "calls", note: "how a CLI is actually run, behind one port" },
  { from: "cmp-cli-harness", to: "cmp-op-grammar", kind: "calls", note: "the OP: line a CLI engine calls tools through" },
  { from: "cmp-op-grammar", to: "cmp-c-registry", kind: "reads", note: "a call arrives only in a shape the registry declares" },
  { from: "cmp-hooks", to: "cmp-catalog", kind: "gates", note: "the class, derived in one module and nowhere else" },
  { from: "cmp-hooks", to: "cmp-policy", kind: "gates", note: "four structural rules, before the gate" },
  { from: "cmp-hooks", to: "cmp-ledger", kind: "calls", note: "one row per invocation, failures included" },
  { from: "cmp-hooks", to: "cmp-approvals", kind: "calls", note: "GATED writes an approval row and emits decision.requested" },
  { from: "cmp-hooks", to: "cmp-c-harness", kind: "reads", note: "the closed refusal vocabulary and the truncation notice" },
  { from: "cmp-policy", to: "cmp-conn-vault", kind: "reads", note: "a connector: entry is permitted only while the connection is live NOW" },

  /* --- the catalog is the policy --- */
  { from: "cmp-catalog", to: "cmp-validators", kind: "calls", note: "AUTO fires only after its validator passes" },
  { from: "cmp-catalog", to: "cmp-c-manifest", kind: "reads", note: "the class is derived from the manifest's own flags" },
  { from: "cmp-catalog", to: "cmp-c-registry", kind: "calls", note: "the registry row the gate hands on" },
  { from: "cmp-catalog", to: "cmp-conn-service", kind: "reads", note: "a connector merges exactly like a page" },
  { from: "cmp-validators", to: "cmp-c-manifest", kind: "reads", note: "enums and maxItems are part of the contract" },

  /* --- the record outlives a reconcile --- */
  { from: "cmp-approvals", to: "cmp-brain-schema", kind: "reads", note: "companion_approval sits outside INDEX_TABLES on purpose" },
  { from: "cmp-approvals", to: "cmp-ids", kind: "calls", note: "one prefix, minted in one place" },
  { from: "cmp-ledger", to: "cmp-brain-schema", kind: "reads", note: "companion_turn, likewise outside" },
  { from: "cmp-ledger", to: "cmp-c-harness", kind: "reads", note: "the reason comes from the closed set" },

  /* --- the composer has two outputs --- */
  { from: "cmp-prompt", to: "cmp-recall", kind: "calls", note: "three blocks, each announcing its own M" },
  { from: "cmp-prompt", to: "cmp-constitution", kind: "calls", note: "the law and the identity, from inside the wheel" },
  { from: "cmp-prompt", to: "cmp-fence", kind: "calls", note: "nothing untrusted arrives unfenced" },
  { from: "cmp-prompt", to: "cmp-catalog", kind: "reads", note: "every registry name appears in the composed prompt" },
  { from: "cmp-recall", to: "cmp-brain-store", kind: "reads", note: "what Athena remembers, bounded" },
  { from: "cmp-fence", to: "cmp-ids", kind: "calls", note: "a fresh nonce per turn" },

  /* --- the brain: disk first, index second --- */
  { from: "cmp-brain-store", to: "cmp-brain-frontmatter", kind: "calls", note: "the markdown file is written first" },
  { from: "cmp-brain-store", to: "cmp-brain-schema", kind: "calls", note: "then the index transaction" },
  { from: "cmp-brain-store", to: "cmp-brain-paths", kind: "calls", note: "where a brain lives" },
  { from: "cmp-brain-store", to: "cmp-ids", kind: "calls", note: "episode and fact prefixes" },
  { from: "cmp-brain-reconcile", to: "cmp-brain-schema", kind: "calls", note: "rebuild clears exactly INDEX_TABLES" },
  { from: "cmp-brain-reconcile", to: "cmp-brain-frontmatter", kind: "reads", note: "the tree on disk is the input" },
  { from: "cmp-brain-reconcile", to: "cmp-brain-paths", kind: "reads", note: "the directory shape" },

  /* --- connectors enter the catalog like a page --- */
  { from: "cmp-conn-service", to: "cmp-conn-spec", kind: "reads", note: "one JSON spec per service" },
  { from: "cmp-conn-service", to: "cmp-conn-vault", kind: "calls", note: "the executor never holds a token" },
  { from: "cmp-conn-service", to: "cmp-conn-port", kind: "implements", note: "list_tools and call" },
  { from: "cmp-conn-service", to: "cmp-c-manifest", kind: "implements", note: "the same manifest shape a page presents" },
  { from: "cmp-conn-vault", to: "cmp-brain-paths", kind: "reads", note: "credentials live under ATHENA_HOME, never in a brain" },

  /* --- wiring is the one place the classes meet --- */
  { from: "cmp-wiring", to: "cmp-lane", kind: "calls", note: "binds the lane to its ports" },
  { from: "cmp-wiring", to: "cmp-cli-harness", kind: "calls", note: "binds the harness" },
  { from: "cmp-wiring", to: "cmp-catalog", kind: "calls", note: "binds the catalog" },
  { from: "cmp-wiring", to: "cmp-brain-store", kind: "calls", note: "binds the brain" },
  { from: "cmp-wiring", to: "cmp-conn-service", kind: "calls", note: "binds the connectors, when there are any" },
  { from: "cmp-cli", to: "cmp-wiring", kind: "calls", note: "serve, doctor and rebuild all start here" },
  { from: "cmp-cli", to: "cmp-daemon-server", kind: "calls", note: "athena serve" },
  { from: "cmp-cli", to: "cmp-brain-reconcile", kind: "calls", note: "athena rebuild" },
  { from: "cmp-cli", to: "cmp-engines", kind: "reads", note: "athena doctor" },
];
