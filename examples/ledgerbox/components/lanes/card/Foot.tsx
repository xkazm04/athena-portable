"use client";

/**
 * The acts, and the gate in front of three of them.
 *
 * Recording a payment, sending a reminder and voiding an invoice all reach
 * outside this app or cannot be replayed backwards, so each arms first and says
 * in words what it will do and to whom. The gate is asked where the click
 * landed, not in a dialog somewhere else: a question about this invoice belongs
 * on this invoice.
 */
import { formatMoney } from "@/lib/format";
import { CATEGORIES, TONES, type Category, type Tone } from "@/lib/constants";
import {
  categorizeAction,
  draftReminderAction,
  markPaidAction,
  sendReminderAction,
  voidInvoiceAction,
} from "@/app/actions";
import { Gate } from "../Gate";
import type { LnDetail, LnMark } from "../model";
import type { useRun } from "../useRun";

type Run = ReturnType<typeof useRun>;

export function CardFoot({
  mark,
  detail,
  actionable,
  owed,
  tone,
  setTone,
  category,
  setCategory,
  pending,
  run,
}: {
  mark: LnMark;
  detail: LnDetail | undefined;
  actionable: boolean;
  owed: boolean;
  tone: Tone;
  setTone: (next: Tone) => void;
  category: Category;
  setCategory: (next: Category) => void;
  pending: Run["pending"];
  run: Run["run"];
}) {
  return (
      <div className="ln-card-foot">
        {actionable ? (
          <>
            <div className="ln-actions">
              <label className="ln-select">
                <span className="ln-block-label">Tone</span>
                <select
                  value={tone}
                  onChange={(event) => setTone(event.target.value as Tone)}
                  aria-label="Reminder tone"
                >
                  {TONES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ln-btn"
                disabled={pending}
                onClick={() => run(() => draftReminderAction(mark.id, tone))}
              >
                Draft a {tone} reminder
              </button>
              <label className="ln-select">
                <span className="ln-block-label">File under</span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as Category)}
                  aria-label="Book-keeping category"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ln-btn"
                disabled={pending || category === mark.category}
                onClick={() => run(() => categorizeAction([mark.id], category))}
              >
                Refile
              </button>
            </div>
            <div className="ln-actions">
              <Gate
                // Exact, not `formatMoneyShort`: the short formatter rounds to
                // whole units, which is right for a headline figure and wrong
                // on the one control that moves money. What is written is
                // `balanceCents` to the cent, so that is what the label and the
                // armed question both have to say.
                label={`Record ${formatMoney(mark.balanceCents)} received`}
                confirmLabel="Record it"
                question={`This writes ${formatMoney(mark.balanceCents)} against the books and cannot be replayed backwards.`}
                onConfirm={() => markPaidAction(mark.id, mark.balanceCents)}
                disabled={!owed}
              />
              <Gate
                label={detail?.draft ? "Send the drafted reminder" : "Send a reminder"}
                confirmLabel="Send it"
                question={`This reaches ${detail?.email ?? "the client"}. You cannot un-send it.`}
                onConfirm={() => sendReminderAction(mark.id)}
                disabled={!detail?.draft}
              />
              {/*
                `voidInvoiceAction` refuses any invoice with payments applied,
                so the control has to say so before it is pressed rather than
                after. `mark_paid` through the tool layer hits the same guard.
              */}
              <Gate
                label="Void this invoice"
                confirmLabel="Void it"
                question={
                  mark.paidCents > 0
                    ? "Unapply the credits on this invoice first."
                    : "Voiding writes off the balance. There is no undo."
                }
                onConfirm={() => voidInvoiceAction(mark.id)}
                disabled={mark.paidCents > 0}
              />
            </div>
            <p className="ln-class">
              <b>AUTO</b> draft, refile, apply a credit — reversible. <i>GATED</i> record,
              send, void — each reaches a person or cannot be replayed backwards.
            </p>
          </>
        ) : (
          <p className="ln-class">
            Nothing is owed on this invoice, so there is nothing here to press. The three gated
            acts appear on invoices that still carry a balance.
          </p>
        )}
      </div>
  );
}
