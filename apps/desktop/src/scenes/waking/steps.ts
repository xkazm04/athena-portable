/**
 * The first act's steps and where it opens — README section 3.5, ADR 0223.
 *
 * Four steps, each with the fact that says it is done (the same facts that light her tendrils).
 * The act opens on a step the person kept this session; otherwise on the first step still owed;
 * with everything lit, on the last, where Wake her is. Pure: it reads the Setup module's own facts
 * and decides nothing about readiness, so an opening step can never bypass `isReady`.
 */
import type { AvatarId } from "@/avatar/types";
import { engineFact, micFact, pageFact, voiceFact, type Fact } from "@/modules/setup/readiness";
import type { SetupModel } from "@/modules/setup/model";

export const STEPS = [
  { key: "mind", name: "Mind", ask: "What will she think with?" },
  { key: "reach", name: "Reach", ask: "Where will she work?" },
  { key: "voice", name: "Voice", ask: "Do you want to talk to her?" },
  { key: "face", name: "Face", ask: "How will she appear?" },
] as const;

export type Step = 0 | 1 | 2 | 3;
export const LAST: Step = 3;

/** Which steps are done, in step order. */
export function litSteps(model: SetupModel, avatar: AvatarId): [boolean, boolean, boolean, boolean] {
  return [
    engineFact(model).standing === "done",
    pageFact(model).standing === "done",
    micFact(model).standing === "done" || voiceFact(model).standing === "done",
    avatar !== "halo",
  ];
}

/** Where the act opens: the kept step, else the first unlit one, else the last. */
export function openingStep(model: SetupModel, avatar: AvatarId, kept: Step | null): Step {
  if (kept !== null) return kept;
  const first = litSteps(model, avatar).indexOf(false);
  return first === -1 ? LAST : (first as Step);
}

const BADGE: Record<Exclude<Fact["standing"], "unknown">, string> = {
  done: "ready",
  todo: "not yet",
  missing: "not ready",
};

/**
 * A fact as one line. An unknown fact has no badge: on this act it is a microphone nobody has asked
 * about ("not asked yet"), and a "checking" badge in front of that said something was running.
 */
export function factLine(fact: Fact): string {
  return fact.standing === "unknown" ? fact.summary : `${BADGE[fact.standing]} · ${fact.summary}`;
}
