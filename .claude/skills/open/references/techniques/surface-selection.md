# surface-selection

**When** an app is to be opened to Athena, **publish WebMCP tools from the app's own UI, running in
her tab** (`document.modelContext.registerTool`), **because** it is the only third-party surface she
consumes today and the only one that also moves the UI the person is looking at.

## The three candidate surfaces

| Surface | Does Athena consume it? | What it gives | When it fits |
|---|---|---|---|
| **WebMCP in the page** (tier 1) | yes: `inject.js` polyfills `document.modelContext` in every tab, the relay lists and calls (`packages/athena-bridge/protocol.md`; ADR 0010, 0014) | data, writes as cards, AND navigation the person sees; the tools run in the page with the page's own data layer | the default, for any app with a UI |
| **MCP over stdio** | no: there is no MCP channel in `src/` (README, "Deferred surface"; ADR 0032) | data only, no UI | not today. Keep an existing MCP server for other agents, but do not plan Athena's access on it (Shadowrunr's 19-tool stdio MCP was rejected for this reason) |
| **HTTP API as a connector** (tier 3) | only through a connector spec (JSON) plus a code provider in Athena's repo (`connectors/service.py:48` `PROVIDERS`; ADR 0021) | data, executor in her daemon, credentials in her vault | a headless service with no UI, and only with a change to Athena herself. Not an `/open build` deliverable; record it as a proposal |
| DOM hands (tier 2) | yes, always, GATED on first sight | page reading and clicking with minted refs | never the plan; their use in a pilot marks a missing tool |

## Reaching a Tauri app

A Tauri app's own window runs on `tauri://localhost` or `http://tauri.localhost`, which Athena never
admits as a page origin (ADR 0119 admits `https://<host>` and `http://localhost` only). So Athena never
drives the Tauri window itself. She drives **the same frontend served into her tab**:

1. **Find the data path.** Read the frontend's data layer. If every read and write goes through Tauri
   `invoke()`, the UI cannot work in a plain browser tab, and no tool built on it can either. If it talks
   to an HTTP/WS backend (Shadowrunr: `POST /rpc` and `GET /events` on 127.0.0.1:7717), the frontend
   works in her tab as it is.
2. **Pick how the frontend is served**:
   - the dev server (`vite` on a fixed port), opened as `http://localhost:<port>/` (not `127.0.0.1`,
     even when Vite prints that);
   - a static serve of the built `dist` on `localhost` (what the e2e harness does, so no dev server is
     needed);
   - a hosted `https://` build.
3. **Point the frontend at the backend** with a query parameter or config the app already honours
   (Shadowrunr: `?daemon=http://127.0.0.1:<port>`). The backend URL may be `127.0.0.1`; only the page's
   origin must be `localhost`.
4. **When the data path is `invoke()` only**, the choices, cheapest first:
   - add an HTTP/RPC sidecar (or the existing Rust backend's own HTTP listener) that the frontend uses
     when `window.__TAURI__` is absent, with the Origin allowlist of `trust-and-pairing`;
   - expose a narrower read-only HTTP surface for the tools alone, and accept that writes stay out of
     reach;
   - record that the app cannot be opened yet. Never fake the backend in the page.

## Evidence

- Shadowrunr (2026-10-23 design wave 1): WebMCP in the console was chosen over "an MCP channel in Athena
  (a new subsystem in her repo, data only, no UI control)". The console is a Tauri app whose frontend
  talks HTTP to its daemon, so it was served into her tab with `?daemon=`.
- Athena's tabs accept any http(s) URL (`apps/desktop/src-tauri/src/tabs.rs:207-229`), but only an
  admitted origin registers tools; a refused origin gets no manifest and `/run` answers 403
  `foreign_origin` (`apps/desktop/src/lib/manifest.ts:160-163`, `daemon/routes.py:650-652`).
- All tabs share one browsing profile (`tabs.rs:236-238`), so an app login done in one tab holds in the
  next: a reason never to put a credential in the page.

## Registry

`mcp-tools/transport-selection` agrees that a local HTTP port is reachable by every visited website and
needs origin validation. `mcp-tools` says a capability belongs in a protocol only if it cannot be had
outside it; here the deciding fact is the consumer's support, which is why the plan records the
rejected surfaces with that reason.
