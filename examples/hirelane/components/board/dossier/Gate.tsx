"use client";

/**
 * The gated half of the action bar: the acts that reach a person and cannot be
 * taken back.
 *
 * A separate REGION, not a badge on a button — and still a region now that it
 * shares a row with the reversible half rather than sitting in a band beneath
 * it. Greyscale the dossier and this is still the only light surface on it, at
 * the only 3px rule in the direction. That is the test DESIGN-LAW §7.1 sets and
 * the reason the merge in `design/ui-pass-brief.md` §3 could not simply be one
 * row of six buttons: six identical controls fail it on the first look.
 *
 * WHAT THE MERGE DOES NOT CHANGE, because all four are the gate contract (§7):
 *
 *   - every act arms before it fires, through `useArm`, one at a time, with the
 *     8-second self-disarm;
 *   - the armed sentence names the person and says, in words, what stops being
 *     true — verbatim, unshortened, because this is the moment §7.4 is about;
 *   - an armed act starts on its Cancel, never on the fire button: the second
 *     press is the consent, so a held or doubled Enter must not be able to give
 *     it (`test/gate.test.ts`);
 *   - `Dossier.tsx` keys this component by the candidate, so a bench click
 *     voids an armed gate rather than re-pointing it at somebody else (§7.3);
 *   - every precondition below is a projection of a rule `app/actions.ts`
 *     enforces, never a second rule (§7.7). Literally: `acts` comes from
 *     `actsFor` in `lib/acts.ts`, the predicates the actions guard with, so the
 *     slot list is the set the action would book - this candidate's own held
 *     slots first - and not a narrower one recomputed here.
 *
 * THE LETTER IS ON THE GATE. The two sends arm over the words that will reach the person - subject
 * and full body, from `letterFor` in `tools/preview.ts`, the function the send composes with - and
 * they change as the wording or the slot select changes. A wording's label is not what is being
 * approved; the letter is (hitl-approval: the gate sees its target).
 *
 * WHAT IT DOES CHANGE: arming takes over the whole bar. The reversible zone is
 * hidden for as long as an irreversible act is one click away, which is a
 * property the two-panel layout could not have — there, "Score again" sat live
 * and adjacent while a rejection was armed.
 */
import { useState } from "react";

import { decideStage, sendRejection, sendSchedulingEmail } from "@/app/actions";
import type { Act, Acts } from "@/lib/acts";
import {
  REJECTION_TEMPLATES,
  REJECTION_TEMPLATE_LABEL,
  STAGE_LABEL,
  type RejectionTemplate,
} from "@/lib/constants";
import { fmtWhen } from "../format";
import type { BdCandidate } from "../model";
import { letterFor } from "../tools/preview";
import { useArm, useRun } from "../useRun";

/** The letter a send would deliver, as the armed gate shows it: what is being approved. */
function Letter({ subject, body }: { subject: string; body: string }) {
  return (
    <div className="bd-letter" aria-label="The message that will be sent">
      <p className="bd-block-label">Subject: {subject}</p>
      <p className="bd-arm-q" style={{ whiteSpace: "pre-wrap" }}>
        {body}
      </p>
    </div>
  );
}

