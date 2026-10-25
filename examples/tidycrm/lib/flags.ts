import "server-only";
/**
 * The four stored defect flags, the rules they cache, and the one door every contact field write
 * goes through (ADR 0163).
 *
 * `phone_ok`, `is_stale`, `conflict` and `in_open_pair` are stored and indexed (lib/db.ts) so a
 * segment filter is one index scan. A stored figure is a cache, and a cache needs its rule beside
 * it plus a check. Before this file each write path restamped the flags it remembered by hand:
 * `phone_ok` in three places, `is_stale` in one that arrived only after a bug, `in_open_pair` both
 * derived and zeroed inline. So here, and only here:
 *
 * - `deriveFlags` is each flag's rule, as a pure function of the row's inputs;
 * - `restamp` recomputes the flags for a set of rows and domains and writes the ones that moved -
 *   the only writer of the four columns in the app (test/flag-drift.test.ts pins that by source);
 * - `writeField` is the field write: one `revisions` row, the value, and a restamp of what the
 *   field feeds, so a new write path cannot forget a flag or leave a change without a history;
 * - `flagDrift` recomputes every flag from its rule and names any row where the cache disagrees.
 *
 * No import from lib/db.ts: the seed stamps through `restamp` too, and db.ts imports this file.
 */
import type { Db } from "@athena/demo-kit/db";

import { NOW_ISO, STALE_MONTHS } from "./constants";
import { isE164, NORMALIZABLE_FIELDS, type NormalizableField } from "./normalize";

export const FLAGS = ["phone_ok", "is_stale", "conflict", "in_open_pair"] as const;
export type Flag = (typeof FLAGS)[number];

/**
 * The working list: live and not merged away. A company spelling is counted over this set and
 * nothing wider, because it is the set `resolve_company` rewrites - a merged-away record keeps its
 * old spelling forever, and counting it would hold its domain in conflict after every survivor
 * agrees. lib/db.ts re-exports it for the reads, so both sides share the predicate.
 */
export const WORKING = "deleted_at IS NULL AND merged_into IS NULL";

function staleCutoff(): string {
  const d = new Date(NOW_ISO);
  d.setUTCMonth(d.getUTCMonth() - STALE_MONTHS);
  return d.toISOString();
}

const STALE_CUTOFF = staleCutoff();

/** The one rule `is_stale` caches. */
export function isStaleAt(lastActivityAt: string): boolean {
  return lastActivityAt < STALE_CUTOFF;
}

/**
 * What the four rules read off one row: two of its fields and two counts around it. The spelling
 * count is `WORKING` spelled per alias in `flagRows`, the same predicate `domainSpellings` counts
 * with, so the flag and the sheet's clause cannot disagree.
 */
export interface FlagInputs {
  phone: string;
  last_activity_at: string;
  /** Distinct company spellings among the WORKING rows on the row's domain. */
  spellings: number;
  /** Open identity pairs that name the row on either side. */
  open_pairs: number;
}

export type Flags = Record<Flag, 0 | 1>;

/** Each flag's rule. Nothing else in the app decides what a flag should be. */
export function deriveFlags(i: FlagInputs): Flags {
  return {
    phone_ok: isE164(i.phone) ? 1 : 0,
    is_stale: isStaleAt(i.last_activity_at) ? 1 : 0,
    conflict: i.spellings > 1 ? 1 : 0,
    in_open_pair: i.open_pairs > 0 ? 1 : 0,
  };
}

interface FlagRow extends FlagInputs, Flags {
  id: string;
}

/** Every row's stored flags beside the inputs their rules read, optionally narrowed. */
function flagRows(tx: Db, where = "", params: string[] = []): FlagRow[] {
  return tx.all<FlagRow>(
    `SELECT c.id, c.phone, c.last_activity_at, c.phone_ok, c.is_stale, c.conflict, c.in_open_pair,
            (SELECT COUNT(DISTINCT TRIM(w.company)) FROM contacts w
              WHERE w.domain = c.domain AND w.deleted_at IS NULL AND w.merged_into IS NULL) AS spellings,
            (SELECT COUNT(*) FROM merge_pairs p
              WHERE p.status = 'open' AND (p.keep_id = c.id OR p.drop_id = c.id)) AS open_pairs
       FROM contacts c ${where} ORDER BY c.id ASC`,
    params,
  );
}

