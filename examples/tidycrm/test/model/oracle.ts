/**
 * The reference the write-path walk is checked against: every stored flag, every segment count and
 * the sheet's two partitions, recomputed from the raw columns and compared with what the app says.
 *
 * Deliberately not built from the app's own rules. `deriveFlags` and `flagDrift` (lib/flags.ts)
 * are the code under test; an oracle that called them would agree with any bug they carry. So the
 * predicates below are restated from the design's words (design 4.6.4, lib/constants.ts'
 * SEGMENT_HINTS): a phone is fine when it is +1 and ten digits, stale is no activity for 18 months
 * before the seed's clock, a conflict is a domain whose working records spell the company more
 * than one way, a duplicate is a working record named by an open pair.
 *
 * `checkInvariants()` never throws on a broken world; it returns what is wrong, by name.
 */
import { COMPANIES } from "@athena/demo-kit/seed";

import { NOW_ISO, SEGMENTS, STALE_MONTHS, type Segment } from "../../lib/constants";
import { countOpenPairs, countSegment, db, segmentRows } from "../../lib/db";
import { buildSheet } from "../../lib/blocks";

export const INVARIANTS = [
  "phone_ok",
  "is_stale",
  "conflict",
  "in_open_pair",
  "open pair with a non-working member",
  "segment count",
  "sheet partition",
  "pair attachment",
] as const;
export type Invariant = (typeof INVARIANTS)[number];

export interface Violation {
  invariant: Invariant;
  /** The contact id, domain, pair id or segment the violation is about. */
  subject: string;
  detail: string;
}

/** `listOpenPairs(200)` is what the sheet attaches; past it the two figures may differ by design. */
const PAIR_CAP = 200;

const CLIENT_DOMAINS = new Set(COMPANIES.map((c) => c.domain));

const CUTOFF = (() => {
  const d = new Date(NOW_ISO);
  d.setUTCMonth(d.getUTCMonth() - STALE_MONTHS);
  return d.toISOString();
})();

interface RawContact {
  id: string;
  phone: string;
  company: string;
  domain: string;
  last_activity_at: string;
  phone_ok: number;
  is_stale: number;
  conflict: number;
  in_open_pair: number;
  merged_into: string | null;
  deleted_at: string | null;
}

/** SQLite's TRIM: spaces only, both ends. The spelling count is defined in SQL. */
const sqlTrim = (s: string) => s.replace(/^ +| +$/g, "");

export function checkInvariants(): Violation[] {
  const out: Violation[] = [];
  const contacts = db().all<RawContact>(
    `SELECT id, phone, company, domain, last_activity_at, phone_ok, is_stale, conflict, in_open_pair,
            merged_into, deleted_at FROM contacts ORDER BY id`,
  );
  const open = db().all<{ id: string; keep_id: string; drop_id: string }>(
    "SELECT id, keep_id, drop_id FROM merge_pairs WHERE status = 'open' ORDER BY id",
  );

  const working = (c: RawContact) => c.deleted_at === null && c.merged_into === null;
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const spellings = new Map<string, Set<string>>();
  for (const c of contacts) {
    if (!spellings.has(c.domain)) spellings.set(c.domain, new Set());
    if (working(c)) spellings.get(c.domain)!.add(sqlTrim(c.company));
  }
  const pairsOf = new Map<string, number>();
  for (const p of open) {
    pairsOf.set(p.keep_id, (pairsOf.get(p.keep_id) ?? 0) + 1);
    pairsOf.set(p.drop_id, (pairsOf.get(p.drop_id) ?? 0) + 1);
  }

  const phoneOk = (c: RawContact) => /^\+1\d{10}$/.test(c.phone.trim());
  const stale = (c: RawContact) => c.last_activity_at < CUTOFF;
  const conflicted = (c: RawContact) => (spellings.get(c.domain)?.size ?? 0) > 1;
  const paired = (c: RawContact) => (pairsOf.get(c.id) ?? 0) > 0;

  // 1-4: each stored flag against its recomputation. `conflict` is the domain's, so it is reported
  // once per domain with the rows that disagree.
  const conflictRows = new Map<string, string[]>();
  for (const c of contacts) {
    const flag = (invariant: Invariant, stored: number, want: boolean) => {
      if (stored !== (want ? 1 : 0)) out.push({ invariant, subject: c.id, detail: `stored ${stored}, recomputed ${want ? 1 : 0}` });
    };
    flag("phone_ok", c.phone_ok, phoneOk(c));
    flag("is_stale", c.is_stale, stale(c));
    flag("in_open_pair", c.in_open_pair, paired(c));
    if (c.conflict !== (conflicted(c) ? 1 : 0)) {
      const list = conflictRows.get(c.domain) ?? [];
      list.push(c.id);
      conflictRows.set(c.domain, list);
    }
  }
  for (const [domain, ids] of conflictRows) {
    out.push({
      invariant: "conflict",
      subject: domain,
      detail: `${ids.length} row(s) disagree with ${spellings.get(domain)?.size ?? 0} working spelling(s): ${ids.slice(0, 5).join(", ")}`,
    });
  }

  // 5: an open pair is work only while both of its records are in the working list.
  for (const p of open) {
    const gone = [p.keep_id, p.drop_id].filter((id) => {
      const c = byId.get(id);
      return !c || !working(c);
    });
    if (gone.length > 0) {
      out.push({ invariant: "open pair with a non-working member", subject: p.id, detail: `gone: ${gone.join(", ")}` });
    }
  }

  // 6: every segment's count against its predicate over raw columns.
  const predicate: Record<Segment, (c: RawContact) => boolean> = {
    all: working,
    clients: (c) => working(c) && CLIENT_DOMAINS.has(c.domain),
    duplicates: (c) => working(c) && paired(c),
    "phone-format": (c) => working(c) && !phoneOk(c),
    stale: (c) => working(c) && stale(c),
    conflicts: (c) => working(c) && conflicted(c),
    merged: (c) => c.deleted_at === null && c.merged_into !== null,
  };
  for (const segment of SEGMENTS) {
    const want = contacts.filter(predicate[segment]).length;
    const got = countSegment(segment);
    if (got !== want) out.push({ invariant: "segment count", subject: segment, detail: `countSegment ${got}, recomputed ${want}` });
  }

  // 7 and 8: the sheet. Every working record sits in exactly one block, and the head's pair count
  // equals the pairs the blocks show, while the attached list is under its cap.
  const tables = buildSheet().databases.flatMap((d) => d.tables);
  const shown = tables.flatMap((t) => t.ids).sort();
  const listed = segmentRows("all")
    .map((c) => c.id)
    .sort();
  if (shown.length !== new Set(shown).size || shown.join("|") !== listed.join("|")) {
    out.push({
      invariant: "sheet partition",
      subject: "all",
      detail: `blocks carry ${shown.length} ids (${new Set(shown).size} distinct), the list ${listed.length}`,
    });
  }
  const pairsTotal = countOpenPairs();
  if (pairsTotal <= PAIR_CAP) {
    const attached = tables.reduce((n, t) => n + (t.deviations.find((d) => d.kind === "duplicate")?.count ?? 0), 0);
    if (attached !== pairsTotal) {
      const off = tables
        .filter((t) => (t.deviations.find((d) => d.kind === "duplicate")?.count ?? 0) !== t.pairs.length + t.pairsHidden)
        .map((t) => t.domain);
      out.push({
        invariant: "pair attachment",
        subject: "duplicates",
        detail: `countOpenPairs ${pairsTotal}, attached to blocks ${attached}; blocks counting rows not pairs: ${off.join(", ")}`,
      });
    }
  }
  return out;
}
