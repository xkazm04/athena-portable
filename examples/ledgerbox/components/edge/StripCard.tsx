"use client";

/** One invoice on the strip, pinned to its due day, dragging a tail to today when it is late. */
import { motion, useReducedMotion } from "motion/react";
import type { InvoiceRow } from "@/lib/types";
import { Money, balanceTone } from "./Money";
import { CARD_H, CARD_W } from "./layout";
import { settle } from "./motion";

export function StripCard({
  row,
  x,
  y,
  todayX,
  dim,
  selected,
  delay,
  onOpen,
  onToggle,
}: {
  row: InvoiceRow;
  x: number;
  y: number;
  todayX: number;
  dim: boolean;
  selected: boolean;
  delay: number;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const reduced = useReducedMotion();
  const late = row.days_overdue > 0;
  const tailStart = x + CARD_W;
  const tailW = late ? Math.max(0, todayX - tailStart) : 0;

  return (
    <>
      {tailW > 0 ? (
        <motion.span
          className="ed-tail"
          style={{ insetInlineStart: tailStart, insetBlockStart: y + CARD_H / 2, inlineSize: tailW, transformOrigin: "left", opacity: dim ? 0.15 : 1 }}
          initial={reduced ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: delay + 0.3 }}
          aria-hidden="true"
        />
      ) : null}
      <motion.div
        className="ed-card"
        role="button"
        tabIndex={0}
        data-dim={dim}
        data-late={late}
        data-state={row.state}
        data-selected={selected}
        style={{ insetInlineStart: x, insetBlockStart: y }}
        initial={reduced ? false : { opacity: 0, y: -40, rotate: -2 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        whileHover={reduced ? undefined : { y: -3, scale: 1.02 }}
        transition={{ ...settle, delay }}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen();
          if (e.key === " " || e.key === "x") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-label={`${row.number}, ${row.client_name}, ${late ? `${row.days_overdue} days late` : row.state}`}
      >
        <span className="ed-card-top">
          <span className="ed-card-num num">{row.number}</span>
          <input
            type="checkbox"
            className="ed-card-tick"
            checked={selected}
            onChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Tick ${row.number}`}
            tabIndex={-1}
          />
        </span>
        <span className="ed-card-client">{row.client_name}</span>
        <Money className="ed-card-money" cents={row.balance_cents > 0 ? row.balance_cents : row.amount_cents} tone={balanceTone(row)} short />
        {late ? (
          <span className="ed-card-late num">{row.days_overdue} days late{row.candidate_count > 0 ? ", credit fits" : ""}</span>
        ) : (
          <span className="ed-mute" style={{ fontSize: 11.5 }}>
            {row.state === "paid" ? "settled" : row.state === "void" ? "void" : row.candidate_count > 0 ? "credit fits" : row.state}
          </span>
        )}
      </motion.div>
    </>
  );
}
