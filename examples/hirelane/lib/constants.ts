/** Client-safe app identity. `lib/db.ts` is server-only, so the ids live here too. */
export const APP_ID = "hirelane";
export const APP_VERSION = "0.1.0";

/** Views `navigate` can open. Enums are mandatory for anything addressing UI (design 5.1). */
export const VIEWS = ["board"] as const;
export type View = (typeof VIEWS)[number];

/** Pipeline stages, in order. The last two are decisions, not moves. */
export const STAGES = ["applied", "screening", "interview", "offer", "rejected"] as const;
export type Stage = (typeof STAGES)[number];

/** Stages `move_stage` may set. Anything else is a decision and goes through `decide_stage`. */
export const MOVE_STAGES = ["screening", "interview"] as const;
/** Stages `decide_stage` may set. Both are GATED: they end a candidate's process. */
export const DECISION_STAGES = ["offer", "rejected"] as const;

export type MoveStage = (typeof MOVE_STAGES)[number];
export type DecisionStage = (typeof DECISION_STAGES)[number];

/**
 * The AUTO/GATED split, as predicates.
 *
 * These two vocabularies decide a capability's class, so the manifest, the server actions and the
 * buttons all have to read the SAME declaration - otherwise widening `MOVE_STAGES` advertises a
 * target the action rejects, and a button can be drawn for a move the server will refuse. One rule,
 * one spelling.
 */
export function isMoveStage(stage: Stage): stage is MoveStage {
  return (MOVE_STAGES as readonly string[]).includes(stage);
}

export function isDecisionStage(stage: Stage): stage is DecisionStage {
  return (DECISION_STAGES as readonly string[]).includes(stage);
}

/**
 * The next stage a reversible move may set from `stage`, or null if there is none.
 *
 * A decision is terminal, so it has no next move: the way back from an offer or a rejection is Undo
 * on the activity row that made it, not another move. Both the button and `moveStage` read this, so
 * they agree by construction.
 */
export function nextMoveFor(stage: Stage): MoveStage | null {
  if (isDecisionStage(stage)) return null;
  const next = STAGES[STAGES.indexOf(stage) + 1];
  return next && isMoveStage(next) ? next : null;
}

export const STAGE_LABEL: Record<Stage, string> = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

/** Rejection letter templates. An enum, because the wording reaches a person. */
export const REJECTION_TEMPLATES = ["standard", "encouraging", "keep_in_touch"] as const;
export type RejectionTemplate = (typeof REJECTION_TEMPLATES)[number];

export const REJECTION_TEMPLATE_LABEL: Record<RejectionTemplate, string> = {
  standard: "Standard - short and clear",
  encouraging: "Encouraging - names the strengths",
  keep_in_touch: "Keep in touch - invites a later application",
};

/** Score labels for the 0-4 rubric scale. 0 means the CV carried no evidence either way. */
export const SCORE_LABEL = ["no evidence", "thin", "partial", "solid", "strong"] as const;

/** Deterministic "today". The seed is fixed, so the calendar has to be too. */
export const TODAY = "2026-09-07T09:00:00.000Z";
