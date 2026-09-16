"use client";

/**
 * WHAT IS DRAWN: lane bands, phase bands, nodes, runs, the trail, the legend.
 *
 * TWO LAYERS AND ONE RULE ABOUT WHICH IS WHICH. The chrome and the runs are SVG, because they are
 * geometry the router measured and nothing operates them. The nodes are HTML BUTTONS on top,
 * because a node is focusable, has a name, opens on Enter and roves under the arrows — and an SVG
 * `<g role="button">` is a worse button in every browser. Interactions read `data-node-id`,
 * `data-role`, `data-edge-from/-to` off the DOM and never a parallel graph, which is archify's §4
 * and the reason the legend, the story and the keyboard compose without knowing about each other.
 *
 * THE NODE ANATOMY IS FIXED (study Part 2 §2, the component-strategy gap the owner named):
 * 130×56, `rx 6`, stroke 1.5, an opaque mask underneath so a run never shows through, an 11-unit
 * stroked sigil top-left, a centred 11/600 label that SHRINKS TO A FLOOR OF 8 and never clips, a
 * 9-unit muted sublabel carrying the components the node absorbed, and a 7-unit tag in the kind
 * accent at the bottom. No title bar, no ghost cells, no fitted width, no ellipsis anywhere.
 *
 * THE LANE AND PHASE CHROME REPLACES EVERY BOUNDARY FRAME. There is not one dashed rectangle
 * around a membership in this drawing: a lane band with a label at its left says who owns the
 * step, a phase band says when it happens, and the amber region dashes that became texture in
 * round 5 are simply gone.
 */
import { memo, type CSSProperties, type KeyboardEvent } from "react";

import { kindOfNode, statusOfNode, type WNode, type Role } from "./workflow";
import { fitTier, rem } from "./text";
import type { LaneBand, NodeBox, PhaseBand, Plan } from "./geometry";
import type { Run } from "./routing";
import { Sigil } from "./Sigil";


const box = (r: { x: number; y: number; w: number; h: number }): CSSProperties => ({
  transform: `translate(${r.x}px, ${r.y}px)`,
  width: `${r.w}px`,
  height: `${r.h}px`,
});

/* ------------------------------------------ the chrome --------------------------------------- */

export const Lanes = memo(function Lanes({ lanes }: { lanes: readonly LaneBand[] }) {
  return (
    <g className="al-lanes" aria-hidden>
      {lanes.map((l) => (
        <g key={l.id} className="al-lane" data-variant={l.variant}>
          <rect className="al-lane-band" x={l.x} y={l.y} width={l.w} height={l.h} rx={8} />
          <line
            className="al-lane-rule"
            x1={l.gutter.x + l.gutter.w + 6}
            y1={l.y + 6}
            x2={l.gutter.x + l.gutter.w + 6}
            y2={l.y + l.h - 6}
          />
          <text className="al-lane-ord" x={l.gutter.x} y={l.y + l.h / 2 - 8}>
            {l.ord}
          </text>
          <text className="al-lane-label" x={l.gutter.x} y={l.y + l.h / 2 + 8}>
            {l.label.length > 9 ? l.label.split(" ")[0] : l.label}
          </text>
          {l.label.length > 9 ? (
            <text className="al-lane-label" x={l.gutter.x} y={l.y + l.h / 2 + 20}>
              {l.label.split(" ").slice(1).join(" ")}
            </text>
          ) : null}
        </g>
      ))}
    </g>
  );
});

export const Phases = memo(function Phases({
  phases,
  open,
}: {
  phases: readonly PhaseBand[];
  open: string | null;
}) {
  return (
    <g className="al-phases" aria-hidden>
      {phases.map((p) => (
        <g
          key={p.id}
          className="al-phase"
          data-variant={p.variant}
          data-open={open === p.id ? "" : undefined}
        >
          <rect className="al-phase-band" x={p.x} y={p.y} width={p.w} height={p.h} rx={10} />
          <rect
            className="al-phase-head"
            x={p.header.x}
            y={p.header.y}
            width={p.header.w}
            height={p.header.h}
            rx={6}
          />
          <text className="al-phase-label" x={p.x + p.w / 2} y={p.header.y + 18}>
            {p.label}
          </text>
        </g>
      ))}
    </g>
  );
});

/* ------------------------------------------- the runs ---------------------------------------- */

const ROLE_ORDER: readonly Role[] = ["branch", "async", "return", "error", "main"];

