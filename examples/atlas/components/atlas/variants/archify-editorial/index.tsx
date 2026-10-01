"use client";

/**
 * ARCHIFY-EDITORIAL — the turn in lanes, clarity-forward finish. Round 7.
 *
 * WHAT THIS VARIANT TESTS. The same twelve nodes. Two things classic hides behind a toggle
 * live on the page: the four lane owners, pinned in screen space so they never leave with the
 * camera (the round-6 carry: L1 frames three of four lanes and the in-world labels drop off),
 * and the twelve stops of README §3.2 as a reading column you can click. The architecture is
 * an argument; the drawing is the illustration. Paper, vermilion, a serif heading, a ruled
 * margin — archify's editorial preset, spent on making the solution readable as prose.
 */
import type { VariantMeta, VariantProps } from "../contract";

import { LanesDrawing, VIEWS } from "@/components/atlas/lanes";

export const meta: VariantMeta = { slug: "archify-editorial", views: [...VIEWS] };

export default function ArchifyEditorial(props: VariantProps) {
  return <LanesDrawing {...props} preset="editorial" />;
}
