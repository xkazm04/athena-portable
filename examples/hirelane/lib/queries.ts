import "server-only";
/*
 * Every query a route actually reaches, and nothing else.
 *
 * This file used to carry fourteen exports; seven of them served the /applicant, /rubric,
 * /scheduling and /activity routes, which were reviewed out, and were held alive only by
 * lib/scope.ts, which nothing imported. Neither repo gate can see that - an exported symbol is
 * never unused to tsc, and eslint-config-next tracks no cross-module reachability - so the
 * domain layer read as twice the size of the shipped surface for as long as nobody counted.
 */
import { db } from "./db";
import type {
  Applicant,
  Criterion,
  CriterionScore,
  Message,
  Role,
  Slot,
} from "./types";

/** SQLite has no booleans and no arrays; these put the rows back into their declared shapes. */
interface ApplicantRow extends Omit<Applicant, "borderline"> {
  borderline: number;
}
interface CriterionRow extends Omit<Criterion, "keywords"> {
  keywords: string;
}

const toApplicant = (row: ApplicantRow): Applicant => ({ ...row, borderline: row.borderline === 1 });
const toCriterion = (row: CriterionRow): Criterion => ({
  ...row,
  keywords: JSON.parse(row.keywords) as string[],
});

export function listRoles(): Role[] {
  return db().all<Role>("SELECT * FROM roles ORDER BY id");
}

/** One role, for the two sends: a letter names the role it is about. */
export function getRole(roleId: string): Role | undefined {
  return db().get<Role>("SELECT * FROM roles WHERE id = ?", [roleId]);
}

export function listCriteria(roleId: string): Criterion[] {
  return db()
    .all<CriterionRow>("SELECT * FROM criteria WHERE role_id = ? ORDER BY ord", [roleId])
    .map(toCriterion);
}

export function listApplicants(roleId: string): Applicant[] {
  return db()
    .all<ApplicantRow>(
      "SELECT * FROM applicants WHERE role_id = ? ORDER BY borderline DESC, applied_at DESC",
      [roleId],
    )
    .map(toApplicant);
}

export function getApplicant(id: string): Applicant | undefined {
  const row = db().get<ApplicantRow>("SELECT * FROM applicants WHERE id = ?", [id]);
  return row ? toApplicant(row) : undefined;
}

export function listSlots(): Slot[] {
  return db().all<Slot>("SELECT * FROM slots ORDER BY start_ts");
}

export function listMessages(applicantId?: string): Message[] {
  return applicantId
    ? db().all<Message>("SELECT * FROM messages WHERE applicant_id = ? ORDER BY id DESC", [
        applicantId,
      ])
    : db().all<Message>("SELECT * FROM messages ORDER BY id DESC LIMIT 50");
}

/** Latest stored scorecard per applicant of a role. Unscored applicants are simply absent. */
export function latestScorecards(roleId: string): Record<string, CriterionScore[]> {
  const rows = db().all<{ applicant_id: string; scores_json: string }>(
    `SELECT applicant_id, scores_json FROM notes
     WHERE id IN (
       SELECT MAX(id) FROM notes WHERE kind = 'rubric' AND scores_json IS NOT NULL GROUP BY applicant_id
     )
     AND applicant_id IN (SELECT id FROM applicants WHERE role_id = ?)`,
    [roleId],
  );
  return Object.fromEntries(rows.map((r) => [r.applicant_id, JSON.parse(r.scores_json) as CriterionScore[]]));
}

/** One applicant's activity row, as the dossier's History band reads it. */
export interface ApplicantActivity {
  id: number;
  ts: string;
  action: string;
  summary: string;
  reversible: boolean;
  undone: boolean;
}

interface ApplicantActivityRow extends Omit<ApplicantActivity, "reversible" | "undone"> {
  applicant_id: string;
  reversible: number;
  undone: number;
  total: number;
}

/**
 * Each applicant's newest `limit` activity rows, newest first, and how many they have in all.
 *
 * Every act on a person logs `target = 'applicant:<id>'`, the agent's acts and every undo
 * included, so this one read is the whole record of what was done to them. Bounded in SQL per
 * applicant rather than after the fact, so a long history costs the page nothing it does not show.
 */
export function applicantHistory(limit: number): Record<string, { rows: ApplicantActivity[]; total: number }> {
  const rows = db().all<ApplicantActivityRow>(
    `SELECT id, ts, action, summary, reversible, undone, applicant_id, total FROM (
       SELECT id, ts, action, summary, reversible, undone,
              substr(target, length('applicant:') + 1) AS applicant_id,
              ROW_NUMBER() OVER (PARTITION BY target ORDER BY id DESC) AS rn,
              COUNT(*) OVER (PARTITION BY target) AS total
       FROM activity WHERE target LIKE 'applicant:%'
     ) WHERE rn <= ? ORDER BY id DESC`,
    [limit],
  );
  const out: Record<string, { rows: ApplicantActivity[]; total: number }> = {};
  for (const { applicant_id, total, reversible, undone, ...row } of rows) {
    const entry = (out[applicant_id] ??= { rows: [], total });
    entry.rows.push({ ...row, reversible: reversible === 1, undone: undone === 1 });
  }
  return out;
}
