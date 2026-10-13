# 0095 — The cutover deletes the bar and the old views, and the first paint is a budget

## Context

ADR 0090 ported the five depths one at a time behind a bridge to the module views, with the console
opt-in. With the last port in, the bridge, the bar and the flag had no reason to exist, and the
first full build measured what ADR 0089 only promised: the shipped playbooks' 2.7 MB of JSON was
bundled eagerly into the first frame, and every depth's view and fixtures with it.

## Decision

**Deleted:** `ModuleBar`, the app root, the module registry, the flag (`lib/ui.ts`), the five modules'
views and their stylesheets, the bridge, the Rust `browser` alias and the `layout_module` command,
and the components only those views used (`Emblem`, `Layer`, `PageHeader`, `PageSection`,
`PageShell`, `SectionCard`, `Tile`) with their CSS. **Kept:** each module's model, fixtures, hook and
tests; what the scenes still borrowed was moved to where it is used (`scenes/apps/strip.tsx`,
`scenes/mind/shared.tsx`, `modules/voice/pieces.tsx`). The Rust selection is now a shape (`page` or
`scene`), starts as the scene, and `layout:changed` carries only the shape. The preview harness is
scene-first (`?scene=&fixture=`), and the contract the registry test used to pin (four fixtures per
module, every fixture renders) is now `console/scenes.test.tsx` over the depth registry.

**The first paint is held by what the console imports statically.** Each depth is a `live.tsx` (its
hook, its crumbs, its band) whose view is a `lazy` chunk, and an `index.tsx` carrying the fixtures
and the synchronous preview for the harness and the tests (`scenes/registry.ts`). The shipped
playbooks load on first ask (`stores/playbooks.ts`, `loadShipped`); the eager copy
(`lib/playbooks.shipped.ts`) is for fixtures and tests only. `console/graph.test.ts` walks the
static imports from the console's root and fails on a fixture, a preview, the eager playbooks or a
depth's view. The result: about 125 kB gzipped to draw the first frame (the shared chunk 97 kB, the
console 27 kB), from 780 kB.

**The dock is a row, not a layer over the scene**, and the light theme's depth tones cool instead of
darkening.

## Consequences

- A person who opens a depth waits for one small chunk (about 10 to 20 kB gzipped plus its
  stylesheet); the surface's totals and the Chores field say they are counting or loading until the
  playbooks arrive, rather than showing zero.
- Anything that needs the real shipped set at import time (a fixture, a test) imports the eager
  copy, and a test pins that nothing in the running app does.
- A new depth is a compile error until it has a live part and a full scene.
- The measurements are from Edge, the engine WebView2 is built on, not from the shipped window.
