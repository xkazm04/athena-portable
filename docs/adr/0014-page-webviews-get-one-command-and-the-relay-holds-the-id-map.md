# 0014. Page webviews get exactly one command, and the relay holds the id map

Date: 2026-09-12

## Context

Tier 1 of README section 3.4 is *the page's own WebMCP tools, through `inject.js` and the relay*.
`packages/athena-bridge/inject.js` is the page's half and it already exists (c16): it polyfills
`document.modelContext`, answers `list` and `call` over `window.postMessage`, and posts
`toolchange`. What c19 owes is the other end of that conversation inside the shell.

The shape of the problem is that a webview is a one-way street. Tauri's `eval` is
fire-and-forget — it returns nothing — so a message can be pushed into a page and no answer can
come back out of it that way. The two ways an answer *can* come back are the IPC, which means
granting a page webview a command, and polling a global with repeated `eval`, which means a poll
loop and a global the page controls anyway.

A page webview is whatever site the user navigated to. It is the least trusted document in the
process, and it is about to be handed a way to call into Rust.

## Decision

**One command, and the capability names it.** `capabilities/page.json` grants the `page-*`
webviews `allow-bridge-reply` and nothing else — no `core:default`, no window control, no
filesystem. `capabilities/ui.json` keeps `bridge_list` and `bridge_call` for the `chrome` webview.
A page can hand the relay an answer; it cannot ask the relay for anything.

**Three checks stand between a page and the id map**, and each answers a different question:

1. the per-tab **nonce**, minted in Rust and closed over by the forwarding script, which runs at
   document start before any page script and never writes the value anywhere the page can read.
   It answers "is this the script we installed?";
2. the **id namespace**. Every request id is `<tab>:<n>-<random>`, a reply is only matched against
   a pending request of its own tab, and the 128-bit tail is what stops a document spraying
   `1:0`..`1:500` to pre-answer calls nobody has made yet. It answers "is this a reply to
   something we asked?";
3. **the page was always the responder.** Even with a perfect nonce, all a page can return is a
   tool result — which is exactly what it returns on every other surface. Tool results are
   untrusted input downstream (the gate, the fence, the budget) and nothing here changes that.

**The relay's timer is 35 s and it forgets.** `inject.js` races every `call` against a 30 s abort,
so the page's own deadline is meant to win and produce a real error; the relay's longer timer only
covers a page that is gone, frozen, or never had a bridge. When it fires, the call resolves
`{ ok: false, error: "timeout" }` and the id leaves the map — a request leaves the map exactly
once, by the reply that matches it or by the timer that gave up on it, which is what makes a late
reply a dropped message rather than a leak or a panic.

**`inject.js` is embedded from the package, not copied.** `INJECT_JS` is an `include_str!` of
`packages/athena-bridge/inject.js` itself, `build.rs` re-runs on that file, and a unit test reads
the file at test time and compares the bytes. The bridge package is the source of truth for what
runs in a page on every surface, and the failure mode of a stale copy — a page that answers an
older protocol — would look exactly like a page with no tools.

**A message from Rust to a page is JSON-encoded once and then made safe to be JavaScript.**
`serde_json` escapes the quotes, the newlines and the control characters; `js_safe` then spells
`U+2028`, `U+2029` and `</` as escapes, all three of which JSON allows raw and a script host does
not. What comes out still parses as JSON, which is what the round-trip test asserts — escaping
that changed a value would reach the page as a tool called with the wrong arguments.

## Consequences

The panel's manifest is built from a store, not from a view. `src/stores/tools.ts` keeps one entry
per tab and refreshes on three occasions: a `bridge:toolchange` from the page, a tab that has just
appeared, and a tab that has navigated. It is started by the app root and by nothing else, because
the focused page's tool list has to stay true while the user is looking at the Approvals module
(README section 3.5). An answer about a document the tab has already left is dropped rather than
shown: the tab's address is stamped on the request and compared when the answer lands.

Zero tools is the ordinary answer and the surface says so in three ways rather than one — asking,
a count, and a reason when the page could not be read at all. Every site that never heard of
WebMCP lives in that third state, which is what the nine generic hands are for (c24, tier 2).

What this leaves open. The nonce is per tab and an initialization script re-runs on every document
a tab loads, so the page after a navigation holds the same nonce as the page before it; the
document-level rule lives in the tools store rather than in the relay, and the day a gated host
call is executed on a page that navigated mid-turn, the relay will want the same comparison one
floor down. And a tab that closes with requests parked on it leaves them to time out — 35 s of
waiting for an answer that cannot come. Both are one function each in `bridge.rs` and neither is
reachable from anything c19 ships.
