/**
 * A candidate, a criterion, a score, and the stage-specific facts.
 *
 * The rule this file exists to hold: `scored` is false until somebody scored
 * them, and `overall` is meaningless unless it is true. The design law puts it
 * as "the unscored are expressed by absence" — a zero is a score, and treating
 * an unread application as one is the worst thing this domain can do.
 *
 * The evidence facets hold the same rule by type rather than by a flag: `evidence`
 * is null until there is a stored scorecard to count, so no reader can print an
 * evidence count, a band or an "uncertain because" for an application nobody read.
 */

import type { ActSlot } from "@/lib/acts";
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
  /**
   * interview: every slot that is this candidate's, held or booked. `booked` is an interview they
   * have been emailed about; `held` is time Propose slots is keeping for them and nobody has sent.
   */
  held: { id: string; interviewer: string; startTs: string; minutes: number; status: "held" | "booked" }[];
  /** offer / closed: what has already reached this person. */
  sent: { kind: "scheduling" | "rejection"; subject: string; ts: string }[];
  /** Every stage: the newest acts on this person, newest first, bounded by `HISTORY_SHOWN`. */
  history: BdHistoryRow[];
  /** How many acts there are in all, so the band can say what it is not showing. */
  historyTotal: number;
}

/**
 * One act on a person, as the dossier's History band draws it. Built by `historyRow`, which is the
 * one place that decides whether a row gets an Undo and, when it does not, what it says instead.
 */
export interface BdHistoryRow {
  /** The activity row id, which is what `undoAction` takes. */
  id: number;
  ts: string;
  /** Who ran the act, as the band prints it: "Athena", "You", or "Hirelane" for the seed. */
  by: string;
  action: string;
  summary: string;
  undone: boolean;
  /** Reversible and not yet undone: the row draws an Undo. */
  undoable: boolean;
  /** Present exactly when `undoable` is false: why there is no Undo on this row. */
  why?: string;
}

/**
 * How much of the rubric a STORED scorecard speaks to. Built only from a scorecard somebody wrote
 * (`lib/board/read.ts` `evidenceOf`), never from the zero row an unscored candidate is drawn with.
 */
export interface BdEvidence {
  /** Criteria carrying at least one quoted sentence. */
  evidenced: number;
  /** Criteria in the role's rubric. */
  criteriaCount: number;
  band: Band;
  /** Why the band is as wide as it is: the criteria with nothing quoted. */
  drivers: string[];
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
  /** Null exactly when `scored` is false: an unread application evidences nothing, not zero. */
  evidence: BdEvidence | null;
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
  /** Every interview slot and whose it is. `actsFor` in `lib/acts.ts` decides who may book which. */
  slots: ActSlot[];
  /** Stage id -> the label the board prints. Sent down so no component has to
   *  import the constants module just to render a column heading. */
  stageLabel: Record<Stage, string>;
}
