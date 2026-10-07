# 0029. A module is two layers: an overview that reads, and a layer for every write

Date: 2026-10-07

Refines [0024](0024-the-shells-second-pass-apps-as-a-ledger-the-panel-as-a-conversation-setup-as-one-module.md):
the ledger, the connector cards and the settings list keep every fact they showed. What changes
is where the controls that change those facts sit.

## Context

After the second pass, every Main module mixed reading with writing on one surface:

- the Browser ledger opened with a register field at title size above the rows, and each row
  carried "Don't act here" and "Forget" behind a hover;
- each Connectors card held its tools, its two decisions, its connect form and its guide, stacked
  in one 60rem column;
- Setup's settings were a list of rows, each with its control inline.

The owner asked for every module to have two layers. The first layer should give a clear overview
of the items. The second should open on a detail or a call to action, and that is where creating
and updating happens. Their examples: Browser as a table of registered apps, with registration as
the second layer; Connectors as a grid of logos, each opening its setup; Setup as large icon cards,
each opening that submodule's setup, test and preview, using the space this frees. Voice was
already laid out well and gets only polish.

## Decision

1. **The first layer reads.** Each overview is the shape that suits its items:
   - Browser is a `Table`: one row per origin, with its standing, tools and last-seen.
   - Connectors and Setup are a grid of `Tile`s. A tile shows a drawing, a name, the standing as
     a dot and a word, and one line.

   A tile has no description. Its emblem dominates the card, the name sits under it, and the
   standing is a small pill in the top right corner. The `Emblem` sets each drawing in the brand's
   stamp: a plate, an inset seal ring, a tilted ghost plate behind it, and the diamond mark.
   - When the item stands done, the plate is inked teal, the glyph is dark, and the ring is solid.
   - When it doesn't, the plate is recessed and the ring is dashed.

   One accent stroke per drawing is the mark's countersign.

   The only act left on an overview is navigation: opening an app, or opening an item's layer.
   Nothing that writes stays on it.
2. **The second layer writes.** `Layer` (in `src/components/`) is a sheet that slides in from the
   right, under the module bar, over a scrim. It closes three ways: Back, the scrim, or Escape.
   Focus moves into it when it opens and returns to whatever opened it.
   - `md` holds one form: registering an app, or one app's switch and Forget.
   - `lg` holds a submodule. `LayerColumns` puts what is set on the left and how it tests or
     what it looks like on the right:
     - a connector's decisions next to its tools and guide;
     - the engine choice next to the probe;
     - the theme rail next to a live preview of each theme.
3. **A layer shows the item as it is now.** The open layer's item is looked up again from the
   view-model on every render, so a probe or a save that lands while the layer is open shows at
   once. Which layer is open is view-local state, like a draft. It is not in the view-model and
   not in a store.
4. **First-run exceptions.** When the Browser has nothing registered on its first run, the
   register layer starts open, because registering is the only thing to do there. Setup's
   onboarding letter keeps its controls inline: it is a first act read top to bottom, not an
   overview someone comes back to.
5. **Arrival motion.**
   - A module fades in when it is selected, and its bands rise into place a few frames apart.
   - The module root animates opacity only. A transform on an ancestor would become the
     containing block of the fixed `Layer` and move it.
   - Reduced motion removes the motion and the delays.

## Consequences

- An overview fits in one screen and can be compared at a glance. The cost is one more click to
  change anything. Opening an app, the most frequent act, stays in its row.
- `Table` gained `rowClassName` and `onRowClick`. A clickable row must also contain a focusable
  control that does the same thing, because a `<tr>` is not focusable.
- `Tile` and `Layer` join the catalog, each with three callers.
- A layer is a fixed element. In the Browser module it can only be seen while no page webview
  covers the area, which is exactly when the ledger is on screen. Registering closes the layer
  before the new tab opens.
- Tests now check the split: no overview fixture renders an input, a textarea or a radiogroup,
  and the Browser first run renders the register dialog open.
