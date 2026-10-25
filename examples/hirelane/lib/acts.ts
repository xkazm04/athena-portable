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
export type ActReason = "decided" | "too_early" | "no_slot" | "already_held" | "next_is_a_decision";

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
 * How many slots Propose slots holds for one person, in all. A call tops the person up to this;
 * it never adds this many again, because every held slot is one nobody else can be booked into.
 */
export const SLOTS_HELD_EACH = 3;

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
  already_held: (p: Pick<ActPerson, "name">) =>
    `${SLOTS_HELD_EACH} slots are already held for ${p.name}. Book one of them, or undo the hold to choose again.`,
  next_is_a_decision: (p: Pick<ActPerson, "stage">): string => REFUSAL.not_a_move(ladderNext(p.stage) ?? p.stage),
  /**
   * A move asked of a decided person. It says what a move cannot do, and names no other way back:
   * `decide_stage` logs `reversible: false`, so an Undo on its row would be refused too.
   */
  decided_move: (p: Pick<ActPerson, "name" | "stage">) =>
    `${p.name} is at ${STAGE_LABEL[p.stage]}. A decision is final: a move cannot reverse it, and it has no undo.`,
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

/** The slots Propose slots is holding for this person and nobody has booked yet. */
export function heldFor(slots: readonly ActSlot[], personId: string): ActSlot[] {
  return slots.filter((s) => s.status === "proposed" && s.applicantId === personId);
}

/**
 * Why Propose slots would refuse this person, or null. Holding time is for someone who can be
 * booked into it, so the stage rule is scheduling's; past that, three held each, and a free slot.
 */
export function proposeReason(
  person: Pick<ActPerson, "id" | "stage">,
  slots: readonly ActSlot[],
): "decided" | "too_early" | "already_held" | "no_slot" | null {
  return (
    scheduleReason(person.stage) ??
    (heldFor(slots, person.id).length >= SLOTS_HELD_EACH ? "already_held" : slots.some(isFree) ? null : "no_slot")
  );
}

/** The free slots one Propose would hold now: enough to top the person up to three, in order. */
export function slotsToHold(slots: readonly ActSlot[], personId: string): ActSlot[] {
  return slots.filter(isFree).slice(0, Math.max(0, SLOTS_HELD_EACH - heldFor(slots, personId).length));
}

/** The short form the dossier's Propose button has room for: what it does, or why it is shut. */
export function proposeLabel(act: Act, stage: Stage): string {
  if (act.enabled) return "Propose slots";
  if (act.reason === "decided") return `${STAGE_LABEL[stage]} is decided`;
  if (act.reason === "too_early") return "Slots open at Interview";
  if (act.reason === "already_held") return `${SLOTS_HELD_EACH} slots held`;
  return "No slot is open";
}

function open(reason: ActReason | null): Act {
  return reason ? { enabled: false, reason } : { enabled: true };
}

/** Who a batch reads: the three facts `scoreBatchFor` decides on. */
export interface BatchPerson {
  id: string;
  stage: Stage;
  /** A stored rubric scorecard exists for them. */
  scored: boolean;
}

/**
 * Who one `score_batch` scores, of the people given: not decided, not scored yet, and at `stage`
 * when one is named. The caller hands in one role's people. `app/actions.ts` guards with this and
 * the group's "Score N unscored" control counts from it, so the button never offers a pile the
 * action would score differently (ADR 0107). A score is not a decision: the batch never reads or
 * writes a stage beyond choosing who is in it, and a decided person is never re-scored by it.
 */
export function scoreBatchFor(people: readonly BatchPerson[], stage?: Stage): string[] {
  return people
    .filter((p) => !p.scored && !decidedReason(p.stage) && (stage === undefined || p.stage === stage))
    .map((p) => p.id);
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
    propose: open(proposeReason(person, slots)),
    offer: open(decided),
    reject: open(decided),
    schedule: { ...open(early ?? (bookable.length > 0 ? null : "no_slot")), slots: bookable },
  };
}
