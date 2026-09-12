"use client";

/**
 * The two things a row says beyond a count.
 *
 * `stageFact` is the one fact true in this stage and no other, in the same
 * vocabulary the carousel uses one level down. `FitRule` is the group's scored
 * candidates as ticks on the rubric's own 0-4 line with both stored floors
 * ruled across it — because L0's real question is not "who is in this group"
 * but "which of these ten do I open", and a count alone cannot answer it.
 *
 * Both obey the same rule: when there is nothing to say they draw nothing. A
 * group nobody has scored has no line, not an empty one.
 */
import type { CSSProperties } from "react";

import {
  FIT_PROMISING,
  FIT_STRONG,
  SCORE_MAX,
  type BdCandidate,
  type StageRole,
} from "../model";

/**
 * The one fact that is true in this stage and in no other, aggregated over the
 * groups the filters left standing.
 *
 * It is the same vocabulary `Carousel`'s `StageMeta` uses one level down, for
 * the same reason: a stage is not just a name and a count, it is a thing a
 * candidate is waiting for. Every figure is a stored column — the frozen day
 * count, the evidence attached to a scorecard, the slots, the messages — so
 * nothing here is estimated.
 */
export function stageFact(role: StageRole, candidates: BdCandidate[]): string | null {
  if (candidates.length === 0) return null;

  if (role === "entry") {
    const longest = candidates.reduce((n, c) => Math.max(n, c.meta.waitingDays), 0);
    return `${longest} days is the longest wait`;
  }

  if (role === "screening") {
    const evidenced = candidates.reduce((n, c) => n + c.meta.evidenced, 0);
    const total = candidates.reduce((n, c) => n + c.meta.criteriaCount, 0);
    return `${evidenced} of ${total} criteria evidenced`;
  }

  if (role === "interview") {
    const held = candidates.filter((c) => c.meta.held.length > 0).length;
    return `${held} of ${candidates.length} have a slot held`;
  }

  const sent = candidates.filter((c) => c.meta.sent.length > 0).length;
  return `${sent} of ${candidates.length} have been written to`;
}

/**
 * The group's scored candidates as ticks on the rubric's own 0-4 line, with the
 * two stored fit floors ruled across it.
 *
 * L0's real question is not "who is in this group" — it is "which of these ten
 * groups do I open", and a count alone cannot answer it. A group whose five
 * ticks all sit left of the promising floor is a different afternoon from one
 * with three above the strong floor, and that difference was invisible before.
 * The floors are `FIT_PROMISING` and `FIT_STRONG` from the model, not values
 * typed in here, so the line means exactly what the fit band means.
 *
 * When nobody in the group has been scored there is no line at all — the same
 * rule the cards follow (brief §2: "the unscored are expressed by absence").
 */
export function FitRule({ candidates }: { candidates: BdCandidate[] }) {
  const scored = candidates.filter((c) => c.scored);
  const arguable = candidates.filter((c) => c.borderline).length;

  /* Absence, not a zero. A group nobody has scored and nobody has flagged has
     nothing to say here, and printing "0 scored" under every such row repeats
     the column head once per role for no gain. */
  if (scored.length === 0 && arguable === 0) return null;

  return (
    <span className="bd-group-scale">
      {scored.length > 0 ? (
        <span className="bd-scale" aria-hidden>
          <i className="bd-scale-floor" style={{ "--at": FIT_PROMISING / SCORE_MAX } as CSSProperties} />
          <i
            className="bd-scale-floor"
            data-strong="true"
            style={{ "--at": FIT_STRONG / SCORE_MAX } as CSSProperties}
          />
          {scored.map((c) => (
            <i
              key={c.id}
              className="bd-scale-tick"
              data-borderline={c.borderline}
              style={{ "--at": c.overall / SCORE_MAX } as CSSProperties}
            />
          ))}
        </span>
      ) : null}
      <span className="bd-scale-note">
        {scored.length > 0 ? `${scored.length} scored` : null}
        {scored.length > 0 && arguable > 0 ? " · " : null}
        {arguable > 0 ? `${arguable} arguable` : null}
      </span>
    </span>
  );
}
