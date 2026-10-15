# 0102. A long page read continues from a short-lived snapshot

Date: 2026-10-15

Amends the generic hands (README section 3.4 tier 2): `page_read` and `page_find` take an optional
`cursor`. Their classes do not change (reversible, `side_effects: none`, so `AUTO` once an origin is
trusted), and no refusal reason is added.

## Context

Two cuts stacked on every page read. `hands.js` cut `page_read` at 4,000 characters and `page_find`
at its first 20 matches; then the lane cut every tool result at 1,600 characters (`RESULT_CAP`,
`src/athena/lane/turn_frame.py`) with `(showing N of M)`. Neither hand took a continuation. A fact
past character 1,600 of a read, or the 21st match of a find, could not be reached by any call: the
model was told something was cut and given no way to ask for it.

## Decision

1. **Packets fit the lane's cut.** An answer that does not fit `PACKET_CAP` (1,500 characters) is
   sent in packets of at most that, first line, content and footer included. The first line is
   `cursor: cur_<generation>_<snapshot>_<offset> (chars a-b of M, snapshot sN; ...)`, or on the
   last packet `chars a-b of M, snapshot sN, the end`; the footer stays `(showing N of M)`. 1,500
   and not 1,600 so a packet is never within a few characters of the frame's wall; the 8,000
   characters `hands.rs` allows (`OUTPUT_CAP`) are never approached. A text packet backs off to a
   space within its last 80 characters, so a figure is not split across two packets. A find packet
   holds at most 20 rows and fewer when long labels would overrun it. An answer that fits one packet
   is exactly what it was before cursors existed: no cursor line.
2. **A continuation reads a snapshot, not the page.** The first call that needs packets keeps the
   whole text (up to 200,000 characters) or the list of matched elements, and the cursor names an
   offset into that copy. A page that re-renders between packets cannot shift an offset, skip a row
   or hand one back twice. A continued `page_find` row is minted a ref the ordinary way (`mint`), so
   it resolves, and goes stale, like every other ref.
3. **Bounded in number and age.** At most 4 snapshots per document (the oldest-used dropped first)
   and 3 minutes since last use. A navigation (the generation bump that already retires refs) drops
   them all.
4. **Refused in the existing vocabulary.** An expired, evicted, invented, over-long, cross-hand or
   left-behind cursor answers `unknown_ref`, the reason a stale ref already gives, and the detail
   says to call the hand again without a cursor.
5. **One bound, two languages.** `hands.rs` declares `CURSOR_MAX = 64` in both schemas; `hands.js`
   declares the same constant and enforces it. Rust tests read the script for the constant, the
   schema spelling and every page hand's description, and hold descriptions to 240 characters
   (ADR 0068).

## Consequences

- A fact anywhere in the first 200,000 characters of a page, and every match of a find, is
  reachable in `ceil(M / ~1,400)` reads or `ceil(matches / 20)` finds. A model that never passes a
  cursor sees what it saw before, cut earlier: a long read now shows its first ~1,350 characters
  rather than the frame's first 1,600, and says where the rest is.
- A continuation after 3 idle minutes, or after a navigation, costs one extra call to read again.
  That is the price of not holding stale copies of pages the user has moved on from.
- The two hands' `inputSchema` changed, so their contract hash changes: wherever ADR 0100 has
  recorded an accepted contract for them, they ask once more until an approved call runs.
- The snapshot lives in the page's main world beside the ref map. A page script can see neither
  any more than before: `hands.js` keeps both in its closure.
