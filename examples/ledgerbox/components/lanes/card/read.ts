/**
 * What the card prints beside the lead figure, and whether it has a left column
 * at all.
 *
 * Both answer the same question in two places: does this actually say
 * something, or is it a slot being filled? Neither is layout — they are
 * judgements about one invoice, which is why they live here and not in the JSX.
 */
import { formatDate, formatMoneyShort } from "@/lib/format";
import type { LnDetail, LnMark } from "../model";

/**
 * The stat row, after the lead figure — and every entry has to EARN its slot.
 *
 * It used to print Invoiced and Received unconditionally, so the commonest
 * invoice in the books (nothing paid, badly late) opened on "$95,100 STILL
 * OWED · $95,100.00 INVOICED · $0.00 RECEIVED": the same number twice in two
 * different formats, and a zero. A figure that repeats the one beside it is not
 * a second fact, it is noise wearing a label. Invoiced and Received now appear
 * only when a payment has actually split them apart, and the whole row is set
 * in whole units — the cents are in the lines below, which is the place you
 * reconcile.
 */
export function figuresFor(mark: LnMark): { label: string; value: string }[] {
  const row: { label: string; value: string }[] = [];
  // Only a PART-paid invoice has three different money figures. On a settled
  // one the balance, the invoiced total and the received total are the same
  // number, and printing it three times was the same fault in a friendlier
  // disguise.
  if (mark.paidCents > 0 && mark.balanceCents > 0) {
    row.push({ label: "Invoiced", value: formatMoneyShort(mark.amountCents) });
    row.push({ label: "Received", value: formatMoneyShort(mark.paidCents) });
  }
  if (mark.daysOverdue > 0) row.push({ label: "Days late", value: String(mark.daysOverdue) });
  row.push({ label: mark.daysOverdue > 0 ? "Was due" : "Due", value: formatDate(mark.dueAt) });
  return row;
}

/**
 * Does the left column have anything in it?
 *
 * A settled invoice has no detail record built for it at all — the sheet only
 * builds one for what can still be acted on — so the card opened on a wide
 * empty column beside a panel of em-dashes and said nothing about why. It says
 * so now.
 */
export function hasEvidenceFor(detail: LnDetail | undefined): boolean {
  return Boolean(
    detail &&
      (detail.disputeNote ||
        detail.mostlyPaid ||
        detail.lines.length > 0 ||
        detail.matched.length > 0 ||
        detail.candidates.length > 0 ||
        detail.draft ||
        detail.note),
  );
}
