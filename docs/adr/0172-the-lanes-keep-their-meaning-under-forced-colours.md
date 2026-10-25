# 0172. The Lanes keep their meaning under forced colours

Date: 2026-10-25

Builds on ADR 0018 (ledgerbox ships the Lanes) and ADR 0169 (the Lanes have one colour authority).

## Context

Under forced colours (a Windows contrast theme) the platform repaints the page in the reader's
palette: `background-color` and `border-color` are forced to system colours, gradient backgrounds
are dropped and `box-shadow` computes to none. The Lanes carried almost every meaning that way. Each
mark is a `<button>` painted `background: var(--tone)` with no border, so every state became the
same box on the same ground; the lateness tail and the now-line are backgrounds, the lane spine
(the share already late) is a gradient, the node meter, the clock's marks and the legend swatch are
backgrounds, and `select`'s working set and the open mark are box-shadow rings. Only position and
width survived. The sheet already honours reduced motion with the rule that nothing is hidden;
forced colours was the platform preference it had not met, and no part of `examples/` or
`packages/` mentioned it.

## Decision

1. **One part, `style/base/forced-colors.css`, imported last**, every rule inside
   `@media (forced-colors: active)`. Nothing outside the media query changes, so no other viewer
   sees a difference. Last in the cascade, it beats the heat and ticked rules at equal weight.
2. **The five states are a (fill, border) pair in system colours**: alert CanvasText fill, risk
   Highlight fill, watch LinkText fill (each with a solid border of its fill), good no fill with a
   solid CanvasText border, inert no fill with a dashed GrayText border. The legend swatch and the
   clock's marks repeat the same pairs, so the key still keys. A system colour an author writes is
   honoured by forced colours, which is what makes this possible at all.
3. **Lateness and now are drawn in the theme's ink**: the tail and the late share of the spine in
   CanvasText (the spine as its own length, since its gradient is dropped), the now-line in
   Highlight at full opacity.
4. **Rings become outlines**: the open or hovered mark a 2px CanvasText outline, the picked mark and
   node a 2px Highlight outline set further out, so a mark both open and picked shows both. The
   presence dot is an empty ring while waiting and filled when a bridge is in the page.
5. **Text stays the platform's.** The part sets no text colour and never `forced-color-adjust`;
   it uses only system colour keywords and `transparent`, no `--ln-*` token and no literal.

`test/ledgerbox-style-design.test.ts` holds all of it, each population read from the sheet: the
part is last and wholly inside the query; the five heats (read off `heat-in-one-place.css`) draw
five distinct pairs; every rule whose background carries `--tone`, `--ln-accent` or `--ln-alert`
has a system-colour carrier; every state whose box-shadow is a ring has an outline or border; the
legend pairs equal the marks'; and the part's vocabulary is the system palette.

## Consequences

- A reader on a contrast theme reads five distinguishable states, lateness to the now-line, the
  late share per lane and the working set, instead of identical boxes.
- Using LinkText and Highlight as state fills spends two theme colours on meanings the theme did
  not name; they are chosen because Windows contrast themes map them to distinct, high-contrast
  values. Good and inert differ by structure (outline vs dashed) in any theme; the three filled
  states rely on the theme giving CanvasText, Highlight and LinkText distinct values.
- A new colour-borne meaning on the sheet must add its carrier here, or the forced-colours tests
  go red.
- Not verified in a browser in this change; the tests read the sheet, not a render.
