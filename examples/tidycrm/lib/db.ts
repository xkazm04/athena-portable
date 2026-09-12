import "server-only";
import { openDb, type Db } from "@athena/demo-kit/db";
import { COMPANIES } from "@athena/demo-kit/seed";
import { createActivityTable, logActivity } from "@athena/demo-kit/activity";

import {
  APP_ID,
  CONFIDENT_AT,
  MAX_DOMAINS,
  NOW_ISO,
  PAGE_SIZE,
  STALE_MONTHS,
  type Segment,
} from "./constants";
import { isE164 } from "./normalize";
import { buildSeed } from "./seed-data";
import type {
  Contact,
  ContactPage,
  DefectCounts,
  Evidence,
  MergePair,
  PairPreview,
  PairStatus,
  Revision,
} from "./types";

export { APP_ID };

/**
 * Defect flags are stored, not computed at read time, and every one of them is indexed. 800 rows is
 * small, but the segment filter runs on every keystroke of the pager and the dashboard reads six
 * counts at once; a stored flag keeps both to one index scan.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS contacts (
  id               TEXT PRIMARY KEY,
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  email            TEXT NOT NULL,
  phone            TEXT NOT NULL,
  company          TEXT NOT NULL,
  domain           TEXT NOT NULL,
  title            TEXT NOT NULL,
  city             TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  phone_ok         INTEGER NOT NULL DEFAULT 1 CHECK (phone_ok IN (0,1)),
  is_stale         INTEGER NOT NULL DEFAULT 0 CHECK (is_stale IN (0,1)),
  stale_flagged    INTEGER NOT NULL DEFAULT 0 CHECK (stale_flagged IN (0,1)),
  conflict         INTEGER NOT NULL DEFAULT 0 CHECK (conflict IN (0,1)),
  in_open_pair     INTEGER NOT NULL DEFAULT 0 CHECK (in_open_pair IN (0,1)),
  merged_into      TEXT REFERENCES contacts (id),
  deleted_at       TEXT
);
CREATE INDEX IF NOT EXISTS contacts_live   ON contacts (deleted_at, merged_into, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS contacts_phone  ON contacts (phone_ok, deleted_at);
CREATE INDEX IF NOT EXISTS contacts_stale  ON contacts (is_stale, deleted_at);
CREATE INDEX IF NOT EXISTS contacts_conf   ON contacts (conflict, deleted_at);
CREATE INDEX IF NOT EXISTS contacts_dup    ON contacts (in_open_pair, deleted_at);
CREATE INDEX IF NOT EXISTS contacts_domain ON contacts (domain);

CREATE TABLE IF NOT EXISTS merge_pairs (
  id            TEXT PRIMARY KEY,
  keep_id       TEXT NOT NULL REFERENCES contacts (id),
  drop_id       TEXT NOT NULL REFERENCES contacts (id),
  confidence    REAL NOT NULL,
  evidence_json TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('open','merged','kept_both','skipped'))
);
CREATE INDEX IF NOT EXISTS pairs_status ON merge_pairs (status, confidence DESC);
CREATE INDEX IF NOT EXISTS pairs_keep   ON merge_pairs (keep_id);
CREATE INDEX IF NOT EXISTS pairs_drop   ON merge_pairs (drop_id);

CREATE TABLE IF NOT EXISTS revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL REFERENCES contacts (id),
  field      TEXT NOT NULL,
  old_value  TEXT NOT NULL,
  new_value  TEXT NOT NULL,
  rules      TEXT NOT NULL,
  ts         TEXT NOT NULL,
  reverted   INTEGER NOT NULL DEFAULT 0 CHECK (reverted IN (0,1))
);
CREATE INDEX IF NOT EXISTS revisions_contact ON revisions (contact_id, id DESC);
`;

function staleCutoff(): string {
  const d = new Date(NOW_ISO);
  d.setUTCMonth(d.getUTCMonth() - STALE_MONTHS);
  return d.toISOString();
}

function seed(db: Db): void {
  db.exec(SCHEMA);
  createActivityTable(db);

  const { contacts, pairs, conflictDomains } = buildSeed();
  const conflicted = new Set(conflictDomains);
  const cutoff = staleCutoff();
  const inPair = new Set(pairs.flatMap((p) => [p.keep_id, p.drop_id]));

  for (const c of contacts) {
    db.run(
      `INSERT INTO contacts
         (id, first_name, last_name, email, phone, company, domain, title, city,
          last_activity_at, created_at, phone_ok, is_stale, conflict, in_open_pair)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        c.id, c.first_name, c.last_name, c.email, c.phone, c.company, c.domain, c.title, c.city,
        c.last_activity_at, c.created_at,
        isE164(c.phone) ? 1 : 0,
        c.last_activity_at < cutoff ? 1 : 0,
        conflicted.has(c.domain) ? 1 : 0,
        inPair.has(c.id) ? 1 : 0,
      ],
    );
  }

  for (const p of pairs) {
    db.run(
      `INSERT INTO merge_pairs (id, keep_id, drop_id, confidence, evidence_json, status)
       VALUES (?, ?, ?, ?, ?, 'open')`,
      [p.id, p.keep_id, p.drop_id, p.confidence, JSON.stringify(p.evidence)],
    );
  }

  const confident = pairs.filter((p) => p.confidence >= CONFIDENT_AT).length;
  logActivity(db, {
    actor: "system",
    action: "import",
    target: "contacts",
    summary:
      `Imported ${contacts.length} contacts. Found ${pairs.length} near-duplicate pairs ` +
      `(${confident} confident, ${pairs.length - confident} uncertain).`,
    reversible: false,
    ts: NOW_ISO,
  });
}

export function db(): Db {
  return openDb(APP_ID, { seed });
}

/* ---------------------------------------------------------------- reads */

