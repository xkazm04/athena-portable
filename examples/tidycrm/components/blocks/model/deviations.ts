/**
 * The four kinds of deviation, and the three states a record can be in.
 *
 * `RecordMark` is what the cube draws a dot for. The distinction it carries is
 * the one the whole direction is about: `Deviates` is something a rule can
 * repair, `Unadjudicated` is something only a person may settle, and they are
 * two values rather than one because merging a pair destroys a record.
 */

/* ------------------------------------------------------------ deviations */

export const DEVIATION_KINDS = ["duplicate", "conflict", "phone", "stale"] as const;
export type DeviationKind = (typeof DEVIATION_KINDS)[number];

export const DEVIATION_LABEL: Record<DeviationKind, string> = {
  duplicate: "Duplicate",
  conflict: "Conflict",
  phone: "Phone",
  stale: "Stale",
};

/** What one record contributes to the cube. See `BkTable.marks`. */
export const enum RecordMark {
  Clean = 0,
  Deviates = 1,
  Unadjudicated = 2,
}

export interface Deviation {
  kind: DeviationKind;
  count: number;
  /** The clause this deviation contributes to the block's "why". */
  clause: string;
}
