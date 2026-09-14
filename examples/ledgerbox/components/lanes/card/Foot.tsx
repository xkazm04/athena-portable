"use client";

/**
 * The foot of the card: one call to action, and the key underneath it.
 *
 * IT USED TO BE TWO BANDS. A cool one tagged AUTO holding four controls, a
 * warmer one tagged GATED holding three, and two bare `<select>`s wedged in
 * among the first four with nothing saying which verb they were arguments to.
 * The review's words were "footer bars Auto/Gated have terrible UX, not clear
 * what belongs to what". Both halves of that are layout faults rather than
 * copy faults: a row of peers cannot express "this picker is a parameter of
 * that button", and a band tagged with a class cannot express what the class
 * MEANS for the particular act you are hovering.
 *
 * So the acts are a list now, one level in — `Decide.tsx` — and what is left
 * here is the one control that opens it plus the key that says what the two
 * class words mean. The card's own height goes back to the evidence, which is
 * what a reader is at this level for.
 *
 * NOTHING ABOUT THE ACTS THEMSELVES MOVED. Same five server actions, same three
 * gates, same classes read from `lib/tool-classes.ts`. This file got smaller;
 * the contract did not change.
 */
import { useState } from "react";

import { type Category, type Tone } from "@/lib/constants";
import { Decide } from "./Decide";
import type { LnDetail, LnMark } from "../model";
import type { useRun } from "../useRun";

type Run = ReturnType<typeof useRun>;

export function CardFoot({
  mark,
  detail,
  actionable,
  owed,
  tone,
  setTone,
  category,
  setCategory,
  pending,
  run,
}: {
  mark: LnMark;
  detail: LnDetail | undefined;
  actionable: boolean;
  owed: boolean;
  tone: Tone;
  setTone: (next: Tone) => void;
  category: Category;
  setCategory: (next: Category) => void;
  pending: Run["pending"];
  run: Run["run"];
}) {
  const [deciding, setDeciding] = useState(false);

  return (
    <div className="ln-card-foot">
      {actionable ? (
        <>
          <button
            type="button"
            className="ln-btn ln-decide-cta"
            data-kind="primary"
            onClick={() => setDeciding(true)}
            aria-haspopup="dialog"
            aria-expanded={deciding}
          >
            Decide next step
          </button>
          <p className="ln-class">
            <b>AUTO</b> draft, refile, apply a credit — reversible. <i>GATED</i> record, send,
            void — each reaches a person or cannot be replayed backwards.
          </p>
          {deciding ? (
            <Decide
              mark={mark}
              detail={detail}
              owed={owed}
              tone={tone}
              setTone={setTone}
              category={category}
              setCategory={setCategory}
              pending={pending}
              run={run}
              /* Just the state. Focus back to this button is the dialog's, and
                 the dialog gets it from the kit's overlay hook — which records
                 whatever held focus when it mounted, i.e. the CTA the reader
                 pressed, and restores it next frame whatever closed it. */
              onClose={() => setDeciding(false)}
            />
          ) : null}
        </>
      ) : (
        <p className="ln-class">
          Nothing is owed on this invoice, so there is nothing here to press. The three gated
          acts appear on invoices that still carry a balance.
        </p>
      )}
    </div>
  );
}