const LIVE = "deleted_at IS NULL";

/**
 * The studio's fifteen client domains, as a SQL list.
 *
 * The registry is the authority (`COMPANIES`, @athena/demo-kit/seed) and this is the only place
 * the app turns it into a predicate, so the `clients` segment cannot drift from the list the
 * sibling apps invoice and interview against. Every domain is a slug on `.example`, so the
 * literals are quoted rather than bound: a segment clause is composed once at module load, not
 * per call.
 */
const CLIENT_DOMAINS: readonly string[] = COMPANIES.map((c) => c.domain);
const CLIENT_LIST = CLIENT_DOMAINS.map((d) => `'${d.replace(/'/g, "''")}'`).join(", ");

const SEGMENT_WHERE: Record<Segment, string> = {
  all: `${LIVE} AND merged_into IS NULL`,
  clients: `${LIVE} AND merged_into IS NULL AND domain IN (${CLIENT_LIST})`,
  duplicates: `${LIVE} AND merged_into IS NULL AND in_open_pair = 1`,
  "phone-format": `${LIVE} AND merged_into IS NULL AND phone_ok = 0`,
  stale: `${LIVE} AND merged_into IS NULL AND is_stale = 1`,
  conflicts: `${LIVE} AND merged_into IS NULL AND conflict = 1`,
  merged: `${LIVE} AND merged_into IS NOT NULL`,
};

