"use client";

/** The scrollable stage itself: day rules, month marks, cards with tails, coins, the now-line. */
import { useEffect, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { formatDate, formatMoney, formatMoneyShort } from "@/lib/format";
import type { LineSuggestion } from "./types";
import { CARD_H, COIN_H, DAY_PX, GAP, LANE_GAP, LANE_TOP, type StripGeometry } from "./layout";
import { StripCard } from "./StripCard";
import { CoinPop } from "./CoinPop";
import { revealDelay, settle } from "./motion";

export function Strip({
  ref,
  geometry,
  dimmed,
  selection,
  onToggle,
  suggestions,
}: {
  ref: Ref<HTMLDivElement>;
  geometry: StripGeometry;
  dimmed: (id: string) => boolean;
  selection: string[];
  onToggle: (id: string) => void;
  suggestions: Record<string, LineSuggestion[]>;
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [openCoin, setOpenCoin] = useState<string | null>(null);
  const cardsTop = LANE_TOP;
  const cardsH = geometry.cardRows * (CARD_H + GAP);
  const coinsTop = cardsTop + cardsH + LANE_GAP;
  const coinsH = geometry.coinRows * (COIN_H + GAP);
  const height = coinsTop + coinsH + 24;

  // Land on today the first time, then leave the scroll to the user.
  useEffect(() => {
    const el = typeof ref === "object" && ref && "current" in ref ? ref.current : null;
    if (!el) return;
    el.scrollTo({ left: Math.max(0, geometry.todayX - el.clientWidth * 0.78), behavior: "instant" });
  }, [ref, geometry.todayX]);

  return (
    <div className="ed-strip" ref={ref} role="region" aria-label="Invoices by due date" tabIndex={0}>
      <div className="ed-strip-inner" style={{ inlineSize: geometry.width, blockSize: height }}>
        <div className="ed-days" aria-hidden="true">
          {Array.from({ length: geometry.days }, (_, d) => (
            <span key={d} className="ed-day" data-week={d % 7 === 0} style={{ insetInlineStart: d * DAY_PX }} />
          ))}
          {geometry.months.map((m) => (
            <span key={m.label} className="ed-month-mark" style={{ insetInlineStart: m.x }}>{m.label.toUpperCase()}</span>
          ))}
        </div>

        <span className="ed-lane-label" style={{ position: "absolute", insetBlockStart: cardsTop - 18 }}>DUE</span>
        {geometry.cards.map((c) => (
          <StripCard
            key={c.item.id}
            row={c.item}
            x={c.x}
            y={cardsTop + c.row * (CARD_H + GAP)}
            todayX={geometry.todayX}
            dim={dimmed(c.item.id)}
            selected={selection.includes(c.item.id)}
            delay={reduced ? 0 : revealDelay(c.day)}
            onOpen={() => router.push(`/invoices/${c.item.id}`)}
            onToggle={() => onToggle(c.item.id)}
          />
        ))}

        <span className="ed-lane-label" style={{ position: "absolute", insetBlockStart: coinsTop - 18 }}>CREDITS NOT PLACED</span>
        {geometry.coins.map((c) => (
          <motion.button
            key={c.item.id}
            type="button"
            className="ed-coin"
            style={{ insetInlineStart: c.x, insetBlockStart: coinsTop + c.row * (COIN_H + GAP) }}
            initial={reduced ? false : { opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...settle, delay: reduced ? 0 : revealDelay(c.day) + 0.2 }}
            whileHover={reduced ? undefined : { scale: 1.06 }}
            onClick={() => setOpenCoin(openCoin === c.item.id ? null : c.item.id)}
            aria-expanded={openCoin === c.item.id}
            aria-label={`Credit ${c.item.memo}, ${formatMoney(c.item.amount_cents)} on ${formatDate(c.item.posted_at)}`}
          >
            <span className="num">{formatMoneyShort(c.item.amount_cents)}</span>
            <small>{c.item.memo}</small>
          </motion.button>
        ))}
        {openCoin ? (
          <CoinPop
            coin={geometry.coins.find((c) => c.item.id === openCoin)!}
            top={coinsTop}
            width={geometry.width}
            suggestions={suggestions[openCoin] ?? []}
            onClose={() => setOpenCoin(null)}
          />
        ) : null}

        <div className="ed-now" style={{ insetInlineStart: geometry.todayX }} aria-hidden="true">
          <span>TODAY</span>
        </div>
      </div>
    </div>
  );
}
