"use client";

/**
 * THE RUNS: one SVG layer, in the sheet's own coordinates, under the blocks.
 *
 * WHY SVG FOR THE EDGES AND DOM FOR THE BLOCKS, which is the one structural decision of this
 * round and is worth stating plainly.
 *
 *   · A block is TEXT AND CONTROLS — a title, a count, sixty-eight focusable parts, an
 *     accessibility tree, a roving tabindex, a hover. In SVG that is `foreignObject`, which is a
 *     different layout box in every engine and drops focus rings on two of them; in the DOM it is
 *     a `<button>`.
 *   · A run is a POLYLINE WITH A MARKER. In the DOM that is four positioned rectangles per edge
 *     and a triangle made of borders — a hundred and twenty edges is five hundred elements — and
 *     the arrowhead cannot follow the last segment's direction without arithmetic per edge. In SVG
 *     it is one `<path>` and `marker-end`.
 *
 * So both, inside ONE transformed element. That is the part that matters: the SVG and the block
 * layer are siblings under `.at-world`, which carries the camera transform, so the two share a
 * coordinate system exactly and no run can drift from the port it is drawn to. Round 3's css3d
 * variant had precisely this bug in reverse — a screen-space SVG over a transformed scene, with no
 * depth and no registration — and it is the reason the hybrid variant existed at all.
 *
 * The `viewBox` is the plan's own bounds, so a `d` string is world units and nothing is scaled
 * twice.
 */
import { memo } from "react";

import { pathOf } from "./geometry";
import type { PartRun, Plan, PlanEdge } from "./plan";

export interface RunsProps {
  /** Only `edges` and `view` are read; the `<svg>` box and its `viewBox` are the canvas's. */
  plan: Plan;
  /** Component-level runs for the open layer. Empty at L0. */
  parts: readonly PartRun[];
  /** The turn's current stop, so the leg arriving at it can be marked. Null outside the turn. */
  liveStop: number | null;
  /** `packages` hides its runs until the reader asks. */
  hidden: boolean;
}

function markerId(kind: string): string {
  return `at-arrow-${kind}`;
}

const MARKERS = ["system", "path", "tether", "part", "live"] as const;

function RunsView({ plan, parts, liveStop, hidden }: RunsProps) {
  return (
    <g className="at-runs" data-hidden={hidden ? "" : undefined}>
      <defs>
        {MARKERS.map((kind) => (
          <marker
            key={kind}
            id={markerId(kind)}
            className="at-arrow"
            data-kind={kind}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0 0 L10 5 L0 10 z" />
          </marker>
        ))}
      </defs>

      {/* Block-to-block runs: what the view's legend calls its runs. */}
      <g className="at-runs-system">
        {plan.edges.map((e: PlanEdge) => (
          <path
            key={e.id}
            className="at-run"
            data-mode={e.mode}
            data-down={e.run.down ? "" : undefined}
            data-live={e.mode === "path" && liveStop === e.weight ? "" : undefined}
            data-from={e.from}
            data-to={e.to}
            d={pathOf(e.run.points)}
            markerEnd={`url(#${markerId(
              e.mode === "path" && liveStop === e.weight ? "live" : e.mode,
            )})`}
          />
        ))}
      </g>

      {/* Component-to-component runs inside the open layer, and the stubs that leave it. */}
      <g className="at-runs-part">
        {parts.map((r) => (
          <path
            key={r.id}
            className="at-run"
            data-mode="part"
            data-kind={r.kind}
            data-leaves={r.leaves ?? undefined}
            d={pathOf(r.run.points)}
            markerEnd={`url(#${markerId("part")})`}
          />
        ))}
      </g>
    </g>
  );
}

export const Runs = memo(RunsView);
