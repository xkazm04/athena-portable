"use client";

/**
 * L1 — one zone, built out of the dots the cube just put down.
 *
 * WHAT THIS IS. Not a page that replaces the cube: the same twelve clusters,
 * carried out of the canvas and into the DOM without moving, and then walked
 * from there to where a reader can use them. The cube flattens its records into
 * a small plate of clusters in the middle of the frame; this level draws those
 * same clusters, at that same size, in those same places, and only then spreads
 * them across the sheet and grows the parts a block has at this depth.
 *
 * THE FOUR BEATS, and why each one exists:
 *
 *   land    the cells are rendered and immediately pushed onto the canvas's own
 *           clusters — measured, not guessed — carrying nothing but their dots.
 *           The canvas fades out underneath them and nothing appears to happen,
 *           which is the point: the hand-off has to be invisible.
 *   spread  the transforms are dropped. Each block travels from the plate to
 *           its place in the grid, staggered, so twelve blocks read as twelve
 *           things moving rather than one block of content sliding.
 *   dress   each cell grows its ground and its rule, then its name and its
 *           figures, and the zone's own heading arrives last.
 *   settled an ordinary grid of blocks, with nothing left animating.
 *
 * A cell is therefore not a card containing a chart. It is the block itself, at
 * the depth where its name and its counts are finally worth printing.
 */
import { useRef, type CSSProperties } from "react";
import { motion } from "motion/react";

import {
  FLAT_COLS,
  type BkSheet,
  type BkTable,
  type BkZone,
} from "./model";
import { Cluster } from "./Cluster";
import { FieldHead } from "./field/Head";
import { useLanding } from "./field/useLanding";

/** The beats of the arrival. See the file header. */
export type FieldPhase = "land" | "spread" | "dress" | "settled";

/** Which edge a cell carries: the stronger claim wins it. */
function toneOf(table: BkTable): "goldline" | "redline" | "greenline" {
  if (table.attention) return "goldline";
  if (table.deviationTotal > 0) return "redline";
  return "greenline";
}

/**
 * Shared-layout identities are handed out only once the arrival is over.
 *
 * `layoutId` makes motion the owner of an element's `transform`, and it writes
 * that inline — which beats any stylesheet. While the cells are being placed on
 * the canvas's clusters the transform belongs to the arrival, so the ids are
 * withheld until the grid is settled. Nothing is lost: the ids exist for the
 * L1 -> L2 morph, which can only start from the settled grid anyway.
 */
export function Field({
  sheet,
  zone,
  phase,
  onOpenTable,
  onOpenZone,
}: {
  sheet: BkSheet;
  zone: BkZone;
  phase: FieldPhase;
  onOpenTable: (ident: string) => void;
  onOpenZone: (id: string) => void;
}) {
  const cellsRef = useRef<HTMLDivElement | null>(null);
  const settled = phase === "settled";

  // Beat one of the arrival: measure where the canvas left each block's dots
  // and start every cell exactly there. See `field/useLanding.ts`.
  useLanding(cellsRef, phase, zone.tables.length);

  return (
    <section className="bk-grid" data-phase={phase}>
      <FieldHead sheet={sheet} zone={zone} onOpenZone={onOpenZone} />

      <div
        className="bk-cells"
        ref={cellsRef}
        data-phase={phase}
        style={{ "--cols": FLAT_COLS } as CSSProperties}
      >
        {zone.tables.map((table, i) => (
          <motion.button
            key={table.ident}
            type="button"
            layoutId={settled ? `table-${table.ident}` : undefined}
            className="bk-cell"
            data-tone={toneOf(table)}
            style={{ "--i": i } as CSSProperties}
            onClick={() => onOpenTable(table.ident)}
            aria-label={`Open ${table.ident}, ${table.name}. ${table.why}`}
          >
            <motion.span
              layoutId={settled ? `cluster-${table.ident}` : undefined}
              className="bk-cell-cluster"
            >
              <Cluster marks={table.marks} />
            </motion.span>

            <span className="bk-cell-body">
              <span className="bk-cell-head">
                <span className="bk-tile-ident">{table.ident}</span>
                <motion.span
                  layoutId={settled ? `table-name-${table.ident}` : undefined}
                  className="bk-tile-name"
                >
                  {table.name}
                </motion.span>
              </span>

              <span className="bk-tile-figures">
                <span className="bk-tile-fig">
                  <b>{table.records}</b>
                  <span>rows</span>
                </span>
                <span className="bk-tile-fig" data-zero={table.changed === 0}>
                  <b>{table.changed}</b>
                  <span>changed</span>
                </span>
                <span
                  className="bk-tile-fig"
                  data-tone={table.deviationTotal > 0 ? "redline" : undefined}
                  data-zero={table.deviationTotal === 0}
                >
                  <b>{table.deviationTotal}</b>
                  <span>errors</span>
                </span>
              </span>
            </span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