export function RunMarkers() {
  return (
    <defs>
      {ROLE_ORDER.map((role) => (
        <marker
          key={role}
          id={`al-arrow-${role}`}
          className="al-marker"
          data-role={role}
          viewBox="0 0 10 7"
          refX="9"
          refY="3.5"
          markerWidth="10"
          markerHeight="7"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 3.5 0 7z" />
        </marker>
      ))}
    </defs>
  );
}

export interface RunsProps {
  runs: readonly Run[];
  /** Node ids the reader is pointing at — a run touching one is a one-hop preview. */
  near: ReadonlySet<string>;
  /** Run ids the story or a filter reveals; `null` is "everything at full strength". */
  revealed: ReadonlySet<string> | null;
}

/**
 * Runs are drawn in role order with `main` LAST, so the turn's spine is the line on top.
 *
 * Archify marks eight of twelve connections `emphasis` on its own architecture example; the
 * round-5 sheet marked none, which study Part 2 §2 lists as a named divergence. Here the emphasis
 * is not a decoration on a relationship, it is the answer to "which of these is the turn".
 */
export const Runs = memo(function Runs({ runs, near, revealed }: RunsProps) {
  const ordered = [...runs].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
  );
  return (
    <g className="al-runs">
      {ordered.map((run) => {
        const lit = near.has(run.from) || near.has(run.to);
        const dim = revealed !== null && !revealed.has(run.id) && !lit;
        return (
          <g
            key={run.id}
            className="al-run"
            data-role={run.role}
            data-edge-from={run.from}
            data-edge-to={run.to}
            data-near={lit ? "" : undefined}
            data-dim={dim ? "" : undefined}
          >
            <path className="al-run-line" d={run.d} markerEnd={`url(#al-arrow-${run.role})`} />
            {run.label.shown ? (
              <g
                className="al-run-label"
                /* THE FIFTEEN-SECOND READ IS THE HAPPY PATH, THE EXCEPTION AND THE WAY HOME, so
                   those three roles keep their labels at every distance; a branch and the ledger
                   write are detail, and L1 is where detail belongs (study §4, the detail tiers). */
                data-detail={run.role === "branch" || run.role === "async" ? "fine" : "context"}
              >
                <rect
                  className="al-run-mask"
                  x={run.label.x}
                  y={run.label.y}
                  width={run.label.w}
                  height={run.label.h}
                  rx={3}
                />
                <text x={run.label.x + run.label.w / 2} y={run.label.y + run.label.h - 4}>
                  {run.label.text}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
});

/* ------------------------------------------ the trail ---------------------------------------- */

export interface TrailSegment {
  id: string;
  d: string;
  authored: boolean;
  state: "past" | "active" | "next";
}

export interface TrailMark {
  id: string;
  x: number;
  y: number;
  n: number;
  state: "past" | "active" | "next";
}

/**
 * The Story Trail: drawn ON the authored run, never instead of it (study §7.11).
 *
 * The authored edge keeps its own role style underneath; the trail adds one stroke in its own
 * colour, dashed where README asserts a hop the lane grid does not carry. Beats carry
 * `data-story-beat-state`, which is the whole of the static frame's meaning under reduced motion:
 * numbered stops, three legible states, nothing that has to play.
 */
export const Trail = memo(function Trail({
  segments,
  marks,
}: {
  segments: readonly TrailSegment[];
  marks: readonly TrailMark[];
}) {
  return (
    <g className="al-trail" aria-hidden>
      {segments.map((s) => (
        <path
          key={s.id}
          className="al-trail-line"
          d={s.d}
          data-authored={s.authored ? "" : undefined}
          data-story-beat-state={s.state}
        />
      ))}
      {marks.map((m) => (
        <g key={m.id} className="al-trail-mark" data-story-beat-state={m.state}>
          <circle cx={m.x} cy={m.y} r={9} />
          <text x={m.x} y={m.y + 3.5}>
            {m.n}
          </text>
        </g>
      ))}
    </g>
  );
});

/* ------------------------------------------ the legend --------------------------------------- */

/** The 9-unit monospace advance the legend measures its own counts against. */
const LEGEND_ADVANCE = 5.4;

export const ROLE_LEGEND: readonly { role: Role; text: string }[] = [
  { role: "main", text: "the turn" },
  { role: "branch", text: "a side path" },
  { role: "async", text: "written, not awaited" },
  { role: "return", text: "the answer, home" },
  { role: "error", text: "the gate declines" },
];

/**
 * The legend, INSIDE the canvas footprint (study §2: one footprint measurement shared by the
 * view box and the placement, so geometry and validation cannot disagree).
 *
 * Round 5 floated it over the drawing, which study Part 2 §3 lists as one of the things that read
 * cheaper. Here it is drawn in world units under the last lane, so it is part of the sheet, it
 * pans and zooms with it, and the exported frame carries it.
 */
export const Legend = memo(function Legend({
  rect,
  counts,
}: {
  rect: { x: number; y: number; w: number; h: number };
  counts: readonly { role: Role; n: number }[];
}) {
  const pitch = Math.min(206, (rect.w - 96) / ROLE_LEGEND.length);
  return (
    <g className="al-legend" aria-hidden>
      <text className="al-legend-title" x={rect.x + 16} y={rect.y + 22}>
        Legend
      </text>
      {ROLE_LEGEND.map((entry, i) => {
        const x = rect.x + 86 + i * pitch;
        const n = counts.find((c) => c.role === entry.role)?.n ?? 0;
        return (
          <g key={entry.role} className="al-legend-item" data-role={entry.role}>
            <line className="al-legend-line" x1={x} y1={rect.y + 17} x2={x + 30} y2={rect.y + 17} />
            <text className="al-legend-label" x={x + 38} y={rect.y + 21}>
              {entry.text}
            </text>
            <text
              className="al-legend-count"
              x={x + 38 + entry.text.length * LEGEND_ADVANCE + 9}
              y={rect.y + 21}
            >
              {n}
            </text>
          </g>
        );
      })}
    </g>
  );
});

/* ------------------------------------------- the node ---------------------------------------- */

export type Intent = "focus" | "hover" | "story" | "lens" | undefined;

export interface NodeProps {
  node: WNode;
  rect: NodeBox;
  intent: Intent;
  dim: boolean;
  onMain: boolean;
  /** `presenceOf` from the model, as the two properties a level change may animate (rule 7). */
  presence: number;
  onOpen: (id: string) => void;
  onHover: (id: string | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, id: string) => void;
}

/**
 * A NODE IS NOT A DRAG HANDLE — KIT-GAPS R5-A1, hit again here.
 *
 * `useCameraRig`'s `onPointerDown` captures the pointer on the canvas, and a captured pointer
 * retargets the following `click` to the capturing element, so a node's own `onClick` never fires.
 * The node stops the pointer at itself; the camera still pans from the bands, the gaps and the
 * gutter, which is most of the drawing.
 */
const holdPointer = (event: { stopPropagation: () => void }) => event.stopPropagation();

export const Node = memo(function Node({
  node,
  rect,
  intent,
  dim,
  onMain,
  presence,
  onOpen,
  onHover,
  onKeyDown,
}: NodeProps) {
  const kind = kindOfNode(node);
  return (
    <div
      className="al-node"
      data-node-id={node.id}
      data-component={node.item}
      data-node-kind={kind}
      data-status={statusOfNode(node)}
      data-lane={node.lane}
      data-col={node.col}
      data-phase={rect.phase}
      data-main={onMain ? "" : undefined}
      data-intent={intent}
      data-dim={dim ? "" : undefined}
      style={{ ...box(rect), "--al-present": presence } as CSSProperties}
      tabIndex={0}
      role="button"
      aria-label={`${node.label} — ${node.sublabel}. ${node.note}`}
      onPointerDown={holdPointer}
      onClick={() => onOpen(node.id)}
      onKeyDown={(e) => onKeyDown(e, node.id)}
      onPointerEnter={() => onHover(node.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(node.id)}
      onBlur={() => onHover(null)}
    >
      <Sigil kind={kind} />
      <span className="al-node-label" style={{ fontSize: rem(fitTier(node.label, "label")) }}>
        {node.label}
      </span>
      <span
        className="al-node-sub"
        data-detail="context"
        style={{ fontSize: rem(fitTier(node.sublabel, "sublabel")) }}
      >
        {node.sublabel}
      </span>
      <span
        className="al-node-tag"
        data-detail="fine"
        style={{ fontSize: rem(fitTier(node.tag, "tag")) }}
      >
        {node.tag}
      </span>
    </div>
  );
});

export const planKey = (plan: Plan): string => plan.open ?? "closed";
