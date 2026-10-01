"use client";

/**
 * ARCHIFY-LANES — the turn in lanes, classic finish. Round 6's winner, round 7's baseline.
 *
 * THE DRAWING LIVES IN `Drawing.tsx`. This file is the mount the shell's lazy import resolves:
 * the same engine the Signal and Editorial variants mount, with `preset="classic"`. Geometry,
 * routing, poses and tools did not change; round 7's question is the finish, and this is the
 * one the owner already chose.
 */
import type { VariantMeta, VariantProps } from "../contract";

import LanesDrawing, { VIEWS } from "./Drawing";

export const meta: VariantMeta = { slug: "archify-lanes", views: [...VIEWS] };

export default function ArchifyLanes(props: VariantProps) {
  return <LanesDrawing {...props} preset="classic" />;
}

export { EDGE_LABELS, GROUPS, VIEWS } from "./Drawing";
