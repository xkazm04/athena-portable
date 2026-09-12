"use client";

/** The money gates: record a payment, void the invoice. Both final, both asked twice. */
import { useState } from "react";
import { formatMoney, parseDollars } from "@/lib/format";
import { markPaidAction, voidInvoiceAction } from "@/app/actions";
import type { InvoiceRow } from "@/lib/types";
import { Gate } from "./Gate";

export function Close({ invoice }: { invoice: InvoiceRow }) {
  const [amount, setAmount] = useState(() => (invoice.balance_cents / 100).toFixed(2));
  const settled = invoice.balance_cents <= 0 || invoice.state === "void";
  // One reading of the field, shared by the label and the call, so the gate can never offer one
  // figure and record another. `1,250.00` - the format the app prints - used to read as NaN here.
  const cents = parseDollars(amount);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {settled ? (
        <p className="ed-mute" style={{ margin: 0 }}>
          {invoice.state === "void" ? "Void. It stays in the books as a record." : `Settled in full, ${formatMoney(invoice.amount_cents)}.`}
        </p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }} className="ed-mute">
            Amount received
            <input className="ed-input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ inlineSize: "14ch" }} aria-label="Amount received in dollars" />
          </label>
          <div className="ed-actions">
            <Gate
              label="Record payment"
              confirmLabel={cents === null ? "Record payment" : `Record ${formatMoney(cents)}`}
              question="Permanent. The activity log keeps it; nothing undoes it."
              disabled={cents === null}
              onConfirm={() => markPaidAction(invoice.id, cents ?? Number.NaN)}
            />
            <span className="ed-mute" style={{ fontSize: 13 }}>
              {cents === null ? "That is not an amount." : `of ${formatMoney(invoice.balance_cents)} owed`}
            </span>
          </div>
        </div>
      )}
      {invoice.state !== "void" ? (
        <Gate
          label="Void this invoice"
          confirmLabel={`Void ${invoice.number}`}
          question={invoice.paid_cents > 0 ? "Lift the applied coins off first." : "It stays in the books, marked void, for good."}
          disabled={invoice.paid_cents > 0}
          onConfirm={() => voidInvoiceAction(invoice.id)}
        />
      ) : null}
    </div>
  );
}
