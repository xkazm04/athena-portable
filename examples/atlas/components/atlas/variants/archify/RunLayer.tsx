"use client";

/**
 * THE RUNS, DRAWN — and the overlays that are drawn ON TOP of them rather than instead of them.
 *
 * Archify study §7.11: *"overlays for derived paths; the authored edge is never mutated."* The
 * authored run keeps its own style at all times. A PATH probe and a Story Trail add a second stroke
 * over the same geometry, in their own colour, with their own dash and their own beat state — so a
 * reader can always see that the highlighted thing IS the edge the model declares, and a derived
 * hop the model does NOT declare is visibly different (dotted, and counted in the receipt).
 *
 * ARROWHEADS ARE MARKERS, one per style, because a marker inherits the path's own colour through
 * `context-stroke` where it is supported and falls back to the style's variable where it is not;
 * a hand-drawn triangle at the end of a path has to be re-computed on every reroute.
 *
 * EVERY LABEL HAS AN OPAQUE MASK (study §7.7) and the mask is the rectangle the ROUTER reserved —
 * the same numbers, so what a later route was told to avoid is exactly what a reader sees.
 */
import { memo } from "react";

import type { Run } from "./routing";
import { runPath } from "./routing";

export interface RunsProps {
  runs: readonly Run[];
  /** Run ids the LENS reveals. `null` means "no lens: everything is at full strength". */
  revealed: ReadonlySet<string> | null;
  /** Node ids the reader is pointing at — a run touching one is a one-hop preview. */
  near: ReadonlySet<string>;
  hidden: boolean;
}

/** The four markers, declared once. */
export function RunMarkers() {
  return (
    <defs>
      {(["default", "emphasis", "security", "dashed"] as const).map((style) => (
        <marker
          key={style}
          id={`ar-arrow-${style}`}
          className="ar-marker"
          data-style={style}
          viewBox="0 0 10 10"
          refX="8.5"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 1.2L9 5 0 8.8z" />
        </marker>
      ))}
    </defs>
  );
}

export const Runs = memo(function Runs({ runs, revealed, near, hidden }: RunsProps) {
  return (
    <g className="ar-runs" data-hidden={hidden ? "" : undefined}>
      {runs.map((run) => {
        const lit = near.has(run.from) || near.has(run.to);
        const dim = revealed !== null && !revealed.has(run.id) && !lit;
        return (
          <g
            key={run.id}
            className="ar-run"
            data-style={run.style}
            data-edge-from={run.from}
            data-edge-to={run.to}
            data-family={run.family}
            data-dim={dim ? "" : undefined}
            data-revealed={revealed !== null && !dim ? "" : undefined}
            data-near={lit ? "" : undefined}
          >
            <path
              className="ar-run-line"
              d={runPath(run.points)}
              markerEnd={`url(#ar-arrow-${run.style})`}
            />
            <g className="ar-run-label" data-detail="context">
              <rect
                className="ar-run-mask"
                x={run.label.x}
                y={run.label.y}
                width={run.label.w}
                height={run.label.h}
                rx="2"
              />
              <text x={run.label.x + run.label.w / 2} y={run.label.y + run.label.h * 0.74}>
                {run.label.text}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
});

/* -------------------------------------------- overlays --------------------------------------- */

export interface TrailSegment {
  id: string;
  d: string;
  /** `past | active | next` — archify's beat states at opacity .72 / 1 / .5. */
  state: "past" | "active" | "next";
  /** False when README's turn asserts a hop no module edge carries. Drawn dotted, and counted. */
  authored: boolean;
  index: number;
}

/**
 * The Story Trail. Drawn over the authored runs, never in place of them.
 *
 * A beat is numbered on the drawing, because the argument the turn makes is an ORDER and an order
 * that is only legible while it animates is not legible at all (round 3's finding, kept).
 */
export const Trail = memo(function Trail({
  segments,
  marks,
}: {
  segments: readonly TrailSegment[];
  marks: readonly { id: string; x: number; y: number; n: number; state: TrailSegment["state"] }[];
}) {
  return (
    <g className="ar-trail" aria-hidden>
      {segments.map((s) => (
        <path
          key={s.id}
          className="ar-trail-line"
          data-story-beat-state={s.state}
          data-authored={s.authored ? "" : undefined}
          d={s.d}
        />
      ))}
      {marks.map((m) => (
        <g key={m.id} className="ar-beat" data-story-beat-state={m.state}>
          <circle cx={m.x} cy={m.y} r="11" />
          <text x={m.x} y={m.y + 3.6}>
            {m.n}
          </text>
        </g>
      ))}
    </g>
  );
});

/** The PATH overlay: the same geometry as the authored run, one weight heavier, in its own colour. */
export const PathOverlay = memo(function PathOverlay({
  segments,
}: {
  segments: readonly { id: string; d: string; authored: boolean }[];
}) {
  return (
    <g className="ar-probe" aria-hidden>
      {segments.map((s) => (
        <path key={s.id} className="ar-probe-line" data-authored={s.authored ? "" : undefined} d={s.d} />
      ))}
    </g>
  );
});
