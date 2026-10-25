/** Row shapes shared between server queries and client components. No server imports here. */
import type { Segment } from "./constants";

/** SQLite has no boolean; flags come back as 0 or 1. */
export type Flag = 0 | 1;

export interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company: string;
  domain: string;
  title: string;
  city: string;
  last_activity_at: string;
  created_at: string;
  /** Denormalised defect flags, indexed so a segment page never scans 800 rows. */
  phone_ok: Flag;
  is_stale: Flag;
  stale_flagged: Flag;
  conflict: Flag;
  in_open_pair: Flag;
  merged_into: string | null;
  deleted_at: string | null;
}

export type PairStatus = "open" | "merged" | "kept_both" | "skipped";

/** One matching rule that fired, with the weight it contributed and what it saw. */
export interface Evidence {
  rule: string;
  label: string;
  weight: number;
  detail: string;
}

export interface MergePair {
  id: string;
  keep_id: string;
  drop_id: string;
  confidence: number;
  status: PairStatus;
  evidence: Evidence[];
}

/** A pair with both records attached: what the reviewer and `preview_merge` both render. */
export interface PairPreview {
  pair: MergePair;
  keep: Contact;
  drop: Contact;
  /** Fields where the two records disagree, in display order. */
  conflicts: { field: string; label: string; keep: string; drop: string }[];
}

/** One value the merge's survivor takes from the record folded into it. */
export interface MergeAdoption {
  field: "phone" | "last_activity_at";
  from: string;
  to: string;
}

/**
 * One stored flag the merge moves: on a named row, or on every working row of a domain (a company
 * spelling count is the domain's, so its flag moves for all of them at once).
 */
export type MergeRestamp =
  | { flag: "phone_ok" | "is_stale" | "in_open_pair"; id: string; from: Flag; to: Flag }
  | { flag: "conflict"; domain: string; from: Flag; to: Flag };

/**
 * What `merge_contacts` will write, from the planner the write itself runs (lib/mutations.ts
 * `planMerge`, ADR 0168). The merge is GATED and irreversible; this is what the person reads
 * before the yes.
 */
export interface MergeOutcome {
  /** Set when the write would refuse: the exact error string `mergeContacts` returns. */
  refusal?: string;
  adopts: MergeAdoption[];
  /** Other open pairs the dropped record stands in, closed as `skipped`. */
  closes: string[];
  restamps: MergeRestamp[];
  /** The surviving record's stored values after the write; null when the write would refuse. */
  survivor: { id: string; phone: string; last_activity_at: string; phone_ok: Flag; is_stale: Flag } | null;
  /** The outcome as one sentence, for an approval card or a reply. */
  summary: string;
}

/** `preview_merge`: the side-by-side evidence plus what the merge will write. */
export interface MergePreview extends PairPreview {
  outcome: MergeOutcome;
}

export interface Revision {
  id: number;
  contact_id: string;
  field: string;
  old_value: string;
  new_value: string;
  rules: string;
  ts: string;
  reverted: Flag;
}

export interface DefectCounts {
  total: number;
  duplicates: number;
  "phone-format": number;
  stale: number;
  conflicts: number;
  merged: number;
  /** Pair-review progress, the numbers the dashboard strip is built from. */
  pairs_total: number;
  pairs_open: number;
  confident_open: number;
  uncertain_open: number;
  pairs_merged: number;
  pairs_kept: number;
  pairs_skipped: number;
}

export interface ContactPage {
  rows: Contact[];
  total: number;
  page: number;
  pages: number;
  segment: Segment;
}

/** A candidate pair as the detail view needs it: the pair plus the record on the other side. */
export interface RelatedPair {
  pair: MergePair;
  /** True when this contact is the one the pair proposes to keep. */
  isKeeper: boolean;
  other: Contact;
}
