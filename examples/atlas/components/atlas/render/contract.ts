"use client";

/**
 * WHAT A RENDERER IS, AND WHAT IT IS NOT ALLOWED TO DECIDE.
 *
 * Round 3 prototypes three rendering techniques for one machine — webgl, css3d, hybrid — and the
 * owner picks. A comparison is only worth making if the three differ in exactly one thing: how a
 * scene unit becomes a pixel. So everything else is here, upstream of all three:
 *
 *   the model         `@/data`, unchanged since round 2
 *   the geometry      `scene/layout.ts` — planes, blocks, parts, pipes, in scene units
 *   the camera        `scene/rig.ts` — one pose, one set of bands, one `poseFor`
 *   the turn          `scene/turn.ts` + `scene/useTurn.ts` — one beat, one script
 *   the weights       `weightsFor` below — what is present, what is lit, what is on the path
 *   the prose         `machine/Pane.tsx` — the ONLY place a sentence is allowed
 *
 * A renderer receives `SceneProps` and draws. It may not read `@/data` for anything the layout
 * did not already resolve, may not invent a position, and may not hold the camera.
 *
 * WHY A SWITCHER AT ALL. Because the owner asked to see all three live rather than read three
 * descriptions of them, which is the same decision tidycrm's L0 switcher records — and, like
 * that one, this control is TEMPORARY FURNITURE. Two of the three go after the review.
 */
import { emphasis, type Focus } from "@athena/demo-kit/zoom";

import type { Lens } from "@/data";

import { SCENE, blockAt, type Block, type Part, type Stratum } from "../scene/layout";
import type { CameraRig } from "../scene/rig";
import type { Transport } from "../scene/useTurn";

/* ------------------------------------ the three ------------------------------------ */

export const RENDER_VARIANTS = ["webgl", "css3d", "hybrid"] as const;
export type RenderVariant = (typeof RENDER_VARIANTS)[number];

export const isRenderVariant = (v: unknown): v is RenderVariant =>
  typeof v === "string" && (RENDER_VARIANTS as readonly string[]).includes(v);

export const RENDER_LABEL: Record<RenderVariant, string> = {
  webgl: "WebGL",
  css3d: "CSS 3D",
  hybrid: "Hybrid",
};

/** One line each, shown under the switch. What the reader is looking at, not how it is built. */
export const RENDER_NOTE: Record<RenderVariant, string> = {
  webgl: "Everything is geometry. Volume, depth and a travelling light; labels are drawn in the scene.",
  css3d: "Everything is a box. Real text you can select, the pipes in one SVG, the turn a marker on a path.",
  hybrid: "Geometry for the machine, the document for the words: labels ride the camera as DOM.",
};

/* ------------------------------------ the weights ------------------------------------ */

/**
 * What a renderer draws a thing WITH: how present it is, whether the lens lights it, and whether
 * the turn is on it. Three channels, and a renderer maps them onto its own vocabulary — opacity
 * and emissive in webgl, opacity and rule weight in css3d.
 */
export interface Weight {
  /** 0..1 from the kit's `emphasis()`. Rule 7: presence comes from the model. */
  presence: number;
  /** The chosen concept lights this. The one accent on the surface. */
  lit: boolean;
  /** The turn's script passes through here. */
  onTurn: boolean;
  /** The light is here RIGHT NOW. At most one block and one part at a time. */
  live: boolean;
  /** Open: the stratum being read at L1, or the part being read at L2. */
  open: boolean;
  /** Under the pointer or keyboard focus. */
  hot: boolean;
}

export interface Weights {
  stratum: (s: Stratum) => Weight;
  block: (b: Block) => Weight;
  part: (p: Part) => Weight;
}

const REST: Weight = {
  presence: 1,
  lit: false,
  onTurn: false,
  live: false,
  open: false,
  hot: false,
};

/**
 * One derivation of the three channels, for every renderer.
 *
 * THE MIDDLE TIER IS DERIVED, NOT MODELLED. `emphasis(focus, group, item)` knows two tiers and
 * Atlas has three (stratum → block → part), so a block's presence is the strongest presence
 * among its parts, floored at the stratum's own. That is a decision this app had to make because
 * the kit's model cannot express it — round-2 KIT-GAPS #9, still open, and now the machine makes
 * it visible: a block whose parts have all receded should stand back, and a receding block that
 * still holds a lit part should not take its part down with it.
 */
export function weightsFor(args: {
  focus: Focus;
  lens: Lens;
  liveBlock: string | null;
  livePart: string | null;
  turnBlocks: ReadonlySet<string>;
  turnParts: ReadonlySet<string>;
  hover: string | null;
}): Weights {
  const { focus, lens, liveBlock, livePart, turnBlocks, turnParts, hover } = args;

  const partW = (p: Part): Weight => {
    const block = blockAt(p.block);
    const layer = block?.layer ?? "";
    return {
      presence: emphasis(focus, layer, p.id),
      lit: lens.components.has(p.id),
      onTurn: turnParts.has(p.id),
      live: livePart === p.id,
      open: focus.item === p.id,
      hot: hover === p.id,
    };
  };

  return {
    stratum: (s) => ({
      ...REST,
      presence: emphasis(focus, s.id, null),
      lit: lens.layers.has(s.id),
      open: focus.group === s.id && focus.level > 0,
      hot: hover === s.id,
    }),
    block: (b) => {
      const parts = b.parts;
      const floor = emphasis(focus, b.layer, null);
      const strongest = parts.reduce((m, p) => Math.max(m, emphasis(focus, b.layer, p.id)), 0);
      return {
        presence: Math.max(floor, strongest),
        lit: lens.systems.has(b.id),
        onTurn: turnBlocks.has(b.id),
        live: liveBlock === b.id,
        open: focus.group === b.layer && focus.level > 0,
        hot: hover === b.id,
      };
    },
    part: partW,
  };
}

/* ------------------------------------ the props ------------------------------------ */

/** What every renderer is handed. Nothing in it is optional and nothing in it is a decision. */
export interface SceneProps {
  rig: CameraRig;
  transport: Transport;
  focus: Focus;
  lens: Lens;
  weights: Weights;
  hover: string | null;
  onHover: (id: string | null) => void;
  /** Open a stratum (L1). The renderer calls it on a plane or a block; the nav does the rest. */
  onOpenStratum: (id: string) => void;
  /** Open a part (L2). */
  onOpenPart: (id: string) => void;
  reduced: boolean;
  /** Which pieces of the machine exist at all right now — the scene is the same, the cut is not. */
  scene: typeof SCENE;
}