export function countSegment(segment: Segment): number {
  const row = db().get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM contacts WHERE ${SEGMENT_WHERE[segment]}`,
  );
  return row?.n ?? 0;
}

/** One page of a segment. Always ordered the same way, so the pager cannot shuffle under a click. */
export function pageContacts(segment: Segment, page: number): ContactPage {
  const total = countSegment(segment);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const rows = db().all<Contact>(
    `SELECT * FROM contacts WHERE ${SEGMENT_WHERE[segment]}
     ORDER BY last_activity_at DESC, id ASC LIMIT ? OFFSET ?`,
    [PAGE_SIZE, (current - 1) * PAGE_SIZE],
  );
  return { rows, total, page: current, pages, segment };
}

export function getContact(id: string): Contact | undefined {
  return db().get<Contact>("SELECT * FROM contacts WHERE id = ?", [id]);
}

export function getContacts(ids: string[]): Contact[] {
  if (ids.length === 0) return [];
  const holes = ids.map(() => "?").join(",");
  return db().all<Contact>(`SELECT * FROM contacts WHERE id IN (${holes})`, ids);
}

export function segmentRows(segment: Segment): Contact[] {
  return db().all<Contact>(
    `SELECT * FROM contacts WHERE ${SEGMENT_WHERE[segment]} ORDER BY id ASC`,
  );
}

export function listRevisions(contactId: string, limit = 40): Revision[] {
  return db().all<Revision>(
    "SELECT * FROM revisions WHERE contact_id = ? ORDER BY id DESC LIMIT ?",
    [contactId, limit],
  );
}

/**
 * How many stored field changes each contact carries, keyed by contact id.
 *
 * `listRevisions` answers this one record at a time, which is the wrong shape
 * for a surface that has to show "changed rows" for every block on one screen:
 * that would be 800 queries. Reverted revisions are excluded, because a change
 * that was replayed backwards is not a change the record still carries.
 */
export function revisionCounts(): Record<string, number> {
  const rows = db().all<{ contact_id: string; n: number }>(
    `SELECT contact_id, COUNT(*) AS n FROM revisions
     WHERE reverted = 0 GROUP BY contact_id`,
  );
  const out: Record<string, number> = {};
  for (const row of rows) out[row.contact_id] = row.n;
  return out;
}

interface PairRow {
  id: string;
  keep_id: string;
  drop_id: string;
  confidence: number;
  evidence_json: string;
  status: PairStatus;
}

function toPair(row: PairRow): MergePair {
  return {
    id: row.id,
    keep_id: row.keep_id,
    drop_id: row.drop_id,
    confidence: row.confidence,
    status: row.status,
    evidence: JSON.parse(row.evidence_json) as Evidence[],
  };
}

/**
 * An open pair is only workable while both of its records are still in the working list.
 *
 * The write paths close a pair when either member is removed, and this is the read side of the
 * same rule: a pair whose members have both left cannot be attached to any block, so counting it
 * at the top of the sheet would promise work that appears nowhere below.
 */
const WORKABLE_PAIR = `status = 'open'
     AND EXISTS (SELECT 1 FROM contacts k
                  WHERE k.id = keep_id AND k.deleted_at IS NULL AND k.merged_into IS NULL)
     AND EXISTS (SELECT 1 FROM contacts d
                  WHERE d.id = drop_id AND d.deleted_at IS NULL AND d.merged_into IS NULL)`;

/** Open pairs, hardest evidence first, so a reviewer clears the easy wins before the judgement calls. */
export function listOpenPairs(limit = 60): MergePair[] {
  return db()
    .all<PairRow>(
      `SELECT * FROM merge_pairs WHERE ${WORKABLE_PAIR} ORDER BY confidence DESC, id ASC LIMIT ?`,
      [limit],
    )
    .map(toPair);
}

/**
 * How many open pairs there are, as opposed to how many `listOpenPairs` returned.
 *
 * `listOpenPairs` is capped, and a capped figure that does not say so is how a reader comes to
 * believe the sheet holds 200 pairs when it holds more (CLAUDE.md: announce truncation).
 */
export function countOpenPairs(): number {
  return (
    db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM merge_pairs WHERE ${WORKABLE_PAIR}`)?.n ?? 0
  );
}

/** Activity rows behind the sheet, uncapped - this is what a revision number counts. */
export function countActivity(): number {
  return db().get<{ n: number }>("SELECT COUNT(*) AS n FROM activity")?.n ?? 0;
}

