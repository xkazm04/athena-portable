"use client";

/** The stage: one invoice under the light, with the coins that could settle it and the two gates. */
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { CATEGORIES, type Category } from "@/lib/constants";
import { isMostlyPaid } from "@/lib/filter";
import { formatFullDate, formatMoney } from "@/lib/format";
import { categorizeAction } from "@/app/actions";
import type { InvoiceProps } from "./types";
import { Money, balanceTone } from "./Money";
import { useRun } from "./useRun";
import { Settle } from "./Settle";
import { Chase } from "./Chase";
import { Close } from "./Close";
import { stage } from "./motion";

export function EdgeDetail({ detail }: InvoiceProps) {
  const { invoice, client, lines, payments, matches, candidates, reminders } = detail;
  const { pending, run } = useRun();
  const settled = invoice.balance_cents <= 0 || invoice.state === "void";
  const movedAfter = client.address_changed_at && invoice.issued_at < client.address_changed_at;

  return (
    <div className="ed-wrap ed-stage">
      <Link href="/" className="ed-back"><ArrowLeft size={18} aria-hidden="true" /> Back to the strip</Link>

      <motion.header className="ed-stage-head" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={stage}>
        <div>
          <h1 className="ed-display ed-h1 num">{invoice.number}</h1>
          <p className="ed-stage-client">{invoice.client_name}</p>
        </div>
        <div className="ed-stage-money">
          <Money className="ed-display" cents={invoice.balance_cents > 0 ? invoice.balance_cents : invoice.amount_cents} tone={balanceTone(invoice)} />
          <span className="ed-mute num">
            {settled ? (invoice.state === "void" ? "void" : "settled in full") : `still owed of ${formatMoney(invoice.amount_cents)}`}
            {invoice.days_overdue > 0 ? <b style={{ color: "var(--e-late)" }}> · {invoice.days_overdue} days late</b> : null}
          </span>
        </div>
      </motion.header>

      <div className="ed-stage-meta">
        <span>Issued <b>{formatFullDate(invoice.issued_at)}</b></span>
        <span>Due <b>{formatFullDate(invoice.due_at)}</b></span>
        <span>State <b>{invoice.state}</b></span>
        <label>
          Filed under{" "}
          <select className="ed-select" value={invoice.category} disabled={pending} onChange={(e) => run(() => categorizeAction([invoice.id], e.target.value as Category))} aria-label="Category">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c === "uncategorized" ? "unfiled" : c}</option>)}
          </select>
        </label>
      </div>
      {invoice.dispute_note ? <p className="ed-note"><b>Disputed.</b> {invoice.dispute_note}</p> : null}
      {invoice.note ? <p className="ed-mute" style={{ margin: 0, maxInlineSize: "70ch" }}>{invoice.note}</p> : null}

      <div className="ed-stage-grid">
        <motion.section className="ed-panel" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ ...stage, delay: 0.05 }}>
          <h3>SETTLE</h3>
          <Settle invoiceId={invoice.id} matches={matches} candidates={candidates} settled={settled} />
        </motion.section>
        <motion.section className="ed-panel" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ ...stage, delay: 0.1 }}>
          <h3>CHASE</h3>
          <Chase invoiceId={invoice.id} clientName={invoice.client_name} reminders={reminders} settled={settled} daysLate={invoice.days_overdue} mostlyPaid={isMostlyPaid(invoice)} disputed={invoice.state === "disputed"} />
        </motion.section>
        <motion.section className="ed-panel" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ ...stage, delay: 0.15 }}>
          <h3>CLOSE</h3>
          <Close invoice={invoice} />
        </motion.section>
        <motion.section className="ed-panel" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ ...stage, delay: 0.2 }}>
          <h3>RECEIPT</h3>
          <div className="ed-receipt">
            {lines.map((l) => (
              <div key={l.id}><span>{l.description} <span className="ed-mute num">× {l.quantity}</span></span><Money cents={l.amount_cents} /></div>
            ))}
            {payments.map((p) => (
              <div key={p.id}><span className="ed-mute">Paid by {p.method}, {formatFullDate(p.paid_at)}</span><Money cents={-p.amount_cents} tone="ok" /></div>
            ))}
            <div><span>Still owed</span><Money cents={invoice.balance_cents} tone={balanceTone(invoice)} /></div>
          </div>
          <address className="ed-mute" style={{ fontStyle: "normal", marginBlockStart: 14, fontSize: 13, lineHeight: 1.5 }}>
            <b style={{ color: "var(--e-ink)" }}>{client.name}</b>, {client.contact}, {client.email}<br />
            {movedAfter ? `${client.prior_address} (their address at the time)` : client.address}<br />
            Terms {client.terms_days} days. {client.note}
          </address>
        </motion.section>
      </div>
    </div>
  );
}
