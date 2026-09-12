# 0007. The page half of the bridge degrades to "no bridge" instead of failing

Date: 2026-09-12

## Context

`inject.js` runs inside applications this project does not own, at document start, before their
own scripts. README §3.4 tier 1 makes it the path to a page's own WebMCP tools, and the shell
injects it into every page webview on every navigation — including pages the user opened for
reasons that have nothing to do with Athena.

Three things about that environment are not negotiable. The page may already have a
`document.modelContext`, because WebMCP is shipping and a browser that implements it natively is
the point of the standard. The page may have sealed the slot, or made `window` non-extensible,
before anything of ours ran; the build plan lists *a page that freezes its globals* as a risk to
retire in this commit. And the page may be hostile, or merely contain an iframe that is: an
advertisement in a frame posting `{ type: "call", name: "send_invoice" }` must not be able to
reach the surface through the bridge the user's own page is carrying.

The tempting design for the first two is an exception — throw, log, let the surface see a real
error. That is wrong twice over. An exception at document start lands in the page's console and,
in the polyfill's case, in the application's own initialization path; it is a visible defect in
software the user did not ask us to modify. And an error is not what the surface should render:
a page with no bridge and a page with no tools are the same page to a person, and "0 tools" is a
true, calm answer where "TypeError: Cannot define property" is neither.

## Decision

**Everything `inject.js` does is inside one `try`, and the failure mode is silence.** No bridge
means no message listener, so `list` never answers, the relay's own timer expires, and the surface
shows a page with zero tools. The marker `window.__athenaBridge` is written *first*, before any
listener: on a non-extensible window that write throws and nothing is installed at all, so the
bridge never ends up half-present.

**A native `document.modelContext` is used as it is found, and reported.** The polyfill is
installed only when the slot is empty, `list` says `transport: "webmcp-native"` or
`"webmcp-polyfill"`, and the registry is read through whichever of `listTools`, `getTools` or
`tools` the implementation offers rather than through the one shape of the draft this was written
against.

**A frame is not the page.** `inject.js` installs nothing when `window.top !== window` (and a
cross-origin `top` that throws lands in the same catch, with the same answer), and the message
listener requires both `event.source === window` and `event.origin === location.origin`.

**A call is raced against its deadline, not merely aborted.** The tool is handed an `AbortSignal`,
but the answer comes from `Promise.race`, so a tool that ignores the signal and never settles
still produces `{ ok: false, reason: "timeout" }`.

## Consequences

A page that broke the bridge is indistinguishable from a page that has no tools. That is the
intended trade and it has a cost: a genuine bug in `inject.js` presents as "this app has no
tools", which is a poor error message for us and a fine one for the user. The re-injection marker
is the compensation — `window.__athenaBridge` is present exactly when the bridge installed, so a
surface (or a person at a console) can tell "no bridge" from "no tools" in one read, and
`packages/athena-bridge/test/inject.test.js` asserts both halves of that.

Reading a native registry through three possible shapes is more code than the draft needs today,
and it is the code that keeps the bridge working when the draft moves. The alternative — assume
`listTools` — would fail closed in exactly the browsers that implemented the standard best.

Nothing here weakens the gate, because nothing here decides anything: every flag the page supplies
travels to the surface as a claim, and the class is derived from it there and in the catalog.
