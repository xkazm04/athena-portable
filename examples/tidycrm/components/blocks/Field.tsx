"use client";

/**
 * L1 — one database's tables, built out of the dots the picture just put down.
 *
 * WHAT THIS IS. Not a page that replaces the L0 picture: the same five or six
 * clusters, carried out of it and into the DOM without moving, and then walked
 * from there to where a reader can use them. L0 flattens the database's tables
 * into a small plate of clusters in the middle of the frame; this level draws
 * those same clusters, at that same size, in those same places, and only then
 * spreads them across the sheet and grows the parts a table has at this depth.
 *
 * THE FOUR BEATS, and why each one exists:
 *
 *   land    the cells are rendered and immediately pushed onto the plane the
 *           picture published — measured, not guessed — carrying nothing but
 *           their dots. The picture fades out underneath them and nothing
 *           appears to happen, which is the point: the hand-off has to be
 *           invisible.
 *   spread  the transforms are dropped. Each table travels from the plane to
 *           its place in the grid, staggered, so six tables read as six things
 *           moving rather than one block of content sliding.
 *   dress   each cell grows its ground and its rule, then its name and its
 *           figures, and the database's own heading arrives last.
 *   settled an ordinary grid of tables, with nothing left animating.
 *
 * A cell is therefore not a card containing a chart. It is the table itself, at
 * the depth where its name and its counts are finally worth printing.
 *
 * ARROW KEYS, which round 1's review named as missing. The grid is ONE tab stop
 * with a roving tabindex: left and right step a cell, up and down step a row,
 * Home and End go to the ends, and nothing wraps off the edge. Where the step
 * goes is `model/keys.ts`, shared with the plate prototype, because two grids
 * owing the reader two different answers is how a keyboard reader learns not to
 * trust either.
 */
import { useRef, useState, type CSSProperties } from "react";
import { motion } from "motion/react";

import {
  FLAT_COLS,
  gridStep,
  type BkDatabase,
  type BkSheet,
  type BkTable,
} from "./model";
import type { InkHold } from "./Blocks";
import { Cluster } from "./Cluster";
import { Stat, Stats } from "./Stat";
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
 * Shared-layout identities are handed out only once the arrival is over — and
 * the cell is REMOUNTED when they are, which is the part that was missing.
 *
 * `layoutId` makes motion the owner of an element's `transform`, and it writes
 * that inline — which beats any stylesheet. While the cells are being placed on
 * the picture's plane the transform belongs to the arrival, so the ids are
 * withheld until the grid is settled. Nothing is lost: the ids exist for the
 * L1 -> L2 morph, which can only start from the settled grid anyway.
 *
 * WHY THE KEY CHANGES WITH IT. `motion` builds a projection node once, during
 * the render in which the component first appears, and reads `layoutId` off the
 * props it had at that moment (`useVisualElement`'s `createProjectionNode`,
 * whose own source carries the "TODO: update options in an effect" admitting
 * it). A `layoutId` that arrives later is never registered in the shared stack,
 * so the dossier that mounts holding the matching id finds nothing to travel
 * FROM — which is exactly why the L1 -> L2 morph had been dead since it was
 * written, and why the card appeared at full size on frame zero. Changing the
 * key at the settle makes the cell a new component on the frame it acquires its
 * id, which is the only frame motion will read it on. The remount is a single
 * commit with identical markup on both sides of it, and it happens at the one
 * moment on this level when nothing is moving.
 */
export function Field({
  sheet,
  database,
  phase,
  ink,
  onOpenTable,
  onOpenDatabase,
}: {
  sheet: BkSheet;
  database: BkDatabase;
  phase: FieldPhase;
  /** Which cell is holding its lettering back while its box travels. */
  ink: InkHold | null;
  onOpenTable: (ident: string) => void;
  onOpenDatabase: (id: string) => void;
}) {
  const cellsRef = useRef<HTMLDivElement | null>(null);
  const settled = phase === "settled";
  /*
   * The roving stop, carried WITH the database it belongs to rather than reset
   * by an effect when the database changes. Derived, so a jump to another
   * database lands on its first cell in the same render that draws it — an
   * effect would have painted one frame with a stop pointing into a grid that
   * no longer exists.
   */
  const [roving, setRoving] = useState<{ db: string; at: number }>({ db: database.id, at: 0 });
  const at = roving.db === database.id ? roving.at : 0;
  const rove = (next: number) => setRoving({ db: database.id, at: next });

  // Beat one of the arrival: measure where the picture left each table's dots
  // and start every cell exactly there. See `field/useLanding.ts`.
  useLanding(cellsRef, phase, database.tables.length);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const next = gridStep(event.key, at, database.tables.length, FLAT_COLS);
    if (next === null) return;
    event.preventDefault();
    rove(next);
    const ident = database.tables[next]?.ident;
    if (ident) {
      cellsRef.current?.querySelector<HTMLElement>(`.bk-cell[data-ident="${ident}"]`)?.focus();
    }
  };

  return (
    <section className="bk-grid" data-phase={phase}>
      <FieldHead sheet={sheet} database={database} onOpenDatabase={onOpenDatabase} />

      <div
        className="bk-cells"
        ref={cellsRef}
        data-phase={phase}
        role="group"
        aria-label={`Tables in ${database.name}`}
        onKeyDown={onKeyDown}
        style={{ "--cols": FLAT_COLS } as CSSProperties}
      >
        {database.tables.map((table, i) => (
          <motion.button
            key={settled ? table.ident : `${table.ident}:arriving`}
            type="button"
            layoutId={settled ? `table-${table.ident}` : undefined}
            className="bk-cell"
            /* The cell is where focus is put back down when the dossier closes,
               and for a card an agent opened there is nothing else to go on —
               nothing on the sheet had focus. See `Dossier.tsx`. */
            data-ident={table.ident}
            data-tone={toneOf(table)}
            /* THE INK WAITS FOR THE BOX. `gone` while the box is out at the
               dossier, `after-box` while it comes home; the stylesheet owns
               both. See the note in `Blocks.tsx`. */
            data-ink={
              ink?.ident === table.ident ? (ink.phase === "out" ? "gone" : "after-box") : undefined
            }
            tabIndex={i === at ? 0 : -1}
            style={{ "--i": i } as CSSProperties}
            onFocus={() => rove(i)}
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
              {/*
                * The NAME leads and the ident follows it, quieter. The other way round the card
                * opened on `BLK-04` — a code no reader is looking for — and the company it stands
                * for came second, in the same box, at a size that had to argue with it.
                */}
              <span className="bk-cell-head">
                <motion.span
                  layoutId={settled ? `table-name-${table.ident}` : undefined}
                  className="bk-tile-name"
                >
                  {table.name}
                </motion.span>
                <span className="bk-tile-ident">{table.ident}</span>
              </span>

              {/*
                * `deviations`, not `errors`. Nothing on this sheet is an error: a record deviates
                * from a specification, and that is the word the plate, the database head and the
                * dossier all use for the same figure.
                */}
              <Stats className="bk-tile-figures">
                <Stat value={table.records} label="rows" />
                <Stat value={table.changed} label="changed" quiet={table.changed === 0} />
                <Stat
                  value={table.deviationTotal}
                  label="deviations"
                  tone={table.deviationTotal > 0 ? "redline" : undefined}
                  quiet={table.deviationTotal === 0}
                />
              </Stats>
            </span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
