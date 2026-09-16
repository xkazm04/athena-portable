"use client";

/**
 * THE RUNS: one SVG layer, in the sheet's own coordinates, under the blocks.
 *
 * WHY SVG FOR THE EDGES AND DOM FOR THE BLOCKS, which is the one structural decision round 4 made
 * and round 5 keeps:
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
 * Both live inside ONE transformed element, so the SVG and the block layer share a coordinate
 * system exactly and no run can drift from the port it is drawn to.
 *
 * ROUND 5 ADDS THREE THINGS TO IT, all from the archify study:
 *
 *   THE LABEL AND ITS MASK (§7.7). A run that says `×7` where it crosses the sheet is a run that
 *   has told the reader what it carries without a tooltip, and the opaque rect under it is what
 *   makes that legible over a ruled ground — the mask is not decoration, it is the reason the two
 *   characters can be read at all. The label is screen-space like every other piece of type here
 *   (rule 13), so its `<g>` carries `scale(var(--at-cs))` and its box was reserved in WORLD units
 *   at routing time by `route.ts`, which is why no later run crosses it.
 *
 *   THE STORY TRAIL (§4, §7.11). A second `<path>` over the SAME point array as the authored run,
 *   in its own class, for the legs the story has already travelled. The authored run underneath is
 *   not restyled, not re-routed and not hidden: a derived path is an overlay, always, so that what
 *   the drawing asserts and what the story is saying about it can never be confused.
 *
 *   BEAT STATES AND DIMMING (§4). `data-beat` on a leg and `data-dim` on everything the current
 *   lens, filter or story does not concern. Dimmed, never removed — the rest of the drawing is the
 *   spatial reference that makes the highlighted part mean something.
 */
import { memo } from "react";

import { TEXT, pathOf, textBox } from "./geometry";
import { legBeat } from "./story";
import type { PartRun, Plan, PlanEdge } from "./plan";

export interface RunsProps {
  /** Only `edges` is read; the `<svg>` box and its `viewBox` are the canvas's. */
  plan: Plan;
  /** Component-level runs for the open layer. Empty at L0. */
  parts: readonly PartRun[];
  /** The turn's current stop, 1-based, so the leg arriving at it can be marked. */
  liveStop: number | null;
  /** `packages` hides its runs until the reader asks. */
  hidden: boolean;
  /** Telling the story rather than scrubbing it: everything off the beat recedes. */
  story: boolean;
  /** Run ids the legend's filter or the hover preview has pushed into the background. */
  dimmed: ReadonlySet<string>;
  /** Run ids the one-hop hover preview is lighting. Empty when nothing is hovered. */
  hopped: ReadonlySet<string>;
}

function markerId(kind: string): string {
  return `at-arrow-${kind}`;
}

const MARKERS = ["system", "path", "tether", "part", "live"] as const;

/** The mask and the two or three characters over it. One `<g>`, counter-scaled, nothing else. */
function RunLabel({ edge }: { edge: PlanEdge }) {
  if (!edge.short || !edge.labelAt) return null;
  const box = textBox(edge.short.length);
  return (
    <g
      className="at-run-label"
      data-detail="context"
      data-mode={edge.mode}
      style={{
        transform: `translate(${edge.labelAt.x}px, ${edge.labelAt.y}px) scale(var(--at-cs))`,
      }}
    >
      <rect
        className="at-run-mask"
        x={-box.w / 2}
        y={-box.h / 2}
        width={box.w}
        height={box.h}
        rx={0}
      />
      <text className="at-run-text" x={0} y={0} dominantBaseline="middle" textAnchor="middle">
        {edge.short}
      </text>
    </g>
  );
}

function RunsView({ plan, parts, liveStop, hidden, story, dimmed, hopped }: RunsProps) {
  const at = (liveStop ?? 1) - 1;

  return (
    <g className="at-runs" data-hidden={hidden ? "" : undefined} data-story={story ? "" : undefined}>
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

      {/* Block-to-block runs: what the view's legend calls its runs. Authored, never restyled. */}
      <g className="at-runs-system">
        {plan.edges.map((e: PlanEdge) => {
          const beat = liveStop !== null && e.mode === "path" ? legBeat(e.weight, at) : null;
          return (
            <path
              key={e.id}
              className="at-run"
              data-mode={e.mode}
              data-down={e.run.down ? "" : undefined}
              data-live={e.mode === "path" && liveStop === e.weight ? "" : undefined}
              data-story-beat-state={beat ?? undefined}
              data-dim={dimmed.has(e.id) ? "" : undefined}
              data-hop={hopped.has(e.id) ? "" : undefined}
              data-from={e.from}
              data-to={e.to}
              d={pathOf(e.run.points)}
              markerEnd={`url(#${markerId(
                e.mode === "path" && liveStop === e.weight ? "live" : e.mode,
              )})`}
            />
          );
        })}
      </g>

      {/* THE STORY TRAIL. The same geometry, drawn again on top, owned by the story. */}
      {story ? (
        <g className="at-trail" aria-hidden>
          {plan.edges
            .filter((e) => e.mode === "path" && e.weight <= at + 1)
            .map((e) => (
              <path
                key={`trail:${e.id}`}
                className="at-trail-run"
                data-story-beat-state={legBeat(e.weight, at) ?? undefined}
                d={pathOf(e.run.points)}
              />
            ))}
        </g>
      ) : null}

      {/* Component-to-component runs inside the open layer, and the stubs that leave it. */}
      <g className="at-runs-part">
        {parts.map((r) => (
          <path
            key={r.id}
            className="at-run"
            data-mode="part"
            data-kind={r.kind}
            data-leaves={r.leaves ?? undefined}
            data-dim={dimmed.has(r.id) ? "" : undefined}
            data-hop={hopped.has(r.id) ? "" : undefined}
            d={pathOf(r.run.points)}
            markerEnd={`url(#${markerId("part")})`}
          />
        ))}
      </g>

      {/* The labels last, so a mask is over every run and not only over the ones drawn before it. */}
      <g className="at-run-labels" style={{ fontSize: `${TEXT.line}px` }}>
        {plan.edges.map((e) => (
          <RunLabel key={`label:${e.id}`} edge={e} />
        ))}
      </g>
    </g>
  );
}

export const Runs = memo(RunsView);
