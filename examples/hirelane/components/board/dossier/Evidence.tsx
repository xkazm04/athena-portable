"use client";

/**
 * Their answer, every score, and the sentence that earned it.
 *
 * This is the direction's whole claim in one column: a score is never printed
 * without the applicant's own words beside it, quoted verbatim, so a reader can
 * disagree with the machine on the spot. A criterion the application never
 * speaks to is drawn as a gap rather than a low mark.
 */
import { answerBody, fmtDate, fmtWhen, scoreWord } from "../format";
import { SCORE_MAX, type BdCandidate, type BdRole } from "../model";
import { Band } from "./parts";

export function DossierEvidence({
  role,
  candidate,
}: {
  role: BdRole;
  candidate: BdCandidate;
}) {
  return (
    <div className="bd-main">
      <Band label="Their answer" note={role.question} />
      <div className="bd-section">
        <p className="bd-prose">{answerBody(candidate.shortAnswer, role.question)}</p>
      </div>
      <Band label="In their own words" />
      <div className="bd-section">
        <p className="bd-prose">{candidate.cvText}</p>
      </div>
      <Band
        label="The rubric, criterion by criterion"
        note={candidate.gap ? `the gap is ${candidate.gap.toLowerCase()}` : undefined}
      />
      <div className="bd-section">
        {candidate.scores.map((score) => {
          const criterion = role.criteria.find((c) => c.id === score.criterionId);
          const isGap = candidate.gapId === score.criterionId;
          return (
            <div className="bd-criterion" key={score.criterionId} data-gap={isGap}>
              <div className="bd-criterion-top">
                <span className="bd-criterion-name">{score.name}</span>
                <span className="bd-criterion-score">
                  {candidate.scored
                    ? `${score.score} / ${SCORE_MAX} · ${scoreWord(score.score)}`
                    : "not scored"}
                  {" · weight "}
                  {score.weight}
                </span>
              </div>
              {criterion ? <p className="bd-prose">{criterion.description}</p> : null}
              {score.evidence.length > 0 ? (
                <ul className="bd-evidence">
                  {score.evidence.map((sentence) => (
                    <li key={sentence}>{sentence}</li>
                  ))}
                </ul>
              ) : (
                <p className="bd-hand">nothing in the application speaks to this</p>
              )}
            </div>
          );
        })}
      </div>
      <Band label="Where they are" />
      <div className="bd-section">
        <dl className="bd-facts">
          <div>
            <dt>Email</dt>
            <dd>{candidate.email}</dd>
          </div>
          <div>
            <dt>Waiting</dt>
            <dd>{candidate.meta.waitingDays} days</dd>
          </div>
          <div>
            <dt>Time held</dt>
            <dd>
              {candidate.meta.held.length === 0
                ? "none"
                : candidate.meta.held
                    .map((s) => `${s.interviewer}, ${fmtWhen(s.startTs)}`)
                    .join("; ")}
            </dd>
          </div>
          <div>
            <dt>Already sent</dt>
            <dd>
              {candidate.meta.sent.length === 0
                ? "nothing"
                : candidate.meta.sent
                    .map((s) => `${s.kind} ${fmtDate(s.ts)}`)
                    .join("; ")}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
