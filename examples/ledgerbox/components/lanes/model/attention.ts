/**
 * How present a mark is, decided once for the whole direction.
 *
 * THE COMPLAINT THIS ANSWERS. "Items needing attention need separation, e.g. by
 * default other nodes semitransparent." The sheet drew all 124 invoices at full
 * strength, so the forty that are settled and the twenty that are still inside
 * their terms competed on equal footing with the fifty-four that are late — and
 * the level whose whole job is finding the money that has not arrived gave the
 * money that already has exactly as much ink.
 *
 * IT IS NOT A SECOND DIMMING SYSTEM, and that was the constraint. The filter
 * already dimmed rather than removed, and the kit's `emphasis()` already decides
 * how present a LANE is once you have drilled past it. This is the same channel
 * with one more reason to be in it: one function, three values, and `opacity`
 * is the only thing anything downstream does with them. A mark's opacity on
 * screen is `emphasis(focus, lane) * markPresence(mark, filter)` — the lane's
 * reading and the mark's, multiplied, never two systems arguing.
 *
 * HOW THE TWO CHANNELS COMPOSE, since the kit only knows one of them. The kit's
 * `presenceOf(focus, group)` answers "how present is this LANE, given where the
 * reader is standing" — a fact about NAVIGATION, and the only presence the kit
 * can know. This file answers "how present is this MARK, given the filter and
 * whether the invoice wants a decision" — a fact about the BOOKS, which the kit
 * has no way to see. They multiply, and they multiply in the DOM rather than in
 * arithmetic: the lane element carries the kit's opacity and the mark inside it
 * carries this one, so the two compose the way nested opacity always does and
 * neither has to know the other exists. `markPresence` is named for its subject
 * so it cannot be mistaken at a call site for the kit's `presenceOf`.
 *
 * Pure, so `test/lanes.test.ts` can hold the rule without a DOM.
 */

import { matches, type LnFilter } from "./filters";
import type { LnMark } from "./sheet";

/** The three readings, from "this wants you" to "the filter has put this away". */
export type Presence = "lit" | "quiet" | "dim";

/**
 * Is this invoice asking for a decision?
 *
 * The three answers the books actually offer, and they are the same three the
 * footer's glyph key has published since the first cut: it is late, the client
 * disputes it, or a credit has landed that might clear it. Everything else —
 * settled, voided, drafted, or simply not due yet — is a row where the right
 * move is nothing, and a row where the right move is nothing should not be as
 * loud as one where it is not.
 */
export function needsDecision(mark: LnMark): boolean {
  if (mark.state === "disputed") return true;
  // Nothing outstanding is nothing to decide, whatever else is true of it: a
  // settled invoice cannot be late and a voided one is not owed.
  if (mark.balanceCents <= 0) return false;
  if (mark.state === "void" || mark.state === "draft") return false;
  return mark.daysOverdue > 0 || mark.candidateCount > 0;
}

/**
 * The one reading every level draws a mark at.
 *
 * The filter comes first because it is the reader's own explicit narrowing, and
 * an invoice they have filtered out should recede even when it is screaming.
 */
export function markPresence(mark: LnMark, filter: LnFilter): Presence {
  if (!matches(mark, filter)) return "dim";
  return needsDecision(mark) ? "lit" : "quiet";
}

/**
 * Presence as a number, for the one place that cannot use the CSS token:
 * motion owns the inline `opacity` of an L1 card while it morphs, so a
 * stylesheet rule on the same element would either lose or fight it.
 *
 * These are the values of `--ln-presence-*` in `style/base/tokens.css`. The test
 * reads both and asserts they agree, so the two spellings cannot drift.
 */
export const PRESENCE_OPACITY: Record<Presence, number> = {
  lit: 1,
  quiet: 0.3,
  dim: 0.11,
};
