"use client";

/**
 * One card in the deck: a person, and the five criteria they were read against.
 *
 * It carries `layoutId={`candidate-${id}`}` — the same identity the face on
 * the board had and the dossier will have — so a candidate travels through all
 * three levels as one object rather than being drawn three times.
 *
 * The unscored are expressed by absence. A candidate nobody has read shows an
 * empty bar and no number, because printing a zero would rank them below
 * somebody who was read and found wanting.
 */
import { motion } from "motion/react";
import type { CSSProperties } from "react";

import { fmtScore, scoreWord } from "../format";
import { Face } from "../marks/Face";
import { GapMark } from "../marks/Marks";
import { BAND_LABEL, FIT_LABEL, type BdCandidate, type BdColumn } from "../model";
import { settle } from "../motion";
import { LOUPE, poseOf } from "./pose";
import { StageMeta } from "./StageMeta";

export function Slide({
  candidate,
  column,
  offset,
  onFocus,
  onOpen,
}: {
  candidate: BdCandidate;
  column: BdColumn;
  offset: number;
  onFocus: () => void;
  onOpen: () => void;
}) {
  const pose = poseOf(offset);
  const focused = offset === 0;
  return (
      <motion.button
        key={candidate.id}
        type="button"
        layoutId={`candidate-${candidate.id}`}
        className="bd-slide"
        data-focus={focused}
        /*
         * A loupe implies everything outside it is out of focus, and the
         * cards past the near set were still resolving five criterion
         * labels each — so the recede read as a smear of small type
         * rather than as depth. Naming the two depths lets the stylesheet
         * throw the far ones properly out of focus, which is what a
         * contact sheet under a loupe actually looks like.
         */
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
        /* A card off the loupe brings itself under it; the card already under
           it opens. One control, two meanings, decided by where it is. */
        onClick={() => (focused ? onOpen() : onFocus())}
      >
        <span className="bd-slide-inner">
          <span className="bd-slide-who">
            <Face
              id={candidate.id}
              initials={candidate.initials}
              className="bd-mono"
              size="lg"
            />
            <span className="bd-slide-text">
              <span className="bd-slide-name">{candidate.name}</span>
              <br />
              <span className="bd-slide-sub">
                {candidate.years} yrs · {candidate.headline}
              </span>
            </span>
          </span>
          <span className="bd-slide-verdict">
            <span className="bd-overall" data-unscored={!candidate.scored}>
              {fmtScore(candidate.scored, candidate.overall)}
            </span>
            <span className="bd-fit" data-fit={candidate.fit}>
              {FIT_LABEL[candidate.fit]}
            </span>
            {candidate.scored ? (
              <span className="bd-band">{BAND_LABEL[candidate.band]}</span>
            ) : null}
          </span>
          <span className="bd-bars">
            {candidate.scores.map((score) => {
              const isGap = candidate.gapId === score.criterionId;
              return (
                <span className="bd-bar" key={score.criterionId}>
                  <span className="bd-bar-top">
                    <b>{score.short}</b>
                    <span>
                      {candidate.scored ? scoreWord(score.score) : "—"}
                    </span>
                  </span>
                  <span
                    className="bd-bar-track"
                    data-weight={score.weight}
                    data-gap={isGap}
                  >
                    {candidate.scored ? (
                      <span
                        className="bd-bar-fill"
                        style={{ "--score": score.score } as CSSProperties}
                      />
                    ) : null}
                    {isGap ? <GapMark className="bd-bar-gap" /> : null}
                  </span>
                </span>
              );
            })}
          </span>
          <StageMeta column={column} candidate={candidate} />
        </span>
      </motion.button>
  );
}