/** Which rows a restamp covers: named ones, and every row on the named domains. */
export interface RestampScope {
  ids?: Iterable<string>;
  domains?: Iterable<string>;
}

/**
 * Recompute the four flags for every row in `scope` and write the ones that moved.
 *
 * Callers name what their write could have moved: the row whose phone or date changed, the domain
 * whose spelling set changed, the two members of a pair whose status changed. Restamping a row
 * whose inputs did not move writes nothing, so a generous scope costs a read and nothing else.
 */
export function restamp(tx: Db, scope: RestampScope | "all"): void {
  let rows: FlagRow[];
  if (scope === "all") {
    rows = flagRows(tx);
  } else {
    const ids = [...new Set(scope.ids ?? [])];
    const domains = [...new Set(scope.domains ?? [])];
    if (ids.length === 0 && domains.length === 0) return;
    const clauses: string[] = [];
    if (ids.length > 0) clauses.push(`c.id IN (${ids.map(() => "?").join(",")})`);
    if (domains.length > 0) clauses.push(`c.domain IN (${domains.map(() => "?").join(",")})`);
    rows = flagRows(tx, `WHERE ${clauses.join(" OR ")}`, [...ids, ...domains]);
  }
  for (const row of rows) {
    const want = deriveFlags(row);
    const moved = FLAGS.filter((f) => row[f] !== want[f]);
    if (moved.length === 0) continue;
    tx.run(`UPDATE contacts SET ${moved.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`, [
      ...moved.map((f) => want[f]),
      row.id,
    ]);
  }
}

/** One stored flag that disagrees with its rule. */
export interface Drift {
  id: string;
  flag: Flag;
  stored: number;
  derived: number;
}

/**
 * Every row, every flag, recomputed from its rule and compared with what is stored. Empty is the
 * invariant; a non-empty answer names the row and the flag, which is the bug report.
 */
export function flagDrift(tx: Db): Drift[] {
  const out: Drift[] = [];
  for (const row of flagRows(tx)) {
    const want = deriveFlags(row);
    for (const flag of FLAGS) {
      if (row[flag] !== want[flag]) out.push({ id: row.id, flag, stored: row[flag], derived: want[flag] });
    }
  }
  return out;
}

/* ------------------------------------------------------------- the door */

/** The fields a write may set through the door: the rules' fields, and the date a merge adopts. */
export const WRITABLE_FIELDS = [...NORMALIZABLE_FIELDS, "last_activity_at"] as const;
export type WritableField = NormalizableField | "last_activity_at";

/** Which flags a field feeds: its own row's, its domain's, or none. */
const FEEDS: Record<WritableField, "row" | "domain" | null> = {
  first_name: null,
  last_name: null,
  email: null,
  city: null,
  phone: "row",
  last_activity_at: "row",
  company: "domain",
};

function writable(field: string): field is WritableField {
  return (WRITABLE_FIELDS as readonly string[]).includes(field);
}

/**
 * Set one field and restamp what it feeds, with no revision. `writeField` is the door for a new
 * value; this half is also what `applyUndo` calls to put an old value back, since the reversal is
 * recorded on the revision it reverts rather than as a new one.
 */
export function setField(tx: Db, contactId: string, field: string, value: string): void {
  if (!writable(field)) throw new Error(`no write door for field: ${field}`);
  tx.run(`UPDATE contacts SET ${field} = ? WHERE id = ?`, [value, contactId]);
  const feeds = FEEDS[field];
  if (feeds === "row") restamp(tx, { ids: [contactId] });
  if (feeds === "domain") {
    const domain = tx.get<{ domain: string }>("SELECT domain FROM contacts WHERE id = ?", [contactId])?.domain;
    if (domain) restamp(tx, { domains: [domain] });
  }
}

/** One field write as the app records it. */
export interface FieldWrite {
  contact_id: string;
  field: WritableField;
  from: string;
  to: string;
  /** What `revisions.rules` says caused it: rule names joined by commas, or a write's tag. */
  rules: string;
  ts: string;
}

/** Record the revision, set the value, restamp what it feeds. Returns the revision id. */
export function writeField(tx: Db, w: FieldWrite): number {
  const { lastInsertRowid } = tx.run(
    `INSERT INTO revisions (contact_id, field, old_value, new_value, rules, ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [w.contact_id, w.field, w.from, w.to, w.rules, w.ts],
  );
  setField(tx, w.contact_id, w.field, w.to);
  return lastInsertRowid;
}
