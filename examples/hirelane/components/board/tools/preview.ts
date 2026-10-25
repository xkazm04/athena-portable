/**
 * The exact letter, before the gate: `preview_message`.
 *
 * Hirelane has two acts that reach a person and can never be taken back - a rejection and an
 * interview email - and both were approved on a label. The dossier armed "Send it" under a wording
 * NAME, and Athena's approval card could quote `template: "encouraging"`, never the words. Nobody
 * read the letter until it had gone. A gate with nothing to check it against is a formality
 * (hitl-approval, oracle-before-gate): the reviewer has to see the target.
 *
 * The letter is a pure function of data the board already holds, so it is composed here through the
 * SAME `rejectionMail` / `schedulingMail` the server actions call, with the same arguments - name,
 * address, role title, and the slot. And it is refused exactly where the action would refuse, in the
 * action's words: an unknown applicant, an unknown wording, a decided person, a stage too early to
 * book, a slot that is gone or held for somebody else. A preview that showed a letter the action
 * would not send would be a second, kinder gate, which is worse than none.
 *
 * `test/preview.test.ts` holds it to the actions byte for byte on a scratch database, so the letter
 * shown cannot drift from the letter sent. Nothing here writes: it reads the board payload.
 */
import { canBook, decidedReason, REFUSAL, scheduleReason, type ActReason, type ActSlot } from "@/lib/acts";
import { MESSAGE_KINDS, REJECTION_TEMPLATES, type MessageKind, type RejectionTemplate } from "@/lib/constants";
import { rejectionMail, schedulingMail, type Mail } from "@/lib/mail";
import type { BdBoard, BdCandidate } from "../model";

export { MESSAGE_KINDS, type MessageKind };

/** What one letter is addressed from: the candidate, their role's title, and the choice. */
export type LetterChoice =
  | { kind: "rejection"; template: RejectionTemplate }
  | { kind: "scheduling"; slot: Pick<ActSlot, "interviewer" | "startTs" | "minutes"> };

/**
 * The letter one send would put in a mailbox. The actions compose with exactly these arguments, so
 * the dossier's gate and the agent's preview read the same function the send does.
 */
export function letterFor(
  candidate: Pick<BdCandidate, "name" | "email">,
  roleTitle: string,
  choice: LetterChoice,
): Mail {
  return choice.kind === "rejection"
    ? rejectionMail({
        applicantName: candidate.name,
        applicantEmail: candidate.email,
        roleTitle,
        template: choice.template,
      })
    : schedulingMail({
        applicantName: candidate.name,
        applicantEmail: candidate.email,
        roleTitle,
        interviewer: choice.slot.interviewer,
        startTs: choice.slot.startTs,
        minutes: choice.slot.minutes,
      });
}

export interface PreviewArgs {
  applicant_id: string;
  kind: string;
  template?: string;
  slot_id?: string;
}

/** Why there is no letter to show. The act reasons, plus the refusals of an argument. */
export type PreviewReason =
  | Extract<ActReason, "decided" | "too_early">
  | "no_applicant"
  | "unknown_kind"
  | "unknown_template"
  | "no_slot_given"
  | "slot_taken";

export type PreviewResult =
  | {
      ok: true;
      kind: MessageKind;
      to: string;
      subject: string;
      body: string;
      /** The GATED call that would send exactly this, so a proposal can quote both. */
      sent_by: { tool: "send_rejection"; template: RejectionTemplate } | { tool: "send_scheduling_email"; slot_id: string };
      note: string;
    }
  | { ok: false; reason: PreviewReason; why: string };

const NOTE = "Nothing was sent. This is the letter the send would deliver, word for word; it reaches them and cannot be un-sent.";

function locate(board: BdBoard, id: string): { candidate: BdCandidate; roleTitle: string } | null {
  for (const role of board.roles) {
    for (const column of role.columns) {
      const candidate = column.candidates.find((c) => c.id === id);
      if (candidate) return { candidate, roleTitle: role.title };
    }
  }
  return null;
}

const refuse = (reason: PreviewReason, why: string): PreviewResult => ({ ok: false, reason, why });

/**
 * The letter `send_rejection` or `send_scheduling_email` would send now, or the action's refusal.
 *
 * The checks run in the actions' own order (`app/actions.ts`): the person exists; for a rejection
 * the wording is one of the three, then the person is not decided; for scheduling the stage is
 * Interview, then the slot is bookable for this person by `canBook`, the predicate the action
 * guards with.
 */
export function previewMessage(board: BdBoard, args: PreviewArgs): PreviewResult {
  const found = locate(board, args.applicant_id);
  if (!found) {
    return refuse(
      "no_applicant",
      `No applicant ${args.applicant_id}. It may have been removed since this page loaded.`,
    );
  }
  const { candidate, roleTitle } = found;

  if (args.kind === "rejection") {
    const template = args.template ?? "";
    if (!(REJECTION_TEMPLATES as readonly string[]).includes(template)) {
      return refuse(
        "unknown_template",
        `No rejection wording called "${template}". Use one of: ${REJECTION_TEMPLATES.join(", ")}.`,
      );
    }
    const decided = decidedReason(candidate.stage);
    if (decided) return refuse(decided, REFUSAL.decided(candidate));
    const chosen = template as RejectionTemplate;
    const mail = letterFor(candidate, roleTitle, { kind: "rejection", template: chosen });
    return { ok: true, kind: "rejection", ...mail, sent_by: { tool: "send_rejection", template: chosen }, note: NOTE };
  }

  if (args.kind === "scheduling") {
    const early = scheduleReason(candidate.stage);
    if (early) return refuse(early, REFUSAL[early](candidate));
    if (!args.slot_id) {
      return refuse("no_slot_given", "Pass a slot_id: the interview time is part of the letter.");
    }
    const slot = board.slots.find((s) => s.id === args.slot_id);
    if (!slot || !canBook(slot, candidate.id)) return refuse("slot_taken", REFUSAL.slot_taken());
    const mail = letterFor(candidate, roleTitle, { kind: "scheduling", slot });
    return {
      ok: true,
      kind: "scheduling",
      ...mail,
      sent_by: { tool: "send_scheduling_email", slot_id: slot.id },
      note: NOTE,
    };
  }

  return refuse("unknown_kind", `No message kind called "${args.kind}". Use one of: ${MESSAGE_KINDS.join(", ")}.`);
}
