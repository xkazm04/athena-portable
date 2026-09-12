import "server-only";

/**
 * What one invoice is worth on the sheet, and what it is waiting for.
 *
 * `weightOf` is log-compressed on purpose: one whale would otherwise flatten
 * every other mark to the minimum width, and the swarm's whole claim is that a
 * mark's width IS its size. `statusOf` is the sentence the hover read-out
 * shows, assembled from stored columns only — no figure here is estimated.
 */
import { MS_DAY } from "./constants";
import { TODAY } from "../constants";
import type { InvoiceRow } from "../types";
import type { LnAxis, LnLane, LnMark } from "@/components/lanes/model";

/**
 * Log compression: the studio's biggest invoice is many times its smallest, and
 * a linear width would leave two thirds of the books as an unreadable crust.
 */
export function weightOf(cents: number, max: number): number {
  if (max <= 0) return 0;
  return Math.log1p(Math.max(0, cents)) / Math.log1p(max);
}

/**
 * One clause saying what this invoice is waiting for.
 *
 * Composed from the stored columns only. It is the line the mark cannot show at
 * L0 and the first thing the spread at L1 adds, which is most of why opening a
 * lane is worth doing.
 */
export function statusOf(row: InvoiceRow): string {
  if (row.state === "void") return "Voided. Nothing owed and nothing to do.";
  if (row.state === "draft") return "Draft. Not sent, so the clock has not started.";
  if (row.state === "disputed") {
    return row.dispute_note ? `Disputed: ${row.dispute_note}` : "Disputed. Held until it is settled.";
  }
  if (row.balance_cents <= 0) return "Settled in full.";
  if (row.candidate_count > 0) {
    const n = row.candidate_count;
    return `${n} unapplied ${n === 1 ? "credit" : "credits"} could belong here.`;
  }
  if (row.days_overdue > 30) {
    return `${row.days_overdue} days past due${row.reminders_sent > 0 ? `, ${row.reminders_sent} chased` : ", never chased"}.`;
  }
  if (row.days_overdue > 0) return `${row.days_overdue} days past due.`;
  if (row.paid_cents > 0) return "Part paid and still inside terms.";
  return "Within terms.";
}

/** A lane reads as its worst invoice, so the gutter is legible at a distance. */
export function laneHeat(marks: readonly LnMark[]): LnLane["heat"] {
  const order: LnLane["heat"][] = ["inert", "good", "watch", "risk", "alert"];
  let worst = 0;
  for (const m of marks) {
    if (m.heat === "inert") continue;
    worst = Math.max(worst, order.indexOf(m.heat));
  }
  return order[worst] ?? "good";
}

/**
 * The time axis every lane shares.
 *
 * It runs from the first thing in the books to the last due date, with the
 * frozen "today" somewhere inside it — so a mark to the right of the now-line is
 * money that has not fallen due yet, and the tails on the left have length.
 */
export function buildAxis(rows: readonly InvoiceRow[]): LnAxis {
  const stamps = [
    ...rows.map((r) => Date.parse(r.issued_at)),
    ...rows.map((r) => Date.parse(r.due_at)),
    Date.parse(TODAY),
  ];
  const min = Math.min(...stamps);
  const max = Math.max(...stamps);
  const start = new Date(min);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  // A fortnight of headroom so the last mark is not welded to the right edge.
  const end = max + 14 * MS_DAY;
  const startMs = start.getTime();
  const span = Math.max(MS_DAY, end - startMs);

  const months: { label: string; x: number }[] = [];
  const cursor = new Date(startMs);
  while (cursor.getTime() < end) {
    months.push({
      label: cursor.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
      x: (cursor.getTime() - startMs) / span,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return {
    startIso: start.toISOString(),
    endIso: new Date(end).toISOString(),
    todayX: (Date.parse(TODAY) - startMs) / span,
    months,
  };
}
