/**
 * The decision card — README section 3.3 (`GATED`: an approval row and a decision card) and 3.2,
 * step 6 (the gated path closes through `POST /decisions/<id>`).
 *
 * It is the one surface in this app that is about an irreversible act, and the only thing it has
 * to get right is that **the user can read what they are approving**. So:
 *
 * - **The parameters are the headline, not a blob.** A key/value list in the card's own tiers,
 *   long values cut to a budget and offered whole by the control beside them, with the
 *   `(showing N of M)` every bounded thing in this app carries. The first build showed
 *   `JSON.stringify(params, null, 1)` in a 128px scrolling well — the one field that decides
 *   whether the user approves the right thing, bounded and scrolled.
 * - **The evidence is beside the act.** A `captureId` means the shell photographed the page
 *   before the proposal was minted, and the picture goes under the parameters. *No* capture id
 *   means there is no picture: nothing is drawn, and no placeholder pretends one is coming.
 * - **Approve is one option among the ones the daemon offered.** The options come off the
 *   approval row; `approve` leads where it exists and everything else is secondary. The card
 *   never invents a button the daemon would not accept.
 * - **After an answer the card is a line.** One line naming the choice and the call, in the place
 *   the card was, because the record is what the user comes back to and a spent card is a fact
 *   rather than a control.
 *
 * A pure function of one `DecisionCard`; every act goes through the callback.
 */
import { useState } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import StatusDot from "@/components/StatusDot";

import { collapsedLine, primaryOption, type DecisionCard as Card, type ParamRow } from "../model";

export default function DecisionCard({
  card,
  onAnswer,
  blocked,
}: {
  card: Card;
  onAnswer: (choice: string) => void;
  /** A reason the options cannot be pressed, shown on them rather than implied by absence. */
  blocked?: string;
}) {
  if (card.state !== "pending") {
    return (
      <div className={`decision decision--${card.state}`}>
        <p className="typo-label row" style={{ gap: 6 }}>
          <StatusDot tone={card.state === "resolved" ? "success" : "neutral"} />
          <span>{collapsedLine(card)}</span>
        </p>
      </div>
    );
  }

  const primary = primaryOption(card.options);
  return (
    <div className="decision" role="group" aria-label={`Approve or decline ${card.action}`}>
      {/* The evidence is what gives way when the card is taller than the pin it sits in; the
          options below it never do. */}
      <div className="decision__body">
        <p className="typo-label row" style={{ gap: 6 }}>
          <StatusDot tone="warning" />
          waiting on you
          <Badge tone="neutral" title="Where the request came from">
            {card.surface || "panel"}
          </Badge>
          {card.origin ? <span className="typo-caption">{card.origin}</span> : null}
        </p>

        <code className="typo-heading decision__action">{card.action}</code>

        {card.params.length > 0 ? (
          <dl className="params">
            {card.params.map((param) => (
              <Param key={param.key} param={param} />
            ))}
          </dl>
        ) : (
          <p className="typo-caption">No parameters.</p>
        )}

        {/* What Athena says this is for. Model text: displayed, never an instruction. */}
        {card.summary ? <p className="typo-body entry__prose">{card.summary}</p> : null}

        {card.captureUrl ? (
          <img
            className="decision__capture"
            src={card.captureUrl}
            alt={`The page as the shell photographed it before proposing ${card.action}`}
          />
        ) : null}
      </div>

      <div className="row">
        {card.options.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={option === primary ? "primary" : "secondary"}
            disabledReason={blocked}
            onClick={() => onAnswer(option)}
          >
            {option}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * One parameter. The value is shown to the budget and the whole of it is one press away — never a
 * hover, because the thing behind the hover is the thing being approved.
 */
function Param({ param }: { param: ParamRow }) {
  const [whole, setWhole] = useState(false);
  return (
    <div className="param">
      <dt className="typo-label muted">{param.key}</dt>
      <dd className="param__value typo-code">
        {whole || !param.truncated ? param.text : param.short}
        {param.truncated ? (
          <>
            {" "}
            <button
              type="button"
              className="btn btn--ghost btn--sm typo-label focus-ring"
              aria-expanded={whole}
              onClick={() => setWhole(!whole)}
            >
              {whole ? "less" : "whole value"}
            </button>
          </>
        ) : null}
      </dd>
    </div>
  );
}
