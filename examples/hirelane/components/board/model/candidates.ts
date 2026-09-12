/**
 * A candidate, a criterion, a score, and the stage-specific facts.
 *
 * The rule this file exists to hold: `scored` is false until somebody scored
 * them, and `overall` is meaningless unless it is true. The design law puts it
 * as "the unscored are expressed by absence" — a zero is a score, and treating
 * an unread application as one is the worst thing this domain can do.
 */

import type { Stage } from "@/lib/constants";
import type { Band, Fit } from "./fit";
import type { StageRole } from "./stages";

export interface BdCriterion {
  id: string;
  name: string;
  /** Short enough to label a bar. */
  short: string;
  description: string;
  /** 1-3, multiplies into the weighted overall. */
  weight: number;
}

export interface BdScore {
  criterionId: string;
  name: string;
  short: string;
  /** 0-4. Zero means the application carried no evidence either way. */
  score: number;
  weight: number;
  /** The sentences the applicant wrote that earned it, quoted verbatim. */
  evidence: string[];
}

/**
 * The non-descriptive metadata one stage adds and the others do not.
 *
 * Every column shows a different thing because a different thing is true in it:
 * how long an untouched application has been sitting, how much of the rubric an
 * application actually speaks to, whose time is booked, what has been sent. All
 * four are stored columns, so none of them is a guess.
 */
export interface BdStageMeta {
  /** entry: whole days between the application and the frozen today. */
  waitingDays: number;
  /** screening: criteria carrying at least one quoted sentence, out of all. */
  evidenced: number;
  criteriaCount: number;
  /** interview: slots held for this candidate. */
  held: { id: string; interviewer: string; startTs: string; minutes: number }[];
  /** offer / closed: what has already reached this person. */
  sent: { kind: "scheduling" | "rejection"; subject: string; ts: string }[];
}

export interface BdCandidate {
  id: string;
  name: string;
  /** Initials for the monogram. There is no photograph and no proxy for one. */
  initials: string;
  headline: string;
  email: string;
  /** Current employer: one of the studio's clients, by name. */
  employer: string;
  years: number;
  stage: Stage;
  appliedAt: string;
  shortAnswer: string;
  cvText: string;
  /** False until somebody scored them, and then it stays honest. */
  scored: boolean;
  /** Weighted 0-4, meaningless unless `scored`. */
  overall: number;
  fit: Fit;
  band: Band;
  /** Why the band is as wide as it is: the criteria with nothing quoted. */
  bandDrivers: string[];
  scores: BdScore[];
  /** The one criterion with no evidence, when there is exactly one. */
  gap: string | null;
  gapId: string | null;
  line: string;
  borderline: boolean;
  meta: BdStageMeta;
}

export interface BdColumn {
  id: Stage;
  label: string;
  role: StageRole;
  wait: string;
  candidates: BdCandidate[];
  /** Mean weighted score of the SCORED candidates only. */
  mean: number;
  scored: number;
  borderline: number;
}

export interface BdRole {
  id: string;
  title: string;
  team: string;
  brief: string;
  question: string;
  criteria: BdCriterion[];
  columns: BdColumn[];
  totals: {
    applicants: number;
    scored: number;
    borderline: number;
  };
}

export interface BdBoard {
  roles: BdRole[];
  openSlots: { id: string; interviewer: string; startTs: string; minutes: number }[];
  /** Stage id -> the label the board prints. Sent down so no component has to
   *  import the constants module just to render a column heading. */
  stageLabel: Record<Stage, string>;
}

/** One role's slice of one stage: the thing the board opens. */
export interface BdColumnGroup {
  role: BdRole;
  column: BdColumn;
}
