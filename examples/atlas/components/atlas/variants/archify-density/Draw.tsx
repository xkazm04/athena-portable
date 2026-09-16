"use client";

/**
 * WHAT IS DRAWN IN THE WORLD: the two frames, the twelve nodes, the fourteen runs.
 *
 * ARCHIFY'S NODE ANATOMY, CLAUSE BY CLAUSE (study §2; part 2 §2 is the list of what round 5 got
 * wrong and each fix is here):
 *
 *   · fixed 140 × 60, rx 6, stroke 1.5     — round 5 fitted widths and drew 378 × 214 boxes
 *   · an opaque mask under the box          — so a run passing close never shows through it
 *   · an 11-unit stroked sigil at (6, 6)    — instead of a 24-unit title strip
 *   · label 11/600, centred, shrink-to-fit with a floor of 8, REJECT rather than ellipsis
 *   · sublabel 9, muted, under the label    — `data-detail="context"`
 *   · tag 7, bottom-centre, in the kind accent — `data-detail="fine"`; round 5 put it top-right,
 *     where it fought the sigil
 *   · NO GHOST CELLS. A node never opens here, so there is nothing for a ghost to promise. The
 *     components it absorbed are in the sublabel, the tag and the cards, which is the sanctioned
 *     form: text, not more boxes.
 *
 * ONE HTML ELEMENT PER NODE, not an SVG group, because a node is a BUTTON: focusable, named, Enter
 * opens it, arrows rove between them. The runs and the frames are SVG and CSS underneath; the
 * things a reader operates are DOM controls on top.
 */
import { memo, type CSSProperties } from "react";

import { SIZE, fit, type Boundary, type NodeBox, type Rect } from "./sheet";
import { runPath, type Run } from "./routing";
import { Sigil } from "./Sigil";

const at = (r: Rect): CSSProperties => ({
  transform: `translate(${r.x}px, ${r.y}px)`,
  width: `${r.w}px`,
  height: `${r.h}px`,
});

/**
 * A NODE IS NOT A DRAG HANDLE — a kit gap, not a preference (KIT-GAPS R5-A1, still open).
 * `useCameraRig`'s `onPointerDown` captures the pointer on the canvas, and a captured pointer
 * retargets the subsequent `click` to the capturing element, so a node's `onClick` never fires.
 * The camera still pans from the paper, the gutters and the inside of both frames.
 */
const holdPointer = (event: { stopPropagation: () => void }) => event.stopPropagation();

/** The size a tier is drawn at, as a `rem` world length. `null` (reject) is never reached — tested. */
const tier = (text: string, which: keyof typeof SIZE): string | undefined => {
  const size = fit(text, which);
  if (size === null || size === SIZE[which]) return undefined;
  return `${size / 16}rem`;
};

/* ------------------------------------------ the frames ---------------------------------------- */

export const Frames = memo(function Frames({
  boundaries,
  lit,
}: {
  boundaries: readonly Boundary[];
  lit: ReadonlySet<string>;
}) {
  return (
    <>
      {boundaries.map((b) => (
        <div
          key={b.id}
          className="ad-frame"
          data-kind={b.kind}
          data-lit={lit.has(b.id) ? "" : undefined}
          style={at(b)}
          aria-hidden
        >
          <span className="ad-frame-label">
            <span>{b.label}</span>
            <span className="ad-frame-note" data-detail="context">
              {b.note}
            </span>
          </span>
        </div>
      ))}
    </>
  );
});

/* ------------------------------------------- the node ----------------------------------------- */

export type Intent = "focus" | "hover" | "lens" | undefined;

export const Node = memo(function Node({
  node,
  open,
  intent,
  dim,
  lit,
  onOpen,
  onHover,
}: {
  node: NodeBox;
  /** The reader is inside this node's layer band. */
  open: boolean;
  intent: Intent;
  dim: boolean;
  lit: boolean;
  onOpen: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const t = node.text;
  return (
    <div
      className="ad-node"
      data-node-id={node.id}
      data-node-kind={node.kind}
      data-status={node.status}
      data-trust={node.trust ? "" : undefined}
      data-open={open ? "" : undefined}
      data-intent={intent}
      data-dim={dim ? "" : undefined}
      data-lit={lit ? "" : undefined}
      data-roving=""
      style={at(node)}
      tabIndex={0}
      role="button"
      aria-label={`${t.label} — ${t.sublabel}, ${t.tag}. ${node.components.length} components.`}
      onPointerDown={holdPointer}
      onClick={() => onOpen(node.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(node.id);
        }
      }}
      onPointerEnter={() => onHover(node.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(node.id)}
      onBlur={() => onHover(null)}
    >
      <span className="ad-mask" aria-hidden />
      <Sigil kind={node.kind} />
      <span className="ad-label" style={{ fontSize: tier(t.label, "label") }}>
        {t.label}
      </span>
      <span className="ad-sub" data-detail="context" style={{ fontSize: tier(t.sublabel, "sub") }}>
        {t.sublabel}
      </span>
      <span className="ad-tag" data-detail="fine" style={{ fontSize: tier(t.tag, "tag") }}>
        {t.tag}
      </span>
    </div>
  );
});

/* ------------------------------------------- the runs ----------------------------------------- */

/**
 * The four markers, declared once. Archify's are 10 × 7 with `refX 9` (part 2 §2: round 5's were
 * 7 × 7, which is why the arrowheads read as dots).
 */
export function RunMarkers() {
  return (
    <defs>
      {(["default", "emphasis", "security", "dashed"] as const).map((style) => (
        <marker
          key={style}
          id={`ad-arrow-${style}`}
          className="ad-marker"
          data-style={style}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="10"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 1.2L9.5 5 0 8.8z" />
        </marker>
      ))}
    </defs>
  );
}

export const Runs = memo(function Runs({
  runs,
  near,
  derived,
}: {
  runs: readonly Run[];
  /** Node ids the reader is pointing at — a run touching one is a one-hop preview. */
  near: ReadonlySet<string>;
  /** Run ids README §3.2 asserts and no module edge carries. Drawn dotted, and counted. */
  derived: ReadonlySet<string>;
}) {
  const dimming = near.size > 0;
  return (
    <g className="ad-runs">
      {runs.map((run) => {
        const touching = near.has(run.from) || near.has(run.to);
        return (
          <g
            key={run.id}
            className="ad-run"
            data-style={run.style}
            data-edge-from={run.from}
            data-edge-to={run.to}
            data-family={run.family}
            data-derived={derived.has(run.id) ? "" : undefined}
            data-dim={dimming && !touching ? "" : undefined}
          >
            <path
              className="ad-run-line"
              d={runPath(run.points)}
              markerEnd={`url(#ad-arrow-${run.style})`}
            />
            <g className="ad-run-label">
              <rect
                className="ad-run-mask"
                x={run.label.x}
                y={run.label.y}
                width={run.label.w}
                height={run.label.h}
                rx="3"
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
