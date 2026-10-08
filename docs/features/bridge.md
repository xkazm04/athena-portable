# The page bridge

`packages/athena-bridge/`. Tier 1 of capability: a page's own tools, reached in the page.

- **`inject.js`, the page's half** (ADR 0008). Injected into every page webview as its
  initialisation script. It provides the `document.modelContext` polyfill so a page can register
  WebMCP tools, lists and calls them over `postMessage`, reports tool changes, aborts a call after
  30 seconds, and degrades to "no bridge" instead of failing.
- **`gate.js`, the surface's half** (ADR 0009). Derives a tool's class from its flags and only ever
  tightens it; carries the refusal vocabulary, pinned to the Python `ERROR_REASONS` by a parity test;
  fences and bounds output; keeps a per-origin budget.
- **The relay.** The desktop forwards calls with a tab id and a nonce (`bridge_list`,
  `bridge_call`, `bridge_reply`) and holds the id map with a 35-second timer (ADR 0014).
- `protocol.md` is the wire contract; `test/` covers both halves.

A page that registers nothing still gets tier 2: nine generic DOM hands in the shell
([desktop.md](desktop.md)).
