/**
 * How hot an invoice is, in five words the whole app agrees on.
 *
 * Deliberately not a colour: a surface decides what `alert` LOOKS like. What
 * this fixes is the JUDGEMENT, so every reading of the books agrees about which
 * invoices are the trouble and disagrees only about how to draw them.
 *
 * It used to live in `components/worlds/model.ts`, a 176-line payload shaped for
 * three WebGL worlds that have since been cut. The Lanes only ever wanted these
 * two exports, and a direction should not import the model of a deleted one to
 * get them.
 *
 * Client-safe: a type and a pure function, no `lib/db` import.
 */
import type { InvoiceState } from "../types";

export type Heat = "good" | "watch" | "risk" | "alert" | "inert";

export const HEAT_LABEL: Record<Heat, string> = {
  good: "settled",
  watch: "within terms",
  risk: "late",
  alert: "long overdue",
  inert: "not in play",
};

export function heatOf(state: InvoiceState, daysOverdue: number): Heat {
  if (state === "void" || state === "draft") return "inert";
  if (state === "disputed") return "alert";
  if (state === "paid") return "good";
  if (daysOverdue > 30) return "alert";
  if (daysOverdue > 0) return "risk";
  return "watch";
}
