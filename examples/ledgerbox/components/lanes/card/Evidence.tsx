"use client";

/**
 * What there is to weigh up about this invoice: the lines, the credits that
 * might fit it, and anything already written to the client.
 *
 * The last region is the honest one. When there is nothing on file the card
 * says so in words rather than showing three empty blocks — an empty region
 * reads as a loading failure, and a sentence reads as an answer.
 */
import { formatDate, formatMoney } from "@/lib/format";
import { HEAT_LABEL, type LnDetail, type LnMark } from "../model";

export function CardEvidence({
  mark,
  detail,
  owed,
  hasEvidence,
  pending,
  onMatch,
  onUnmatch,
}: {
  mark: LnMark;
  detail: LnDetail | undefined;
  owed: boolean;
  hasEvidence: boolean;
  pending: boolean;
  onMatch: (lineId: string) => void;
  onUnmatch: (lineId: string) => void;
}) {
  return (
        <div className="ln-card-main">
        {detail?.disputeNote ? (
          <p className="ln-note" data-kind="dispute">
            {detail.disputeNote}
          </p>
        ) : null}
        {detail?.mostlyPaid ? (
          <p className="ln-note" data-kind="caution">
            This client has already paid most of this invoice. Chasing the remainder is probably
            the wrong move; read the balance before you send anything.
          </p>
        ) : null}
        {detail && detail.lines.length > 0 ? (
          <div className="ln-block">
            <span className="ln-block-label">Lines</span>
            <div className="ln-lines">
              {/* Keyed on the position, not the description: a real invoice
                  bills the same thing twice (LB-2026-0002 has two
                  "Discovery workshop, two days" lines) and a description key
                  made React drop one of them and log a duplicate-key error. */}
              {detail.lines.map((line, index) => (
                <span className="ln-line" key={`${index}-${line.description}`}>
                  <span>
                    {line.description}
                    {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                  </span>
                  <span>{formatMoney(line.amountCents)}</span>
                </span>
              ))}
            </div>
            {detail.linesHidden > 0 ? (
              <span className="ln-truncated">
                (showing {detail.lines.length} of {detail.lines.length + detail.linesHidden})
              </span>
            ) : null}
          </div>
        ) : null}
        {detail && detail.matched.length > 0 ? (
          <div className="ln-block">
            <span className="ln-block-label">Credits already applied</span>
            {detail.matched.map((m) => (
              <div className="ln-candidate" key={m.lineId}>
                <span className="ln-candidate-top">
                  <span className="ln-candidate-memo">{m.memo}</span>
                  <span className="num">{formatMoney(m.amountCents)}</span>
                </span>
                <span className="ln-truncated">
                  {formatDate(m.postedAt)} · {m.evidence}
                </span>
                {/* The card's own footer prints `apply a credit — reversible`, and voiding tells
                    the user to unapply the payments first. Without this the direction had no
                    control anywhere that could do it. */}
                <span>
                  <button
                    type="button"
                    className="ln-btn"
                    data-kind="ghost"
                    disabled={pending}
                    onClick={() => onUnmatch(m.lineId)}
                  >
                    Unapply
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {detail && detail.candidates.length > 0 ? (
          <div className="ln-block">
            <span className="ln-block-label">
              Unapplied credits that could belong here — the evidence, not a score
            </span>
            {detail.candidates.map((candidate) => (
              <div className="ln-candidate" key={candidate.lineId}>
                <span className="ln-candidate-top">
                  <span className="ln-candidate-memo">{candidate.memo}</span>
                  <span className="num">{formatMoney(candidate.amountCents)}</span>
                  <span className="ln-confidence">{candidate.confidence}</span>
                </span>
                <ul className="ln-evidence">
                  {candidate.evidence.map((clause) => (
                    <li key={clause}>{clause}</li>
                  ))}
                </ul>
                <span>
                  <button
                    type="button"
                    className="ln-btn"
                    disabled={pending}
                    onClick={() => onMatch(candidate.lineId)}
                  >
                    Apply this credit
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {detail?.draft ? (
          <div className="ln-block">
            <span className="ln-block-label">Draft reminder, {detail.draft.tone}, not sent</span>
            <p className="ln-draft">{detail.draft.body}</p>
          </div>
        ) : null}
        {detail?.note ? (
          <div className="ln-block">
            <span className="ln-block-label">Note</span>
            <p className="ln-note">{detail.note}</p>
          </div>
        ) : null}
        {hasEvidence ? null : (
          <div className="ln-block ln-nothing">
            <span className="ln-block-label">Nothing to weigh up</span>
            <p className="ln-note">
              {owed
                ? "No lines, no unapplied credits and no correspondence are on file for this invoice — everything known about it is in the panel beside this one."
                : `This invoice is ${HEAT_LABEL[mark.heat]}, so the books carry no open evidence for it. The facts are beside this column and there is nothing here to decide.`}
            </p>
          </div>
        )}
        </div>
  );
}
