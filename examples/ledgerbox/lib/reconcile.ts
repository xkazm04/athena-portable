/**
 * The reconciliation table: every (open invoice, unapplied credit) pair scored ONCE, and each pair
 * given a standing. Pure, no server import - `lib/db.ts` feeds it the request's rows and lines.
 *
 * The relation "this credit could settle this invoice" used to be computed three times: the row's
 * `candidate_count` and the card's candidates by two invoice-side passes, and the credits strip
 * and `read_credits` by a credit-side pass that alone knew about ambiguity. So the two halves of
 * the app judged the same credit differently: Ironwood's $43,650 scored 99 for one invoice and 54
 * for another, the credit side called it the first one's, and the invoice side still counted it,
 * carded it and offered it on the second - where applying it settles the wrong invoice and leaves
 * the right one overdue and chaseable.
 *
 * The rule, from the one threshold `isContender` owns: a credit is OFFERED to an invoice only when
 * that invoice is its best fit or a real contender for it. A runner-up that is clearly behind is
 * still listed on the credit's side - a person checking the credit should see what else it nearly
 * fit - but marked `claimed_elsewhere`, naming the invoice it plainly belongs to, and it is never
 * counted or offered on the runner-up's own side. Every reader reads this one table, so the row's
 * count, the card, the credits strip and both tools agree by construction
 * (measurement-honesty / co-published-numbers-must-reconcile).
 */
import { isAmbiguous, isContender, scoreCandidate, type ScoreInput } from "./match";
import type { BankLine, ClaimedBy, MatchCandidate, Standing } from "./types";

/** One open invoice as the table scores it: the scorer's input plus the id it is filed under. */
export interface ReconcileInvoice extends ScoreInput {
  id: string;
}

/** One scored (credit, invoice) pair, with its standing among the credit's other fits. */
export interface Offer extends MatchCandidate {
  invoice_id: string;
  number: string;
  client_name: string;
  standing: Standing;
}

/** One credit's side of the table: every invoice it fits, best first, and whether to ask. */
export interface CreditReading {
  line: BankLine;
  offers: Offer[];
  /** The top two are too close to choose between (`isAmbiguous`). */
  ambiguous: boolean;
}

export interface Reconciliation {
  /** Every incoming credit, in the order the lines were given. */
  credits: CreditReading[];
  byCredit(lineId: string): CreditReading | undefined;
  /** The credits OFFERED to this invoice (never a `claimed_elsewhere` pair), best first. */
  byInvoice(invoiceId: string): Offer[];
}

/** Rank one credit's fits and give each its standing. `scored` must be sorted best first. */
function standings(scored: Omit<Offer, "standing">[]): Offer[] {
  const top = scored[0];
  if (!top) return [];
  const contested = isAmbiguous(scored);
  const claimedBy: ClaimedBy = { invoice_id: top.invoice_id, number: top.number, score: top.score };
  return scored.map((o, i) => {
    if (i === 0) return { ...o, standing: contested ? "contested" : "best" };
    if (contested && isContender(top.score, o.score)) return { ...o, standing: "contested" };
    return { ...o, standing: "claimed_elsewhere", claimed_by: claimedBy };
  });
}

export function reconcile(open: readonly ReconcileInvoice[], lines: readonly BankLine[]): Reconciliation {
  const credits: CreditReading[] = [];
  const byCredit = new Map<string, CreditReading>();
  const byInvoice = new Map<string, Offer[]>();

  for (const line of lines) {
    if (line.direction !== "in") continue;
    const scored: Omit<Offer, "standing">[] = [];
    for (const inv of open) {
      const hit = scoreCandidate(inv, line);
      if (hit) {
        scored.push({ ...hit, invoice_id: inv.id, number: inv.invoice.number, client_name: inv.clientName });
      }
    }
    // Stable sort: equal scores keep the invoices' given order, as the old passes did.
    scored.sort((a, b) => b.score - a.score);
    const offers = standings(scored);
    const reading: CreditReading = { line, offers, ambiguous: isAmbiguous(offers) };
    credits.push(reading);
    byCredit.set(line.id, reading);
    for (const o of offers) {
      if (o.standing === "claimed_elsewhere") continue;
      const list = byInvoice.get(o.invoice_id) ?? [];
      list.push(o);
      byInvoice.set(o.invoice_id, list);
    }
  }
  for (const list of byInvoice.values()) list.sort((a, b) => b.score - a.score);

  return {
    credits,
    byCredit: (lineId) => byCredit.get(lineId),
    byInvoice: (invoiceId) => byInvoice.get(invoiceId) ?? [],
  };
}
