"use client";

/**
 * The Strip. The quarter laid out by day; the month title and the "owed by here" figure follow the
 * scroll position (the signature moment), and the beam at today breathes.
 */
import { useMemo, useRef, useState } from "react";
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";
import { FILTERS, FILTER_LABEL, type Filter } from "@/lib/constants";
import { matchesFilterClient } from "@/lib/filter";
import { formatMoneyShort } from "@/lib/format";
import { useAppState } from "@/components/state/AppState";
import type { InboxProps } from "./types";
import { DAY_PX, monthAtX, owedByDay, stripGeometry } from "./layout";
import { Strip } from "./Strip";
import { Dock } from "./Dock";

export function EdgeHome({ rows, counts, credits, suggestions }: InboxProps) {
  const { filter, setFilter, selection, setSelection } = useAppState();
  const geometry = useMemo(() => stripGeometry(rows, credits), [rows, credits]);
  const owed = useMemo(() => owedByDay(geometry.cards, geometry.days), [geometry]);
  const scroller = useRef<HTMLDivElement>(null);

  const { scrollX } = useScroll({ container: scroller });
  const [month, setMonth] = useState(() => monthAtX(geometry.months, geometry.todayX));
  const edgeDay = useTransform(scrollX, (x) => {
    const w = scroller.current?.clientWidth ?? 900;
    return Math.max(0, Math.min(geometry.days, Math.floor((x + w * 0.8) / DAY_PX)));
  });
  const owedRaw = useTransform(edgeDay, (d) => owed[d] ?? 0);
  const owedSpring = useSpring(owedRaw, { stiffness: 120, damping: 24 });
  const owedText = useTransform(owedSpring, (v) => formatMoneyShort(v));
  useMotionValueEvent(scrollX, "change", (x) => {
    const w = scroller.current?.clientWidth ?? 900;
    const next = monthAtX(geometry.months, x + w * 0.45);
    if (next !== month) setMonth(next);
  });

  const dimmed = (id: string) => !matchesFilterClient(rows.find((r) => r.id === id)!, filter as Filter);
  const toggle = (id: string) => setSelection(selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]);

  return (
    <div className="ed-home">
      <div className="ed-wrap ed-home-head">
        <div>
          <h1 className="ed-display ed-h1 ed-month" aria-live="polite">{month}</h1>
          <p className="ed-mute" style={{ margin: "8px 0 0", fontSize: 15, maxInlineSize: "56ch" }}>
            Every invoice sits on the day it fell due; the red tail is how long it has waited. Coins are credits on the statement nobody has placed. Scrub to today.
          </p>
        </div>
        <div className="ed-counter">
          <small>Owed by the day under the beam</small>
          <motion.span className="ed-display num">{owedText}</motion.span>
          <small className="num">{counts.overdue} overdue, {counts.unmatched} with a credit waiting</small>
        </div>
        <div className="ed-chips" role="tablist" aria-label="Filter">
          {FILTERS.map((f) => (
            <button key={f} type="button" role="tab" className="ed-chip" aria-selected={filter === f} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f]}<span className="num">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="ed-empty"><b>The strip is empty</b>Raise an invoice and it will land on its due day.</div>
      ) : (
        <Strip ref={scroller} geometry={geometry} dimmed={dimmed} selection={selection} onToggle={toggle} suggestions={suggestions} />
      )}

      <Dock rows={rows} selection={selection} onClear={() => setSelection([])} />
    </div>
  );
}
