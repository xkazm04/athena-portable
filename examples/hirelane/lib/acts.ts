/**
 * Which acts a candidate can take, with which choices, and if not, why. Client-safe and pure.
 *
 * DESIGN-LAW §7.7 has two directions. Whatever the surface states is enforced by the server
 * action, so an agent never gets a larger option set than a person. And the surface offers exactly
 * what the action accepts, so a person never gets a smaller one. The second direction is the one
 * that drifted. The gate panel recomputed the scheduling rule from `status = 'open'`, while the
 * action books any slot that is not booked and is not held for somebody else. A candidate whose
 * three slots Propose slots had just held could not be booked into any of them from the dossier,
 * although the agent could.
 *
 * So there is one module, and every reader reads it: `app/actions.ts` guards with the predicates
 * below and refuses with `REFUSAL`, the dossier draws its buttons from `actsFor`, and the agent's
 * dossier read carries the same `actsFor`. It is the pattern `nextMoveFor` already set for the
 * Move button. `test/acts.test.ts` runs every seeded applicant through every act against the real
 * actions and fails on any disagreement in either direction.
 *
 * No database here. The slots come in as plain rows, so the client and the server ask the same
 * question of the same data.
 */
import { isDecisionStage, nextMoveFor, STAGE_LABEL, STAGES, type MoveStage, type Stage } from "./constants";

/** Why an act is not on offer. One vocabulary for the dossier's labels and the server's refusals. */
export type ActReason = "decided" | "too_early" | "no_slot" | "next_is_a_decision";

/** Who an act is for: the three fields every rule here reads. */
export interface ActPerson {
  id: string;
  name: string;
  stage: Stage;
}

/** One interview slot, as both the board payload and the actions read it. */
export interface ActSlot {
  id: string;
  interviewer: string;
  /** ISO start, UTC. */
  startTs: string;
  minutes: number;
  status: "open" | "proposed" | "booked";
  /** Who it is held or booked for, or null when nobody. */
  applicantId: string | null;
}

export interface Act {
  enabled: boolean;
  reason?: ActReason;
}

export interface Acts {
  score: Act;
  /** The next stage on the ladder, when that stage is a move rather than a decision. */
  move: Act & { to: MoveStage | null };
  propose: Act;
  offer: Act;
  reject: Act;
  /** The slots this person can be booked into: their own held slots first, then free ones. */
  schedule: Act & { slots: ActSlot[] };
}

/** How many free slots the dossier lists after the person's own. A select, not a calendar. */
export const FREE_SLOTS_LISTED = 12;

/**
 * The refusal sentences, keyed by reason, plus the few that refuse an argument rather than a
 * person. The server returns these words and the agent's read quotes them, so a reason means one
 * thing wherever it is read.
 */
export const REFUSAL = {
  decided: (p: Pick<ActPerson, "name" | "stage">) =>
    `${p.name} is already at ${STAGE_LABEL[p.stage]}. That decision has been made and cannot be re-made here.`,
  too_early: (p: Pick<ActPerson, "name" | "stage">) =>
    `${STAGE_LABEL[p.stage]} is too early to book a time. Move ${p.name} to Interview first.`,
  no_slot: () => "No open slots left in the next two weeks.",
  next_is_a_decision: (p: Pick<ActPerson, "stage">): string => REFUSAL.not_a_move(ladderNext(p.stage) ?? p.stage),
  /** A move asked of a decided person. It says what a move cannot do. */
  decided_move: (p: Pick<ActPerson, "name" | "stage">) =>
    `${p.name} is at ${STAGE_LABEL[p.stage]}. A decision is not undone with a move - use Undo on the activity row that made it.`,
  not_a_move: (stage: Stage) => `${STAGE_LABEL[stage]} is a decision. Use the decision controls.`,
  not_a_decision: (stage: Stage) => `${STAGE_LABEL[stage]} is a move, not a decision.`,
  slot_taken: () => "That slot is gone or is held for someone else. Pick another.",
};

/** The refusal sentence for a reason, about this person. */
export function refusalFor(reason: ActReason, p: Pick<ActPerson, "name" | "stage">): string {
  return REFUSAL[reason](p);
}

/** The stage after this one on the ladder, decision or not. Null after the last. */
export function ladderNext(stage: Stage): Stage | null {
  return STAGES[STAGES.indexOf(stage) + 1] ?? null;
}

/** A decision is terminal: nothing that decides, moves or books may run over one. */
export function decidedReason(stage: Stage): "decided" | null {
  return isDecisionStage(stage) ? "decided" : null;
}

/** Booking a time needs the person at Interview, and not past a decision. */
export function scheduleReason(stage: Stage): "decided" | "too_early" | null {
  return decidedReason(stage) ?? (stage === "interview" ? null : "too_early");
}

/**
 * May this slot be booked for this person? Not if it is booked, and not if it is held for somebody
 * else: re-targeting a held slot silently moves one candidate's interview to another.
 */
export function canBook(slot: Pick<ActSlot, "status" | "applicantId">, personId: string | null): boolean {
  return slot.status !== "booked" && (slot.applicantId === null || slot.applicantId === personId);
}

/** Free: bookable by anyone, because nobody holds it. What Propose slots takes from. */
export function isFree(slot: Pick<ActSlot, "status" | "applicantId">): boolean {
  return canBook(slot, null);
}

/** The person's own held slots, then up to `FREE_SLOTS_LISTED` free ones, each in the order given. */
export function bookableSlots(slots: readonly ActSlot[], personId: string): ActSlot[] {
  const own = slots.filter((s) => s.applicantId === personId && canBook(s, personId));
  const free = slots.filter(isFree).slice(0, FREE_SLOTS_LISTED);
  return [...own, ...free];
}

function open(reason: ActReason | null): Act {
  return reason ? { enabled: false, reason } : { enabled: true };
}

/** Every act on one person, against the slots as they stand. */
export function actsFor(person: ActPerson, slots: readonly ActSlot[]): Acts {
  const decided = decidedReason(person.stage);
  const to = nextMoveFor(person.stage);
  const early = scheduleReason(person.stage);
  const bookable = early ? [] : bookableSlots(slots, person.id);
  return {
    score: open(null),
    move: { ...open(to ? null : (decided ?? "next_is_a_decision")), to },
    propose: open(slots.some(isFree) ? null : "no_slot"),
    offer: open(decided),
    reject: open(decided),
    schedule: { ...open(early ?? (bookable.length > 0 ? null : "no_slot")), slots: bookable },
  };
}
