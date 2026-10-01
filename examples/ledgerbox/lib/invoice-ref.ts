/**
 * Design 5.1 (a page's tools take what the page shows): the one place an invoice reference is resolved.
 *
 * A person and a model read `LB-2026-0002` off the screen; the tools are built on `inv_0002`. Both
 * name the same invoice, so every tool that takes an invoice takes either, case-insensitively, and
 * resolves it here. Pure: it holds no database, so the server actions and the client tools share it.
 */

/** What a stranger is told. Both forms and an example, so the next call is right. */
export const REF_HINT = "Use an id like inv_0002 or a number like LB-2026-0002.";

/** The parameter text every invoice-taking tool carries, so a model sees both forms. */
export const REF_DESCRIPTION = "An invoice id (inv_0002) or invoice number (LB-2026-0002), either works";

export type InvoiceRef = { id: string; number: string };

export type Resolved = { ok: true; id: string } | { ok: false; error: string };

export function resolveInvoiceRef(ref: unknown, invoices: Iterable<InvoiceRef>): Resolved {
  const wanted = String(ref ?? "").trim().toLowerCase();
  if (wanted !== "") {
    for (const inv of invoices) {
      if (inv.id.toLowerCase() === wanted || inv.number.toLowerCase() === wanted) {
        return { ok: true, id: inv.id };
      }
    }
  }
  return { ok: false, error: `No invoice matches "${String(ref ?? "")}". ${REF_HINT}` };
}
