"use client";

/**
 * L1 — one database's tables, standing in the database.
 *
 * NOT A PAGE THAT REPLACED THE PICTURE. The tables are slabs inside the octant
 * the camera flew into (`l0/octants/Scene.tsx` draws them), and this is the type
 * on them: one label per slab, projected onto it by `field/useProjector.ts`, at
 * the size the perspective says the slab is. Orbiting turns the rank; zooming
 * out past the band leaves the level; nothing here ever moves under its own
 * power, because the thing that moves is the camera.
 *
 * TWO TECHNOLOGIES, ONE RULE. The slab is the BOX and this is the INK — formula
 * §1 rule 3, and the reason the cell carries no ground of its own: the ground is
 * a solid in the scene, and drawing a second one in the DOM on top of it would
 * hide the object the level is about. So the label is a portrait card of type
 * and nothing else, and what a reader sees standing in front of them is a slab
 * with words on it.
 *
 * WHY PORTRAIT, and it is arithmetic rather than taste: six tables in a cube's
 * face is three across and two down, which makes each slab half again as tall
 * as it is wide. Round 2's landscape cell — cluster beside a column of text,
 * three figures on one baseline — does not fit that box at any type size worth
 * reading. So the cluster goes on top, the name under it, and the figures
 * stack.
 *
 * ARROW KEYS. The grid is ONE tab stop with a roving tabindex, `model/keys.ts`
 * deciding where a step goes, exactly as in round 2 — and the handler stops the
 * key propagating, because the element it bubbles to is the camera rig, whose
 * arrows orbit. Two things that both want the arrow keys is the one place this
 * level could have taken the reader's control away, and it does not.
 *
 * DRAG WINS OVER CLICK. The rig is bound to the frame these labels sit in, so a
 * drag that starts on a card still orbits the scene. A pointer that travelled
 * more than `SLOP` is therefore not a click on the table, and the card says so
 * rather than opening a dossier the reader did not ask for.
 */
import { useRef, useState, type CSSProperties, type RefObject } from "react";
import type { CameraRig } from "@athena/demo-kit/zoom";
import { gridStep, type BkDatabase, type BkTable } from "./model";
import { SLOT_COLS } from "./space/geometry";
import type { InkHold } from "./Blocks";
import { Cluster } from "./Cluster";
import { Stat, Stats } from "./Stat";
import type { FieldPhase } from "./useArrival";
import { useProjector } from "./field/useProjector";

/** How far a pointer may travel and still be a click rather than an orbit. */
const SLOP = 5;

/** Which edge a table carries: the stronger claim wins it. */
function toneOf(table: BkTable): "goldline" | "redline" | "greenline" {
  if (table.attention) return "goldline";
  if (table.deviationTotal > 0) return "redline";
  return "greenline";
}

export function Field({
  database,
  phase,
  ink,
  rig,
  frame,
  onOpenTable,
}: {
  database: BkDatabase;
  phase: FieldPhase;
  /** Which cell is holding its lettering back while its box travels. */
  ink: InkHold | null;
  rig: CameraRig;
  /** The canvas box the labels are projected into. */
  frame: RefObject<HTMLElement | null>;
  onOpenTable: (ident: string) => void;
}) {
  const cellsRef = useRef<HTMLDivElement | null>(null);
  const down = useRef<{ x: number; y: number } | null>(null);

  /*
   * The roving stop, carried WITH the database it belongs to rather than reset
   * by an effect when the database changes. Derived, so a jump to another
   * database lands on its first cell in the same render that draws it.
   */
  const [roving, setRoving] = useState<{ db: string; at: number }>({ db: database.id, at: 0 });
  const at = roving.db === database.id ? roving.at : 0;
  const rove = (next: number) => setRoving({ db: database.id, at: next });

  // Every label onto its slab, on every pose the rig emits. The camera is the
  // only thing that moves at this level; this is what follows it.
  useProjector(rig, frame, cellsRef, database, phase !== "flight");

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const next = gridStep(event.key, at, database.tables.length, SLOT_COLS);
    if (next === null) return;
    event.preventDefault();
    // The rig is an ancestor and its arrows orbit. This key has been spent.
    event.stopPropagation();
    rove(next);
    const ident = database.tables[next]?.ident;
    if (ident) {
      cellsRef.current?.querySelector<HTMLElement>(`.bk-cell[data-ident="${ident}"]`)?.focus();
    }
  };

  return (
    <div
      className="bk-cells"
      ref={cellsRef}
      data-phase={phase}
      role="group"
      aria-label={`Tables in ${database.name}`}
      onKeyDown={onKeyDown}
    >
      {database.tables.map((table, i) => (
          <div
            key={table.ident}
            className="bk-cell-at"
            data-slot={table.ident}
            data-behind="false"
            /* `--i` is the card's place in the wave the dressing beat crosses the
               octant as. It is on the WRAPPER because the wrapper is what the
               projection writes to. */
            style={{ "--i": i } as CSSProperties}
          >
            <button
              type="button"
              className="bk-cell"
              data-ident={table.ident}
              data-tone={toneOf(table)}
              /* THE INK WAITS FOR THE BOX. `gone` while the box is out at the
                 dossier, `after-box` while it comes home; the stylesheet owns
                 both. See the note in `Blocks.tsx`. */
              data-ink={
                ink?.ident === table.ident ? (ink.phase === "out" ? "gone" : "after-box") : undefined
              }
              tabIndex={i === at ? 0 : -1}
              onFocus={() => rove(i)}
              onPointerDown={(e) => {
                down.current = { x: e.clientX, y: e.clientY };
              }}
              onClick={(e) => {
                const from = down.current;
                down.current = null;
                // A pointer that orbited the scene did not choose a table.
                if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > SLOP) return;
                onOpenTable(table.ident);
              }}
              aria-label={`Open ${table.ident}, ${table.name}. ${table.why}`}
            >
              <span className="bk-cell-cluster">
                <Cluster marks={table.marks} />
              </span>

              <span className="bk-cell-body">
                {/*
                  * The NAME leads and the ident follows it, quieter. The other way round the card
                  * opened on `BLK-04` — a code no reader is looking for — and the company it stands
                  * for came second, in the same box, at a size that had to argue with it.
                  */}
                <span className="bk-cell-head">
                  <span className="bk-tile-name">{table.name}</span>
                  <span className="bk-tile-ident">{table.ident}</span>
                </span>

                {/*
                  * `deviations`, not `errors`. Nothing on this sheet is an error: a record deviates
                  * from a specification, and that is the word the picture, the database head and the
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
            </button>
          </div>
      ))}
    </div>
  );
}
