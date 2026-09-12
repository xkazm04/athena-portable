/**
 * @catalog A surface that could not be read, saying why — the reason verbatim, a sentence in the
 * app's own words, and an optional retry.
 *
 * The rule it carries, and the reason no module may hand-roll it: **a surface that degrades says
 * so, and it never renders as an empty list.** "The daemon has no answer" and "there is nothing
 * here" are different facts and the user is owed the difference (README section 8 — a degraded
 * fixture exists for every module precisely so this is exercised). `EmptyState` is the other
 * thing, and the two are never swapped.
 *
 * The code is shown as the code. A reason the app cannot explain is still a reason, and inventing
 * copy for one would be worse than printing it.
 */
import type { ReactNode } from "react";

import Button from "./Button";

export default function ProblemNote({
  title,
  reason,
  detail,
  onRetry,
  retryLabel = "Ask again",
  tone = "warning",
}: {
  /** One line in the app's words: what this means for the person reading it. */
  title: ReactNode;
  /** The daemon's or the shell's own code, rendered verbatim. */
  reason: string;
  /** Anything else it said. Dropped when it merely repeats the reason. */
  detail?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  /** How loud. `warning` is the default: a degraded route is usually not the app's fault. */
  tone?: "warning" | "error";
}) {
  return (
    <div className={`problem-note problem-note--${tone}`} role="alert">
      <span className="problem-note__mark typo-heading" aria-hidden="true">
        !
      </span>
      <div className="problem-note__body">
        <p className="typo-body">{title}</p>
        <p className="typo-caption">
          <code className="typo-code">{reason}</code>
          {detail && detail !== reason ? ` — ${detail}` : ""}
        </p>
        {onRetry ? (
          <span>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              {retryLabel}
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
