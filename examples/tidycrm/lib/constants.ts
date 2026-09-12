/** Client-safe app identity. `lib/db.ts` is server-only, so the ids live here too. */
export const APP_ID = "tidycrm";
export const APP_VERSION = "0.1.0";

/**
 * Views `navigate` can open. Enums are mandatory for anything addressing UI (design 5.1).
 *
 * One entry, because the app has one screen. The enum used to hold `directions` as well, for an
 * index of design drafts at `/v`; that route is gone and the sheet is the root, so the enum names
 * what exists and nothing else.
 */
export const VIEWS = ["blocks"] as const;
export type View = (typeof VIEWS)[number];

export const VIEW_PATHS: Record<View, string> = {
  blocks: "/",
};

/**
 * Segments double as the list filter and as the `export` parameter.
 *
 * `clients` is the campaign audience: the people on the studio's fifteen registry domains
 * (`COMPANIES`, @athena/demo-kit/seed), which is the list act 3 actually sends to. It is a
 * membership, not a defect, so it sits beside the five defect segments rather than among them.
 */
export const SEGMENTS = [
  "all",
  "clients",
  "duplicates",
  "phone-format",
  "stale",
  "conflicts",
  "merged",
] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABELS: Record<Segment, string> = {
  all: "All contacts",
  clients: "Client contacts",
  duplicates: "Duplicates",
  "phone-format": "Phone format",
  stale: "Stale",
  conflicts: "Company conflicts",
  merged: "Merged",
};

export const SEGMENT_HINTS: Record<Segment, string> = {
  all: "Every contact still in the list.",
  clients: "On one of the studio's fifteen client domains: the campaign audience.",
  duplicates: "In an unresolved near-duplicate pair.",
  "phone-format": "Phone number is not stored as +1XXXXXXXXXX.",
  stale: "No activity for more than 18 months.",
  conflicts: "Company spelled differently from others on the same email domain.",
  merged: "Folded into another record and kept for the audit trail.",
};

/** 800 rows: paginate rather than pretending a browser enjoys one long table. */
export const PAGE_SIZE = 50;

/** A pair at or above this score is a confident merge; below it a human decides. */
export const CONFIDENT_AT = 0.8;

/** The clock the seed is built around, so screenshots stay true. */
export const NOW_ISO = "2026-09-01T09:00:00.000Z";

/** Stale means no activity for this many months before `NOW_ISO`. */
export const STALE_MONTHS = 18;

/** Design 5.1 caps any array that addresses UI. The manifest and the server use this one number. */
export const MAX_IDS = 500;

/** `read_conflicts` returns at most this many domains, and says so (CLAUDE.md). */
export const MAX_DOMAINS = 20;

/** `preview_company` lists at most this many per-contact rewrites, and says so. */
export const MAX_REWRITES = 25;

/** The export summary names at most this many companies, and says so. */
export const MAX_COMPANIES = 25;
