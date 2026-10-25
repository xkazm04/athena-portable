"use client";

/**
 * The company-spelling chooser and the preview of what filing under one spelling changes.
 *
 * The decision lives in `settle.ts`; this file holds it for one open dossier and draws it. The
 * chooser starts with nothing pressed, because which spelling is the company's real name is the
 * person's call. Pressing one asks `preview_company` what the write would change, and the gate's
 * AUTO bar offers the write only once that answer is in, with the answer's own count.
 */
import { useCallback, useState } from "react";

import { previewCompanyAction } from "@/app/actions";
import { chosen, choose, previewed, reduce, settleState, type SettleEvent, type Spelling } from "./settle";

/**
 * The settle state for one table, reset whenever the sheet's spellings change.
 *
 * After the write runs, the sheet revalidates and the table arrives spelled one way; the state then
 * starts over from the table rather than holding a plan for a world that no longer exists.
 */
export function useSettle(table: { domain: string; spellings: Spelling[] }) {
  const { domain, spellings } = table;
  const key = `${domain}\n${spellings.map((s) => `${s.company}\t${s.n}`).join("\n")}`;
  const [held, setHeld] = useState(() => ({ key, state: settleState({ spellings }) }));
  const state = held.key === key ? held.state : settleState({ spellings });

  const dispatch = useCallback(
    (event: SettleEvent) =>
      setHeld((prev) => ({
        key,
        state: reduce(prev.key === key ? prev.state : settleState({ spellings }), event),
      })),
    [key, spellings],
  );

  const pick = useCallback(
    (spelling: string) => {
      dispatch(choose(spelling));
      previewCompanyAction(domain, spelling).then(
        (plan) => dispatch(previewed(spelling, plan)),
        (err: unknown) => {
          const reason = err instanceof Error ? err.message : String(err);
          dispatch(previewed(spelling, `The preview did not come back: ${reason}`));
        },
      );
    },
    [dispatch, domain],
  );

  return { state, pick };
}

export type Settle = ReturnType<typeof useSettle>;

/** The spellings as a chooser, then what the chosen one would change. */
export function SettleChooser({ settle }: { settle: Settle }) {
  const { state, pick } = settle;
  if (state.kind === "none") return null;
  const picked = chosen(state);
  return (
    <>
      <div className="bk-spellings" role="group" aria-label="Company spellings on this table">
        {state.spellings.map((spelling, index) => (
          <button
            key={spelling.company}
            type="button"
            className="bk-chip"
            aria-pressed={picked === spelling.company}
            onClick={() => pick(spelling.company)}
          >
            {spelling.company}
            <b data-tone={index > 0 ? "redline" : undefined}>×{spelling.n}</b>
          </button>
        ))}
      </div>
      <div aria-live="polite">
        {state.kind === "previewing" ? (
          <p className="bk-band-note">Checking what filing under &ldquo;{state.spelling}&rdquo; changes&hellip;</p>
        ) : null}
        {state.kind === "refused" ? <p className="bk-band-note">{state.reason}</p> : null}
        {state.kind === "ready" ? (
          <>
            <p className="bk-band-note">
              Filing {state.plan.domain} under &ldquo;{state.plan.canonical_name}&rdquo; rewrites{" "}
              {state.plan.rewrites} of its {state.plan.contacts} contacts. Undo puts them back.
            </p>
            <div className="bk-table-wrap">
              <table className="bk-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Company now</th>
                    <th scope="col">Filed under</th>
                  </tr>
                </thead>
                <tbody>
                  {state.plan.changes.map((change) => (
                    <tr key={change.contact_id}>
                      <td>{change.name}</td>
                      <td data-bad="true">{change.from}</td>
                      <td>{change.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {state.plan.showing < state.plan.total ? <p className="bk-truncated">{state.plan.footer}</p> : null}
          </>
        ) : null}
      </div>
    </>
  );
}
