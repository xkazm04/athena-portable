/**
 * ROUND 6 CLOSED — one variant, and the mechanism that put three on the table kept behind it.
 *
 * Every variant is a folder under `variants/<slug>/` exporting a default component that takes
 * exactly these props. The shell (`variants/Shell.tsx`) owns the switcher, `?variant=`,
 * localStorage, the nav, the flight, the lens and the L2 pane; a variant owns everything inside
 * its stage: layout, camera, bands, views, legend, story. A variant never imports from a sibling
 * variant folder.
 *
 * THE OWNER RULED AFTER ROUND 6: **`archify-lanes` is the winner; delete the other two.** Round 5
 * put three drawings on the table and kept the archify grammar; round 6 asked which archify, built
 * `archify` (the round-5 sheet), `archify-density` (twelve cards) and `archify-lanes` (the turn as
 * lanes and phases), and the verdict was *"lanes are a step forward"*. So `archify/**` and
 * `archify-density/**` are gone, and with them their tests. The three pure modules the lanes
 * variant had been importing across the folder boundary — the kind rule, the twelve-stop script
 * and the routing primitives — moved INTO `archify-lanes/` rather than being deleted with their
 * first home, each keeping its own header and saying where it came from. The line "a variant never
 * imports from a sibling" is now true without an exception to excuse.
 *
 * WHAT SURVIVED THE DELETION, and what did not:
 *
 *   KEPT  the lazy template import, the error boundary and the "not built yet" placeholder in
 *         `Shell.tsx`; `useChoice`; `?variant=archify-lanes`; the `VariantSlug` type; `viewBus`.
 *         `VARIANTS` shrinking from three to one cost one edit to one list and nothing else —
 *         which is the whole argument for having had a contract, and the mechanism is what a
 *         round 7 would mount its next drawing through.
 *   GONE  the mast's variant switcher, which now hides itself because a radio group with one
 *         radio is a control that cannot be operated; and the `set_variant` TOOL, by the same rule
 *         that removed `play_turn` in round 4 — a tool whose subject no longer exists is worse
 *         than a missing one, because an agent will call it. `read_view` still names the drawing
 *         before it names anything else, so nothing an agent could learn from `set_variant` was
 *         lost; only the ability to choose, which there is no longer a choice to make.
 */
import type { ReactNode } from "react";
import type { Focus, Level, ZoomNav } from "@athena/demo-kit/zoom";
import type { useLevelFlight } from "@athena/demo-kit/zoom";

import type { Lens } from "@/data";

export type VariantSlug = "archify-lanes";

/**
 * The first entry is the DEFAULT — the shell falls back to it and the mast draws it first.
 *
 * ONE ENTRY, AND THE LIST IS STILL A LIST. `VARIANTS.length === 1` is the condition every reader
 * of this module branches on — the mast draws no switcher, `Shell` still mounts through the same
 * lazy import, and `read_view` still names the drawing — so adding a second slug is again one edit
 * to one array.
 */
export const VARIANTS: readonly { slug: VariantSlug; label: string; blurb: string }[] = [
  { slug: "archify-lanes", label: "Lanes", blurb: "The turn as lanes and phases." },
];

export interface VariantProps {
  /** The shared zoom model. A variant dispatches through it and never keeps a level of its own. */
  nav: ZoomNav;
  flight: ReturnType<typeof useLevelFlight>;
  focus: Focus;
  level: Level;
  /** The lens (a claim) or null; the set of component ids it lights. Read-only for a variant. */
  lens: Lens | null;
  lit: ReadonlySet<string>;
  /** Called when the variant wants the shell to set or clear the lens (e.g. a chip in a node). */
  onLens: (lens: Lens | null) => void;
  /** Reduced-motion preference resolved by the shell. */
  reduced: boolean;
  /**
   * The L2 pane is the shell's; a variant renders `pane` where its stage wants it (usually last,
   * so it sits over the world) and gives the shell the screen box of the open part so the pane
   * can grow out of it (rule 3, rule 11). Return null if the part is off-screen.
   */
  pane: ReactNode;
  reportOrigin: (rect: DOMRect | null) => void;
}

/** What a variant exports besides its component: what read_view should say about it. */
export interface VariantMeta {
  slug: VariantSlug;
  /** Names of this variant's views, if it has them; the shell exposes them through `set_view`. */
  views?: readonly string[];
}
