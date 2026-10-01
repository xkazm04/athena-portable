/**
 * ROUND 7 — three finishes of the one drawing round 6 kept.
 *
 * Every variant is a folder under `variants/<slug>/` exporting a default component that takes
 * exactly these props. The shell (`variants/Shell.tsx`) owns the switcher, `?variant=`,
 * localStorage, the nav, the flight, the lens and the L2 pane; a variant owns everything inside
 * its stage: layout, camera, bands, views, legend, story. A variant never imports from a sibling
 * variant folder.
 *
 * THE OWNER RULED AFTER ROUND 6: **`archify-lanes` is the winner.** Round 7 does not replace that
 * drawing: it mounts it three times, with three finishes, so a reader can compare visual wow
 * against the ability to present the solution. Classic is the round-6 baseline. Signal and
 * Editorial import the shared engine through `components/atlas/lanes.ts`, never this folder's
 * sibling, so the "no sibling import" line still holds. `set_variant` is back on the tool
 * surface because there is a choice an agent can make.
 */
import type { ReactNode } from "react";
import type { Focus, Level, ZoomNav } from "@athena/demo-kit/zoom";
import type { useLevelFlight } from "@athena/demo-kit/zoom";

import type { Lens } from "@/data";

export type VariantSlug = "archify-lanes" | "archify-signal" | "archify-editorial";

/**
 * The first entry is the DEFAULT — the shell falls back to it and the mast draws it first.
 *
 * THREE FINISHES OF ONE GEOMETRY. The mast draws the switcher because `VARIANTS.length > 1`;
 * `set_variant` is on the tool surface for the same reason. Classic is the round-6 winner;
 * Signal and Editorial are the round-7 prototypes.
 */
export const VARIANTS: readonly { slug: VariantSlug; label: string; blurb: string }[] = [
  { slug: "archify-lanes", label: "Lanes", blurb: "The turn as lanes and phases. The round-6 baseline." },
  {
    slug: "archify-signal",
    label: "Signal",
    blurb: "The same drawing, wow-forward: glow on the main path, one finite scan.",
  },
  {
    slug: "archify-editorial",
    label: "Editorial",
    blurb: "The same drawing, as an argument: twelve stops under the sheet, lane owners pinned on screen.",
  },
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
