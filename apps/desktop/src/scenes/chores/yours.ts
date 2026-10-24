/**
 * "Your chores" on the catalogue — README section 3.5, ADR 0123 and 0131.
 *
 * Pure: the person's saved cases (`GET /adopt/cases` with no playbook, every case) joined to the
 * chores this build ships, and ordered so what is waiting for them is read first: a case whose due
 * review is open (unanswered), oldest due first, then the latest approval. A case whose chore this
 * build does not ship is counted and said, never dropped in silence. Each state with no row is said
 * in the words the topic page's "Your case" uses (`casesLine`).
 */
import type { CaseSummary, ChoreReview, DueReview } from "@/lib/adopt";
import type { PlaybookView, PlaybooksModel } from "@/modules/playbooks/model";

import { dayOf } from "./adopt/state";

/** What the catalogue knows of the person's saved cases. No deps, no band: there is no `no-daemon`. */
export type YoursState =
  | { kind: "looking" }
  | {
      kind: "found";
      cases: CaseSummary[];
      footer: string;
      reviews: ReadonlyMap<string, DueReview | null>;
    }
  | { kind: "failed"; offline: boolean; detail: string };

/** One saved case, as the band draws it. */
export interface YourRow {
  caseId: string;
  playbookId: string;
  view: PlaybookView;
  /** The chore's short title. */
  chore: string;
  /** The case's own title, or the chore's when it has none. */
  title: string;
  /** `Last approved 2026-10-08`. */
  approved: string;
  /** `7 of 9 confirmed`. */
  confirmed: string;
  /** `Due 2026-10-24`, `Due 2026-10-24 and 2 missed`, or "" when nothing is waiting. */
  due: string;
  /** The open review's due instant, "" when none: the order's first key. */
  dueAt: string;
  approvedAt: string;
}

export interface Yours {
  rows: YourRow[];
  /** Saved cases whose chore this build does not ship. */
  elsewhere: number;
  /** Those, said; "" when there are none. */
  elsewhereLine: string;
}

/** The review a due occurrence opened and the person has not answered yet, or null. */
export function openReview(review: DueReview | null | undefined): ChoreReview | null {
  const r = review?.review;
  return r && r.answer === "" && r.due_at ? r : null;
}

/** `2026-10-24`, the local day of an ISO instant (the day the person lives it). */
export function localDay(iso: string): string {
  const at = new Date(iso);
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso) || Number.isNaN(at.getTime())) return dayOf(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function yoursOf(
  model: PlaybooksModel,
  cases: readonly CaseSummary[],
  reviews: ReadonlyMap<string, DueReview | null>,
): Yours {
  const byId = new Map(model.items.map((v) => [v.id, v]));
  const rows: YourRow[] = [];
  let elsewhere = 0;
  for (const c of cases) {
    const view = byId.get(c.playbook_id);
    if (!view) {
      elsewhere += 1;
      continue;
    }
    const open = openReview(reviews.get(c.case_id));
    rows.push({
      caseId: c.case_id,
      playbookId: c.playbook_id,
      view,
      chore: view.playbook.shortTitle,
      title: c.title || view.playbook.shortTitle,
      approved: `Last approved ${dayOf(c.approved_at)}`,
      confirmed: `${c.confirmed} of ${c.slots} confirmed`,
      due: open ? `Due ${localDay(open.due_at)}${open.missed > 0 ? ` and ${open.missed} missed` : ""}` : "",
      dueAt: open ? open.due_at : "",
      approvedAt: c.approved_at,
    });
  }
  rows.sort((a, b) => {
    if (a.dueAt && b.dueAt) return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0;
    if (a.dueAt || b.dueAt) return a.dueAt ? -1 : 1;
    return a.approvedAt < b.approvedAt ? 1 : a.approvedAt > b.approvedAt ? -1 : 0;
  });
  const elsewhereLine =
    elsewhere === 0
      ? ""
      : elsewhere === 1
        ? "1 saved case is for a chore this build does not ship."
        : `${elsewhere} saved cases are for chores this build does not ship.`;
  return { rows, elsewhere, elsewhereLine };
}

/** The chores this build ships that the person has a saved case for: what `Yours` narrows to. */
export function hasCase(model: PlaybooksModel, cases: readonly CaseSummary[]): Set<string> {
  const shipped = new Set(model.items.map((v) => v.id));
  return new Set(cases.map((c) => c.playbook_id).filter((id) => shipped.has(id)));
}

/** The one line the band says when it has no case to show, or "" when it has. */
export function yoursLine(state: YoursState): string {
  switch (state.kind) {
    case "looking":
      return "Looking for the cases you saved…";
    case "failed":
      return state.offline
        ? "Your chores could not be looked up: the daemon is not running."
        : `Your chores could not be looked up: ${state.detail}`;
    case "found":
      return state.cases.length
        ? ""
        : "No saved case yet. Approve a brief with her on a chore's page and it is listed here, what comes due first.";
  }
}
