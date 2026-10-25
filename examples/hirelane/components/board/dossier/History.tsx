"use client";

/**
 * What has been done to this person, and the way back from each act that has one.
 *
 * It sits in the reading column and not in the action bar: ADR 0022 won the bar's height back for
 * the evidence, and a list of past acts is something to read, not a control to reach for. The acts
 * the agent ran are here too - they are the ones the reader most needs to find, so each row
 * opens with who ran it, "Athena" or "You" - and each reversible, not-undone row carries its Undo. A row with no way back says why in words
 * (`components/board/history.ts` decides which, and what) instead of drawing a dead control.
 */
import { fmtWhen } from "../format";
import { historyNote } from "../history";
import type { BdCandidate } from "../model";
import { useRun } from "../useRun";
import { Band } from "./parts";

export function DossierHistory({ candidate }: { candidate: BdCandidate }) {
  const { pending, undo } = useRun();
  const { history } = candidate.meta;

  return (
    <>
      <Band label="History" note={historyNote(candidate.meta)} />
      <div className="bd-section">
        {history.length === 0 ? (
          <p className="bd-hand">nothing has been done here yet</p>
        ) : (
          <ol className="bd-history">
            {history.map((row) => (
              <li key={row.id} className="bd-history-row" data-undone={row.undone}>
                <span className="bd-history-when">{fmtWhen(row.ts)}</span>
                <span className="bd-history-what">
                  {row.by} - {row.summary}
                </span>
                {row.undoable ? (
                  <button
                    type="button"
                    className="bd-btn"
                    disabled={pending}
                    aria-label={`Undo: ${row.by} - ${row.summary}`}
                    onClick={() => undo(row.id)}
                  >
                    Undo
                  </button>
                ) : (
                  <span className="bd-hand">{row.why}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
