/**
 * The two reads the screening journey is built on: the pile, and the shortlist it produces.
 *
 * `read_view` describes where the VIEW is; these describe where the PEOPLE are, and they do it
 * without moving anything, so an agent can decide over the whole applied pile before it opens a
 * single group. Both are pure functions over the one payload `lib/board/index.ts` built, which is
 * what lets a test read them without a browser.
 *
 * Two rules carry over from `./read.ts` and neither is negotiable here:
 *
 *   - **The unscored are expressed by absence.** No `score` key at all until somebody scored them.
 *     A zero is a score, and an unread application must never be rankable against a read one.
 *   - **Nothing invents a demographic fact.** What comes back is what a reader gets: a name, an
 *     address, where they work now, what stage they are at, and the sentence they wrote that
 *     earned each number. There is no column behind this file that could carry anything else.
 *
 * `employer_domain` is the cross-app key and the only reason the employer is here: it resolves
 * through the shared `COMPANIES` registry, so an applicant who works at a company the other two
 * tabs also know can be recognised without a lookup. It is context and it is never an input —
 * no score, no stage and no ordering in this file reads it.
 */
import { companyByName } from "@athena/demo-kit/seed";

import type { BdBoard, BdCandidate, BdRole } from "../model";

/** How many applicants one roster read returns before it says what it left out. */
export const ROSTER_PAGE = 40;
/** How many advanced applicants one shortlist carries. A shortlist longer than this is a pile. */
export const SHORTLIST_PAGE = 12;

/** The stages an applicant has been advanced INTO. A shortlist is the people who got there. */
const ADVANCED = new Set(["interview", "offer"]);

/** The truncation sentence this repo says once, everywhere (CLAUDE.md, README invariant 4). */
function showingOf(showing: number, of: number): string {
  return `(showing ${showing} of ${of})`;
}

/**
 * One applicant, at the depth a screening decision needs.
 *
 * Every field here is one the demo journey names: the id to act on, the name and address a
 * message is addressed to, the employer and its domain for the cross-app beat, the stage, whether
 * a person flagged them borderline, the criterion their application never mentions, and the score
 * IF one exists.
 */
export function applicantRead(candidate: BdCandidate) {
  return {
    id: candidate.id,
    name: candidate.name,
    email: candidate.email,
    employer: candidate.employer,
    employer_domain: companyByName(candidate.employer)?.domain ?? null,
    stage: candidate.stage,
    borderline: candidate.borderline,
    /** The criterion with no evidence behind it, by name. Null when there is not exactly one. */
    gap: candidate.gap,
    scored: candidate.scored,
    // Absence, not a zero: see the file header.
    ...(candidate.scored ? { score: candidate.overall } : {}),
  };
}

export interface RosterQuery {
  role_id: string;
  stage?: string;
  borderline?: boolean;
}

function roleOf(board: BdBoard, roleId: string): BdRole | undefined {
  return board.roles.find((r) => r.id === roleId);
}

function noSuchRole(board: BdBoard, roleId: string) {
  return {
    ok: false as const,
    error: `No role with id ${roleId}.`,
    roles: board.roles.map((r) => ({ id: r.id, title: r.title })),
  };
}

/**
 * Every applicant on one role, optionally at one stage, best-scored first.
 *
 * The order is the same two-part order `search_candidates` uses and for the same reason: the
 * scored rank against each other, the unscored rank by how long they have been waiting, and the
 * two groups never interleave.
 */
export function readApplicants(board: BdBoard, q: RosterQuery) {
  const role = roleOf(board, q.role_id);
  if (!role) return noSuchRole(board, q.role_id);

  const found = role.columns
    .filter((column) => q.stage === undefined || q.stage === "all" || column.id === q.stage)
    .flatMap((column) => column.candidates)
    .filter((c) => q.borderline !== true || c.borderline)
    .sort((a, b) => {
      if (a.scored !== b.scored) return a.scored ? -1 : 1;
      if (a.scored) return b.overall - a.overall;
      return b.meta.waitingDays - a.meta.waitingDays;
    });

  const kept = found.slice(0, ROSTER_PAGE);
  return {
    ok: true as const,
    role_id: role.id,
    role: role.title,
    stage: q.stage ?? "all",
    showing: kept.length,
    of: found.length,
    bounded: showingOf(kept.length, found.length),
    applicants: kept.map(applicantRead),
  };
}

/** One advanced applicant with the sentence behind every criterion they scored on. */
function shortlistEntry(candidate: BdCandidate) {
  return {
    ...applicantRead(candidate),
    headline: candidate.headline,
    evidence: candidate.scores
      .filter((s) => s.evidence.length > 0)
      .map((s) => ({ criterion: s.name, score: s.score, quote: s.evidence[0]! })),
  };
}

function markdownFor(
  title: string,
  role: BdRole,
  entries: ReturnType<typeof shortlistEntry>[],
  of: number,
): string {
  const lines = [`# ${title}`, "", `**${role.title}** · ${role.team} · ${showingOf(entries.length, of)}`, ""];
  if (entries.length === 0) {
    lines.push("Nobody has been advanced to interview or offer on this role yet.");
    return lines.join("\n");
  }
  for (const entry of entries) {
    lines.push(`## ${entry.name}`);
    lines.push("");
    lines.push(
      `- **Stage:** ${entry.stage}`,
      `- **Now at:** ${entry.employer}${entry.employer_domain ? ` (${entry.employer_domain})` : ""}`,
      `- **Contact:** ${entry.email}`,
      ...("score" in entry ? [`- **Weighted score:** ${entry.score} of 4`] : ["- **Weighted score:** not scored"]),
      ...(entry.gap ? [`- **No evidence for:** ${entry.gap}`] : []),
      "",
      "Evidence, quoted from their own application:",
      "",
    );
    for (const e of entry.evidence) {
      lines.push(`- **${e.criterion}** (${e.score}/4) — "${e.quote}"`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * The close of the journey: a shortlist a person can paste into a Notion page.
 *
 * Only the applicants who were actually advanced — interview and offer — and every one of them
 * carries the sentence they wrote that earned each score, so the page can be argued with rather
 * than merely agreed to. The markdown and the array are the same people in the same order; the
 * markdown exists because the destination is a document, and the array because the caller may
 * want to do something else with it.
 */
export function readShortlist(board: BdBoard, roleId: string) {
  const role = roleOf(board, roleId);
  if (!role) return noSuchRole(board, roleId);

  const advanced = role.columns
    .filter((column) => ADVANCED.has(column.id))
    .flatMap((column) => column.candidates)
    .sort((a, b) => b.overall - a.overall);

  const kept = advanced.slice(0, SHORTLIST_PAGE).map(shortlistEntry);
  const title = `${role.title} — shortlist`;
  return {
    ok: true as const,
    role_id: role.id,
    title,
    markdown: markdownFor(title, role, kept, advanced.length),
    showing: kept.length,
    of: advanced.length,
    bounded: showingOf(kept.length, advanced.length),
    applicants: kept,
  };
}
