"use client";

/**
 * L0, prototype one — nine databases on one 2.5D plate, in CSS.
 *
 * WHAT IT LOOKS LIKE. A drawing-office plate seen from a little above: nine
 * tiles in a three-by-three, each one a named database with its tables drawn as
 * dots inside it and its two figures under them. The tile's ground is the state
 * — a quiet vellum wash when nothing inside is outstanding, a subtle redline
 * wash when any of its tables is — so "which database is in fault" is answered
 * by the colour of a rectangle rather than by reading nine numbers.
 *
 * HOW IT IS MANIPULATED. The pointer tilts the plate a few degrees and does
 * nothing else; there is no drag, no inertia and no pose to get lost in, which
 * is the review's complaint about the cube answered by removing the thing that
 * caused it. A tile is a real `<button>`: click it, or reach it with Tab and the
 * arrow keys — the nine tiles are ONE tab stop with a roving tabindex, so a
 * keyboard reader lands on the plate and steers inside it rather than tabbing
 * past nine controls to reach the legend.
 *
 * WHAT IT COSTS. No canvas, no WebGL context, no animation frame. At rest the
 * plate is nine boxes and fifty-odd dots of static DOM; the tilt is a `rotate3d`
 * on one wrapper, driven by two custom properties written on pointer move, so
 * the compositor does it and the main thread does not.
 *
 * THE FLATTEN. Opening a database is one transform on one element. The tile's
 * dot field is laid out in `FLAT_COLS` columns at the plane's own proportions,
 * which means it is already a scaled copy of the plane the L1 cells are about to
 * be measured onto — so the whole move is "put this tile's field exactly on the
 * plane", and every dot arrives at its cluster centre because the arithmetic
 * that placed it is `clusterCentre`'s. The other eight tiles and this one's
 * lettering fade out under it.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { FLATTEN } from "../../beats";
import { FLAT_COLS, gridStep, PLANE_ASPECT, RecordMark } from "../../model";
import { dotScale, fillOf, weightOf, type L0Props } from "../contract";

export function Plate({
  cells,
  hovered,
  onHover,
  onOpen,
  opening,
  onFlattened,
  reduced,
}: L0Props) {
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const planeRef = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState(0);

  /*
   * THE TILT, in two custom properties.
   *
   * Written straight onto the node rather than held in state: this answers a
   * pointer move, and a pointer move that goes through React is a render per
   * frame for a value the compositor could have had directly. Nothing else on
   * the plate reads it.
   */
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || opening !== null) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const px = (event.clientX - box.left) / box.width - 0.5;
    const py = (event.clientY - box.top) / box.height - 0.5;
    event.currentTarget.style.setProperty("--tilt-x", `${(-py * 2).toFixed(2)}`);
    event.currentTarget.style.setProperty("--tilt-y", `${(px * 2).toFixed(2)}`);
  };

  const restTilt = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.setProperty("--tilt-x", "0");
    event.currentTarget.style.setProperty("--tilt-y", "0");
  };

  /**
   * The flatten: measure once, then hand the transform to CSS.
   *
   * Both boxes are read before either is written, and the numbers go on as
   * custom properties rather than through state — the same reason
   * `field/useLanding.ts` gives. `--ox/--oy` put the transform's pivot on the
   * field's own centre inside the tile, so the tile scales around its dots and
   * not around its corner.
   */
  const measure = useCallback((id: string) => {
    const plane = planeRef.current;
    const field = fieldRef.current?.querySelector<HTMLElement>(`[data-db="${id}"] .bk-plate-field`);
    const tile = fieldRef.current?.querySelector<HTMLElement>(`[data-db="${id}"]`);
    if (!plane || !field || !tile) return;
    const planeBox = plane.getBoundingClientRect();
    const fieldBox = field.getBoundingClientRect();
    const tileBox = tile.getBoundingClientRect();
    if (fieldBox.width === 0 || planeBox.width === 0) return;
    const here = { x: fieldBox.left + fieldBox.width / 2, y: fieldBox.top + fieldBox.height / 2 };
    const there = { x: planeBox.left + planeBox.width / 2, y: planeBox.top + planeBox.height / 2 };
    tile.style.setProperty("--ox", `${(here.x - tileBox.left).toFixed(1)}px`);
    tile.style.setProperty("--oy", `${(here.y - tileBox.top).toFixed(1)}px`);
    tile.style.setProperty("--fx", `${(there.x - here.x).toFixed(1)}px`);
    tile.style.setProperty("--fy", `${(there.y - here.y).toFixed(1)}px`);
    tile.style.setProperty("--fs", (planeBox.width / fieldBox.width).toFixed(4));
  }, []);

  /*
   * The clock the DOM waits on.
   *
   * `FLATTEN` is the same export the WebGL variants run their interpolation off
   * and the same one `beats.ts` derives the advertised cost from, so all three
   * prototypes hand over at the same moment and an agent is told one number.
   * Cleared on abandon, because an abandoned move that still reports back is a
   * level change nobody asked for.
   */
  useEffect(() => {
    if (opening === null) return;
    measure(opening);
    const id = window.setTimeout(onFlattened, FLATTEN);
    return () => window.clearTimeout(id);
  }, [measure, onFlattened, opening]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const next = gridStep(event.key, at, cells.length, 3);
    if (next === null) return;
    event.preventDefault();
    setAt(next);
    const id = cells[next]?.id;
    if (id) {
      fieldRef.current?.querySelector<HTMLElement>(`[data-db="${id}"]`)?.focus();
      onHover(id);
    }
  };

  return (
    <div className="bk-plate-wrap">
      <div
        className="bk-plate-stage"
        data-opening={opening ?? ""}
        onPointerMove={onPointerMove}
        onPointerLeave={restTilt}
      >
        {/* The plane every variant publishes: inert, unpainted, and the one box
            `field/useLanding.ts` measures. See `l0/contract.ts`. */}
        <div
          className="bk-l0-plane"
          ref={planeRef}
          style={{ "--plane-ar": PLANE_ASPECT } as CSSProperties}
          aria-hidden
        />

        <div
          className="bk-plate"
          ref={fieldRef}
          role="group"
          aria-label="Nine databases"
          onKeyDown={onKeyDown}
        >
          {cells.map((cell, i) => (
            <button
              key={cell.id}
              type="button"
              className="bk-plate-tile"
              data-db={cell.id}
              data-fill={fillOf(cell)}
              data-flying={opening === cell.id ? "true" : undefined}
              tabIndex={i === at ? 0 : -1}
              style={
                {
                  "--w": weightOf(cell.id, hovered, opening),
                  /* How hard the fault wash is drawn: this database's share of
                     the worst one's outstanding work. See `L0Cell.share`. */
                  "--fault": cell.share,
                } as CSSProperties
              }
              aria-label={`Open ${cell.name}: ${cell.tables} tables, ${cell.outstanding} deviations outstanding`}
              onMouseEnter={() => onHover(cell.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => {
                setAt(i);
                onHover(cell.id);
              }}
              onBlur={() => onHover(null)}
              onClick={() => onOpen(cell.id)}
            >
              <span className="bk-plate-name">{cell.name}</span>

              {/*
                * One dot per TABLE, at the plane's own proportions and in the
                * plane's own column count, so the flatten is a single scale.
                */}
              <span
                className="bk-plate-field"
                style={
                  {
                    "--plane-ar": PLANE_ASPECT,
                    "--cols": Math.min(FLAT_COLS, Math.max(1, cell.dots.length)),
                  } as CSSProperties
                }
                aria-hidden
              >
                {cell.dots.map((dot) => (
                  <i
                    key={dot.ident}
                    className="bk-plate-dot"
                    data-mark={dot.mark}
                    style={{ "--dot": dotScale(dot.weight) } as CSSProperties}
                  />
                ))}
              </span>

              <span className="bk-plate-figs">
                <b>{cell.tables}</b>
                <span>tables</span>
                <b data-tone={cell.outstanding > 0 ? "redline" : undefined}>{cell.outstanding}</b>
                <span>outstanding</span>
              </span>

              {cell.attention > 0 ? (
                <span className="bk-plate-flag" data-mark={RecordMark.Unadjudicated}>
                  {cell.attention} awaiting a person
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
