/**
 * ROUND 6 — the archify variant, and the two that come out of it, behind one switcher.
 *
 * Every variant is a folder under `variants/<slug>/` exporting a default component that takes
 * exactly these props. The shell (`variants/Shell.tsx`) owns the switcher, `?variant=`,
 * localStorage, the nav, the flight, the lens and the L2 pane; a variant owns everything inside
 * its stage: layout, camera, bands, views, legend, story. A variant never imports from a sibling
 * variant folder.
 *
 * ROUND 5 PUT THREE DRAWINGS ON THE TABLE AND THE OWNER CHOSE ONE. `blueprint` (round 4's ruled
 * sheet, evolved) and `wildcard` (the 68x68 structure matrix) are deleted; the verdict was that
 * "the degradation from visual archify is significant in grouping, component strategy and style",
 * so the archify grammar is the baseline every further variant is measured against and the other
 * two drawings are not worth carrying. DESIGN.md §R5.3 keeps the reasoning; KIT-GAPS.md keeps
 * everything the three of them found.
 *
 * THE SWITCHER MECHANISM SURVIVES THE DELETION, on purpose. Two more archify-derived variants are
 * coming, and the shell is built and shipped before they exist — which is exactly the condition
 * the lazy template import and the "not built yet" placeholder were written for. The two slugs
 * below name folders that do not exist yet; `?variant=archify-density` renders the placeholder and
 * the app keeps running.
 *
 * The three slugs and what each tests:
 *   archify         — the archify visual language transposed: rounded nodes with icon/title/subtitle
 *                     coloured by kind, dashed group boundaries with corner labels, labelled
 *                     orthogonal runs with a style per edge kind, light and dark, PATH / MAP / LENS
 *                     toolbar, guided stories that dim everything but the step, semantic zoom bands.
 *                     The baseline, and the default.
 *   archify-density — coming: hard abstraction, cards. How few nodes a sheet can carry, and the
 *                     node as a fixed unit whose text tiers absorb what sub-nodes used to.
 *   archify-lanes   — coming: the turn as lanes and phases. The twelve-stop turn as the drawing's
 *                     primary axis rather than an overlay on a spatial map.
 */
import type { ReactNode } from "react";
import type { Focus, Level, ZoomNav } from "@athena/demo-kit/zoom";
import type { useLevelFlight } from "@athena/demo-kit/zoom";

import type { Lens } from "@/data";

export type VariantSlug = "archify" | "archify-density" | "archify-lanes";

/** The first entry is the DEFAULT — the shell falls back to it and the mast draws it first. */
export const VARIANTS: readonly { slug: VariantSlug; label: string; blurb: string }[] = [
  { slug: "archify", label: "Archify", blurb: "The archify grammar, transposed." },
  { slug: "archify-density", label: "Density", blurb: "coming: hard abstraction, cards" },
  { slug: "archify-lanes", label: "Lanes", blurb: "coming: the turn as lanes and phases" },
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
