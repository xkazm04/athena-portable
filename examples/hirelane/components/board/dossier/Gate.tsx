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
 *   - `Dossier.tsx` keys this component by the candidate, so a bench click
 *     voids an armed gate rather than re-pointing it at somebody else (§7.3);
 *   - every precondition below is a projection of a rule `app/actions.ts`
 *     enforces, never a second rule (§7.7).
 *
 * WHAT IT DOES CHANGE: arming takes over the whole bar. The reversible zone is
 * hidden for as long as an irreversible act is one click away, which is a
 * property the two-panel layout could not have — there, "Score again" sat live
 * and adjacent while a rejection was armed.
 */
import { useState } from "react";

import { decideStage, sendRejection, sendSchedulingEmail } from "@/app/actions";
import {
  isDecisionStage,
  REJECTION_TEMPLATES,
  REJECTION_TEMPLATE_LABEL,
  STAGE_LABEL,
  type RejectionTemplate,
} from "@/lib/constants";
import { fmtWhen } from "../format";
import type { BdCandidate } from "../model";
import { useArm, useRun } from "../useRun";

export function DossierGate({
  candidate,
  openSlots,
}: {
  candidate: BdCandidate;
  openSlots: { id: string; interviewer: string; startTs: string; minutes: number }[];
}) {
  const { pending, run } = useRun();
  const { armed, arm, disarm } = useArm();
  const [template, setTemplate] = useState<RejectionTemplate>("standard");
  // The pick is DERIVED, not seeded once: a refresh that consumes the chosen slot would otherwise
  // leave the select blank while the stale id is still what "Send it" submits.
  const [pick, setPick] = useState<string | null>(null);
  const slotId = (pick && openSlots.some((s) => s.id === pick) ? pick : openSlots[0]?.id) ?? "";
  const canScheduleFor = candidate.stage === "interview";
  // Each of these three is a projection of a rule `app/actions.ts` enforces, never a second rule:
  // a decision is terminal, so neither an offer nor a rejection may be recorded over one.
  const settled = isDecisionStage(candidate.stage);

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
              autoFocus
              disabled={pending}
              onClick={() => run(() => decideStage(candidate.id, "offer"), disarm)}
            >
              Record the offer
            </button>
            <button type="button" className="bd-btn" onClick={disarm}>
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
            <button type="button" className="bd-btn" onClick={disarm}>
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
          <div className="bd-actions">
            <select
              className="bd-select"
              value={slotId}
              onChange={(event) => setPick(event.target.value)}
              aria-label="Which slot to offer"
            >
              {openSlots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.interviewer} · {fmtWhen(slot.startTs)} · {slot.minutes}m
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
            <button type="button" className="bd-btn" onClick={disarm}>
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
            disabled={settled}
            onClick={() => arm("offer")}
          >
            {settled ? `${STAGE_LABEL[candidate.stage]} is decided` : "Record an offer"}
          </button>
          <button
            type="button"
            className="bd-btn"
            disabled={settled || !canScheduleFor || openSlots.length === 0}
            onClick={() => arm("schedule")}
          >
            {settled
              ? `${STAGE_LABEL[candidate.stage]} is decided`
              : canScheduleFor
                ? openSlots.length === 0
                  ? "No slot is open"
                  : "Email an invitation"
                : "Scheduling opens at Interview"}
          </button>
          <button
            type="button"
            className="bd-btn"
            disabled={settled}
            onClick={() => arm("reject")}
          >
            {settled ? `${STAGE_LABEL[candidate.stage]} is decided` : "Send a rejection"}
          </button>
        </div>
      )}
    </div>
  );
}
