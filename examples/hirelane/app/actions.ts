"use server";

/**
 * One server action per mutating capability. Each writes the domain change and one activity row,
 * and stores an undo payload whenever the change is reversible. The three that reach a candidate -
 * an offer, a rejection, a scheduling email - store nothing, because there is nothing to store:
 * you cannot un-send a decision. That asymmetry is what makes them GATED in the manifest.
 */
import { revalidatePath } from "next/cache";
import { logActivity, undoActivity, type ActivityEntry } from "@athena/demo-kit/activity";
import type { Db } from "@athena/demo-kit/db";

import {
  isDecisionStage,
  isMoveStage,
  STAGE_LABEL,
  type RejectionTemplate,
  type Stage,
} from "@/lib/constants";
import { db } from "@/lib/db";
import { rejectionMail, schedulingMail, type Mail } from "@/lib/mail";
import { getApplicant, getRole, listCriteria } from "@/lib/queries";
import { scoreAgainst, summarise } from "@/lib/scoring";

export interface ActionResult {
  ok: boolean;
  message: string;
  /**
   * The complete message a send produced, when it produced one.
   *
   * The two gated sends are simulated INSIDE the app and carried OUTSIDE it: in the demo a Gmail
   * connector (README section 4) does the actual sending, and it cannot address an envelope from
   * a candidate id. So a send hands back exactly what a mailbox needs — `to`, `subject`, `body` —
   * and the row in `messages` is the same three fields. The other five actions have no mail and
   * the field is simply absent, which is this repo's convention for "there is none".
   */
  mail?: Mail;
  /**
   * The slots `propose_slots` actually held, when it held any.
   *
   * An id alone is not enough to choose one: the next act is a message to a person naming a time,
   * so the times come back with the ids and nobody has to read them off the board.
   */
  slots?: HeldSlot[];
}

/** One held interview slot, as the caller of `propose_slots` reads it. */
export interface HeldSlot {
  id: string;
  interviewer: string;
  /** ISO start, UTC. */
  start: string;
  minutes: number;
}

/** The one surviving direction is a single page, so every write revalidates just that route. */
function refresh(): void {
  revalidatePath("/");
}

function missing(id: string): ActionResult {
  return { ok: false, message: `No applicant ${id}. It may have been removed since this page loaded.` };
}

/**
 * A decision is a terminal state, not just a stage with a scary colour.
 *
 * Offer and rejected are the two stages this app calls irreversible, which means a SECOND decision
 * cannot re-enter them: no offer after a rejection, no second rejection letter. Without this, the
 * most consequential act in the app can be performed twice, or reversed by another act that is
 * itself irreversible.
 */
function decided(applicant: { name: string; stage: Stage }): ActionResult | null {
  if (!isDecisionStage(applicant.stage)) return null;
  return {
    ok: false,
    message: `${applicant.name} is already at ${STAGE_LABEL[applicant.stage]}. That decision has been made and cannot be re-made here.`,
  };
}

/** AUTO. Writes a scorecard as a note. Never touches the stage - a score is not a decision. */
export async function scoreAgainstRubric(applicantId: string): Promise<ActionResult> {
  const applicant = getApplicant(applicantId);
  if (!applicant) return missing(applicantId);
  const scores = scoreAgainst(listCriteria(applicant.role_id), applicant.cv_text, applicant.short_answer);
  const body = `Scored against the rubric: ${summarise(scores)}.`;
  const { lastInsertRowid } = db().run(
    "INSERT INTO notes (applicant_id, ts, author, kind, body, scores_json) VALUES (?, ?, ?, 'rubric', ?, ?)",
    [applicantId, new Date().toISOString(), "user", body, JSON.stringify(scores)],
  );
  logActivity(db(), {
    actor: "user",
    action: "score_against_rubric",
    target: `applicant:${applicantId}`,
    summary: `Scored ${applicant.name} against the ${applicant.role_id.replace("role_", "")} rubric.`,
    reversible: true,
    undo: { kind: "note", noteId: lastInsertRowid },
  });
  refresh();
  return { ok: true, message: `Scorecard written for ${applicant.name}.` };
}

