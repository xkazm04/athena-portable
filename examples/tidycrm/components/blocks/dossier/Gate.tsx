"use client";

/**
 * What may be done to this block, in two regions that look nothing alike.
 *
 * The bar above is AUTO: everything in it writes a revision, so undo can replay
 * it — which is what buys the class, not harmlessness. The inverted block below
 * is GATED and holds the two acts that destroy something. Greyscale the page
 * and it is still the only inverted region on it, so the class is a PLACE
 * rather than a badge on a button.
 */
import {
  deleteAction,
  flagStaleAction,
  mergeAction,
  normalizeAction,
  resolvePairAction,
} from "@/app/actions";
import { STALE_MONTHS } from "@/lib/constants";
import { RULE_LABELS } from "@/lib/normalize";
import type { BkPair, BkTable } from "../model";
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
}: {
  table: BkTable;
  pair: BkPair | undefined;
  pending: Run["pending"];
  run: Run["run"];
  armed: Arm["armed"];
  arm: Arm["arm"];
  disarm: Arm["disarm"];
}) {
  return (
    <>
  {/* Everything here writes a revision, so undo can replay it — which is
      what buys the AUTO class, not harmlessness. */}
  <div className="bk-foot-bar">
    <p className="bk-lettering" data-ink="1">
      AUTO — every change lands in `revisions` and undo replays it
    </p>
    <div className="bk-actions">
      <button
        type="button"
        className="bk-btn"
        data-auto="true"
        disabled={pending || table.phoneIds.length === 0}
        onClick={() => run(() => normalizeAction(table.phoneIds, ["phone_e164"]))}
      >
        {table.phoneIds.length === 0
          ? "Every number is already +1XXXXXXXXXX"
          : `${RULE_LABELS.phone_e164} · ${table.phoneIds.length} rows`}
      </button>
      <button
        type="button"
        className="bk-btn"
        data-auto="true"
        disabled={pending || table.ids.length === 0}
        onClick={() =>
          run(() => normalizeAction(table.ids, ["trim_whitespace", "lowercase_email"]))
        }
      >
        Tidy whitespace and email case · {table.ids.length} rows
      </button>
      <button
        type="button"
        className="bk-btn"
        data-auto="true"
        disabled={pending || table.staleIds.length === 0}
        onClick={() => run(() => flagStaleAction(table.staleIds))}
      >
        {table.staleIds.length === 0
          ? `Nothing is stale past ${STALE_MONTHS} months`
          : `Flag ${table.staleIds.length} stale rows`}
      </button>
      {pair ? (
        <button
          type="button"
          className="bk-btn"
          data-auto="true"
          disabled={pending}
          onClick={() => run(() => resolvePairAction(pair.id, "kept_both"))}
        >
          Keep both records
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
    <p className="bk-lettering">GATED — destroys identity, and cannot be replayed backwards</p>
    {armed === "merge" && pair ? (
      <div className="bk-arm">
        <p className="bk-arm-q">
          Fold {pair.drop.name} into {pair.keep.name} on {table.domain}. The folded record
          stops being a contact and the {pair.conflicts.length} field
          {pair.conflicts.length === 1 ? "" : "s"} the two disagree on take the surviving
          record&rsquo;s value. There is no undo payload, because there is nothing to store.
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
    ) : armed === "delete" ? (
      <div className="bk-arm">
        <p className="bk-arm-q">
          Delete {table.staleIds.length} stale rows from {table.name}. They leave the list
          entirely. Flagging them instead is reversible and sits in the bar above.
        </p>
        <div className="bk-actions">
          <button
            type="button"
            className="bk-btn"
            data-fire="true"
            disabled={pending}
            onClick={() => run(() => deleteAction(table.staleIds), disarm)}
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
        <button type="button" className="bk-btn" disabled={!pair} onClick={() => arm("merge")}>
          {pair ? "Merge the identity pair" : "No pair to adjudicate"}
        </button>
        <button
          type="button"
          className="bk-btn"
          disabled={table.staleIds.length === 0}
          onClick={() => arm("delete")}
        >
          {table.staleIds.length === 0
            ? "Nothing stale to delete"
            : `Delete ${table.staleIds.length} stale rows`}
        </button>
      </div>
    )}
  </div>
    </>
  );
}
