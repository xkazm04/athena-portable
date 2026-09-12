"use client";

/**
 * The two things a row says beyond a count.
 *
 * `stageFact` is the one fact true in this stage and no other, in the same
 * vocabulary the carousel uses one level down. `GroupRead` answers L0's real
 * question — not "who is in this group" but "which of these ten do I open" —
 * in the three figures that decide it.
 *
 * Both obey the same rule: when there is nothing to say they draw nothing. A
 * group nobody has scored has no line, not an empty one.
 */
import type { BdCandidate, StageRole } from "../model";

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
 * What a reader needs to decide which of ten groups to open, in words.
 *
 * It was a tick line: the group's scored candidates plotted on the rubric's own 0-4 baseline with
 * the two stored fit floors ruled across it. The arithmetic was right and nobody could read it.
 * At a column's width the whole instrument is 180px wide and 8px tall, it carries no axis, no
 * legend and no label, and the review of the shipped board called it what it looked like: a
 * decoration under every row. A structural device has to encode something a reader can decode.
 *
 * The same three facts, said: how many of this group have been read, the best weighted score in
 * it, and how many a person flagged as arguable. `best` is what the ticks were really being
 * scanned for — is there anything above the strong floor in here — and it answers that exactly
 * rather than to within a few pixels of tick position. It is on the rubric's own 0-4 scale, which
 * every other score on this surface is on, so the denominator is not reprinted under every row.
 *
 * The absence rule is unchanged (brief §2): a group nobody has scored and nobody has flagged says
 * nothing here rather than printing a zero.
 */
export function GroupRead({ candidates }: { candidates: BdCandidate[] }) {
  const scored = candidates.filter((c) => c.scored);
  const arguable = candidates.filter((c) => c.borderline).length;
  if (scored.length === 0 && arguable === 0) return null;

  const best = scored.reduce((n, c) => Math.max(n, c.overall), 0);

  return (
    <span className="bd-group-read">
      {scored.length > 0 ? (
        <span>
          <span className="bd-fig">{scored.length}</span> of{" "}
          <span className="bd-fig">{candidates.length}</span> scored
        </span>
      ) : null}
      {scored.length > 0 ? (
        <span>
          best <span className="bd-fig">{best.toFixed(1)}</span>
        </span>
      ) : null}
      {arguable > 0 ? (
        <span data-arguable="true">
          <span className="bd-fig">{arguable}</span> arguable
        </span>
      ) : null}
    </span>
  );
}
