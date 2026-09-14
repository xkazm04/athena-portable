"use client";

/**
 * The nine-database legend beside the picture.
 *
 * It belongs to the HOST rather than to any one prototype, for the reason it
 * existed in round 1: a scene is not reachable by keyboard and a survey plate has
 * to be, so these nine buttons are the accessible path to the same nine places
 * whichever drawing is in the frame. They double as the read-out for whatever
 * the pointer is over.
 *
 * THE RECEDE COMES FROM THE MODEL (formula §1 rule 7). While a database is
 * opening, the other eight keys step back — and what "step back" means is
 * `emphasis()`'s answer put through the kit's one mapping, not a number chosen
 * here. Two options are passed, and both are decisions rather than taste:
 *
 *   floor  0.5, because a reader may change their mind mid-flatten and the eight
 *          they did not choose have to stay readable enough to pick. The kit's
 *          bare mapping would take them to 0.22, which is right for a board that
 *          has receded behind a card and wrong for a rail that is still live.
 *   depth  0, because these are rows in a list. The kit's six percent is a
 *          shallow SINK, which reads correctly for an object standing further
 *          back in a scene; a legend key that shrinks reads as a control that
 *          has been disabled, and it has not been.
 *
 * THE INDEX GLYPH. Nine squares with one filled, which is where that database
 * sits in the picture — the same 3x3 arrangement the plate and the slab lay out,
 * and the reading order the octant corners follow. A list has no geometry, so a
 * reader who learns "support is 41 outstanding" from the legend has no way to
 * find support in the picture without hunting for it. Four squares and a filled
 * one was the whole fix in round 1 and nine is the same fix.
 */

import type { CSSProperties } from "react";

import { presenceOf, type Focus } from "@athena/demo-kit/zoom";

import { Stat, Stats } from "../Stat";
import { DB_GRID, outstandingTone } from "../model";
import type { L0Cell } from "./contract";
import { fillOf } from "./contract";

function IndexGlyph({ id }: { id: string }) {
  const at = DB_GRID[id] ?? { row: 0, col: 0 };
  return (
    <svg className="bk-db-index" viewBox="0 0 15 15" aria-hidden focusable="false">
      <rect className="bk-db-index-box" x="0.5" y="0.5" width="14" height="14" />
      <path className="bk-db-index-box" d="M5.17 0.5V14.5M9.83 0.5V14.5M0.5 5.17H14.5M0.5 9.83H14.5" />
      <rect
        className="bk-db-index-on"
        x={0.5 + at.col * 4.67}
        y={0.5 + at.row * 4.67}
        width="4.67"
        height="4.67"
      />
    </svg>
  );
}

export function L0Keys({
  cells,
  focus,
  hovered,
  opening,
  onHover,
  onOpen,
}: {
  cells: L0Cell[];
  /** The nav's focus, which is what says how present each key is. */
  focus: Focus;
  hovered: string | null;
  opening: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  /** The worst database sets the scale the other eight are drawn against. */
  const worst = cells.reduce((n, c) => Math.max(n, c.outstanding), 0);

  return (
    <ul className="bk-db-keys">
      {cells.map((cell) => (
        <li key={cell.id}>
          <button
            type="button"
            className="bk-db-key"
            data-on={hovered === cell.id || opening === cell.id}
            data-fill={fillOf(cell)}
            style={presenceOf(focus, cell.id, null, { floor: 0.5, depth: 0 }) as CSSProperties}
            /* Never disabled while a database is opening. `openFromPlate`
               already handles being asked for a second one mid-flight and
               Escape abandons the move outright, so a control the reader can
               see but not press would protect nothing. */
            onMouseEnter={() => onHover(cell.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(cell.id)}
            onBlur={() => onHover(null)}
            onClick={() => onOpen(cell.id)}
          >
            <span className="bk-db-key-top">
              <IndexGlyph id={cell.id} />
              <span className="bk-db-key-name">{cell.name}</span>
            </span>
            <span className="bk-db-key-span">{cell.blurb}</span>

            <Stats className="bk-stats-pair bk-db-key-figures">
              <Stat value={cell.tables} label="tables" />
              <Stat
                value={cell.outstanding}
                label="deviations"
                tone={outstandingTone(cell.outstanding)}
                quiet={cell.outstanding === 0}
              />
            </Stats>

            {/* The frontier, drawn rather than counted: how much of the sheet's
                outstanding work stands in this database, against the worst
                one's share. Nine rules of unequal length rank nine databases
                faster than nine numbers do. */}
            <span
              className="bk-db-key-measure"
              style={{ "--of": worst > 0 ? cell.outstanding / worst : 0 } as CSSProperties}
              aria-hidden
            >
              <i />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