/** AUTO. A note is the only place a judgement belongs before a stage changes. */
export async function addNote(applicantId: string, text: string): Promise<ActionResult> {
  const applicant = getApplicant(applicantId);
  if (!applicant) return missing(applicantId);
  const body = text.trim();
  if (body.length === 0) return { ok: false, message: "Write something first." };
  const { lastInsertRowid } = db().run(
    "INSERT INTO notes (applicant_id, ts, author, kind, body, scores_json) VALUES (?, ?, 'user', 'note', ?, NULL)",
    [applicantId, new Date().toISOString(), body],
  );
  logActivity(db(), {
    actor: "user",
    action: "add_note",
    target: `applicant:${applicantId}`,
    summary: `Note on ${applicant.name}: ${body.slice(0, 80)}`,
    reversible: true,
    undo: { kind: "note", noteId: lastInsertRowid },
  });
  refresh();
  return { ok: true, message: "Note added." };
}

function writeStage(applicantId: string, to: Stage, reason: string): number {
  const now = new Date().toISOString();
  const from = getApplicant(applicantId)?.stage ?? null;
  db().run("UPDATE applicants SET stage = ? WHERE id = ?", [to, applicantId]);
  const { lastInsertRowid } = db().run(
    "INSERT INTO stage_events (applicant_id, ts, from_stage, to_stage, actor, reason) VALUES (?, ?, ?, ?, 'user', ?)",
    [applicantId, now, from, to, reason],
  );
  return lastInsertRowid;
}

/**
 * AUTO. Moves within the process: screening and interview only, and it goes back.
 *
 * Both ends of the move are checked against `lib/constants.ts`, the one place the AUTO/GATED
 * vocabulary is declared. The FROM stage matters as much as the TO stage: without it, an AUTO
 * `move_stage` reverses a GATED decision - a rejected candidate walks back into Screening, logged
 * reversible:true, with no arming step - which is exactly the distinction this app exists to make.
 */
export async function moveStage(applicantId: string, stage: Stage): Promise<ActionResult> {
  const applicant = getApplicant(applicantId);
  if (!applicant) return missing(applicantId);
  if (isDecisionStage(applicant.stage)) {
    return {
      ok: false,
      message: `${applicant.name} is at ${STAGE_LABEL[applicant.stage]}. A decision is not undone with a move - use Undo on the activity row that made it.`,
    };
  }
  if (!isMoveStage(stage)) {
    return { ok: false, message: `${STAGE_LABEL[stage]} is a decision. Use the decision controls.` };
  }
  const eventId = writeStage(applicantId, stage, `Moved to ${stage}.`);
  logActivity(db(), {
    actor: "user",
    action: "move_stage",
    target: `applicant:${applicantId}`,
    summary: `${applicant.name}: ${STAGE_LABEL[applicant.stage]} to ${STAGE_LABEL[stage]}.`,
    reversible: true,
    undo: { kind: "stage", applicantId, stage: applicant.stage, eventId },
  });
  refresh();
  return { ok: true, message: `${applicant.name} moved to ${STAGE_LABEL[stage]}.` };
}

/** GATED. Offer and rejection end someone's process; the log records them as final. */
export async function decideStage(applicantId: string, stage: Stage): Promise<ActionResult> {
  const applicant = getApplicant(applicantId);
  if (!applicant) return missing(applicantId);
  if (!isDecisionStage(stage)) {
    return { ok: false, message: `${STAGE_LABEL[stage]} is a move, not a decision.` };
  }
  const already = decided(applicant);
  if (already) return already;
  writeStage(applicantId, stage, `Decision: ${stage}.`);
  logActivity(db(), {
    actor: "user",
    action: "decide_stage",
    target: `applicant:${applicantId}`,
    summary: `Decision on ${applicant.name}: ${STAGE_LABEL[stage]}.`,
    reversible: false,
  });
  refresh();
  return { ok: true, message: `${applicant.name}: ${STAGE_LABEL[stage]} recorded.` };
}

