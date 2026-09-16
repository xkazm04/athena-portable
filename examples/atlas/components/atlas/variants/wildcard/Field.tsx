"use client";

/**
 * THE FIELD — 68 rows, 68 columns, one mark per relationship, drawn in world space.
 *
 * ONE ELEMENT CARRIES THE CAMERA and it is written straight onto `style` from `rig.subscribe`,
 * never through React state: this subtree is ~450 nodes and sixty renders a second of it is the
 * motion-cost score round 1 paid for. The same subscription writes `--wc-cs`, the quantised
 * inverse of the zoom (rule 13), which only the kind glyphs and the aggregates' figures spend —
 * every LABEL on this surface lives in the rails, in screen space, and never counter-scales at
 * all. Moving the headers out of the world is what buys that.
 *
 * WHAT IS DRAWN AT WHICH BAND, bottom of the stack to top:
 *
 *   always   the fine grid, the diagonal, the six layer blocks, the fifteen hatched zones that
 *            must stay empty, and all 120 marks. The field is never a different drawing.
 *   band 0   the 6 x 6 grain: layer-pair blocks filled by how much crosses between them, with
 *            the figure printed. The reader sees the shape of the architecture, not its parts.
 *   band 1   the 19 x 19 grain, and the open layer's row band and column band tinted.
 *   band 2   the kind glyph inside every mark, and the crosshair on one component's row and
 *            column — which is the whole reading at L2: what it asks of, and what asks it.
 *
 * HAIRLINES ARE SVG WITH `vector-effect="non-scaling-stroke"`. A rule drawn as a DOM element
 * inside a scaled ancestor is 0.3 px at the far band and 3 px at the near one; the browser's own
 * answer to that is one attribute, and it means the grid is exactly as fine at every distance.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { poseToTransform } from "@athena/demo-kit/zoom";
import type { Focus } from "@athena/demo-kit/zoom";

import type { EdgeKind } from "@/data";

import {
  FIELD,
  LAYER_CELLS,
  LAYER_SPANS,
  M,
  MARKS,
  N,
  SPAN,
  SYSTEM_CELLS,
  SYSTEM_SPANS,
  UPWARD_ZONES,
  blockRect,
  cellRect,
  indexOf,
  layerSpan,
  markAt,
  type Mark,
  type Rect,
} from "./matrix";
import { quantise } from "./poses";
import type { MatrixCamera } from "./useMatrixCamera";

/** What the reader is pointing at. A mark points at two components; a rail entry at one. */
export type Hover =
  | { kind: "mark"; row: number; col: number }
  | { kind: "axis"; index: number }
  | null;

/** One letter per edge kind, so the near band says WHICH relationship without a tooltip. */
export const KIND_GLYPH: Record<EdgeKind, string> = {
  calls: "c",
  implements: "i",
  gates: "g",
  streams: "s",
  reads: "r",
};

export interface FieldProps {
  camera: MatrixCamera;
  focus: Focus;
  /** The component ids the lens lights. The plaid is drawn from this and nothing else. */
  lit: ReadonlySet<string>;
  hover: Hover;
  onHover: (hover: Hover) => void;
  onOpenPart: (id: string) => void;
  /** Called with the element standing for the open component, so the pane can grow out of it. */
  anchor: (el: HTMLElement | null) => void;
}

const px = (n: number) => `${n}px`;

const boxOf = (r: Rect): CSSProperties => ({
  left: px(r.x),
  top: px(r.y),
  width: px(r.w),
  height: px(r.h),
});

