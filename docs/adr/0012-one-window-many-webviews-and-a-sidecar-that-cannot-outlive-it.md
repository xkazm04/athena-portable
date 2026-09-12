# 0012. One window with many webviews, and a sidecar that cannot outlive it

Date: 2026-09-12

## Context

The shell has to put a page the user is browsing beside a 380 px panel, hold several such pages at
once, inject the bridge into each of them, and run the Python daemon underneath. Three decisions in
that sentence could each have gone another way.

**How a tab is shown.** Tauri's stable API gives one webview per window. Making each tab its own OS
window would be simple and would also stop being a browser: the panel could not sit beside the page
it is about, the window manager would own the tab order, and act 1 of the demo — two tabs, one per
real app, with the panel showing each one's tools — would be three windows the presenter has to
arrange on stage.

**How the daemon dies.** README §3.5 records the first build's evening: orphaned daemons after
every wrong-way close, six of them holding six ports. A `Drop` implementation covers the ordinary
quit and covers nothing else. A shell killed from Task Manager, or one that panics, never runs
`Drop` — and those are exactly the closes that happen while developing.

**How a page's tools reach the shell.** `inject.js` speaks `window.postMessage` and must keep
speaking only that: it is the same file under an extension, a webview and whatever surface comes
next, and a version of it that knew about Tauri would be a second version to keep correct.

## Decision

**One window, many webviews, behind Tauri's `unstable` feature.** `layout::split` owns the geometry
and is the only place the column width is written; every webview is repositioned from it on resize
and on a scale-factor change. Page webviews are labelled `page-<n>` from a counter that never
resets, because labels address webviews and route relay replies — a reused label after a close would
deliver the third tab's answer to the first tab's request.

**The sidecar is killed twice over.** On the ordinary path, the exit handler and `Drop` both call
`stop`, which kills *and waits*: a killed child that is never reaped holds its port. On Windows the
child is also assigned to a **job object** with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, so the OS
kills it when the last handle closes — which covers the panic, the force-quit and the debugger
detach that no `Drop` reaches. The daemon binds port 0 and prints one JSON handshake line before
anything else; the shell blocks for that line with a timeout, so it never renders a panel that does
not yet know where to send a turn.

**The relay is a second script, not a second `inject.js`.** `relay.js` is injected beside
`inject.js` at document start and does one thing: carry `to-ext` messages out as a Tauri event and
`to-page` messages in as a `postMessage`. `inject.js` is unchanged and unaware. The Rust half
(`bridge.rs`) mints correlation ids, holds the pending requests and sweeps the ones a page never
answers — with a 35-second window that is deliberately *longer* than the page's own 30-second
abort, so the page's error about the actual tool wins and the relay's timer only ever covers a page
that is gone.

The capability granted to page webviews is two permissions wide: emit an event and listen for one.
A page cannot reach any command. It is scoped to the `page-*` labels and to remote origins, so the
panel's own webview and the shell's commands are outside it entirely.

## Consequences

`unstable` is a real cost: the multi-webview API can change between Tauri minors, and an upgrade is
a change to `lib.rs` rather than a version bump. It is confined to window and webview construction,
`show_only` and `relayout` — about forty lines, all in one file.

`bridge.rs`, `tabs.rs`, `store.rs` and `layout.rs` are pure state and parsing with no Tauri types in
their signatures, so all thirty-eight Rust tests run under `cargo test` with no window, no webview
and no daemon. What is left untested by unit tests is exactly what needs a real window, and that is
where the demo runs stand.

A page that navigates loses its registration and its daemon session in the same operation
(`Tabs::navigated` returns the session to close). A new document is a new page; tools the previous
one registered must stop being addressable, or an origin's standing would outlive the origin.

The settings file is read totally — a corrupt or hand-edited file reads as the defaults and is
repaired rather than refused, because a shell that will not start over a window size is worse than
one that forgot it.