export function pairsForContact(contactId: string): MergePair[] {
  return db()
    .all<PairRow>(
      "SELECT * FROM merge_pairs WHERE keep_id = ? OR drop_id = ? ORDER BY confidence DESC",
      [contactId, contactId],
    )
    .map(toPair);
}

export function getPair(pairId: string): MergePair | undefined {
  const row = db().get<PairRow>("SELECT * FROM merge_pairs WHERE id = ?", [pairId]);
  return row ? toPair(row) : undefined;
}

const COMPARED: { field: keyof Contact; label: string }[] = [
  { field: "first_name", label: "First name" },
  { field: "last_name", label: "Last name" },
  { field: "email", label: "Email" },
  { field: "phone", label: "Phone" },
  { field: "company", label: "Company" },
  { field: "title", label: "Title" },
  { field: "city", label: "City" },
  { field: "last_activity_at", label: "Last activity" },
];

/**
 * The fields two records disagree on, in display order.
 *
 * A pure function of the two rows and no query of its own, so a caller that is already holding
 * both records - the sheet holds all 800 - does not have to go back to the database for them.
 */
export function conflictsBetween(keep: Contact, drop: Contact): PairPreview["conflicts"] {
  return COMPARED.filter((c) => String(keep[c.field]) !== String(drop[c.field])).map((c) => ({
    field: String(c.field),
    label: c.label,
    keep: String(keep[c.field] ?? ""),
    drop: String(drop[c.field] ?? ""),
  }));
}

/** Both records plus the fields they disagree on: what the reviewer and `preview_merge` render. */
export function previewPair(pairId: string): PairPreview | undefined {
  const pair = getPair(pairId);
  if (!pair) return undefined;
  const keep = getContact(pair.keep_id);
  const drop = getContact(pair.drop_id);
  if (!keep || !drop) return undefined;
  return { pair, keep, drop, conflicts: conflictsBetween(keep, drop) };
}

export function defectCounts(): DefectCounts {
  const handle = db();
  const pairRows = handle.all<{ status: PairStatus; confidence: number }>(
    "SELECT status, confidence FROM merge_pairs",
  );
  const open = pairRows.filter((p) => p.status === "open");
  return {
    total: countSegment("all"),
    duplicates: countSegment("duplicates"),
    "phone-format": countSegment("phone-format"),
    stale: countSegment("stale"),
    conflicts: countSegment("conflicts"),
    merged: countSegment("merged"),
    pairs_total: pairRows.length,
    pairs_open: open.length,
    confident_open: open.filter((p) => p.confidence >= CONFIDENT_AT).length,
    uncertain_open: open.filter((p) => p.confidence < CONFIDENT_AT).length,
    pairs_merged: pairRows.filter((p) => p.status === "merged").length,
    pairs_kept: pairRows.filter((p) => p.status === "kept_both").length,
    pairs_skipped: pairRows.filter((p) => p.status === "skipped").length,
  };
}

/** The other spellings sharing this contact's email domain - the conflict, spelled out. */
export function domainSpellings(domain: string): { company: string; n: number }[] {
  return db().all<{ company: string; n: number }>(
    `SELECT TRIM(company) AS company, COUNT(*) AS n FROM contacts
     WHERE domain = ? AND ${LIVE} GROUP BY TRIM(company) ORDER BY n DESC, company ASC`,
    [domain],
  );
}

/**
 * Every domain's spellings, in one grouped pass, keyed by domain.
 *
 * `domainSpellings` answers this one domain at a time, which is the wrong shape for the sheet:
 * that is 46 statements for rows one GROUP BY already has. The inner ordering is
 * `domainSpellings`' own, because the block's consensus name is element 0.
 */
