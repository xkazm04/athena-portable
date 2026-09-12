"use client";

/**
 * The dossier's head: which block this is, and what is outstanding on it.
 *
 * It carries the same cluster the cell carried and the cube before it, matched
 * by id, so the block's own shape follows it all the way down rather than the
 * card arriving as a new object.
 */
import { motion } from "motion/react";
import type { RefObject } from "react";

import { Cluster } from "../Cluster";
import { outstandingTone, type BkTable } from "../model";

export function DossierHead({
  table,
  closeRef,
  onClose,
}: {
  table: BkTable;
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  return (
    <div className="bk-dossier-head">
      <div className="bk-dossier-top">
        {/* The same cluster the cell carried, and the cube before it. */}
        <motion.span layoutId={`cluster-${table.ident}`} className="bk-dossier-cluster">
          <Cluster marks={table.marks} />
        </motion.span>
        <span className="bk-ident">{table.ident}</span>
        <motion.h2
          layoutId={`table-name-${table.ident}`}
          className="bk-dossier-title"
          id="bk-dossier-title"
        >
          {table.name}
        </motion.h2>
        <span className="bk-lettering">{table.domain}</span>
        <button
          type="button"
          className="bk-close"
          onClick={onClose}
          ref={closeRef}
          aria-label="Close this block and return to the zone"
        >
          ✕
        </button>
      </div>
      {/* The verdict, at the size the tile promised. */}
      <div className="bk-verdict">
        <div>
          <b>{table.records}</b>
          <span>total rows</span>
        </div>
        <div>
          <b>{table.changed}</b>
          <span>rows changed</span>
        </div>
        <div data-tone={outstandingTone(table.outstanding)}>
          <b>{table.outstanding}</b>
          <span>rows outstanding</span>
        </div>
        {/* Green is a claim that the check passed, so it is spent only on a
            block where every record is clear. A part-checked block is a
            figure, not a verdict. */}
        <div data-tone={table.coverage >= 0.999 ? "greenline" : undefined}>
          <b>{Math.round(table.coverage * 100)}%</b>
          <span>checked</span>
        </div>
        {table.attention ? (
          <div data-tone="goldline">
            <b>{table.pairs.length + table.pairsHidden}</b>
            <span>awaiting a person</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
