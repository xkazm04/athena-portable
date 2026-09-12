"use client";

/**
 * One card in the deck: a person, and how far each of the five criteria sits from the rest of this
 * column. `design/ui-pass-brief.md` §2.4 — the direction that won the L1 prototype.
 *
 * THE METAPHOR: a scorer's ledger, where what is written down is never the raw mark but the
 * difference from par. The card stops asking the reader to compare and does the comparison.
 *
 * THE CLAIM. L1 exists to answer "which of these". A 3.1 on API design means nothing until you
 * know whether the other ten are above or below it — the argument `dossier/Bench.tsx` already
 * makes in prose about the overall score, applied to the five criteria that produce it. So every
 * criterion is printed as a SIGNED DELTA from the median of the scored candidates in this column,
 * and the five are ordered by that delta, widest first. The card's first line is therefore the one
 * thing that is most true about this person relative to the people they are being chosen against.
 *
 * THE DIFF FROM THE CARD THAT SHIPS, and from the strip beside it:
 *
 *   - THE ORDER IS PER-CANDIDATE, not the rubric's. Two cards under the loupe show their criteria
 *     in different orders, which is the opposite of the strip's fixed axis and is the point: the
 *     reader is shown what is distinctive rather than left to find it.
 *   - THE LABELS STAY ON THE CARD, and must, because the order changes per card. The direction
 *     this beat hoisted its labels to a legend under the rail, which it could do precisely
 *     because its order never moved; this one cannot.
 *   - THE NUMBER IS THE COMPARISON, pre-computed, rather than a shape to be matched by eye.
 *   - WEIGHT IS A WEIGHT MARK — a stack of one to three rules beside the criterion — rather than a
 *     width, because here the row is a line of type and its length is spoken for by the name.
 *
 * IT CARRIES `layoutId={`candidate-${id}`}` — the same identity the face on the board had and the
 * dossier will have — so a candidate travels through all three levels as one object rather than
 * being drawn three times.
 *   - THE GAP IS NAMED IN WORDS on its own row rather than drawn, since this card is already a
 *     list of sentences about difference and "nothing quoted for X" is the same kind of sentence.
 *
 * THE HONEST CASE. When nobody in the column has been scored there is no median and no delta, and
 * the card says so instead of printing zeroes: a delta against an empty population is not a small
 * difference, it is not a measurement. That is the same rule as the em dash on an unscored overall.
 *
 * WHAT IT KEEPS, because DESIGN-LAW §3 requires it: all five criteria, each still carrying its
 * absolute 0-4 score on the shared axis beside the delta, the weight visible, and the gap legible
 * without opening the candidate.
 */
import { motion } from "motion/react";
import type { CSSProperties } from "react";

import { fmtScore } from "../format";
import { Face } from "../marks/Face";
import { BAND_LABEL, FIT_LABEL, SCORE_MAX, type BdCandidate, type BdColumn } from "../model";
import { settle } from "../motion";
import { LOUPE, poseOf } from "./pose";
import { StageMeta } from "./StageMeta";

/** A signed delta, with the sign printed even when it is positive. Zero is "level", not "+0.0". */
function fmtDelta(delta: number): string {
  if (Math.abs(delta) < 0.05) return "level";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}`;
}

export interface SlideProps {
  candidate: BdCandidate;
  column: BdColumn;
  /** Distance from the loupe, in cards. `pose.ts` turns it into a position. */
  offset: number;
  /**
   * Per-criterion median among the SCORED candidates in this column, computed once per column by
   * `Carousel.tsx` rather than once per card.
   *
   * Empty when nobody here has been scored, which this card has to render honestly rather than as
   * a column of zeroes — see `comparable` below.
   */
  medians: Map<string, number>;
  onFocus: () => void;
  onOpen: () => void;
}

export function Slide({ candidate, column, offset, medians, onFocus, onOpen }: SlideProps) {
  const pose = poseOf(offset);
  const focused = offset === 0;
  /* Against the median of the scored, widest difference first. Unscored candidates and empty
     populations fall through to the honest case below rather than sorting on a zero. */
  const comparable = candidate.scored && medians.size > 0;
  const rows = candidate.scores
    .map((score) => ({
      score,
      delta: comparable ? score.score - (medians.get(score.criterionId) ?? score.score) : 0,
      isGap: candidate.gapId === score.criterionId,
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return (
    <motion.button
      type="button"
      layoutId={`candidate-${candidate.id}`}
      className="bd-slide"
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

        <span className="bd-led-verdict">
          <span className="bd-overall" data-unscored={!candidate.scored}>
            {fmtScore(candidate.scored, candidate.overall)}
          </span>
          <span className="bd-fit" data-fit={candidate.fit}>
            {FIT_LABEL[candidate.fit]}
          </span>
          {candidate.scored ? <span className="bd-band">{BAND_LABEL[candidate.band]}</span> : null}
        </span>

        <span className="bd-led-rows">
          {comparable ? (
            <span className="bd-led-head">
              <span>against the {medians.size === 0 ? 0 : column.scored} scored here</span>
            </span>
          ) : null}
          {rows.map(({ score, delta, isGap }) => (
            <span className="bd-led-row" key={score.criterionId} data-gap={isGap}>
              <span className="bd-led-weight" data-weight={score.weight} aria-hidden>
                {Array.from({ length: score.weight }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
              <span className="bd-led-name">{score.short}</span>
              <span
                className="bd-led-axis"
                style={{ "--score": score.score } as CSSProperties}
                aria-hidden
              >
                {candidate.scored ? <span className="bd-led-fill" /> : null}
              </span>
              <span className="bd-led-abs">
                {candidate.scored ? `${score.score}/${SCORE_MAX}` : "—"}
              </span>
              <span
                className="bd-led-delta"
                data-dir={!comparable ? "none" : delta > 0.05 ? "up" : delta < -0.05 ? "down" : "level"}
              >
                {comparable ? fmtDelta(delta) : "—"}
              </span>
            </span>
          ))}
          {candidate.gap ? (
            <span className="bd-led-gapline">nothing quoted for {candidate.gap.toLowerCase()}</span>
          ) : null}
        </span>

        <StageMeta column={column} candidate={candidate} />
      </span>
    </motion.button>
  );
}
