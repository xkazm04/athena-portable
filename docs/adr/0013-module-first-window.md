# 0013. The window is module-first, and the browser is one module inside it

Date: 2026-09-12

> Numbered 0013 rather than 0012: `0012-one-turn-is-one-sse-stream-of-channel-events.md` landed on
> main from the daemon lane while this was being written.

## Context

The first build's shell was a browser with a panel bolted to its side. The panel was a 380 px
column, seven surfaces were designed inside it, and the column became the ceiling: six of those
seven stacked their record lists because nothing wider would fit, a redesign was planned
afterwards, and the redesign is what discovered that a table at full width shows three to five
times as many rows as the stack it replaced. README section 3.5 carries the finding as a day-zero
decision for this build, so the shape of the window is settled before any surface is drawn rather
than after.

Two more facts from that build bear on the same choice. **A store a view starts stops being true
when the user leaves that view** — the pending count lived in one page and froze the moment
somebody navigated away. And **seven people editing one panel** is a merge risk that a module
contract, not a convention, is what survives.

Tauri v2 can put several webviews in one window behind its `unstable` feature, which is what makes
any of this possible: a window can hold a privileged React document and one webview per browsed
page at the same time. Nothing about that arrangement is negotiated in CSS — webviews are
siblings positioned in native coordinates — so *something* has to own the rectangles.

## Decision

**The window is a thin module bar and one module at full width. The browser is a module.** Not a
frame, not a host, not the thing the others live beside — one entry in the same registry, with the
same contract, previewable in the same harness. Its view-model is the tab list and the focused
tab, and the page itself is a rectangle it does not paint.

**One privileged webview, and therefore a bar across the top rather than a rail down the side.**
The module bar and the module are one React tree in the `chrome` webview, which is what lets the
app root start the app-wide stores: `src/app.tsx` starts them, a module's `Live` may read a store
and may never start one. The cost is the bar's position — an L-shaped region (a left rail plus a
tab strip) is not a rectangle, and would need a second webview and a second React tree to express.
A top band is the shape that keeps one tree, so the top band is what it is.

**`src-tauri/src/layout.rs` owns every rectangle**, and it has two shapes. When the Browser module
is selected *and* a tab is focused, the chrome webview is clipped to the bar plus the tab strip
(36 + 40) and the focused page webview takes everything under it. Otherwise the chrome webview is
the whole window. The consequence worth stating plainly: the Browser module's first 40 px must be
its tab strip, because in the first shape everything below them is covered. `styles/app.css` and
`layout.rs` both spell the two numbers and both say they are edited together.

**A page webview only exists while a tab is focused**, which is why the second shape covers
"Browser with nothing open" as well as every other module. That is the only way the Browser
module's empty state is ever seen, and an empty state nobody can reach is an empty state nobody
maintains.

**Page webviews are real webviews on one shared profile, and `window.open` is allowed.** Every tab
gets the same `data_directory`, so a login in one tab is a login in all of them; per-project
profiles are a declared non-goal. README section 9's first risk row asks whether `window.open`
misbehaves under multi-webview WebView2, and it was measured before anything else was built on
top: **Tauri v2 denies a new-window request by default**, and a real mouse click on a real button
returned `null` — with user activation, on a page served over http. Every "Sign in with…" popup in
the world would have failed silently, and a demo is where that would first have been noticed. So
`tabs.rs` answers the request with `NewWindowResponse::Allow`, which hands it to WebView2's own
default: the popup opens as a plain WebView2 window in the same environment, so what it logs into
is the shared profile. That window is not a Tauri webview — no IPC, no capability, no command — so
this widens what a page may display and not what it may reach.

## Consequences

The module contract (`src/modules/<name>/{model,fixtures,view,index}`) and the preview harness
(`preview.html?module=&fixture=&theme=`) land in the same commit as the window, not after it. A
view is a pure function of a view-model, a fixture is a view-model with inert actions, and
`registry.test.tsx` renders every module against every fixture in Node with no shell — so "the
seam is a deliverable of milestone 5, not a wish" is a red test rather than a sentence.

`layout.rs` is arithmetic plus one function that touches a window, which is why `rects()` is a
pure function of width, height and one boolean and has unit tests: the case that matters is a
window dragged shorter than its own chrome, where a zero-height rectangle makes a webview vanish
and never come back.

Rust knows exactly one module id, `browser`, because the rectangles depend on it. Every other id
is a string it stores and hands back, so adding a module stays a TypeScript change plus one line
in the registry.

What this leaves open: the module bar holds one entry today. Whether eight entries in a 36 px band
wants a segmented rail, a menu or something else is a question for the commit that first has eight
of them, and the bar is a pure component precisely so that answer is one file's worth of change.
