# page-identity-and-opt-in

**When** the page detects a WebMCP registry, **name the app with meta tags and offer a default-off
toggle that loads the catalogue as its own chunk and registers every tool under one abort signal**,
**because** the person decides when the app is driven, the app pays nothing outside Athena, and one
abort is the only unregister that cannot leave a tool behind.

## Procedure

1. **Meta tags** in the app's `index.html` (or the head of every document):
   ```html
   <meta name="athena:app" content="<slug>">          <!-- [A-Za-z0-9_-], names tools host.<slug>.<tool> -->
   <meta name="athena:app-name" content="<Display Name>">
   <meta name="athena:app-version" content="<package version>">
   ```
   Without `athena:app` the tools are catalogued under an id derived from the origin
   (`web_http_slocalhost_c3000`, ADR 0065), which changes with the port. `athena:app-manifest` is read
   by the bridge but not forwarded by the shell (ADR 0066); do not rely on it.
2. **Detection.** The registry is `document.modelContext`. `registry()` returns it or `undefined`;
   nothing else of the agent layer runs when it is `undefined`.
3. **The opt-in.** A toggle in the app's chrome, rendered only when the registry exists, persisted in
   `localStorage["<slug>.athena.drive"]` (`"1"` on, default off), with `data-role="athena-drive"` and
   `aria-pressed`. Off reads "Athena"; on reads "Athena driving" in the accent. Storage that throws must
   not break the toggle for the page load.
4. **The chunk.** The catalogue module is a dynamic `import()` taken the first time both conditions hold;
   its size is its own line in the bundle budget.
5. **One controller.** `registerTool(tool, { signal })` for every tool under one `AbortController`;
   switching off aborts it. Also call `unregisterTool(name)` on abort, for a native registry that
   ignores the signal. The polyfill posts `toolchange` on every register and unregister, and the shell
   re-lists (`inject.js:78-80`, `apps/desktop/src/stores/tools.ts`).
6. **No registration outside the toggle.** No tool registers at import time, on route change, or per
   page; the catalogue is one stable set, sorted by name, so an unchanged registry produces an unchanged
   manifest and unchanged contracts.

## Checks

- Unit, with a fake `modelContext` and fake storage: nothing registers without the registry; nothing
  registers with the registry and the toggle off; switching on registers the full catalogue; switching
  off leaves zero (`apps/console/src/app/agent/boot.ts` and its tests are the reference).
- Harness: after the toggle is pressed off, the relay lists zero tools (the Shadowrunr scripted
  "Opt-out" case).

## Evidence

- Shadowrunr console: `apps/console/src/kit/athenaDrive.ts` (detector and store),
  `apps/console/src/app/agent/boot.ts` (the gate and the one controller), `catalog.ts`
  (`registerTools`). Measured cost outside Athena: +1.5 KB on the entry bundle, the agent chunk on its
  own 43 KB budget line (build record, 2026-10-23).
- The opt-in persists in the browsing profile: an Athena that ran the desktop e2e before already has it
  on, so the e2e presses the toggle only when it reads "Athena" (`apps/desktop/e2e/desktop/`).

## Registry

`agent-addressable-ui/opt-in-instrumentation-gate` asks for a double gate so normal builds pay nothing;
here the two gates are the registry's presence and the person's toggle, and the chunk boundary is what
makes the cost near zero. `device-pairing/admission-scoping` ("listener off until trust exists") is the
same instinct: no tool exists until the person opts in.
