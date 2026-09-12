/**
 * A zone: a lettered quarter of the sheet, holding roughly a dozen blocks.
 *
 * The same A/B/C/D grid a real general-arrangement drawing carries down its
 * border, so a block can be referred to by where it sits as well as by what it
 * is called. `ZONE_QUADRANT` is which corner of the cube each one is, and both
 * the scene and the DOM glyph read it, so the rail and the object agree.
 */

import type { DeviationKind } from "./deviations";
import type { BkTable } from "./tables";

/* ---------------------------------------------------------------- zones */

export const ZONE_IDS = ["A", "B", "C", "D"] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

/**
 * Which quarter of the cube a zone is, as signs on the two screen axes.
 *
 * Held here for the same reason `clusterCentre` is: the scene places the
 * quadrant from it and the DOM draws the little quarter glyph on the zone key
 * from it, and a reader who learns "B is the top right" from the key has to
 * find B in the top right of the cube. Two drawings of one fact, from one
 * declaration.
 */
export const ZONE_QUADRANT: Record<string, { sx: -1 | 1; sy: -1 | 1 }> = {
  A: { sx: -1, sy: 1 },
  B: { sx: 1, sy: 1 },
  C: { sx: -1, sy: -1 },
  D: { sx: 1, sy: -1 },
};

export interface BkZone {
  id: ZoneId;
  /** What kind of block landed in this zone, in records. */
  span: string;
  tables: BkTable[];
  records: number;
  checked: number;
  coverage: number;
  changed: number;
  deviationTotal: number;
  /** Tables in this zone with an unadjudicated pair. */
  attention: number;
  /** Tables in this zone carrying no outstanding deviation. */
  clear: number;
}

export interface BkSheet {
  zones: BkZone[];
  records: number;
  checked: number;
  coverage: number;
  /** Open pairs across the whole sheet: the work nobody has adjudicated. */
  unadjudicated: number;
  /** How many of those the sheet actually loaded, which is capped. Never above `unadjudicated`. */
  unadjudicatedShown: number;
  deviationTotal: number;
  changed: number;
  byKind: Record<DeviationKind, number>;
  clearTables: number;
  tableCount: number;
  /** Activity rows behind the sheet, which is what a revision number counts. Uncapped. */
  revision: number;
}
