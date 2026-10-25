"use client";

/**
 * What may be done to this block, in two regions that look nothing alike.
 *
 * The bar above is AUTO: everything in it is logged with what undo needs to put
 * it back — revision rows for a tidy, the flagged ids for a stale flag, the pair
 * for a verdict — which is what buys the class, not harmlessness. The inverted block below
 * is GATED and holds the two acts that destroy something. Greyscale the page
 * and it is still the only inverted region on it, so the class is a PLACE
 * rather than a badge on a button.
 *
 * Neither region decides what is on offer. `table.acts` (lib/acts.ts) is built by the sheet from
 * the writes' own predicates, so a control is enabled exactly when its write would accept it, and
 * the count it prints is the count the write reports.
 */
import {
  deleteAction,
  flagStaleAction,
  mergeAction,
  normalizeAction,
  resolveCompanyAction,
  resolvePairAction,
} from "@/app/actions";
import { PHONE_RULES, TIDY_RULES } from "@/lib/acts";
import type { BkPair, BkTable } from "../model";
import { Band } from "./parts";
import { settleAct } from "./settle";
import type { Settle } from "./SettleChooser";
import type { useArm, useRun } from "../useRun";

/*
 * The runner and the arming state are the hook's own types rather than a
 * restatement of them. Writing the shape out by hand here is how the gate and
 * the thing that fires it drift apart, and this is the one place in the
 * direction where drifting apart destroys a record.
 */
type Run = ReturnType<typeof useRun>;
type Arm = ReturnType<typeof useArm>;

export function DossierGate({
  table,
  pair,
  pending,
  run,
  armed,
  arm,
  disarm,
  settle,
}: {
  table: BkTable;
  pair: BkPair | undefined;
  pending: Run["pending"];
  run: Run["run"];
  armed: Arm["armed"];
  arm: Arm["arm"];
  disarm: Arm["disarm"];
  /** The company-spelling repair: the chooser above decides, this bar fires (`settle.ts`). */
  settle: Settle;
}) {
  // Every control below is drawn from the table's acts: whether it is on offer, what it runs on,
  // and what it prints. The gate computes no availability of its own (lib/acts.ts, ADR 0149).
  const acts = table.acts;
  // The fourth check's repair. Offered once a spelling is picked and its preview is in, with the
  // preview's own count, because only the planner knows how many contacts the write rewrites.
  const company = settleAct(settle.state);
  const companyTarget = settle.state.kind === "ready" ? settle.state.spelling : null;
  return (
    <>
  {/* Everything here can be put back by undo, which is what buys the AUTO
      class, not harmlessness. Only the two tidies write revision rows. */}
  <div className="bk-foot-bar">
    {/* The same band that titles every region of the body above, so the two classes are one
        device read twice rather than two kinds of heading. */}
    <Band label="Auto" note="— every change is logged, and undo can put it back" />
    <div className="bk-actions">
      <button
        type="button"
        className="bk-btn"
        data-auto="true"
        disabled={pending || !acts.phone.enabled}
        onClick={() => run(() => normalizeAction(acts.phone.ids, [...PHONE_RULES]))}
      >
        {acts.phone.label}
      </button>
      <button
        type="button"
        className="bk-btn"
        data-auto="true"
        disabled={pending || !acts.tidy.enabled}
        onClick={() => run(() => normalizeAction(acts.tidy.ids, [...TIDY_RULES]))}
      >
        {acts.tidy.label}
      </button>
      <button
        type="button"
        className="bk-btn"
        data-auto="true"
        disabled={pending || !acts.flag.enabled}
        onClick={() => run(() => flagStaleAction(acts.flag.ids))}
      >
        {acts.flag.label}
      </button>
      {acts.keep_both.enabled && pair ? (
        <button
          type="button"
          className="bk-btn"
          data-auto="true"
          disabled={pending}
          onClick={() => run(() => resolvePairAction(pair.id, "kept_both"))}
        >
          {acts.keep_both.label}
        </button>
      ) : null}
      {settle.state.kind !== "none" ? (
        <button
          type="button"
          className="bk-btn"
          data-auto="true"
          disabled={pending || !company.enabled || companyTarget === null}
          onClick={() => {
            if (companyTarget !== null) run(() => resolveCompanyAction(table.domain, companyTarget));
          }}
        >
          {company.label}
        </button>
      ) : null}
    </div>
  </div>
  {/*
   * The title block. Inverted, drawn differently from the drawing, and the
   * only part of the sheet with authority: a print is not issued until it
   * is signed here. Greyscale the page and this is still the only inverted
   * region on it, so the class is a PLACE and not a badge.
   */}
  <div className="bk-title-block">
    <Band label="Gated" note="— destroys identity, and cannot be replayed backwards" />
    {armed === "merge" && pair ? (
      <div className="bk-arm">
        <p className="bk-arm-q">
          Fold {pair.drop.name} into {pair.keep.name} on {table.domain}. The folded record
          stops being a contact. Of the {pair.conflicts.length} field
          {pair.conflicts.length === 1 ? "" : "s"} the two disagree on, the surviving record
          keeps its own value with two exceptions it takes from the folded one: the phone, when
          the survivor&rsquo;s is not a valid number and the folded one&rsquo;s is, and the
          last activity date, when the folded one&rsquo;s is more recent. There is no undo
          payload, because there is nothing to store.
        </p>
        <div className="bk-actions">
          <button
            type="button"
            className="bk-btn"
            data-fire="true"
            disabled={pending}
            onClick={() => run(() => mergeAction(pair.keep.id, pair.drop.id), disarm)}
          >
            Merge them
          </button>
          <button type="button" className="bk-btn" onClick={disarm}>
            Cancel
          </button>
        </div>
      </div>
    ) : armed === "delete" && acts.delete.enabled ? (
      <div className="bk-arm">
        <p className="bk-arm-q">
          {acts.delete.label} from {table.name}, flagged or not. They leave the list
          entirely. Flagging them instead is reversible and sits in the bar above.
        </p>
        <div className="bk-actions">
          <button
            type="button"
            className="bk-btn"
            data-fire="true"
            disabled={pending}
            onClick={() => run(() => deleteAction(acts.delete.ids), disarm)}
          >
            Delete them
          </button>
          <button type="button" className="bk-btn" onClick={disarm}>
            Cancel
          </button>
        </div>
      </div>
    ) : (
      <div className="bk-actions">
        <button
          type="button"
          className="bk-btn"
          disabled={!acts.merge.enabled}
          onClick={() => arm("merge")}
        >
          {acts.merge.label}
        </button>
        <button
          type="button"
          className="bk-btn"
          disabled={!acts.delete.enabled}
          onClick={() => arm("delete")}
        >
          {acts.delete.label}
        </button>
      </div>
    )}
  </div>
    </>
  );
}
