/**
 * One contact as the sheet carries it, and one unadjudicated identity pair.
 *
 * Every flag on a row is a stored column, never a guess: `phoneOk`, `isStale`,
 * `conflict` and `inOpenPair` are read out of the database, so a mark on the
 * print is always something somebody could go and check.
 */

import type { Evidence } from "@/lib/types";

/* ----------------------------------------------------------------- rows */

/** One contact, as an example row in the problem preview. */
export interface BkRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  title: string;
  city: string;
  lastActivityAt: string;
  /** Stored flags, never a guess. */
  phoneOk: boolean;
  isStale: boolean;
  staleFlagged: boolean;
  conflict: boolean;
  inOpenPair: boolean;
  /** Field changes this record still carries. */
  changed: number;
}

/** One unadjudicated identity pair, with the rules that proposed it. */
export interface BkPair {
  id: string;
  confidence: number;
  keep: BkRow;
  drop: BkRow;
  conflicts: { field: string; label: string; keep: string; drop: string }[];
  evidence: Evidence[];
}
