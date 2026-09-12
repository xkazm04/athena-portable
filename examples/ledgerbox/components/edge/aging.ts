/** How old the money is: four buckets every reports surface draws its own way. */
import { inPeriodClient } from "@/lib/filter-period";
import type { Period } from "@/lib/constants";
import type { InvoiceRow } from "@/lib/types";

export interface AgingBucket {
  id: "terms" | "d30" | "d60" | "d90";
  label: string;
  cents: number;
  count: number;
  /** Share of the largest bucket, 0..1, so bars are comparable without a legend. */
  share: number;
}

const BUCKETS: { id: AgingBucket["id"]; label: string; test: (d: number) => boolean }[] = [
  { id: "terms", label: "Within terms", test: (d) => d <= 0 },
  { id: "d30", label: "1 to 30 days late", test: (d) => d > 0 && d <= 30 },
  { id: "d60", label: "31 to 60 days late", test: (d) => d > 30 && d <= 60 },
  { id: "d90", label: "Over 60 days late", test: (d) => d > 60 },
];

export function agingFor(rows: InvoiceRow[], period: Period): AgingBucket[] {
  const owed = rows.filter(
    (r) => r.balance_cents > 0 && r.state !== "void" && inPeriodClient(r.issued_at, period),
  );
  const raw = BUCKETS.map((b) => {
    const hits = owed.filter((r) => b.test(r.days_overdue));
    return { id: b.id, label: b.label, count: hits.length, cents: hits.reduce((s, r) => s + r.balance_cents, 0) };
  });
  const max = Math.max(1, ...raw.map((b) => b.cents));
  return raw.map((b) => ({ ...b, share: b.cents / max }));
}

/** The invoices the demo story is about: still owed and more than 30 days past due. */
export function chaseList(rows: InvoiceRow[]): InvoiceRow[] {
  return rows
    .filter((r) => r.balance_cents > 0 && r.days_overdue > 30 && r.state !== "void")
    .sort((a, b) => b.days_overdue - a.days_overdue);
}
