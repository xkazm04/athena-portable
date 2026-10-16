/**
 * The board, as an agent reads it.
 *
 * One rule holds this file together, and it is the design law's: **the unscored
 * are expressed by absence.** A candidate nobody has scored has no `overall`
 * and no `fit` here, not a zero and not a null — because a zero is a score and
 * saying it would let an agent rank an unread application below a bad one. The
 * `scored` flag is the whole answer, and everything that depends on it is
 * simply not in the object.
 *
 * Nothing here invents a demographic fact either. There is no photograph in
 * this database and no proxy for one, so an agent gets a name, a headline and
 * evidence — the same things a reader gets.
 */
import { companyByName } from "@athena/demo-kit/seed";

import { actsFor, isFree, refusalFor, type Act, type ActPerson, type ActSlot } from "@/lib/acts";
import { DECISION_STAGES, STAGES } from "@/lib/constants";
import { keepsCandidate, keepsRole, type BoardFilter } from "../columns/filter";
import {
  BAND_LABEL,
  FIT_LABEL,
  groupId,
  STAGE_WAIT,
  type BdBoard,
  type BdCandidate,
  type BdColumn,
  type BdRole,
} from "../model";

/** One candidate at the depth a row or a card shows. */
export function candidateRead(candidate: BdCandidate) {
  return {
    id: candidate.id,
    name: candidate.name,
    headline: candidate.headline,
    // The cross-app key. The employer resolves to the domain Ledgerbox invoices
    // and TidyCRM files contacts under, so an agent can carry this person to
    // either of the other two apps without a lookup.
    employer: candidate.employer,
    employer_domain: companyByName(candidate.employer)?.domain ?? null,
    years: candidate.years,
    stage: candidate.stage,
    applied: candidate.appliedAt.slice(0, 10),
    scored: candidate.scored,
    // Absence, not a zero: see the file header.
    ...(candidate.scored
      ? {
          overall: candidate.overall,
          fit: FIT_LABEL[candidate.fit],
          confidence: BAND_LABEL[candidate.band],
          uncertain_because: candidate.bandDrivers,
        }
      : {}),
    arguable: candidate.borderline,
    missing_evidence_for: candidate.gap,
    summary: candidate.line,
  };
}

/** One act as the agent reads it: open with its choices, or shut with the server's own words. */
function actRead<C extends object>(act: Act, person: ActPerson, choices: C) {
  return act.enabled
    ? { enabled: true as const, ...choices }
    : { enabled: false as const, reason: act.reason, why: act.reason ? refusalFor(act.reason, person) : undefined };
}

/**
 * Which tools would accept this person right now, keyed by tool name.
 *
 * It is `actsFor` - the module the dossier's buttons are drawn from and the actions guard with -
 * so the agent sees the option set the person sees, including the slots held for this candidate,
 * which come first.
 */
function actsRead(candidate: BdCandidate, slots: readonly ActSlot[]) {
  const acts = actsFor(candidate, slots);
  return {
    score_against_rubric: actRead(acts.score, candidate, {}),
    move_stage: actRead(acts.move, candidate, { stage: acts.move.to }),
    propose_slots: actRead(acts.propose, candidate, {}),
    decide_stage: actRead(acts.offer, candidate, { stages: [...DECISION_STAGES] }),
    send_rejection: actRead(acts.reject, candidate, {}),
    send_scheduling_email: actRead(acts.schedule, candidate, {
      slots: acts.schedule.slots.map((s) => ({
        id: s.id,
        interviewer: s.interviewer,
        starts: s.startTs,
        minutes: s.minutes,
        held_for_them: s.applicantId === candidate.id,
      })),
    }),
  };
}

/** The same candidate with the evidence behind every score, and what may be done to them: L2. */
export function dossierRead(role: BdRole, candidate: BdCandidate, slots: readonly ActSlot[]) {
  return {
    ...candidateRead(candidate),
    email: candidate.email,
    role: role.title,
    team: role.team,
    question_asked: role.question,
    their_answer: candidate.shortAnswer,
    scores: candidate.scores.map((s) => ({
      criterion: s.name,
      weight: s.weight,
      score: s.score,
      evidence: s.evidence,
    })),
    waiting_days: candidate.meta.waitingDays,
    criteria_evidenced: `${candidate.meta.evidenced} of ${candidate.meta.criteriaCount}`,
    slots_held: candidate.meta.held.map((h) => ({
      id: h.id,
      interviewer: h.interviewer,
      starts: h.startTs,
      minutes: h.minutes,
    })),
    already_sent: candidate.meta.sent.map((s) => ({ kind: s.kind, subject: s.subject, at: s.ts })),
    acts: actsRead(candidate, slots),
  };
}

/** The whole board, which is L0: the roles, the stages, and how many slots nobody holds. */
export function boardRead(board: BdBoard) {
  return {
    roles: board.roles.map(roleRead),
    stages: STAGES.map((stage) => ({ id: stage, label: board.stageLabel[stage] })),
    // Counted by `isFree`, the predicate Propose slots takes from, not by a capped display list.
    open_interview_slots: board.slots.filter(isFree).length,
  };
}

/**
 * Every group the board is drawing, under the board's own filters: what `read_view` lists,
 * `open_group` may open and `set_filter` counts. The rows are `columns/filter.ts`'s, the module
 * the columns draw with, so an agent is never told about a row the reader cannot see.
 */
export function boardGroups(board: BdBoard, filter: BoardFilter) {
  return board.roles
    .filter((role) => keepsRole(role, filter))
    .flatMap((role) =>
      role.columns
        .map((column) => ({ column, count: column.candidates.filter((c) => keepsCandidate(c, filter)).length }))
        .filter(({ count }) => count > 0)
        .map(({ column, count }) => ({
          id: groupId(column.id, role.id),
          label: `${role.title} · ${column.label}`,
          count,
        })),
    );
}

/** One role's slice of one stage: the thing the board opens. */
export function groupRead(role: BdRole, column: BdColumn) {
  return {
    id: `${column.id}::${role.id}`,
    stage: column.id,
    stage_label: column.label,
    waiting_for: STAGE_WAIT[column.id],
    role: role.title,
    here: column.candidates.length,
    scored: column.scored,
    arguable: column.borderline,
    // Only meaningful when somebody has been scored, so it goes when nobody has.
    ...(column.scored > 0 ? { mean_of_the_scored: Number(column.mean.toFixed(2)) } : {}),
  };
}

/** One role, as the filter chips name it. */
export function roleRead(role: BdRole) {
  return {
    id: role.id,
    title: role.title,
    team: role.team,
    brief: role.brief,
    rubric: role.criteria.map((c) => ({
      id: c.id,
      name: c.name,
      weight: c.weight,
      what_it_asks: c.description,
    })),
    applicants: role.totals.applicants,
    scored: role.totals.scored,
    arguable: role.totals.borderline,
  };
}