export function Field({ camera, focus, lit, hover, onHover, onOpenPart, anchor }: FieldProps) {
  const worldRef = useRef<HTMLDivElement | null>(null);
  const { rig } = camera;

  /* The camera, on one element, outside React. `subscribe` fires once immediately, so there is no
     initial-paint special case. */
  const lastScale = useRef(0);
  useEffect(
    () =>
      rig.subscribe((pose) => {
        const el = worldRef.current;
        if (!el) return;
        el.style.transform = poseToTransform(pose);
        const q = quantise(pose.zoom);
        if (q !== lastScale.current) {
          lastScale.current = q;
          el.style.setProperty("--wc-cs", String(Math.round((1 / q) * 1000) / 1000));
        }
      }),
    [rig],
  );

  const focusRow = focus.level === 2 ? indexOf(focus.item) : -1;
  const openLayer = focus.level >= 1 ? layerSpan(focus.group) : null;

  /**
   * THE ONE-HOP PREVIEW, as two sets of axis indices.
   *
   * A mark is a pair, so pointing at one lights BOTH of its components — the row of the module
   * that asks and the column of the module asked. A rail entry is one component, so it lights its
   * own row and its own column, which on this field is the whole of "what it touches". One hop
   * and no further: the archify study's rule, and the reason this never becomes a reachability
   * highlight nobody can read the end of.
   */
  const { hotRows, hotCols, hotMark } = useMemo(() => {
    const rows = new Set<number>();
    const cols = new Set<number>();
    let mark: Mark | null = null;
    if (hover?.kind === "mark") {
      mark = markAt(hover.row, hover.col);
      rows.add(hover.row);
      cols.add(hover.col);
      rows.add(hover.col);
      cols.add(hover.row);
    } else if (hover?.kind === "axis") {
      rows.add(hover.index);
      cols.add(hover.index);
    }
    return { hotRows: rows, hotCols: cols, hotMark: mark };
  }, [hover]);

  const litRows = useMemo(() => {
    const rows: number[] = [];
    for (const id of lit) {
      const i = indexOf(id);
      if (i >= 0) rows.push(i);
    }
    return rows.sort((a, b) => a - b);
  }, [lit]);

  const onLeave = useCallback(() => onHover(null), [onHover]);

  const enterMark = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const el = event.currentTarget;
      const row = Number(el.dataset.row);
      const col = Number(el.dataset.col);
      if (Number.isFinite(row) && Number.isFinite(col)) onHover({ kind: "mark", row, col });
    },
    [onHover],
  );

  const clickMark = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const from = event.currentTarget.dataset.from;
      if (from) onOpenPart(from);
    },
    [onOpenPart],
  );

  return (
    /*
     * THE ONE ELEMENT WITH A TRANSFORM, and it is ZERO-SIZED. `.wc-world` is a point at the middle
     * of the frame, so its default `transform-origin` IS the point `zoomAt` solves about, and every
     * child is placed at its own world coordinate with no origin element in between. Round 4
     * needed a second element for that because its sheet was laid out from a corner; the field is
     * laid out from its centre, so the reconciliation is already done in `matrix.ts`.
     */
    <div className="wc-world" ref={worldRef} onPointerLeave={onLeave}>
      <div className="wc-plate" style={boxOf(FIELD)} aria-hidden />
      <div className="wc-field" aria-hidden>
        {/* ------------------------------------------------- the zones that must stay empty -- */}
        {UPWARD_ZONES.map((z) => (
          <div
            key={z.id}
            className="wc-zone"
            data-breached={z.count > 0 ? "" : undefined}
            style={boxOf(z.rect)}
          />
        ))}

        {/* --------------------------------------------------------------- the lens's plaid -- */}
        {litRows.map((i) => (
          <div key={`lr:${i}`} className="wc-lit wc-lit-row" style={boxOf(rowStrip(i))} />
        ))}
        {litRows.map((i) => (
          <div key={`lc:${i}`} className="wc-lit wc-lit-col" style={boxOf(colStrip(i))} />
        ))}

        {/* ------------------------------------------------------------ the open layer's cross -- */}
        {openLayer ? (
          <>
            <div
              className="wc-open wc-open-row"
              style={boxOf(rowStrip(openLayer.start, openLayer.count))}
            />
            <div
              className="wc-open wc-open-col"
              style={boxOf(colStrip(openLayer.start, openLayer.count))}
            />
          </>
        ) : null}

        {/* ---------------------------------------------------------------- the two grains -- */}
        {LAYER_CELLS.map((agg) => (
          <div
            key={agg.id}
            className="wc-agg wc-agg-layer"
            data-sense={agg.sense}
            style={{ ...boxOf(agg.rect), "--wc-a": 0.18 + agg.weight * 0.82 } as CSSProperties}
          >
            <span className="wc-fig">{agg.count}</span>
          </div>
        ))}
        {SYSTEM_CELLS.map((agg) => (
          <div
            key={agg.id}
            className="wc-agg wc-agg-system"
            data-sense={agg.sense}
            style={{ ...boxOf(agg.rect), "--wc-a": 0.2 + agg.weight * 0.8 } as CSSProperties}
          >
            <span className="wc-fig">{agg.count}</span>
          </div>
        ))}

        {/* -------------------------------------------------------- the six layer blocks -- */}
        {LAYER_SPANS.map((span) => (
          <div
            key={`blk:${span.id}`}
            className="wc-block"
            data-open={openLayer?.id === span.id ? "" : undefined}
            style={boxOf(blockRect(span))}
          />
        ))}

        {/* ------------------------------------------------------------------- the rules -- */}
        <svg
          className="wc-rules"
          width={SPAN}
          height={SPAN}
          viewBox={`${FIELD.x} ${FIELD.y} ${SPAN} ${SPAN}`}
          style={boxOf(FIELD)}
          focusable="false"
          aria-hidden
        >
          <g className="wc-grid-fine">
            {Array.from({ length: N + 1 }, (_, i) => (
              <line
                key={`gv:${i}`}
                x1={FIELD.x + i * M.cell}
                y1={FIELD.y}
                x2={FIELD.x + i * M.cell}
                y2={FIELD.y + SPAN}
              />
            ))}
            {Array.from({ length: N + 1 }, (_, i) => (
              <line
                key={`gh:${i}`}
                x1={FIELD.x}
                y1={FIELD.y + i * M.cell}
                x2={FIELD.x + SPAN}
                y2={FIELD.y + i * M.cell}
              />
            ))}
          </g>
          <g className="wc-grid-system">
            {SYSTEM_SPANS.map((s) => (
              <line
                key={`sv:${s.id}`}
                x1={FIELD.x + s.start * M.cell}
                y1={FIELD.y}
                x2={FIELD.x + s.start * M.cell}
                y2={FIELD.y + SPAN}
              />
            ))}
            {SYSTEM_SPANS.map((s) => (
              <line
                key={`sh:${s.id}`}
                x1={FIELD.x}
                y1={FIELD.y + s.start * M.cell}
                x2={FIELD.x + SPAN}
                y2={FIELD.y + s.start * M.cell}
              />
            ))}
          </g>
          <g className="wc-grid-layer">
            {LAYER_SPANS.map((s) => (
              <line
                key={`lv:${s.id}`}
                x1={FIELD.x + s.start * M.cell}
                y1={FIELD.y}
                x2={FIELD.x + s.start * M.cell}
                y2={FIELD.y + SPAN}
              />
            ))}
            {LAYER_SPANS.map((s) => (
              <line
                key={`lh:${s.id}`}
                x1={FIELD.x}
                y1={FIELD.y + s.start * M.cell}
                x2={FIELD.x + SPAN}
                y2={FIELD.y + s.start * M.cell}
              />
            ))}
            <rect x={FIELD.x} y={FIELD.y} width={SPAN} height={SPAN} className="wc-frame" />
          </g>
          {/* The diagonal: where a row meets its own column, and the line the whole argument is
              read against. Everything right of it runs down the stack. */}
          <line
            className="wc-diagonal"
            x1={FIELD.x}
            y1={FIELD.y}
            x2={FIELD.x + SPAN}
            y2={FIELD.y + SPAN}
          />
        </svg>

        {/* ------------------------------------------------------------------- the marks -- */}
        {MARKS.map((m) => {
          const hot = hotMark?.id === m.id;
          return (
            <div
              key={m.id}
              className="wc-mark"
              data-sense={m.sense}
              data-row={m.row}
              data-col={m.col}
              data-from={m.from}
              data-hot={hot ? "" : undefined}
              data-cross={focusRow >= 0 && (m.row === focusRow || m.col === focusRow) ? "" : undefined}
              data-lit={lit.has(m.from) && lit.has(m.to) ? "" : undefined}
              style={boxOf(cellRect(m.row, m.col))}
              onPointerEnter={enterMark}
              onClick={clickMark}
            >
              <span className="wc-mark-i">
                <span className="wc-mark-g">{m.kinds.map((k) => KIND_GLYPH[k]).join("")}</span>
              </span>
            </div>
          );
        })}

        {/* ------------------------------------------- the hover preview and the crosshair -- */}
        {[...hotRows].map((i) => (
          <div key={`hr:${i}`} className="wc-hot wc-hot-row" style={boxOf(rowStrip(i))} />
        ))}
        {[...hotCols].map((i) => (
          <div key={`hc:${i}`} className="wc-hot wc-hot-col" style={boxOf(colStrip(i))} />
        ))}

        {focusRow >= 0 ? (
          <>
            <div className="wc-cross wc-cross-row" style={boxOf(rowStrip(focusRow))} />
            <div className="wc-cross wc-cross-col" style={boxOf(colStrip(focusRow))} />
            <div
              className="wc-pin"
              ref={anchor}
              data-component={focus.item ?? undefined}
              style={boxOf(cellRect(focusRow, focusRow))}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

const rowStrip = (i: number, count = 1): Rect => ({
  x: FIELD.x,
  y: FIELD.y + i * M.cell,
  w: SPAN,
  h: count * M.cell,
});

const colStrip = (i: number, count = 1): Rect => ({
  x: FIELD.x + i * M.cell,
  y: FIELD.y,
  w: count * M.cell,
  h: SPAN,
});
