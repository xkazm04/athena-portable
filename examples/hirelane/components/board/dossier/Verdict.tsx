"use client";

/**
 * The verdict band: who this is, and what the rubric made of them.
 *
 * The unscored are expressed by absence. A candidate nobody has read carries no
 * number and no band here, and says so in the surface's own handwriting,
 * because printing a zero would be a score and nobody has given them one.
 */
import type { RefObject } from "react";

import { STAGE_LABEL } from "@/lib/constants";
import { fmtDate, fmtScore } from "../format";
import { Face } from "../marks/Face";
import { BAND_LABEL, FIT_LABEL, SCORE_MAX, type BdCandidate, type BdRole } from "../model";

export function DossierVerdict({
  role,
  candidate,
  closeRef,
  onClose,
}: {
  role: BdRole;
  candidate: BdCandidate;
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  return (
    <div className="bd-dossier-head">
      <div className="bd-dossier-top">
        <Face
          id={candidate.id}
          initials={candidate.initials}
          className="bd-mono"
          size="lg"
        />
        <div className="bd-dossier-id">
          <h2 className="bd-dossier-name" id="bd-dossier-title">
            {candidate.name}
          </h2>
          <p className="bd-dossier-sub">
            {role.title} · {STAGE_LABEL[candidate.stage]} · applied{" "}
            {fmtDate(candidate.appliedAt)}
          </p>
          {/*
           * The remark sits under the sub-line rather than floating at the far
           * end of a figure band, which is where it used to be. Read there it
           * looked like a caption ON the figures; read here it is what it is,
           * a remark about the person — and it costs no row of its own.
           */}
          {candidate.scored ? (
            <p className="bd-hand">
              {candidate.bandDrivers.length > 0
                ? `read it as ${BAND_LABEL[candidate.band]} — nothing quoted for ${candidate.bandDrivers.join(", ")}`
                : `every criterion has a quote behind it`}
            </p>
          ) : (
            <p className="bd-hand">nobody has scored this one yet</p>
          )}
        </div>
        {/*
         * The four figures, folded into the identity row.
         *
         * They were a separately bordered box under it, which cost the pane a
         * 74px band plus its own gap to say four short things that fit beside
         * the name. `design/ui-pass-brief.md` §3 has the measurement: the head
         * was 190px of an 828px modal while the reading column below it was
         * showing 29% of itself.
         *
         * Figures in the mono face at figure size; words in the text face,
         * smaller. Set identically, the phrase "not scored" was the largest
         * thing in the band and out-shouted the number it qualifies — a word
         * borrowing the authority the tabular figures are there to carry.
         */}
        <div className="bd-verdict">
          <div>
            <b>
              {fmtScore(candidate.scored, candidate.overall)}
              <span className="bd-of"> / {SCORE_MAX}</span>
            </b>
            <span>weighted</span>
          </div>
          <div data-word="true">
            <b>{FIT_LABEL[candidate.fit]}</b>
            <span>fit</span>
          </div>
          <div>
            <b>
              {candidate.meta.evidenced}/{candidate.meta.criteriaCount}
            </b>
            <span>evidenced</span>
          </div>
          <div>
            <b>{candidate.years}</b>
            <span>years</span>
          </div>
        </div>
        <button
          type="button"
          className="bd-close"
          onClick={onClose}
          ref={closeRef}
          aria-label="Close this candidate and return to the group"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
