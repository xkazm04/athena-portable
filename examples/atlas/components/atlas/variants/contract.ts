/**
 * ROUND 5 — three atlas variants behind one switcher, one contract.
 *
 * Every variant is a folder under `variants/<slug>/` exporting a default component that takes
 * exactly these props. The shell (`variants/Shell.tsx`, owned by the blueprint agent) owns the
 * switcher, `?variant=`, localStorage, the nav, the flight, the lens and the L2 pane; a variant
 * owns everything inside its stage: layout, camera, bands, views, legend, story. A variant never
 * imports from a sibling variant folder.
 *
 * The three slugs and what each tests:
 *   blueprint — round 4 evolved: same sheet, tighter L1 framing, obstacle-aware runs, archify's
 *               legend-with-counts and story dimming grafted onto the blueprint grammar.
 *   archify   — the archify visual language transposed: rounded nodes with icon/title/subtitle
 *               coloured by kind, dashed group boundaries with corner labels, labelled orthogonal
 *               runs with a style per edge kind, light and dark, PATH / MAP / LENS toolbar,
 *               guided stories that dim everything but the step, semantic zoom bands on top.
 *   wildcard  — one idea neither of the above would try; the agent names it in DESIGN.md.
 */
import type { ReactNode } from "react";
import type { Focus, Level, ZoomNav } from "@athena/demo-kit/zoom";
import type { useLevelFlight } from "@athena/demo-kit/zoom";

import type { Lens } from "@/data";

export type VariantSlug = "blueprint" | "archify" | "wildcard";

export const VARIANTS: readonly { slug: VariantSlug; label: string; blurb: string }[] = [
  { slug: "blueprint", label: "Blueprint", blurb: "Round 4's sheet, evolved." },
  { slug: "archify", label: "Archify", blurb: "The archify grammar, transposed." },
  { slug: "wildcard", label: "Wildcard", blurb: "One idea the others would not try." },
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
