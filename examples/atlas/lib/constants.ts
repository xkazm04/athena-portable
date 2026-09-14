/**
 * Client-safe app identity.
 *
 * There is no `lib/db.ts` here and there never will be: Atlas has no database, no server action
 * and no mutation. Its model is a TypeScript module under `data/`, compiled into the bundle, and
 * every capability it registers is a read or a move. That is why this file is three exports long
 * and why the template's `routeFor` is gone with the routes it addressed — Atlas is one page and
 * three depths, and an agent moves through it with the kit's `open_group` / `open_item` /
 * `zoom_out`, which mean the same thing here as on every other surface in `examples/`.
 */
export const APP_ID = "atlas";
export const APP_VERSION = "0.1.0";

/**
 * The name of this app's design. One name, one `[data-variant]` block in
 * `components/atlas/style/base/tokens.css`, set statically on `<html>` in `app/layout.tsx`.
 * `ThemeVariantSwitcher` is not mounted: this round has one direction on purpose (DESIGN.md §0).
 */
export const VARIANT = "plate";

/**
 * What the three levels are called, L0 first — the same three words the level rail prints and the
 * same three the `read_view` tool answers with, so an agent and a reader are talking about the
 * same thing.
 */
export const LEVELS = ["The plate", "One layer", "One component"] as const;

/** Singular nouns for the zoom tools' generated descriptions. */
export const NOUNS = ["layer", "component"] as const;

/** The cap on any list a tool returns. Every bounded read announces `(showing N of M)`. */
export const READ_CAP = 40;
