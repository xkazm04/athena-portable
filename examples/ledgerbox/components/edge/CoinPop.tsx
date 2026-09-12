"use client";

/** What a coin on the strip could settle. Apply here, without leaving the strip. */
import { useEffect } from "react";
import { motion } from "motion/react";
import type { BankLine } from "@/lib/types";
import { matchAction } from "@/app/actions";
import { formatDate } from "@/lib/format";
import { isAmbiguous } from "@/lib/match";
import { Money } from "./Money";
import type { LineSuggestion } from "./types";
import { useRun } from "./useRun";
import { COIN_H, GAP, type Placed } from "./layout";
import { settle } from "./motion";

export function CoinPop({
  coin,
  top,
  width,
  suggestions,
  onClose,
}: {
  coin: Placed<BankLine>;
  top: number;
  width: number;
  suggestions: LineSuggestion[];
  onClose: () => void;
}) {
  const { pending, run } = useRun();
  const tied = isAmbiguous(suggestions);
  const left = Math.min(coin.x, width - 320);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      className="ed-pop"
      role="dialog"
      aria-label="Settle this credit"
      style={{ insetInlineStart: left, insetBlockStart: top + (coin.row + 1) * (COIN_H + GAP) + 6 }}
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={settle}
    >
      <b>
        <Money cents={coin.item.amount_cents} tone="owed" /> on {formatDate(coin.item.posted_at)}
      </b>
      <span className="ed-mute">{coin.item.memo}</span>
      {suggestions.length === 0 ? <span className="ed-mute">No open invoice fits this credit.</span> : null}
      {tied ? <span style={{ color: "var(--e-late)", fontWeight: 700 }}>Two invoices fit equally. Pick by hand.</span> : null}
      {suggestions.slice(0, tied ? 2 : 1).map((s) => (
        <div key={s.invoice_id} className="ed-pop-row">
          <span><b className="num">{s.number}</b> {s.client_name}</span>
          {/* Full height, not `sm`: this writes a payment row, and it is the one path that does so
              without opening the invoice first. Consequence sets prominence (README.md:44-45), and
              44px is the height every other consequential control in edge.css holds. */}
          <button type="button" className="ed-btn" data-kind={tied ? undefined : "ok"} disabled={pending} onClick={() => run(() => matchAction(s.invoice_id, coin.item.id), onClose)}>
            Settle
          </button>
          <small>{s.confidence}: {s.evidence.join(", ")}</small>
        </div>
      ))}
      <button type="button" className="ed-btn" data-kind="ghost" data-size="sm" onClick={onClose} style={{ justifySelf: "start" }}>
        Close
      </button>
    </motion.div>
  );
}