/** AUTO. Holds up to three open slots for an applicant. Nothing leaves the building yet. */
export async function proposeSlots(applicantId: string): Promise<ActionResult> {
  const applicant = getApplicant(applicantId);
  if (!applicant) return missing(applicantId);
  const open = db().all<{ id: string; interviewer: string; start_ts: string; minutes: number }>(
    "SELECT id, interviewer, start_ts, minutes FROM slots WHERE status = 'open' ORDER BY start_ts LIMIT 3",
  );
  if (open.length === 0) return { ok: false, message: "No open slots left in the next two weeks." };
  const ids = open.map((s) => s.id);
  const held: HeldSlot[] = open.map((s) => ({
    id: s.id,
    interviewer: s.interviewer,
    start: s.start_ts,
    minutes: s.minutes,
  }));
  for (const id of ids) {
    db().run("UPDATE slots SET status = 'proposed', applicant_id = ? WHERE id = ?", [applicantId, id]);
  }
  logActivity(db(), {
    actor: "user",
    action: "propose_slots",
    target: `applicant:${applicantId}`,
    summary: `Held ${ids.length} slots for ${applicant.name}.`,
    reversible: true,
    undo: { kind: "slots", slotIds: ids },
  });
  refresh();
  return { ok: true, message: `${ids.length} slots held for ${applicant.name}.`, slots: held };
}

/**
 * GATED, external. Simulated: the message lands in the app, not in a mailbox.
 *
 * The Interview precondition is asserted HERE, not on the button. The dossier's gate panel
 * disables the control below Interview, but a disabled button is not a rule - an agent calling
 * `send_scheduling_email` never sees it. One engine, two surfaces: the agent's option set has to
 * be a subset of the human's, which means the invariant lives in the action.
 */
export async function sendSchedulingEmail(applicantId: string, slotId: string): Promise<ActionResult> {
  const applicant = getApplicant(applicantId);
  if (!applicant) return missing(applicantId);
  if (applicant.stage !== "interview") {
    return {
      ok: false,
      message: `${STAGE_LABEL[applicant.stage]} is too early to book a time. Move ${applicant.name} to Interview first.`,
    };
  }
  // `status != 'booked'` alone matches a slot `propose_slots` is holding for SOMEONE ELSE, and the
  // UPDATE below would re-target it - one candidate's held interview silently moved to another,
  // with no activity row naming the loss. Whose slot it is has to be part of the lookup, because
  // the agent fills in `slot` as a free string and nothing upstream owns that decision.
  const slot = db().get<{ id: string; interviewer: string; start_ts: string; minutes: number }>(
    "SELECT id, interviewer, start_ts, minutes FROM slots WHERE id = ? AND status != 'booked' AND (applicant_id IS NULL OR applicant_id = ?)",
    [slotId, applicantId],
  );
  if (!slot) {
    return { ok: false, message: "That slot is gone or is held for someone else. Pick another." };
  }
  const when = slot.start_ts.replace("T", " ").slice(0, 16);
  const mail = schedulingMail({
    applicantName: applicant.name,
    applicantEmail: applicant.email,
    roleTitle: getRole(applicant.role_id)?.title ?? "the role",
    interviewer: slot.interviewer,
    startTs: slot.start_ts,
    minutes: slot.minutes,
  });
  db().run("UPDATE slots SET status = 'booked', applicant_id = ? WHERE id = ?", [applicantId, slotId]);
  db().run(
    "INSERT INTO messages (applicant_id, ts, kind, to_email, subject, body) VALUES (?, ?, 'scheduling', ?, ?, ?)",
    [applicantId, new Date().toISOString(), mail.to, mail.subject, mail.body],
  );
  logActivity(db(), {
    actor: "user",
    action: "send_scheduling_email",
    target: `applicant:${applicantId}`,
    summary: `Emailed ${applicant.name} at ${mail.to} an interview time with ${slot.interviewer} (${when} UTC).`,
    reversible: false,
  });
  refresh();
  return { ok: true, message: `Interview time sent to ${applicant.name} at ${mail.to}.`, mail };
}

