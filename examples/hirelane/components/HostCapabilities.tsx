"use client";

/**
 * The acts: every capability that changes something about a person's application.
 *
 * Hirelane ships without Athena; these are registered and waiting (design 4.6.2), on
 * `document.modelContext` rather than in a chat the app hosts itself. A browser agent reads the
 * standard annotations and applies the one rule in design 5.1, so the class is carried by what a
 * tool IS. The rule has four branches, and the one that matters here is the third:
 * `consequentialHint: true` is GATED; `readOnlyHint: true` is AUTO; both hints present and both
 * false is a declared reversible app-data write, which is AUTO; annotations absent is unknown,
 * and unknown is GATED. Most of the tools below sit in that third branch — `add_note`,
 * `move_stage` and the rest write app data and reverse cleanly, and they run without asking.
 * See `examples/demo-kit/src/webmcp/hooks.ts` and `examples/athena-sidepanel/gate.js`.
 *
 * The split that matters is `move_stage` versus `decide_stage`: moving someone into screening or
 * an interview is ordinary pipeline work and reverses cleanly, while an offer or a rejection ends
 * a person's process and cannot be taken back. They are two tools because they are two different
 * kinds of act.
 *
 * MOUNTED EVERYWHERE, INCLUDING THE BOARD. It used to return null on `/v/board`, because the board
 * was one of several directions and would otherwise have been handed a second overlapping set from
 * a route it did not own. There is one route now and it is `/`, and the screening journey has to
 * read the pipeline and act on it in the same breath — so both sets are registered together and
 * the board's foot prints the class of the union. The two do not collide: these are verbs on a
 * person, `components/board/tools/` are verbs on the view.
 */
import { useRouter } from "next/navigation";
import { useWebMCPTool } from "@athena/demo-kit/webmcp";
import { registration } from "@/lib/manifest";
import { type RejectionTemplate, type Stage } from "@/lib/constants";
import {
  addNote,
  decideStage,
  moveStage,
  proposeSlots,
  scoreAgainstRubric,
  sendRejection,
  sendSchedulingEmail,
  type ActionResult,
} from "@/app/actions";

/**
 * What a GATED send hands back: the outcome AND the message it produced.
 *
 * The send is simulated in the app and carried outside it by a mail connector, so the useful
 * answer is the envelope — `to`, `subject`, `body` — not a sentence saying it went. A refusal has
 * no message and the three fields are simply absent.
 */
const sent = (result: ActionResult) => ({
  ok: result.ok,
  message: result.message,
  ...(result.mail ?? {}),
});

export function HostCapabilities() {
  const router = useRouter();

  useWebMCPTool({
    name: "navigate",
    description: "Open the board. The only view this app ships, and it is the root route.",
    ...registration("navigate"),
    handler: ({ view }) => {
      router.push("/");
      return `Opened ${String(view)}.`;
    },
  });

  useWebMCPTool({
    name: "score_against_rubric",
    description:
      "Score one applicant against their role's rubric and write the result as a note, with the sentences that earned each score quoted verbatim. Never changes the stage: a score is not a decision.",
    ...registration("score_against_rubric"),
    handler: async ({ applicant_id: id }) => (await scoreAgainstRubric(String(id))).message,
  });

  useWebMCPTool({
    name: "add_note",
    description: "Add a free-text note to an applicant.",
    ...registration("add_note"),
    handler: async ({ applicant_id: id, text }) => (await addNote(String(id), String(text))).message,
  });

  useWebMCPTool({
    name: "move_stage",
    description:
      "Move one applicant to screening or interview. Reverses cleanly, so it is ordinary pipeline work. One applicant per call: there is no bulk move in this app.",
    ...registration("move_stage"),
    handler: async ({ applicant_id: id, stage }) =>
      (await moveStage(String(id), stage as Stage)).message,
  });

  useWebMCPTool({
    name: "decide_stage",
    description:
      "Record an offer or a rejection. Ends the candidate's process and is not reversible, so it is always gated.",
    ...registration("decide_stage"),
    handler: async ({ applicant_id: id, stage }) =>
      (await decideStage(String(id), stage as Stage)).message,
  });

  useWebMCPTool({
    name: "propose_slots",
    description:
      "Hold up to three open interview slots for an applicant. Nothing is sent. Returns the slot ids held and when each one starts, so a scheduling email can name one.",
    ...registration("propose_slots"),
    handler: async ({ applicant_id: id }) => {
      const result = await proposeSlots(String(id));
      return { ok: result.ok, message: result.message, ...(result.slots ? { slots: result.slots } : {}) };
    },
  });

  useWebMCPTool({
    name: "send_scheduling_email",
    description:
      "Email an applicant an interview time and book the slot. Only an applicant already at the interview stage can be booked - move them first. Returns the complete message - to, subject, body - because the send is carried by a mail connector outside this page. Gated.",
    ...registration("send_scheduling_email"),
    handler: async ({ applicant_id: id, slot_id: slotId }) =>
      sent(await sendSchedulingEmail(String(id), String(slotId))),
  });

  useWebMCPTool({
    name: "send_rejection",
    description:
      "Send an applicant a rejection in one of the approved wordings and close their application. Returns the complete message - to, subject, body. One applicant per call; there is no bulk rejection. Gated.",
    ...registration("send_rejection"),
    handler: async ({ applicant_id: id, template }) =>
      sent(await sendRejection(String(id), template as RejectionTemplate)),
  });

  return null;
}
