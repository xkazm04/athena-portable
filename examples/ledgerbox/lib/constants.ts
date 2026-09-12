/** Client-safe app identity and every enum the host manifest addresses UI with. */
export const APP_ID = "ledgerbox";
export const APP_VERSION = "0.1.0";

/** Views `navigate` can open. Enums are mandatory for anything addressing UI (design 5.1). */
export const VIEWS = [
  "inbox",
  "overdue",
  "unmatched",
  "disputed",
] as const;
export type View = (typeof VIEWS)[number];

/** Inbox filters. `current_filter` is a readable; `navigate` can set three of them. */
export const FILTERS = ["all", "overdue", "unmatched", "disputed"] as const;
export type Filter = (typeof FILTERS)[number];

export const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  overdue: "Overdue",
  unmatched: "Unmatched",
  disputed: "Disputed",
};

/** Book-keeping categories. `categorize(ids, category)` addresses these. */
export const CATEGORIES = [
  "uncategorized",
  "design",
  "development",
  "consulting",
  "retainer",
  "reimbursable",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Reminder tone is the parameter the user keeps control of (design 4.6.1). */
export const TONES = ["gentle", "firm"] as const;
export type Tone = (typeof TONES)[number];

/**
 * The months the books cover - the ONE statement of the quarter's boundary.
 *
 * The `quarter` predicate (lib/filter-period.ts), the seed's first instant (QUARTER_START_ISO) and
 * the frozen clock (TODAY, asserted below) all derive from this list. That fact used to be written
 * four independent times across three files, and a disagreement between them was silent by
 * construction: every read path through `inPeriodClient` returned empty, so `summarize("quarter")`
 * came back all zeros, the aging report showed four empty buckets and `export_summary` wrote
 * "Nothing outstanding in this period." - with nothing thrown anywhere.
 */
export const MONTHS = ["2026-06", "2026-07", "2026-08"] as const;

/** Accounting periods present in the seed, plus the whole quarter. */
export const PERIODS = [...MONTHS, "quarter"] as const;
export type Period = (typeof PERIODS)[number];

/**
 * The quarter's bounds. `reduce` over a non-empty tuple rather than an index, so these are known
 * to be defined without a non-null assertion.
 */
export const QUARTER_FIRST_MONTH = MONTHS.reduce((a, b) => (b < a ? b : a));
export const QUARTER_LAST_MONTH = MONTHS.reduce((a, b) => (b > a ? b : a));

/** The seed's first instant: midnight on the first day of the first month. lib/seed.ts dates from it. */
export const QUARTER_START_ISO = `${QUARTER_FIRST_MONTH}-01T00:00:00.000Z`;

/** `2026-08` -> `2026-09`. The only month arithmetic the boundary needs. */
function monthAfter(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, "0")}`;
}

/*
 * The quarter predicate is a RANGE over MONTHS, so a gap or an unsorted entry would quietly pull a
 * month the tabs never show into every quarter total. Held here, at import, naming both values.
 */
MONTHS.forEach((month, i) => {
  const previous = i === 0 ? undefined : MONTHS[i - 1];
  if (previous !== undefined && month !== monthAfter(previous)) {
    throw new Error(
      `MONTHS must be contiguous and ascending: ${previous} is followed by ${month}, expected ${monthAfter(previous)}.`,
    );
  }
});

export const PERIOD_LABEL: Record<Period, string> = {
  "2026-06": "June 2026",
  "2026-07": "July 2026",
  "2026-08": "August 2026",
  quarter: "Jun - Aug 2026",
};

/** Ids may be addressed in bulk; design 5.1 requires a cap on every array parameter. */
export const MAX_IDS = 100;

/** Candidate credits offered for one invoice. The detail pane and `read_invoice` show the same few. */
export const DETAIL_CANDIDATES = 5;

/** Invoices offered per unapplied credit, on the strip and in `read_credits`. */
export const LINE_SUGGESTIONS = 3;

/** The books are frozen at this instant so the demo tells the same story on every machine. */
export const TODAY = "2026-09-01T00:00:00.000Z";

/*
 * TODAY is the day the quarter closed, so it belongs to the month after the last one on the books.
 * Moving one without the other leaves `days_overdue` and quarter membership describing different
 * years - the months keep reporting while the quarter goes quiet. Held here rather than discovered.
 */
if (TODAY.slice(0, 7) !== monthAfter(QUARTER_LAST_MONTH)) {
  throw new Error(
    `TODAY (${TODAY}) must fall in the month after the last of MONTHS (${QUARTER_LAST_MONTH}), ` +
      `that is ${monthAfter(QUARTER_LAST_MONTH)}. Move both or neither.`,
  );
}

export const CURRENCY = "USD";
export const LOCALE = "en-US";
