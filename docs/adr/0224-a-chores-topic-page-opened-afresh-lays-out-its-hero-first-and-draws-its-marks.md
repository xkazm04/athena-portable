# 0224. A chore's topic page opened afresh lays out its hero first and draws its marks

Date: 2026-10-25

Builds on ADR 0089 (the performance gate and its 50 ms long-task budget) and ADR 0096 (a chore's
topic page). README sections 3.1 and 3.5. Owner decision in triage 2026-10-25 (item D2: profile and
fix).

## Context

`perf:chores` failed on "press Enter", the step that opens a chore's topic page from its row: one task
of 76-86 ms (62-67 ms at the run base), with a clean still control beside it. A CPU profile of that
task put React's render and commit at about 20 ms and the rest, 62-81 ms, inside the stage's
`land()` focusing the arriving layer. That `focus()` forces the first style and layout of the new
page. Laying the same page out again, warm, took 4 ms, so the cost was cold first-use work, not the
page's size. Two causes, each found by ablation in a Chrome profile harness:

1. **A symbol the UI face lacks.** The hero's "Enlarge" badge was the text `⤢ Enlarge`. U+2922 is
   in none of the system UI faces, so its first use sends the engine through the platform's
   font-fallback search. Warming that one glyph before the press took 25-30 ms off the task. Every
   other character the page draws (· — – → ← × § …) is in the face.
2. **Laying out the whole page at once.** With the symbol gone, the sections under the hero ("Where
   it fits", "How it runs", "See it run", "Make it yours") still cost about 27 ms of cold layout in
   that task, though at 1600 x 900 they sit at or under the fold.

## Decision

1. **The badge's mark is drawn, not typed.** `EnlargeMark` is a 12 px inline SVG (stroke only,
   currentColor) beside the word. The page's text keeps to Latin, general punctuation, the euro sign
   and the four plain arrows. `topic.paint.test.tsx` holds this for every shipped playbook.
2. **A page opened afresh lays out its hero first.** `Topic` marks its scroller `data-fresh` when it
   has no saved scroll (opened from a row, or from the front door, which clear it). Under it,
   `chores.css` gives each section after the hero `content-visibility: auto` with
   `contain-intrinsic-size: auto 480px`, so their layout and paint wait until they near the view.
   Their DOM is still drawn synchronously: tests, find-in-page and the accessibility tree see the
   whole page.
3. **A page drawn back where it was left is laid out whole.** Back from the studio or the replay, the
   page has a saved scroll and is not fresh, so the offset it is put back to (`useLayoutEffect` in
   `Topic`) lands on the same words, not on a placeholder's estimate.

## Consequences

- Isolated in a profile harness (shipped fixture, Chrome, 1600 x 900), the forced layout on Enter fell
  from 70-81 ms to 25-33 ms, and the task from 87-105 ms to under 50 ms in most runs. `perf:chores`
  passed 6 of 6 runs with no long task at all (longTaskMs 0), measured while sibling builders were
  loading the machine.
- On a fresh page the scrollbar reflects estimates until the person scrolls. Sections take their
  real height as they come near the view, and `auto` keeps that height once known. Scroll anchoring
  keeps the words in view still.
- Rejected: deferring the hero as well (`content-visibility` on every section). That moved the whole
  layout into the next rendering task, which became the long task (67-83 ms). Rejected: changing the
  stage's `land()` focus timing. It is shared by every scene, and putting the layout in the next
  frame does not shorten it.
- A new symbol in the page's copy shows up as a test failure naming its code point. Draw it, or add
  its block to the test's covered ranges once it is known to be in the face.
