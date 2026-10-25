# 0201. The Blocks sheet has a forced-colors mode, and the gate leaves the repaint

Date: 2026-10-25

## Context

tidycrm's Blocks sheet (`examples/tidycrm/components/blocks/style/`) exists to tell a reader three
things: which databases are in fault, which field differs between two duplicate records, and where
the irreversible acts are. All three were carried by colour alone. Under a Windows contrast theme
(`forced-colors: active`) the platform repaints `color`, `background` and every border, outline and
fill colour to the user's system palette, so all three disappeared: the fault and quiet legend keys
drew the same 3px edge, the differing field read like its neighbours, the pressed camera pose looked
like the other four, Athena's presence dot filled nothing, and the title block, a place only by its
inverted ground, repainted to the same Canvas as the reversible actions. The stylesheet had no
forced-colors rule at all. It already had the right carriers in two places: the database jump's 3px
pressed edge and the bad table cell's wavy underline.

## Decision

1. **One part, imported last.** `base/forced-colors.css` is one `@media (forced-colors: active)`
   block, the last import in `index.css`, so it wins over every part without raising specificity.
2. **A structural carrier for every colour-only state**, taken from the sheet's own devices: fault
   is a doubled 6px verdict edge against quiet's plain 3px one; a pressed chip takes the jump's 3px
   inline-start edge; the pressed pose is `SelectedItem` and underlined; the differing field and the
   deviant spelling take the wavy underline; the key being read takes a heavier far edge, leaving
   the verdict edge alone; the armed confirm is a doubled edge.
3. **Where an inversion or a fill is the meaning, the element leaves the repaint**
   (`forced-color-adjust: none`) and is drawn in system colours: the presence dot, the measure
   bars, the index mark, and the title block.
4. **The gate inverts itself in system colours, as a scope.** The title block is `CanvasText` with
   `Canvas` ink, and rebinds every colour role (ADR 0198) to a system colour, redline to
   `Highlight`, so its buttons, armed confirm and its hover, ring, band and scrollbar follow with
   no rule of their own.
5. **System keywords only.** No colour in the block is a `--bk-*` palette value.
6. **The obligation is derived, not listed.** `test/tidycrm-style.test.ts` finds every rule whose
   selector carries a state attribute (`aria-pressed`, `data-fill`, `data-differs`, `data-fire`,
   `data-on`) and declares only colours, and requires a forced counterpart for that selector with a
   carrier. A `:hover` part is exempt: it is feedback over a state already drawn at rest. The
   contrast tests skip the forced block, since a system keyword has no sRGB value to measure.

## Consequences

- A reader on a contrast theme can tell fault from quiet, see the differing field, and see the gate
  as a separate place. The default paint is unchanged: the block only applies under forced colors.
- The next state added to the sheet with a colour-only rule fails the derived test until it gets a
  carrier.
- Under forced colors a few boxes change size: the fault edge is 6px and the armed confirm's border
  is 3px. That layout shift happens only in that mode.
- The gate keeps its inversion only because it leaves the repaint. A theme whose `Canvas` and
  `CanvasText` are close would make it low in contrast. Contrast themes are built on that pair, so
  this is accepted.
- Not verified in a real contrast theme. The checks are static, read off the stylesheet, and run
  offline.
