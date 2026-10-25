/**
 * Whether the statement already holds the money a chase would ask for. Pure, no server import -
 * `lib/db.ts` hands it the credits the reconciliation table offers an invoice, and the draft, the
 * send and the invoice's status sentence all read the one verdict (ADR 0197).
 *
 * A credit SETTLES an invoice for this purpose when the table calls that invoice its clear best
 * fit (`standing: "best"`, so no contender within AMBIGUOUS_GAP) and the match is `strong`. Such an
 * invoice is not chased: the refusal names the credit - memo, amount, date, line id - so the next
 * act is `match_bank_line`, not a dunning letter to a client who has paid. The block lifts the
 * moment the credit is applied, here or to the invoice it really belongs to.
 *
 * A credit the table calls `contested` for this invoice does not block - the app cannot say whose
 * it is - but the chase is told, naming every invoice it could be for. A `likely` or `weak` fit,
 * or a credit whose best fit is another invoice, says nothing here at all.
 */
import { formatMoney } from "./format";
import type { BankLine, MatchCandidate } from "./types";

/** The credit a chase is refused for: the line to apply instead. */
export interface SettlingCredit {
  line_id: string;
  memo: string;
  amount_cents: number;
  posted_at: string;
  /** Cents the credit falls short of the balance. Absent when it covers it. */
  short_by_cents?: number;
}

/** One credit as the verdict reads it: the line, and every invoice it fits, best first. */
export interface ChaseCredit {
  line: Pick<BankLine, "id" | "memo" | "amount_cents" | "posted_at">;
  offers: readonly (Pick<MatchCandidate, "confidence" | "standing" | "short_by_cents"> & {
    invoice_id: string;
    number: string;
  })[];
}

export type ChaseVerdict =
  | { block: true; message: string; settling_credit: SettlingCredit }
  | { block: false; warning: string };

interface ChaseRow {
  id: string;
  number: string;
}

/** "28 Jun": the day the credit posted, as the statement prints it, in UTC like the books. */
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The credit on the statement that settles this invoice, or null. The highest-scoring one wins. */
export function settlingCredit(row: Pick<ChaseRow, "id">, credits: readonly ChaseCredit[]): SettlingCredit | null {
  for (const { line, offers } of credits) {
    const top = offers[0];
    if (!top || top.invoice_id !== row.id || top.standing !== "best" || top.confidence !== "strong") continue;
    return {
      line_id: line.id,
      memo: line.memo,
      amount_cents: line.amount_cents,
      posted_at: line.posted_at,
      ...(top.short_by_cents !== undefined ? { short_by_cents: top.short_by_cents } : {}),
    };
  }
  return null;
}

/** `$17,775.00 arrived 28 Jun as "SEPA CR ..."` - the fact, as every sentence here states it. */
function arrived(c: Pick<SettlingCredit, "amount_cents" | "posted_at" | "memo">): string {
  return `${formatMoney(c.amount_cents)} arrived ${dayMonth.format(new Date(c.posted_at))} as "${c.memo}"`;
}

/**
 * `$17,775.00 arrived 28 Jun as "SEPA CR ..." (bank line bl_12), short by $25.00` - the credit named
 * the way the refusal names it, so the card's apply-first row and the books' refusal say one thing.
 */
export function creditNamed(c: SettlingCredit): string {
  const gap = c.short_by_cents ? `, short by ${formatMoney(c.short_by_cents)}` : "";
  return `${arrived(c)} (bank line ${c.line_id})${gap}`;
}

/** The status sentence's clause for an invoice the statement looks to have paid. */
export function looksPaid(credit: SettlingCredit): string {
  return `Looks paid: ${arrived(credit)} - apply it before chasing.`;
}

/**
 * The verdict on chasing `row` given the credits offered to it: blocked by a settling credit,
 * warned by a contested one, or null. Asked before the draft is written and again at the send.
 */
export function chaseVerdict(row: ChaseRow, credits: readonly ChaseCredit[]): ChaseVerdict | null {
  const settling = settlingCredit(row, credits);
  if (settling) {
    const short = settling.short_by_cents;
    const then = short ? `, then chase the ${formatMoney(short)} that remains` : " before chasing";
    return {
      block: true,
      message: `${row.number} looks paid: ${creditNamed(settling)}, and it has not been applied. Apply it with match_bank_line${then}.`,
      settling_credit: settling,
    };
  }
  for (const { line, offers } of credits) {
    const mine = offers.find((o) => o.invoice_id === row.id);
    if (mine?.standing !== "contested" || mine.confidence !== "strong") continue;
    const numbers = offers.filter((o) => o.standing === "contested").map((o) => o.number);
    return {
      block: false,
      warning: `${arrived(line)} (bank line ${line.id}) could be for ${numbers.join(" or ")} - check before sending.`,
    };
  }
  return null;
}
