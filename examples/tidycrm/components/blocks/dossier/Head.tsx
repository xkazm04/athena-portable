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
import { Stat, Stats } from "../Stat";
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
        {/* The name leads here too, the way it does on the cell it grew out of; the block code
            and the domain are the quiet identifiers that follow it. */}
        <motion.h2
          layoutId={`table-name-${table.ident}`}
          className="bk-dossier-title"
          id="bk-dossier-title"
        >
          {table.name}
        </motion.h2>
        <span className="bk-ident">{table.ident}</span>
        <span className="bk-ident">{table.domain}</span>
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
      {/* The verdict, in the one figure scale the plate and the cell also print in. */}
      <Stats className="bk-verdict">
        <Stat value={table.records} label="total rows" />
        <Stat value={table.changed} label="rows changed" quiet={table.changed === 0} />
        <Stat
          value={table.outstanding}
          label="rows outstanding"
          tone={outstandingTone(table.outstanding)}
        />
        {/* Green is a claim that the check passed, so it is spent only on a block where every
            record is clear. A part-checked block is a figure, not a verdict. */}
        <Stat
          value={`${Math.round(table.coverage * 100)}%`}
          label="checked"
          tone={table.coverage >= 0.999 ? "greenline" : undefined}
        />
        {table.attention ? (
          <Stat
            value={table.pairs.length + table.pairsHidden}
            label="pairs awaiting a person"
            tone="goldline"
          />
        ) : null}
      </Stats>
    </div>
  );
}
