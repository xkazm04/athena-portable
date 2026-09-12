"use server";

/**
 * Form-shaped adapters over the capability actions, for `useActionState`. The capability actions in
 * `actions.ts` keep their typed signatures (the manifest calls them); these only parse a FormData.
 */
import { exportSummaryAction, markPaidAction } from "./actions";
import { PERIODS, type Period } from "@/lib/constants";
import { parseDollars } from "@/lib/format";
import type { ActionResult } from "@/lib/types";

export interface PayFormState extends ActionResult {
  /** Bumps on every submit so a form can reset itself after success. */
  seq: number;
}

export async function markPaidForm(prev: PayFormState, data: FormData): Promise<PayFormState> {
  const id = String(data.get("id") ?? "");
  const cents = parseDollars(String(data.get("amount") ?? ""));
  if (cents === null) return { ok: false, message: "That is not an amount.", seq: prev.seq + 1 };
  const result = await markPaidAction(id, cents);
  return { ...result, seq: prev.seq + 1 };
}

export interface ExportFormState extends ActionResult {
  body: string | null;
  period: Period | null;
}

export async function exportForm(_prev: ExportFormState, data: FormData): Promise<ExportFormState> {
  const period = String(data.get("period") ?? "");
  if (!PERIODS.includes(period as Period)) {
    return { ok: false, message: "Pick a period first.", body: null, period: null };
  }
  const result = await exportSummaryAction(period as Period);
  return { ok: result.ok, message: result.message, body: result.body ?? null, period: period as Period };
}
