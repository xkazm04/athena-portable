"use client";

/**
 * The one fact that is true in this stage and in no other.
 *
 * Every column shows a different thing because a different thing is true in it:
 * how long an untouched application has been sitting, how much of the rubric an
 * application actually speaks to, whose time is booked, what has been sent. All
 * four are stored columns, so none of them is a guess — and none of them is
 * shown anywhere it would be meaningless.
 */
import { fmtWhen } from "../format";
import type { BdCandidate, BdColumn } from "../model";

/** The one fact that is true in this stage and in no other. */
export function StageMeta({ column, candidate }: { column: BdColumn; candidate: BdCandidate }) {
  const { meta } = candidate;

  if (column.role === "entry") {
    return <span className="bd-slide-meta">{meta.waitingDays} days waiting to be read</span>;
  }

  if (column.role === "screening") {
    return (
      <span className="bd-slide-meta">
        <span className="bd-pips" aria-hidden>
          {candidate.scores.map((s) => (
            <i key={s.criterionId} data-on={s.evidence.length > 0} />
          ))}
        </span>
        {meta.evidenced} of {meta.criteriaCount} criteria evidenced
      </span>
    );
  }

  if (column.role === "interview") {
    return (
      <span className="bd-slide-meta">
        {meta.held.length === 0
          ? "no slot held"
          : meta.held
              .map((s) => `${s.interviewer} · ${fmtWhen(s.startTs)} · ${s.minutes}m`)
              .join("  ")}
      </span>
    );
  }

  return (
    <span className="bd-slide-meta">
      {meta.sent.length === 0
        ? "nothing sent to this person"
        : meta.sent.map((s) => `${s.kind} sent`).join("  ")}
    </span>
  );
}
