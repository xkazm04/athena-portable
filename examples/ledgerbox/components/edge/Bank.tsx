"use client";

/** The flow: every statement line as a bar whose length is its size; unplaced credits glow. */
import { useMemo, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { formatDate } from "@/lib/format";
import { isAmbiguous } from "@/lib/match";
import { matchAction } from "@/app/actions";
import { Money } from "./Money";
import type { BankProps } from "./types";
import { useRun } from "./useRun";
import { settle } from "./motion";

const TABS = [
  { id: "waiting", label: "Unplaced" },
  { id: "in", label: "In" },
  { id: "out", label: "Out" },
  { id: "all", label: "All" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function EdgeBank({ lines, applied, suggestions }: BankProps) {
  const [tab, setTab] = useState<Tab>("waiting");
  const { pending, run } = useRun();
  const reduced = useReducedMotion();
  const max = useMemo(() => Math.max(1, ...lines.map((l) => Math.log10(l.amount_cents + 1))), [lines]);
  const visible = useMemo(
    () => lines.filter((l) => (tab === "all" ? true : tab === "in" ? l.direction === "in" : tab === "out" ? l.direction === "out" : l.direction === "in" && !applied[l.id])),
    [lines, tab, applied],
  );
  const waiting = lines.filter((l) => l.direction === "in" && !applied[l.id]);

  return (
    <div className="ed-wrap ed-flow">
      <h1 className="ed-display ed-h1">Flow</h1>
      <p className="ed-mute" style={{ margin: 0, maxInlineSize: "56ch", fontSize: 15 }}>
        <span className="num">{lines.length}</span> lines from three statements. <span className="num">{waiting.length}</span> credits worth{" "}
        <Money cents={waiting.reduce((s, l) => s + l.amount_cents, 0)} tone="owed" short /> have not been placed against an invoice.
      </p>
      <div className="ed-chips" role="tablist" aria-label="Statement filter">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" className="ed-chip" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {visible.length === 0 ? (
        <div className="ed-empty"><b>Nothing here</b>Every credit in this view is placed.</div>
      ) : (
        <div className="ed-flow-list">
          {visible.map((line, i) => {
            const m = applied[line.id];
            const wait = line.direction === "in" && !m;
            const sugg = suggestions[line.id] ?? [];
            const tied = isAmbiguous(sugg);
            return (
              <motion.div key={line.id} className="ed-flow-row" initial={reduced ? false : { opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ ...settle, delay: Math.min(i * 0.02, 0.5) }}>
                <div className="ed-flow-when">{formatDate(line.posted_at)}<small>{line.source_file}</small></div>
                <div className="ed-bar" data-dir={line.direction} data-wait={wait} style={{ "--w": `${Math.round((Math.log10(line.amount_cents + 1) / max) * 100)}%` } as React.CSSProperties}>
                  <span className="ed-bar-memo">{line.memo}</span>
                  <Money cents={line.amount_cents} tone={line.direction === "out" ? "out" : wait ? "owed" : "ok"} />
                  {m ? (
                    <Link href={`/invoices/${m.invoice_id}`} className="ed-bar-link num" style={{ gridColumn: "1 / -1", fontSize: 13 }}>Placed on {m.number}</Link>
                  ) : wait ? (
                    <div className="ed-bar-side">
                      {sugg.length === 0 ? <span className="ed-mute" style={{ fontSize: 13 }}>No open invoice fits.</span> : null}
                      {tied ? <span style={{ color: "var(--e-late)", fontSize: 13, fontWeight: 700 }}>Two invoices fit equally. Pick by hand.</span> : null}
                      {sugg.slice(0, tied ? 2 : 1).map((s) => (
                        <div key={s.invoice_id} className="ed-pop-row">
                          <span><b className="num">{s.number}</b> {s.client_name}</span>
                          <button type="button" className="ed-btn" data-kind={tied ? undefined : "ok"} data-size="sm" disabled={pending} onClick={() => run(() => matchAction(s.invoice_id, line.id))}>Place</button>
                          <small>{s.confidence}: {s.evidence.join(", ")}</small>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