/** GATED, external. Simulated, and it moves the applicant to rejected in the same breath. */
export async function sendRejection(
  applicantId: string,
  template: RejectionTemplate,
): Promise<ActionResult> {
  const applicant = getApplicant(applicantId);
  if (!applicant) return missing(applicantId);
  const already = decided(applicant);
  if (already) return already;
  const mail = rejectionMail({
    applicantName: applicant.name,
    applicantEmail: applicant.email,
    roleTitle: getRole(applicant.role_id)?.title ?? "the role",
    template,
  });
  writeStage(applicantId, "rejected", `Rejection sent (${template}).`);
  db().run(
    "INSERT INTO messages (applicant_id, ts, kind, to_email, subject, body) VALUES (?, ?, 'rejection', ?, ?, ?)",
    [applicantId, new Date().toISOString(), mail.to, mail.subject, mail.body],
  );
  logActivity(db(), {
    actor: "user",
    action: "send_rejection",
    target: `applicant:${applicantId}`,
    summary: `Sent ${applicant.name} the ${template.replace("_", " ")} rejection at ${mail.to}.`,
    reversible: false,
  });
  refresh();
  return { ok: true, message: `Rejection sent to ${applicant.name} at ${mail.to}.`, mail };
}

/**
 * The app-specific half of `undoActivity`: only the app knows how to reverse its own writes.
 *
 * `undoActivity` imposes three checks and deliberately holds no domain knowledge - it does not
 * know, and must not know, that a later act may have CONSUMED what an earlier one wrote. That is
 * this function's job, and it is the same guard `examples/ledgerbox` spells `AND sent_at IS NULL`
 * and `examples/tidycrm` spells `if (rev.reverted === 1) continue`. Without it, undoing an AUTO
 * `propose_slots` un-books a slot a GATED `send_scheduling_email` already booked and emailed
 * about: a reversible action's undo reversing half of an irreversible one, which is the exact
 * distinction the app exists to make visible (DESIGN-LAW §7).
 *
 * A partial undo says so, in its own activity row, because `undoActivity`'s compensating line
 * reports a clean undo either way.
 */
function applyUndo(tx: Db, entry: ActivityEntry): void {
  const undo = entry.undo as
    | { kind: "note"; noteId: number }
    | { kind: "stage"; applicantId: string; stage: Stage; eventId: number }
    | { kind: "slots"; slotIds: string[] }
    | null;
  if (undo?.kind === "note") {
    tx.run("DELETE FROM notes WHERE id = ?", [undo.noteId]);
    return;
  }
  if (undo?.kind === "stage") {
    // Restore the stage only if the applicant is still where this action left them. An older
    // move_stage undone after a decision would otherwise pull an offered or rejected candidate
    // back to applied.
    const now = tx.get<{ stage: Stage }>("SELECT stage FROM applicants WHERE id = ?", [undo.applicantId]);
    if (now && isDecisionStage(now.stage)) {
      logActivity(tx, {
        actor: "user",
        action: "undo",
        target: entry.target,
        summary: `#${entry.id} left the stage alone: a decision (${STAGE_LABEL[now.stage]}) was recorded after it.`,
        reversible: false,
      });
      tx.run("DELETE FROM stage_events WHERE id = ?", [undo.eventId]);
      return;
    }
    tx.run("UPDATE applicants SET stage = ? WHERE id = ?", [undo.stage, undo.applicantId]);
    tx.run("DELETE FROM stage_events WHERE id = ?", [undo.eventId]);
    return;
  }
  if (undo?.kind === "slots") {
    let kept = 0;
    for (const id of undo.slotIds) {
      const { changes } = tx.run(
        "UPDATE slots SET status = 'open', applicant_id = NULL WHERE id = ? AND status <> 'booked'",
        [id],
      );
      if (changes === 0) kept += 1;
    }
    if (kept > 0) {
      logActivity(tx, {
        actor: "user",
        action: "undo",
        target: entry.target,
        summary: `#${entry.id} released ${undo.slotIds.length - kept} of ${undo.slotIds.length} slots: ${kept} had already been booked and emailed about.`,
        reversible: false,
      });
    }
    return;
  }
  throw new Error(`no undo strategy for ${entry.action}`);
}

export async function undoAction(id: number): Promise<{ ok: boolean; reason?: string }> {
  const result = undoActivity(db(), id, applyUndo);
  refresh();
  return { ok: result.ok, ...(result.reason ? { reason: result.reason } : {}) };
}
