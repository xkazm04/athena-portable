/** Row shapes shared between server queries and client components. No server imports here. */
import type { Stage } from "./constants";

export interface Role {
  id: string;
  title: string;
  team: string;
  /** What the hire is expected to own in the first six months. */
  brief: string;
  question: string;
  opened_at: string;
}

export interface Criterion {
  id: string;
  role_id: string;
  ord: number;
  name: string;
  description: string;
  /** 1-3. Multiplies into the weighted overall score. */
  weight: number;
  /** Words the evidence heuristic looks for. Stored as JSON in SQLite. */
  keywords: string[];
}

export interface Applicant {
  id: string;
  role_id: string;
  name: string;
  email: string;
  /** Where they work now: a company from the shared registry, so the other two apps know it. */
  employer: string;
  /** One line the applicant wrote about themselves. */
  headline: string;
  years: number;
  cv_text: string;
  short_answer: string;
  stage: Stage;
  applied_at: string;
  /** Strong on most criteria, one clear gap. Six of these exist, by design. */
  borderline: boolean;
  /** The criterion the CV carries no evidence for; only set on borderline applicants. */
  gap_criterion_id: string | null;
}

export interface Note {
  id: number;
  applicant_id: string;
  ts: string;
  author: "user" | "athena" | "system";
  /** `rubric` notes carry a scorecard; `note` notes are free text. */
  kind: "note" | "rubric";
  body: string;
  scores: CriterionScore[] | null;
}

export interface StageEvent {
  id: number;
  applicant_id: string;
  ts: string;
  from_stage: Stage | null;
  to_stage: Stage;
  actor: "user" | "athena" | "system";
  reason: string;
}

export interface Slot {
  id: string;
  interviewer: string;
  start_ts: string;
  minutes: number;
  status: "open" | "proposed" | "booked";
  applicant_id: string | null;
}

export interface Message {
  id: number;
  applicant_id: string;
  ts: string;
  kind: "scheduling" | "rejection";
  /** The address it was sent to. A message row is a complete envelope; see `lib/mail.ts`. */
  to_email: string;
  subject: string;
  body: string;
}

/** One criterion's result: a 0-4 score and the sentences that earned it. */
export interface CriterionScore {
  criterion_id: string;
  name: string;
  score: number;
  weight: number;
  evidence: string[];
}

/** A stage column on the board. */
export interface StageCount {
  stage: Stage;
  count: number;
}

/** What the board needs to know about an applicant without opening them. */
export interface Insight {
  applicant_id: string;
  /** True once a rubric note exists. Until then the board shows nothing rather than a guess. */
  scored: boolean;
  /** Weighted 0-4 overall, from the stored scorecard. */
  overall: number;
  /** Name of the criterion with no evidence, when there is exactly one. */
  gap: string | null;
  /** One line: what is strong, what is missing. */
  line: string;
}
