"use client";

/**
 * The dossier's head: which block this is, and what is outstanding on it.
 *
 * It carries the same cluster the cell carried and the scene before it, so the
 * block's own shape follows it all the way down rather than the card arriving as
 * a new object.
 *
 * ROUND 3 UNMATCHED THE IDS. Rounds 1 and 2 carried a `layoutId` from the cell
 * to each of these, so the cluster and the name physically travelled. That
 * cannot survive a camera: the cell is positioned by a projection written
 * outside React on every frame the pose changes, and a shared-layout morph
 * measured against a box an ancestor transform owns arrives at the wrong place
 * — after one orbit at L1 the card opened stuck at the cell's own size, at zero
 * opacity, and never animated out of it. The continuity is unchanged and the
 * mechanism is the sheet's own now: the card RISES out of the cell's projected
 * box. The argument is in `Dossier.tsx`.
 */
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
        <span className="bk-dossier-cluster">
          <Cluster marks={table.marks} />
        </span>
        {/* The name leads here too, the way it does on the cell it grew out of; the block code
            and the domain are the quiet identifiers that follow it. */}
        <h2 className="bk-dossier-title" id="bk-dossier-title">
          {table.name}
        </h2>
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
