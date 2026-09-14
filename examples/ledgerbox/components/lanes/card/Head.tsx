"use client";

/**
 * The card's head: which invoice this is, and the money in one line.
 *
 * THE TWO SHARED IDS ARE GONE, and the reason is the whole of round 3. The amount and the client
 * name used to carry `layoutId`s matched to the L1 node this card grew out of, so they flew into
 * place. Their other end was `Spread.tsx`, and there is no spread any more: the node is a card in
 * the world, inside the camera's own `translate … scale`. An unmatched `layoutId` is not free —
 * motion still projects the element, it measured it while the pane's grow keyframe had it at 16%
 * of its size, and the headline ended up drawn a hundred pixels left of the box it belongs to.
 *
 * The pane grows from a measured origin instead (`style/world/pane.css`), and the ink arrives
 * after the box has landed. Rule 3 is kept; rule 2 has nothing left to claim.
 *
 * `figures` is computed by the card, not here: which four figures are worth
 * printing depends on whether anything is still owed, and that is a decision
 * about the invoice rather than about the layout.
 */
import type { RefObject } from "react";

import { formatMoneyShort } from "@/lib/format";
import { HEAT_LABEL, type LnMark } from "../model";

export function CardHead({
  mark,
  laneLabel,
  owed,
  figures,
  closeRef,
  onClose,
}: {
  mark: LnMark;
  laneLabel: string;
  owed: boolean;
  figures: { label: string; value: string }[];
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  return (
      <div className="ln-card-head">
        <span className="ln-card-eyebrow">
          <span className="ln-label">{mark.number}</span>
          <span className="ln-label">{laneLabel}</span>
          <span className="ln-label ln-card-state">{HEAT_LABEL[mark.heat]}</span>
          <button
            type="button"
            className="ln-close"
            onClick={onClose}
            ref={closeRef}
            aria-label="Close this invoice and return to the lane"
          >
            ✕
          </button>
        </span>
        <h2 className="ln-card-client" id="ln-card-title">
          {mark.clientName}
        </h2>
        <div className="ln-card-figures">
          <span className="ln-figure" data-lead="true">
            <b>
              {formatMoneyShort(owed ? mark.balanceCents : mark.amountCents)}
            </b>
            <span>{owed ? "Still owed" : "Settled"}</span>
          </span>
          {figures.map((f) => (
            <span className="ln-figure" key={f.label}>
              <b className="num">{f.value}</b>
              <span>{f.label}</span>
            </span>
          ))}
        </div>
      </div>
  );
}
