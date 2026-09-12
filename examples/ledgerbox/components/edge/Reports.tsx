"use client";

/** The skyline: four columns of money by age, the period as a headline you switch, a ticket to file. */
import { useState } from "react";
import { motion } from "motion/react";
import { PERIODS, PERIOD_LABEL } from "@/lib/constants";
import { formatFullDate } from "@/lib/format";
import { exportSummaryAction } from "@/app/actions";
import { useAppState } from "@/components/state/AppState";
import { agingFor } from "./aging";
import { Money } from "./Money";
import type { ReportsProps } from "./types";
import { useRun } from "./useRun";
import { stage } from "./motion";

export function EdgeReports({ summaries, rows, exports: filed }: ReportsProps) {
  const { period, setPeriod } = useAppState();
  const { pending, run } = useRun();
  const [body, setBody] = useState<string | null>(null);
  const s = summaries[period];
  const aging = agingFor(rows, period);
  const download = (b: string) => `data:text/plain;charset=utf-8,${encodeURIComponent(b)}`;

  return (
    <div className="ed-wrap ed-sky">
      <div className="ed-sky-periods" role="tablist" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p} type="button" className="ed-sky-period" aria-pressed={period === p} onClick={() => setPeriod(p)}>{PERIOD_LABEL[p]}</button>
        ))}
      </div>

      <div className="ed-sky-stats">
        <div className="ed-sky-stat"><span>Invoiced</span><Money cents={s.invoiced_cents} short /><span className="num">{s.invoice_count} invoices</span></div>
        <div className="ed-sky-stat"><span>Collected</span><Money cents={s.collected_cents} tone="ok" short /></div>
        <div className="ed-sky-stat"><span>Still owed</span><Money cents={s.outstanding_cents} tone="owed" short /></div>
        <div className="ed-sky-stat"><span>Overdue</span><Money cents={s.overdue_cents} tone="late" short /><span className="num">{s.overdue_count} invoices</span></div>
      </div>

      <section aria-label="How old the money is">
        <div className="ed-columns">
          {aging.map((b) => (
            <div key={b.id} className="ed-column" data-b={b.id}>
              <div className="ed-column-track">
                <motion.span key={`${period}-${b.id}`} className="ed-column-bar" initial={{ scaleY: 0 }} animate={{ scaleY: Math.max(b.share, b.count ? 0.03 : 0) }} transition={stage} />
              </div>
              <span className="ed-column-label"><b><Money cents={b.cents} short /></b>{b.label}<span className="num">{b.count} invoices</span></span>
            </div>
          ))}
        </div>
      </section>

      <section className="ed-panel" aria-label="Summary">
        <h3>TICKET</h3>
        <p className="ed-mute" style={{ margin: "0 0 12px", fontSize: 14 }}>
          <span className="num">{s.unmatched_lines}</span> credits worth <Money cents={s.unmatched_cents} short /> came in during {PERIOD_LABEL[period]} without being placed.
        </p>
        <div className="ed-actions" style={{ marginBlockEnd: 12 }}>
          <button type="button" className="ed-btn" data-kind="primary" disabled={pending} onClick={() => run(() => exportSummaryAction(period), (r) => setBody(r.body ?? null))}>
            {pending ? "Printing…" : `Print the ${PERIOD_LABEL[period]} ticket`}
          </button>
          {body ? <a className="ed-btn" href={download(body)} download={`ledgerbox-${period}.txt`}>Download</a> : null}
        </div>
        {body ? <pre className="ed-ticket num">{body}</pre> : <p className="ed-mute" style={{ margin: 0, fontSize: 14 }}>No ticket printed this session.</p>}
        {filed.length > 0 ? (
          <ul className="ed-filed" style={{ marginBlockStart: 14 }}>
            {filed.map((e) => (
              <li key={e.id}>
                <span>{PERIOD_LABEL[e.period]}</span>
                <span className="ed-mute">{formatFullDate(e.generated_at)}</span>
                <a className="ed-btn" data-kind="ghost" data-size="sm" href={download(e.body)} download={`ledgerbox-${e.period}.txt`}>Download</a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
