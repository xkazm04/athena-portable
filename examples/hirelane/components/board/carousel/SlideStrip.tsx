"use client";

/**
 * Variant A — THE STRIP. `design/ui-pass-brief.md` §2.3.
 *
 * THE METAPHOR: the density strip down the edge of a contact sheet. One continuous signal per
 * frame, read ACROSS frames rather than down one. This direction's source is the lit contact sheet
 * (`design/board-brief.md` §1b) and this is the part of that object nobody had drawn yet.
 *
 * THE DIFF FROM THE CARD THAT SHIPS. Measured: the five criteria took 279px of a 500px card —
 * 56% — as ten stacked elements, and at *Backend Engineer · Applied*, where nobody is scored, all
 * of it was label-plus-em-dash.
 *
 *   - THE LABELS LEAVE THE CARD. All three cards under the loupe belong to one column, so they
 *     are read against one role's rubric in one order. The names were rendered three times to say
 *     the same five things. They are printed once, under the rail, by `Carousel.tsx` — fifteen
 *     renders become five, and the room goes to the signal.
 *   - THE FIVE BECOME ONE SHAPE on a shared 0-4 axis, so comparing two candidates is matching two
 *     silhouettes rather than reading ten words and subtracting two bar lengths at different
 *     heights on the screen.
 *   - WEIGHT IS THE SEGMENT'S WIDTH. The heaviest criterion is literally the widest part of the
 *     signal, so a strong score on a weight-3 criterion occupies more of the reader's eye than the
 *     same score on a weight-1 — which is what the weighted overall is doing arithmetically.
 *   - THE GAP IS A BREAK IN THE BASELINE, at the segment it belongs to, drawn with the same
 *     `GapMark` the card uses. §9.7 wants it legible at row level; a broken rule under the axis is
 *     the most legible place it has been.
 *   - UNSCORED IS A FLAT BASELINE, no segments at all — the signal absent rather than five dashes.
 *   - THE OVERALL BECOMES THE DOMINANT OBJECT. With the labels gone it is the only figure on the
 *     card and may carry the emphasis the five rows were splitting.
 *
 * WHAT IT KEEPS, because DESIGN-LAW §3 requires it: all five criteria, on one shared 0-4 baseline,
 * with the weight visible and the gap legible without opening the candidate.
 */
import { motion } from "motion/react";
import type { CSSProperties } from "react";

import { fmtScore } from "../format";
import { Face } from "../marks/Face";
import { GapMark } from "../marks/Marks";
import { BAND_LABEL, FIT_LABEL, SCORE_MAX } from "../model";
import { settle } from "../motion";
import { LOUPE, poseOf } from "./pose";
import { StageMeta } from "./StageMeta";
import type { CardProps } from "./CardVariant";

export function SlideStrip({ candidate, column, offset, onFocus, onOpen }: CardProps) {
  const pose = poseOf(offset);
  const focused = offset === 0;
  return (
    <motion.button
      type="button"
      layoutId={`candidate-${candidate.id}`}
      className="bd-slide bd-strip"
      data-focus={focused}
      data-depth={Math.abs(offset) <= LOUPE ? "loupe" : "far"}
      data-borderline={candidate.borderline}
      role="option"
      aria-selected={focused}
      animate={{
        x: pose.x,
        rotateY: pose.rotateY,
        z: pose.z,
        scale: pose.scale,
        opacity: pose.opacity,
      }}
      transition={settle}
      style={{ zIndex: 20 - Math.abs(offset) }}
      onClick={() => (focused ? onOpen() : onFocus())}
    >
      <span className="bd-slide-inner">
        <span className="bd-slide-who">
          <Face id={candidate.id} initials={candidate.initials} className="bd-mono" size="lg" />
          <span className="bd-slide-text">
            <span className="bd-slide-name">{candidate.name}</span>
            <br />
            <span className="bd-slide-sub">
              {candidate.years} yrs · {candidate.headline}
            </span>
          </span>
        </span>

        <span className="bd-strip-verdict">
          <span className="bd-strip-overall" data-unscored={!candidate.scored}>
            {fmtScore(candidate.scored, candidate.overall)}
          </span>
          <span className="bd-strip-of">/ {SCORE_MAX}</span>
          <span className="bd-strip-words">
            <span className="bd-fit" data-fit={candidate.fit}>
              {FIT_LABEL[candidate.fit]}
            </span>
            {candidate.scored ? (
              <span className="bd-band">{BAND_LABEL[candidate.band]}</span>
            ) : null}
          </span>
        </span>

        {/*
         * The signal. One row, five segments, the widths carrying weight and the fills carrying
         * score against a shared 0-4 axis. `aria-label` says in words what the shape says in
         * pixels, because a silhouette is not readable by a screen reader and the five criterion
         * names are off the card by design.
         */}
        <span
          className="bd-strip-meter"
          role="img"
          aria-label={
            candidate.scored
              ? candidate.scores
                  .map((s) => `${s.name} ${s.score} of ${SCORE_MAX}`)
                  .join(", ")
              : "not scored"
          }
        >
          {candidate.scores.map((score) => {
            const isGap = candidate.gapId === score.criterionId;
            return (
              <span
                className="bd-strip-seg"
                key={score.criterionId}
                data-gap={isGap}
                style={{ "--w": score.weight, "--score": score.score } as CSSProperties}
              >
                <span className="bd-strip-track">
                  {candidate.scored ? <span className="bd-strip-fill" /> : null}
                </span>
                {isGap ? <GapMark className="bd-strip-break" /> : null}
              </span>
            );
          })}
        </span>

        <StageMeta column={column} candidate={candidate} />
      </span>
    </motion.button>
  );
}
