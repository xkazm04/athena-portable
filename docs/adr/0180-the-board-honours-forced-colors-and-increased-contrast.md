# 0180. The board honours forced colours and increased contrast

Date: 2026-10-25

## Context

Hirelane's board direction draws its quantities with background paint: a criterion's weight is
one to three filled rules, its score a filled bar, screening evidence filled pips, the current
candidate a filled dot, the act class a filled swatch, Athena's presence a filled dot, and the
armed irreversible button a filled coral pill. The weight rules, the score axis and the pips are
aria-hidden because the paint is meant to carry them. In the compact L1 card the absolute score is
hidden, so the bar is the only place the score is drawn.

Under forced colours (Windows High Contrast) the platform repaints every background to the theme's
Canvas and drops gradients, so all of these marks disappear. The fire button then differs from its
Cancel neighbour by nothing, and the inverted GATED zone, the one region DESIGN-LAW §7.1 says must
survive greyscale, keeps only its 3px edge. Nothing in the tree mentioned `forced-colors` or
`prefers-contrast`. Separately, `--bd-ink-4` measures 5.73:1 on the worst room surface: AA, the
floor `design/check-contrast.mjs` gives it, but short of the AAA a person who asked the platform
for more contrast should get.

## Decision

1. **One sheet, imported last.** `components/board/style/base/contrast-modes.css` is the final
   import in `style/index.css`, so its rules win by order at equal specificity. It types no px and
   no colour literal, so `check-law` reads it like any component sheet.
2. **Forced colours: a structural carrier for every background-borne datum, in system colours
   only.** Each mark opts out of the repaint (`forced-color-adjust: none`) and is filled with a
   system colour, or is given a system-colour border or outline:
   - weight rules and score bar fill with `CanvasText`, and the score axis gets a `CanvasText`
     outline so a partial score reads as part of something;
   - an on pip fills `CanvasText` (an off pip is already a ring, and its border survives);
   - carousel dots become `ButtonText` rings on `Canvas`, and the current one fills `Highlight`;
   - every act-class swatch is ringed: AUTO fills `CanvasText`, GATED stays hollow, so the split
     the two locked hues carried survives as shape;
   - Athena present fills her ring with `CanvasText`;
   - the GATED zone keeps its `--bd-rule-w3` start edge in `CanvasText`;
   - the armed fire button takes the selection colours (`Highlight` / `HighlightText`), hovered
     too, so it is told apart from Cancel, which stays a system button; disabled it falls back to
     `GrayText` on `Canvas`.
   Opting out of the repaint also opts out of the forced focus ring colour, so the two focusable
   opt-outs (the dots and the fire button) name `outline-color: CanvasText` on themselves. The
   room's and the gated zone's focus-visible rules are not touched.
   No `var(--bd-*)` hue is used in this mode: the theme owns the palette, and a pastel the person
   turned High Contrast on to escape is not the direction's to keep.
3. **Increased contrast re-points the ladder one rung up instead of adding values.** Under
   `prefers-contrast: more`, inside the board `--bd-ink-3` takes `--bd-ink-2`'s value, `--bd-ink-4`
   takes `--bd-ink-3`'s, and `--bd-rule` takes `--bd-rule-2`. Re-pointing keeps one source of truth
   per value: no new colour, no new floor, and the default tier's declarations (which
   `check-contrast` reads) are untouched. A var() resolves on the same element, so declaring
   `--bd-ink-3: var(--bd-ink-2)` and `--bd-ink-4: var(--bd-ink-3)` side by side would land ink-4 on
   ink-2 and collapse three rungs into one. The two token scopes break that chain: at document
   root ink-4 takes the root's (unmoved) ink-3 and the hairline takes rule-2; the wrapper moves
   ink-3 to ink-2 and lets ink-4 `inherit` the root's value. Root keeps its own ink-3, which already
   clears AAA, and nothing drawn at root scope (the overscroll gutter, the kit's toast) sets a
   quiet rung. Result in the board: ink, ink-2, ink-2, ink-3, every rung at or above 7:1 on the
   worst room surface.

## Consequences

- `examples/hirelane/test/modes.test.ts` parses the sheets with their enclosing at-rules and pins
  the six carriers, the fire button and zone edge, system-colours-only, the resolved
  increased-contrast ladder (including that ink-4 lands one rung up, not two), the import order,
  and three guards (check-law, check-contrast's default ratios, the focus rules).
- A new mark drawn only with background paint needs a line in the forced-colours block; the test's
  mark list is where that is decided, by review.
- The increased-contrast tier depends on `:root:has()` for the root scope, as the default tier's
  root declaration already does. A browser without `:has()` gets no root value to inherit, so the
  wrapper's ink-4 would be unset in that mode only.
- The forced-colours rendering was not checked on a High Contrast desktop; the cases are static
  reads of the sheets.