export function allDomainSpellings(): Record<string, { company: string; n: number }[]> {
  const rows = db().all<{ domain: string; company: string; n: number }>(
    `SELECT domain, TRIM(company) AS company, COUNT(*) AS n FROM contacts
     WHERE ${LIVE} GROUP BY domain, TRIM(company) ORDER BY domain, n DESC, company ASC`,
  );
  const out: Record<string, { company: string; n: number }[]> = {};
  for (const row of rows) {
    const list = out[row.domain];
    if (list) list.push({ company: row.company, n: row.n });
    else out[row.domain] = [{ company: row.company, n: row.n }];
  }
  return out;
}

/** One domain: how many ways its company is spelled, and how many people sit under each. */
export interface DomainConflict {
  domain: string;
  /** The spelling the most records carry - the obvious candidate for `canonical_name`. */
  consensus: string;
  /** On the studio's client registry, which is the list the campaign goes to. */
  client: boolean;
  contacts: number;
  spellings: { company: string; contacts: number }[];
}

/**
 * The company-name conflict, domain by domain - the read behind `read_conflicts` (design 4.6.4).
 *
 * One GROUP BY for every domain rather than `domainSpellings` per domain, and the same inner
 * ordering, because the consensus spelling is element 0 there too. Ordered worst first: most
 * spellings, then most people, so a bounded answer cuts the tail and not the story.
 */
export function listConflicts(domain?: string): DomainConflict[] {
  const all = allDomainSpellings();
  const wanted = domain ? { [domain]: all[domain] ?? [] } : all;
  return Object.entries(wanted)
    .filter(([, spellings]) => (domain ? true : spellings.length > 1))
    .map(([d, spellings]) => ({
      domain: d,
      consensus: spellings[0]?.company ?? "",
      client: CLIENT_DOMAINS.includes(d),
      contacts: spellings.reduce((n, s) => n + s.n, 0),
      spellings: spellings.map((s) => ({ company: s.company, contacts: s.n })),
    }))
    .sort(
      (a, b) =>
        b.spellings.length - a.spellings.length ||
        b.contacts - a.contacts ||
        a.domain.localeCompare(b.domain),
    );
}

/** `read_conflicts`' envelope: bounded, with the total beside it and the bound announced. */
export interface ConflictPage {
  domains: DomainConflict[];
  showing: number;
  total: number;
  footer: string;
}

/**
 * The bounded read itself, in the library rather than in the server action.
 *
 * The action is a `"use server"` module and imports `next/cache`, so nothing that runs outside a
 * Next build can call it - including the tests. Putting the cut here keeps the thing worth
 * pinning, the cut and its announcement, reachable from `node --test`.
 */
export function readConflicts(domain: string | undefined, limit: number): ConflictPage {
  const all = listConflicts(domain);
  const bounded = Math.max(1, Math.min(Math.trunc(limit) || MAX_DOMAINS, MAX_DOMAINS));
  const domains = all.slice(0, bounded);
  return {
    domains,
    showing: domains.length,
    total: all.length,
    footer: `(showing ${domains.length} of ${all.length})`,
  };
}

/** Live contacts on one domain, in id order. `resolve_company`'s write set. */
export function domainContacts(domain: string): Contact[] {
  return db().all<Contact>(
    `SELECT * FROM contacts WHERE domain = ? AND ${LIVE} AND merged_into IS NULL ORDER BY id ASC`,
    [domain],
  );
}

/** Every live contact grouped by the company they are filed under, biggest first. */
export function companyTotals(segment: Segment): { company: string; domain: string; contacts: number }[] {
  return db().all<{ company: string; domain: string; contacts: number }>(
    `SELECT TRIM(company) AS company, domain, COUNT(*) AS contacts FROM contacts
     WHERE ${SEGMENT_WHERE[segment]} GROUP BY TRIM(company), domain
     ORDER BY contacts DESC, company ASC`,
  );
}

export function displayName(c: Pick<Contact, "first_name" | "last_name">): string {
  return `${c.first_name} ${c.last_name}`.replace(/\s{2,}/g, " ").trim();
}
