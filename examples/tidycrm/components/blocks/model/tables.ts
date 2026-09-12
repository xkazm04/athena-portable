/**
 * One block: an email domain, and everything the three levels show about it.
 *
 * Called a table on the surface, because that is what it is to the person
 * reading the sheet — a named set of rows with a row count, a change count and
 * a defect count.
 */

import type { Deviation, RecordMark } from "./deviations";
import type { BkPair, BkRow } from "./rows";

/* --------------------------------------------------------------- tables */

/** Example rows a dossier carries before it says how many it left out. */
export const ROW_SAMPLE = 6;
/** Pairs a dossier previews before it says how many it left out. */
export const PAIR_SAMPLE = 3;

/**
 * One block: an email domain, and everything the three levels show about it.
 *
 * Called a table on the surface, because that is what it is to the person
 * reading the sheet — a named set of rows with a row count, a change count and
 * a defect count.
 */
export interface BkTable {
  ident: string;
  domain: string;
  /** The spelling most records on this domain agree on. */
  name: string;
  records: number;
  checked: number;
  outstanding: number;
  /** checked / records, in [0,1]. */
  coverage: number;
  /** Stored field changes across the whole block, reverted ones excluded. */
  changed: number;
  deviations: Deviation[];
  deviationTotal: number;
  /**
   * Needs a person, not a rule.
   *
   * True when an identity pair on this block has never been adjudicated. This
   * is the one thing on the sheet that no automatic act may resolve — merging
   * destroys a record — so it is marked apart from the redline, in gold.
   */
  attention: boolean;
  /** Competing company spellings on this domain, consensus first. */
  spellings: { company: string; n: number }[];
  rows: BkRow[];
  rowsHidden: number;
  pairs: BkPair[];
  pairsHidden: number;
  /**
   * One code per live record, in ledger order: what the cube draws a dot for.
   *
   * 0 = carries no outstanding deviation, 1 = deviates from the specification,
   * 2 = stands in an identity pair nobody has adjudicated. Sent as a flat array
   * of small integers because there are 800 of them and each one is worth three
   * bytes on the wire, not an object.
   */
  marks: RecordMark[];
  /** Every live contact id in the block, in ledger order. */
  ids: string[];
  /** Ids carrying at least one outstanding deviation — what a dispatch targets. */
  outstandingIds: string[];
  /** Ids stale and not yet flagged: exactly what `flag_stale` may act on. */
  staleIds: string[];
  /** Ids whose phone is not stored as +1XXXXXXXXXX. */
  phoneIds: string[];
  /** One sentence saying why this block needs attention. */
  why: string;
}
