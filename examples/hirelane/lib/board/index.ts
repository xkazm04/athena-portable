/**
 * Builds the one dataset The Board reads (design 4.6.2).
 *
 * Read once per request and handed down as plain props, so moving from the board
 * to a column to a candidate is a transform and never a fetch. A level change
 * that waits is a level change that pops.
 *
 * It builds BOTH open roles rather than resolving one.
 * A kanban whose columns are the pipeline has to be able to answer "which role
 * am I looking at", and the two roles in this database have deliberately
 * different shapes: the six borderline applicants are all on Backend, all
 * sitting in screening, which is the case the comparison level exists for.
 */
import "server-only";

import { STAGE_LABEL, STAGES, TODAY } from "../constants";
import { insightsFor } from "../insights";
import {
  latestScorecards,
  listApplicants,
  listCriteria,
  listMessages,
  listRoles,
  listSlots,
} from "../queries";
import type { Applicant, CriterionScore } from "../types";
import {
  STAGE_ROLE,
  STAGE_WAIT,
  byScoreDesc,
  fitOf,
  type BdBoard,
  type BdCandidate,
  type BdColumn,
  type BdCriterion,
  type BdRole,
} from "@/components/board/model";
import { MS_DAY, bandOf, initialsOf, shorten } from "./read";

export function buildBoard(): BdBoard {
  const roles = listRoles();
  const slots = listSlots();
  const messages = listMessages();

  const heldBy = new Map<string, BdCandidate["meta"]["held"]>();
  for (const s of slots) {
    if (!s.applicant_id || s.status === "open") continue;
    const list = heldBy.get(s.applicant_id) ?? [];
    list.push({ id: s.id, interviewer: s.interviewer, startTs: s.start_ts, minutes: s.minutes });
    heldBy.set(s.applicant_id, list);
  }

  const sentBy = new Map<string, BdCandidate["meta"]["sent"]>();
  for (const m of messages) {
    const list = sentBy.get(m.applicant_id) ?? [];
    list.push({ kind: m.kind, subject: m.subject, ts: m.ts });
    sentBy.set(m.applicant_id, list);
  }

  const built: BdRole[] = roles.map((role) => {
    // Listed ONCE and passed on. `insightsFor` used to call this again with the same argument, and
    // to re-issue the scorecard query `latestScorecards` is about to issue.
    const roleCriteria = listCriteria(role.id);
    const criteria: BdCriterion[] = roleCriteria.map((c) => ({
      id: c.id,
      name: c.name,
      short: shorten(c.name),
      description: c.description,
      weight: c.weight,
    }));

    const applicants = listApplicants(role.id);
    const cards = latestScorecards(role.id);
    const insights = insightsFor(applicants, cards, roleCriteria);

    /** An unscored candidate still gets a full-length row of zeroes, so the
     *  shape is the same for everyone and the absence reads as an absence
     *  rather than as a hole in the layout. */
    const blank = (): CriterionScore[] =>
      criteria.map((c) => ({
        criterion_id: c.id,
        name: c.name,
        score: 0,
        weight: c.weight,
        evidence: [],
      }));

    const toCandidate = (a: Applicant): BdCandidate => {
      const stored = cards[a.id];
      const scores = stored ?? blank();
      const insight = insights[a.id];
      const gapName = insight?.gap ?? null;
      const gapId = criteria.find((c) => c.name === gapName)?.id ?? a.gap_criterion_id;
      const scored = Boolean(stored);
      // `insight.overall` is the same overallScore(stored) call, already made.
      const overall = insight?.overall ?? 0;
      const { band, drivers } = bandOf(scores);

      return {
        id: a.id,
        name: a.name,
        initials: initialsOf(a.name),
        headline: a.headline,
        email: a.email,
        employer: a.employer,
        years: a.years,
        stage: a.stage,
        appliedAt: a.applied_at,
        shortAnswer: a.short_answer,
        cvText: a.cv_text,
        scored,
        overall,
        fit: fitOf(scored, overall),
        band,
        bandDrivers: drivers,
        scores: criteria.map((c) => {
          const s = scores.find((x) => x.criterion_id === c.id);
          return {
            criterionId: c.id,
            name: c.name,
            short: c.short,
            score: s?.score ?? 0,
            weight: c.weight,
            evidence: s?.evidence ?? [],
          };
        }),
        gap: gapName,
        gapId: gapId ?? null,
        line: insight?.line ?? "Nobody has scored this application yet.",
        borderline: a.borderline,
        meta: {
          waitingDays: Math.max(
            0,
            Math.floor((Date.parse(TODAY) - Date.parse(a.applied_at)) / MS_DAY),
          ),
          evidenced: scores.filter((s) => s.evidence.length > 0).length,
          criteriaCount: criteria.length,
          held: heldBy.get(a.id) ?? [],
          sent: sentBy.get(a.id) ?? [],
        },
      };
    };

    const columns: BdColumn[] = STAGES.map((id) => {
      const candidates = applicants
        .filter((a) => a.stage === id)
        .map(toCandidate)
        .sort(byScoreDesc);
      const scored = candidates.filter((c) => c.scored);
      return {
        id,
        label: STAGE_LABEL[id],
        role: STAGE_ROLE[id],
        wait: STAGE_WAIT[id],
        candidates,
        mean: scored.length > 0 ? scored.reduce((s, c) => s + c.overall, 0) / scored.length : 0,
        scored: scored.length,
        borderline: candidates.filter((c) => c.borderline).length,
      } satisfies BdColumn;
    });

    const all = columns.flatMap((c) => c.candidates);

    return {
      id: role.id,
      title: role.title,
      team: role.team,
      brief: role.brief,
      question: role.question,
      criteria,
      columns,
      totals: {
        applicants: all.length,
        scored: all.filter((c) => c.scored).length,
        borderline: all.filter((c) => c.borderline).length,
      },
    } satisfies BdRole;
  });

  return {
    roles: built,
    stageLabel: STAGE_LABEL,
    openSlots: slots
      .filter((s) => s.status === "open")
      .slice(0, 12)
      .map((s) => ({
        id: s.id,
        interviewer: s.interviewer,
        startTs: s.start_ts,
        minutes: s.minutes,
      })),
  };
}
