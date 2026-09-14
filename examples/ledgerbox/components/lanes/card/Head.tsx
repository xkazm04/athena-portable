"use client";

/**
 * The card's head: which invoice this is, and the money in one line.
 *
 * The amount and the client name carry `layoutId`s matched to the node this
 * card grew out of, so they FLY into place rather than cross-fading. That is
 * what makes the card the node enlarged instead of a modal that appeared over
 * it.
 *
 * `figures` is computed by the card, not here: which four figures are worth
 * printing depends on whether anything is still owed, and that is a decision
 * about the invoice rather than about the layout.
 */
import { motion } from "motion/react";
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
        <motion.h2 layoutId={`client-${mark.id}`} className="ln-card-client" id="ln-card-title">
          {mark.clientName}
        </motion.h2>
        <div className="ln-card-figures">
          <span className="ln-figure" data-lead="true">
            <motion.b layoutId={`money-${mark.id}`}>
              {formatMoneyShort(owed ? mark.balanceCents : mark.amountCents)}
            </motion.b>
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
