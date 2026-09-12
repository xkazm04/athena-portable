# 0013. The panel is plain TypeScript, and every module previews without Tauri

Date: 2026-09-12

## Context

README §3.5 records two findings about the first build's panel. It put "seven panel surfaces in a
380 px column" and they grew into each other, because nothing said what a surface *was*. And it had
"no automation seam for the panel": the only way to see the run loop do anything was to launch the
shell, start a daemon, open a page and drive it by hand — so the states that mattered most, the
empty one and the failing one, were the ones nobody ever reached twice the same way.

The answers the design fixes are a module shape — "each module is a view-model, fixtures and a pure
view" — and two seams: `preview.html?module=&fixture=` rendering any module without Tauri, and a
headless test driving the run loop against a fake daemon.

None of that says which UI library to use, and the obvious default is React with Vite. What that
costs here is specific rather than theoretical. It is a bundler between the source and what the
webview loads, so the preview harness renders something the shell does not. It is several hundred
transitive packages in a lockfile that a second team is concurrently editing for the example host
apps. And it is a build step in a repository whose fifth invariant is that nothing heavy is
mandatory and whose Python core is stdlib-only.

Against that, what React would actually provide to this panel is a pure function from state to a
tree — which is what a module is *required* to be anyway.

## Decision

The panel is plain TypeScript compiled by `tsc` to ES modules the webview loads directly. There is
no bundler and no UI framework.

`lib/dom.ts` is twelve lines: an `h` that builds an element, a `replace` that swaps children in one
operation, and a `classes` helper. It sets text through `textContent` and never through `innerHTML`,
because everything this panel renders came from a page the user was browsing, a model, or a tool's
output, and none of that is trusted markup.

A module is `{ id, title, glyph, fixtures, view }`. The view is pure and takes its actions as a
second argument rather than as methods on the model, so a fixture stays plain data — a fixture that
had to carry callbacks is a fixture nobody writes by hand. Every module declares an `empty` fixture,
and the ones worth looking at besides: a card waiting, a turn refused, an engine missing.

`preview.html?module=&fixture=` renders any of them in a 380 px frame with no Tauri, no daemon and
no network, and its index is a contact sheet of the whole panel. The frame is part of what is being
previewed: a module that only looks right wider than the column it lives in is a module that does
not fit.

The tests run against `dist/`, not against the sources. A panel that type-checks and does not run is
exactly the failure a headless test is for.

`apps/desktop/src/lib/ids.ts` is the TypeScript half of `contracts/ids.py`, and
`tests/test_ids_parity.py` reads it as text and compares the two tables. It reads rather than
executes for the reason `test_refusal_parity.py` already gives: the Python gate runs where no Node
is installed, and a test that needs a second toolchain to compare two tables of strings is a test
that gets skipped.

## Consequences

The build is `tsc` plus three file copies, so the preview, the shell and the tests all load the same
output. `pnpm test` builds first, which makes a stale `dist/` impossible rather than merely unlikely.

Re-rendering is whole-panel: `replace` swaps the body on every state change. At this size that is
free and it removes a class of bug entirely — there is no diff to get wrong, and no component that
can hold state the model does not have. If the panel ever grows past what a full re-render can do
smoothly, the module shape is what a virtual-DOM library would want anyway, so the change is local.

Writing imports with explicit `.js` specifiers is the one tax. TypeScript resolves them to the
`.ts` sources and emits them unchanged, which is what makes the output loadable with no bundler.

Twenty-seven tests run under `node --test`: the run loop against a fake daemon and a fake page,
covering the host-tool continuation, the approval instruction, the continuation bound, both refusal
paths and a page that will not report its state; and every module rendering every fixture, with the
card's parameters, the catalog's classes and a broken check's remediation asserted by name.
