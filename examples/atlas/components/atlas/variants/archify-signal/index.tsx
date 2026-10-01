"use client";

/**
 * ARCHIFY-SIGNAL — the turn in lanes, wow-forward finish. Round 7.
 *
 * WHAT THIS VARIANT TESTS. The same twelve nodes, the same camera, the same tools. The main
 * path is the brightest thing in the room: kind-coloured glow on the spine, a deeper ground,
 * a radial wash, and one finite scan that parks itself. The still frame has to carry the
 * whole meaning (study §7.9); the scan is a one-shot, never a loop, and reduced motion skips
 * it. If a reader can still name the happy path and the one exception in under fifteen
 * seconds, the wow did not cost the solution.
 */
import type { VariantMeta, VariantProps } from "../contract";

import { LanesDrawing, VIEWS } from "@/components/atlas/lanes";

export const meta: VariantMeta = { slug: "archify-signal", views: [...VIEWS] };

export default function ArchifySignal(props: VariantProps) {
  return <LanesDrawing {...props} preset="signal" />;
}