export function DossierGate({
  candidate,
  roleTitle,
  acts,
}: {
  candidate: BdCandidate;
  /** The role's title, which every letter names: the same argument the send composes with. */
  roleTitle: string;
  acts: Acts;
}) {
  const { pending, run } = useRun();
  const { armed, arm, disarm } = useArm();
  const [template, setTemplate] = useState<RejectionTemplate>("standard");
  // The pick is DERIVED, not seeded once: a refresh that consumes the chosen slot would otherwise
  // leave the select blank while the stale id is still what "Send it" submits.
  const [pick, setPick] = useState<string | null>(null);
  const slots = acts.schedule.slots;
  const slotId = (pick && slots.some((s) => s.id === pick) ? pick : slots[0]?.id) ?? "";
  const chosen = slots.find((s) => s.id === slotId);
  // A shut act says why on its own face, in the words for its reason. The reason is the same one the
  // server refuses with; the label is the short form a button has room for.
  const shut = (act: Act): string =>
    act.reason === "decided"
      ? `${STAGE_LABEL[candidate.stage]} is decided`
      : act.reason === "too_early"
        ? "Scheduling opens at Interview"
        : "No slot is open";

  return (
    <div className="bd-zone" data-class="GATED">
      {/*
       * The class keeps its full sentence — who it reaches AND what stops being
       * true — because §7.4 asks for both and the zone gives the line its own
       * row. An earlier pass at this bar had the label inline with the buttons
       * and had to shorten it to fit; the stacked zone in l2-dossier-2.css is
       * what made shortening unnecessary.
       */}
      <span className="bd-class" data-class="GATED">
        Gated — reaches {candidate.name}, and cannot be taken back.
      </span>

      {armed === "offer" ? (
        <div className="bd-arm">
          <p className="bd-arm-q">
            Record an offer for {candidate.name}. This ends their assessment and is not
            reversible: there is no undo payload to store, because you cannot un-decide it.
          </p>
          <div className="bd-actions">
            <button
              type="button"
              className="bd-btn"
              data-fire="true"
              disabled={pending}
              onClick={() => run(() => decideStage(candidate.id, "offer"), disarm)}
            >
              Record the offer
            </button>
            <button type="button" className="bd-btn" autoFocus onClick={disarm}>
              Cancel
            </button>
          </div>
        </div>
      ) : armed === "reject" ? (
        <div className="bd-arm">
          <p className="bd-arm-q">
            Send {candidate.name} a rejection at {candidate.email}, worded{" "}
            {REJECTION_TEMPLATE_LABEL[template]}. It reaches them and cannot be un-sent.
          </p>
          <Letter {...letterFor(candidate, roleTitle, { kind: "rejection", template })} />
          <div className="bd-actions">
            <select
              className="bd-select"
              value={template}
              onChange={(event) => setTemplate(event.target.value as RejectionTemplate)}
              aria-label="Rejection wording"
            >
              {REJECTION_TEMPLATES.map((t) => (
                <option key={t} value={t}>
                  {REJECTION_TEMPLATE_LABEL[t]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="bd-btn"
              data-fire="true"
              disabled={pending}
              onClick={() => run(() => sendRejection(candidate.id, template), disarm)}
            >
              Send it
            </button>
            <button type="button" className="bd-btn" autoFocus onClick={disarm}>
              Cancel
            </button>
          </div>
        </div>
      ) : armed === "schedule" ? (
        <div className="bd-arm">
          <p className="bd-arm-q">
            Email {candidate.name} at {candidate.email} to book the slot below. It reaches them
            and cannot be un-sent.
          </p>
          {chosen ? <Letter {...letterFor(candidate, roleTitle, { kind: "scheduling", slot: chosen })} /> : null}
          <div className="bd-actions">
            <select
              className="bd-select"
              value={slotId}
              onChange={(event) => setPick(event.target.value)}
              aria-label="Which slot to offer"
            >
              {slots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.interviewer} · {fmtWhen(slot.startTs)} · {slot.minutes}m
                  {slot.applicantId === candidate.id ? " · held for them" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="bd-btn"
              data-fire="true"
              disabled={pending || slotId === ""}
              onClick={() => run(() => sendSchedulingEmail(candidate.id, slotId), disarm)}
            >
              Send it
            </button>
            <button type="button" className="bd-btn" autoFocus onClick={disarm}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /*
         * The verbs keep their weight — these are the three acts that reach a
         * person, and "Offer" is not the same promise as "Record an offer".
         * The one string that shortened is the ENABLED scheduling label, from
         * "Email a scheduling invitation", because the word scheduling is
         * already carried by the disabled form of the same button and by the
         * arming sentence. Every precondition below still says why, in full.
         */
        <div className="bd-actions">
          <button
            type="button"
            className="bd-btn"
            disabled={!acts.offer.enabled}
            onClick={() => arm("offer")}
          >
            {acts.offer.enabled ? "Record an offer" : shut(acts.offer)}
          </button>
          <button
            type="button"
            className="bd-btn"
            disabled={!acts.schedule.enabled}
            onClick={() => arm("schedule")}
          >
            {acts.schedule.enabled ? "Email an invitation" : shut(acts.schedule)}
          </button>
          <button
            type="button"
            className="bd-btn"
            disabled={!acts.reject.enabled}
            onClick={() => arm("reject")}
          >
            {acts.reject.enabled ? "Send a rejection" : shut(acts.reject)}
          </button>
        </div>
      )}
    </div>
  );
}
