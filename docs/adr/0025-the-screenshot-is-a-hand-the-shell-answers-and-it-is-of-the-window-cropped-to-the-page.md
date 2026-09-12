# 0025. The screenshot is a hand the shell answers, and it is of the window cropped to the page

Date: 2026-09-12

## Status

Accepted. Completes the tier-2 catalogue of ADR 0014's page webviews and README section 3.4: eight
hands answered by `hands.js` and a ninth answered by `hands.rs`.

## Context

README section 5 puts "the screenshot on a gated proposal" on the never-cut list. The reason is the
decision card. A person asked to approve `page_click` on `ref_7` cannot judge it: the ref is a
number minted by a script they have never read. What they can judge is the page, so a gated
proposal has to be able to carry a picture of it.

That leaves four questions a later reader would ask, and the first build answered none of them
explicitly.

**Who takes the picture?** Every other hand is a function in `hands.js`, running in the page's main
world. A page cannot photograph itself — no web API returns pixels of the document — and a page
that could would be choosing what the evidence for a decision about it looks like. That is the same
objection as a page arguing its own tool out of `GATED`.

**What is photographed?** Neither Tauri nor `wry` exposes a webview capture, and WebView2's
`CapturePreview` is not reachable through either. The OS is reachable.

**When there is more than one tab, which one?** `layout` shows exactly one page at a time, so a
capture is of the page on screen and of nothing else. A request naming any other tab has no honest
answer.

**And where does the PNG go?** `store.rs` has held a `captures` table since c21, with an LRU sweep
and a 64 MiB cap, written before anything produced a capture.

## Decision

**`page_screenshot` is the ninth hand, and its runner is the shell.** `Hand` gains a `runner`
field, `Runner::Page` or `Runner::Shell`, and `call` dispatches on it. The name never reaches
`hands.js`, and a test asserts the script does not declare it — a `page_screenshot` in the page's
half would be a page offering to photograph itself.

It is reported to a surface exactly as the other eight are, through `webmcp_tools`, with the same
two flags a page publishes for its own tools. `reversible: true` and `side_effects: "none"`, so the
catalog derives `AUTO` from the same rule it applies to everything else — and README section 3.3's
first-sight override still makes it `GATED` on an origin the user has not trusted.

**It takes no parameters.** No `ref`, because the capture cannot crop to an element; no `tab`,
because the only capturable page is the one on screen.

**`PrintWindow` with `PW_RENDERFULLCONTENT`, cropped to `layout`'s page rectangle.** A screen grab
would capture whatever is in front of the window, so a card filed while the user had mail open
would carry a picture of their mail. `PrintWindow` asks the window to draw itself whether it is
occluded or not, and that flag is what makes it work for a window whose content is a
hardware-composited webview. The crop is to the rectangle `layout` already owns, so the picture is
the page and not the panel beside it.

Two coordinate conversions, both in `page_rect_physical`: logical to physical by the scale factor,
and client-relative to window-relative by the frame's inset, because `PrintWindow` draws the whole
window and `layout` measures inside the client area.

**A non-focused tab is refused, not approximated.** `validator_failed`, naming the tab that is
focused. Handing back a picture of a different page under the asked-for tab's id would be evidence
of the wrong thing, and the person approving the card could not tell.

**The row is filed through `Store::set`.** `Store::put_capture` is the shell's door into the table,
and it goes through the same writer as everything else, so the id is minted in one place and
`bytes` is measured from the blob rather than taken on trust. There is no command for reading a
capture back: the hand answers with the row id, and `store_get("captures", id)` is the read.

**Windows only, and said so.** On any other platform `capture` returns a refusal naming the
platform, so a card elsewhere is a card with no picture rather than a call that panics.

## Consequences

The capture is the one path in the shell that cannot be unit-tested: it needs a window, a
composited webview and the OS's own drawing. `cargo test` covers the table, the schema, the
dispatch, the refusal vocabulary and both coordinate conversions. `ATHENA_SMOKE_HANDS=1` covers the
rest, by running one page hand and then the shell's against a real window and printing both — and
it earns its place immediately: the first run came back with the window frame in the picture as a
black band down the left edge, which is how the client-area inset came to exist.

A hand that the page cannot answer sets the precedent for any later one. The cost is the `runner`
field and one filter in each parity test; the benefit is that `hands.js` stays the whole of what a
page can do, which is the thing a reader of that file needs to be able to assume.

Two captures of the same page are two rows. A card cites one id, so overwriting would change what
an already-answered card showed.

What this does *not* do: nothing files a capture automatically yet. A gated proposal carrying a
`capture_id` is the panel's half, and until that lands `page_screenshot` is a hand a model can call
and a person can see the result of, rather than something the gate does on its own.
