"use client";

/** Tone first, then a draft, then the gate. */
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { TONES, type Tone } from "@/lib/constants";
import { formatDate, formatFullDate } from "@/lib/format";
import { draftReminderAction, sendReminderAction } from "@/app/actions";
import type { Reminder } from "@/lib/types";
import { useRun } from "./useRun";
import { Gate } from "./Gate";
import { fade } from "./motion";

const HINT: Record<Tone, string> = {
  gentle: "Assumes an oversight.",
  firm: "Names the delay and what happens next.",
};

export function Chase({ invoiceId, clientName, reminders, settled, daysLate, mostlyPaid, disputed }: { invoiceId: string; clientName: string; reminders: Reminder[]; settled: boolean; daysLate: number; mostlyPaid: boolean; disputed: boolean }) {
  // A client who has paid most of it is not a client to open firm with, however late the
  // remainder is. The lateness rule only gets to speak when that is not the case.
  const [tone, setTone] = useState<Tone>(mostlyPaid ? "gentle" : daysLate > 45 ? "firm" : "gentle");
  const { pending, run } = useRun();
  const draft = reminders.find((r) => r.sent_at === null);
  const sent = reminders.filter((r) => r.sent_at !== null);

  if (settled) return <p className="ed-mute" style={{ margin: 0 }}>Settled. Nothing to chase.</p>;
  if (disputed) return <p className="ed-mute" style={{ margin: 0 }}>Disputed. Resolve the dispute before chasing this one.</p>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {mostlyPaid ? (
        <p className="ed-note">
          This client has already paid most of this invoice. Chasing the remainder is probably the
          wrong move; read the balance before you send anything.
        </p>
      ) : null}
      <div className="ed-tones" role="radiogroup" aria-label="Tone">
        {TONES.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={tone === t} className="ed-tone" onClick={() => setTone(t)}>
            <b style={{ textTransform: "capitalize" }}>{t}</b>
            <span>{HINT[t]}</span>
          </button>
        ))}
      </div>
      <div className="ed-actions">
        <button type="button" className="ed-btn" disabled={pending} onClick={() => run(() => draftReminderAction(invoiceId, tone))}>
          {pending ? "Writing…" : draft ? `Rewrite as ${tone}` : `Write a ${tone} draft`}
        </button>
        <Gate label="Send it" confirmLabel={`Send to ${clientName}`} question="Reaches a person. Cannot be taken back." disabled={!draft} onConfirm={() => sendReminderAction(invoiceId)} />
      </div>
      <AnimatePresence initial={false}>
        {draft ? (
          <motion.div key={draft.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={fade}>
            <div className="ed-mute" style={{ fontSize: 12, marginBlockEnd: 6 }}>Draft, {draft.tone}, written {formatDate(draft.created_at)}. Nothing sent.</div>
            <pre className="ed-draft">{draft.body}</pre>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {sent.length > 0 ? (
        <ul className="ed-filed">
          {sent.map((r) => <li key={r.id}><span style={{ textTransform: "capitalize" }}>{r.tone}</span> reminder sent {formatFullDate(r.sent_at as string)}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
