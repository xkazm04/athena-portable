"use client";

/**
 * The gated half: the acts that reach a person and cannot be taken back.
 *
 * A separate REGION, not a badge on a button. Greyscale the card and this is
 * still the only panel drawn this way, which is the test the design law sets:
 * the class has to survive being printed in black and white.
 *
 * Everything in it arms first and states, in words, exactly who it reaches and
 * what stops being true. `decide_stage` and `send_rejection` end somebody's
 * application; there is no undo to offer and the panel does not pretend
 * otherwise.
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
<div className="bd-gate-panel">
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
              : "Email a scheduling invitation"
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
