/**
 * The nine databases: what they are called, where each one sits in a drawing of
 * nine, and which tables belong to which.
 *
 * WHY NINE, AND WHY DATABASES. The sheet used to be quartered into lettered
 * zones — A, B, C, D — and a zone was a size band of the 46 blocks. The product
 * owner's review of round 1 asked for something a reader can act on rather than
 * something the drawing border happens to index: nine DATABASES, each owning a
 * handful of tables, so the question L0 answers is "which database is in fault,
 * and how many tables does it hold" and the question L1 answers is "which table
 * inside it". A size band answered neither.
 *
 * WHAT DID NOT CHANGE. A **block** is still one email domain and still the unit
 * a company-name conflict is a deviation within; there are still 46 of them and
 * still 800 records under them, with the same planted defects, the same identity
 * pairs and the same conflicted domains. Only the grouping above them moved, and
 * `test/databases.test.ts` pins exactly that: same record ids, same pair ids,
 * same conflicted domains, regrouped.
 *
 * THE MAPPING RULE, in one sentence: every block ident is hashed (FNV-1a, 32
 * bit), the blocks are put in hash order, and that order is dealt round-robin
 * into the nine databases. Deterministic — the idents are themselves
 * deterministic, `BLK-01` upward by descending record count — and balanced by
 * construction, so with 46 blocks every database holds five or six and none can
 * fall outside the four-to-seven band the review asked for. A hash rather than a
 * slice of the ident order, because a slice would put the ten largest domains in
 * one database and reproduce the size banding this replaces.
 *
 * THE PLACEMENTS. Three prototype drawings of the same nine things are on the
 * page at once (see `components/blocks/l0/`), and two of them need geometry:
 * `DB_GRID` is the 3x3 arrangement the plate and the slab both use, and
 * `DB_OCTANT` is the 2x2x2-plus-a-core arrangement the cube uses. They live here
 * rather than in a variant because the legend beside the picture draws the same
 * index and a reader who learns "support is the top right" from the legend has
 * to find support in the top right.
 */

import type { DeviationKind } from "./deviations";
import type { BkTable } from "./tables";

/* ------------------------------------------------------------- the nine */

export const DATABASE_IDS = [
  "billing",
  "crm-eu",
  "crm-us",
  "support",
  "marketing",
  "partners",
  "events",
  "archive",
  "ops",
] as const;

export type DatabaseId = (typeof DATABASE_IDS)[number];

export interface DatabaseMeta {
  id: DatabaseId;
  /** What the legend and the breadcrumb print. */
  name: string;
  /** One quiet line: what a reader should expect to find in it. */
  blurb: string;
}

/**
 * The nine, named as databases and not as regions.
 *
 * The names are fixtures, not derived: a database is a place the studio put its
 * rows, and no arithmetic over the seed can invent that. What IS derived is
 * every figure beside them.
 */
export const DATABASES: readonly DatabaseMeta[] = [
  { id: "billing", name: "billing", blurb: "invoicing and dunning contacts" },
  { id: "crm-eu", name: "crm-eu", blurb: "the European account book" },
  { id: "crm-us", name: "crm-us", blurb: "the North American account book" },
  { id: "support", name: "support", blurb: "ticket requesters and their sites" },
  { id: "marketing", name: "marketing", blurb: "campaign audiences and consent" },
  { id: "partners", name: "partners", blurb: "resellers and referral contacts" },
  { id: "events", name: "events", blurb: "registrations and badge scans" },
  { id: "archive", name: "archive", blurb: "closed accounts kept for the audit" },
  { id: "ops", name: "ops", blurb: "supplier and logistics contacts" },
];

export const DATABASE_META: Record<string, DatabaseMeta> = Object.fromEntries(
  DATABASES.map((d) => [d.id, d]),
);

/* --------------------------------------------------------- the placements */

/** Where a database sits in a drawing of nine laid out three by three. */
export interface GridPlace {
  /** 0 is the top row. */
  row: 0 | 1 | 2;
  /** 0 is the leading column. */
  col: 0 | 1 | 2;
}

/**
 * Where a database sits in a cube split two by two by two, plus a centre core.
 *
 * Eight corners and one middle is the only way nine cells fit in a cube without
 * one of them being a lie, and the core is drawn smaller and lit from inside so
 * a reader can tell it apart from the eight around it.
 */
export interface OctantPlace {
  sx: -1 | 0 | 1;
  sy: -1 | 0 | 1;
  sz: -1 | 0 | 1;
  /** The centre one. It is the only cell that is not a corner. */
  core: boolean;
}

export const DB_GRID: Record<string, GridPlace> = Object.fromEntries(
  DATABASE_IDS.map((id, i) => [
    id,
    { row: Math.floor(i / 3) as 0 | 1 | 2, col: (i % 3) as 0 | 1 | 2 },
  ]),
);

/**
 * The eight corners in the same reading order the 3x3 uses — top row left to
 * right, then the bottom row — with the core taking the ninth slot, so the
 * legend's index and the cube agree about which cell is which.
 */
const CORNERS: ReadonlyArray<[sx: -1 | 1, sy: -1 | 1, sz: -1 | 1]> = [
  [-1, 1, 1],
  [1, 1, 1],
  [-1, 1, -1],
  [1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [-1, -1, -1],
  [1, -1, -1],
];

export const DB_OCTANT: Record<string, OctantPlace> = Object.fromEntries(
  DATABASE_IDS.map((id, i) => {
    const corner = CORNERS[i];
    return corner
      ? [id, { sx: corner[0], sy: corner[1], sz: corner[2], core: false }]
      : [id, { sx: 0, sy: 0, sz: 0, core: true }];
  }),
);

/* ------------------------------------------------------------ the mapping */

/** FNV-1a, 32 bit. Small, stable across machines, and not a cryptographic claim. */
export function identHash(ident: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < ident.length; i += 1) {
    h ^= ident.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Which database each block belongs to.
 *
 * Hash order, dealt round-robin. Both halves matter: the hash is what stops the
 * grouping being a size band, and the round-robin deal is what keeps the nine
 * within one table of each other however many blocks survive a merge or a
 * delete. Pure, and exported, so the rule can be pinned without a database.
 */
export function assignDatabases(idents: readonly string[]): Record<string, DatabaseId> {
  const order = [...idents].sort(
    (a, b) => identHash(a) - identHash(b) || a.localeCompare(b),
  );
  const out: Record<string, DatabaseId> = {};
  order.forEach((ident, i) => {
    out[ident] = DATABASE_IDS[i % DATABASE_IDS.length] as DatabaseId;
  });
  return out;
}

/* ----------------------------------------------------------- the model */

export interface BkDatabase {
  id: DatabaseId;
  name: string;
  blurb: string;
  /** What size of table landed in this database, in records. */
  span: string;
  tables: BkTable[];
  records: number;
  checked: number;
  coverage: number;
  changed: number;
  deviationTotal: number;
  /** Tables in this database with an unadjudicated pair. */
  attention: number;
  /** Tables in this database carrying no outstanding deviation. */
  clear: number;
  /** Tables in this database carrying at least one. What fills the cell red. */
  faulty: number;
}

export interface BkSheet {
  databases: BkDatabase[];
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
