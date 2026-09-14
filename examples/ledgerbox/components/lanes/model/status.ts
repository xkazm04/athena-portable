/**
 * What an invoice's standing IS, in one word, with one glyph.
 *
 * THE COMPLAINT THIS ANSWERS. "Cards can have status icons instead of ids in the
 * left top corner." The L1 card opened on `#0058` — four digits every invoice in
 * the books shares the prefix of, in the one position on the card the eye
 * reaches first. The id is an address, not a fact: it matters when you are about
 * to name the invoice to somebody and never when you are deciding which of
 * twelve to open. The standing goes there instead and the id drops to a quiet
 * mono line under the client's name.
 *
 * THE VOCABULARY IS THE ONE ALREADY ON THE PAGE. Nothing here is invented: the
 * states are `InvoiceState` from the books, the ordering is the footer legend's
 * own precedence (disputed, then long overdue, then a credit that fits), and the
 * colour is `mark.heat`, which the card already carries as `data-heat`. The
 * glyph adds a shape to an encoding that was colour-only, which is also the
 * greyscale answer: turn the sheet monochrome and the standing is still there.
 *
 * Pure and iconless on purpose — `spread/Glyph.tsx` maps a key to a lucide
 * component, and this file can be held by `test/lanes.test.ts` without React.
 */

import type { LnMark } from "./sheet";

/**
 * At or past this many days a mark is worth interrupting someone about — the
 * footer key publishes this as "45+ days", and the key is the contract.
 *
 * It lived in `swarm/marks.ts`, which is a component-side file that imports the
 * model; a model file importing it back would be a cycle. It is a fact about the
 * books, so it is here and `marks.ts` re-exports it.
 */
export const SHOUT_AT = 45;

export type StatusKey =
  | "disputed"
  | "void"
  | "draft"
  | "settled"
  | "long-overdue"
  | "credit"
  | "late"
  | "part-paid"
  | "within-terms";

/** What the glyph means, said in words. It is the icon's accessible name. */
export const STATUS_LABEL: Record<StatusKey, string> = {
  disputed: "disputed",
  void: "void",
  draft: "draft",
  settled: "settled",
  "long-overdue": "45+ days late",
  credit: "a credit is waiting",
  late: "late",
  "part-paid": "part paid",
  "within-terms": "within terms",
};

/**
 * One invoice's standing, worst first.
 *
 * The order is a claim about which fact you would want to be told if you could
 * only be told one, and it matches `flagOf` in `swarm/marks.ts` for the three
 * standings that also carry a glyph at L0 — so a mark and the card it becomes
 * never disagree about what is the matter with it.
 */
export function statusOf(mark: LnMark): StatusKey {
  if (mark.state === "disputed") return "disputed";
  if (mark.state === "void") return "void";
  if (mark.state === "draft") return "draft";
  if (mark.balanceCents <= 0) return "settled";
  if (mark.daysOverdue >= SHOUT_AT) return "long-overdue";
  if (mark.candidateCount > 0) return "credit";
  if (mark.daysOverdue > 0) return "late";
  if (mark.paidCents > 0) return "part-paid";
  return "within-terms";
}
