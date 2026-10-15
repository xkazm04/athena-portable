/**
 * A turn's cards as one sheet - ADR 0104, README section 3.2 step 6.
 *
 * Pure: which cards that arrived on the stream belong together, and in what order. Grouping is the
 * surface's alone; every row stays its own card at the daemon, with its own single-use grant
 * (ADR 0038), and nothing here changes what the gate decides.
 */
import type { DecisionRequested } from "@/lib/events";

/** The most rows one sheet holds; a card past it stays a card, and the sheet says so (ADR 0104). */
export const SHEET_CAP = 12;

/**
 * Where a card that arrived on the stream belongs (ADR 0104, 0106). `key` names the request and,
 * for a card that is not a page's bound card, its catalog origin and tab; `row` is false for a card past {@link SHEET_CAP}, which
 * stays a card of its own. A card the daemon reported later (reconcile) has no slot: it is a card.
 */
export interface SheetSlot {
  key: string;
  row: boolean;
}

/**
 * The slot key for a card arriving in request `request`. A page's card bound to a tab joins the one
 * checklist of its request, whichever open app and tab it was proposed on (ADR 0106): each row
 * still runs on its own bound tab with its own grant. A connector's, core's or an unbound card
 * keeps a sheet of its own origin.
 */
export function sheetKeyOf(request: number, card: Pick<DecisionRequested, "origin" | "tab_id">): string {
  if (card.origin.startsWith("host:") && card.tab_id !== undefined && card.tab_id !== null) return `${request}|tabs`;
  return `${request}|${card.origin}|${card.tab_id ?? ""}`;
}

/** The slot for a card arriving now, given the slots already handed out. Pure. */
export function slotFor(
  slots: Readonly<Record<string, SheetSlot>>,
  request: number,
  card: Pick<DecisionRequested, "id" | "origin" | "tab_id">,
): SheetSlot {
  const key = sheetKeyOf(request, card);
  const rows = Object.entries(slots).filter(([id, s]) => id !== card.id && s.key === key && s.row).length;
  return { key, row: rows < SHEET_CAP };
}

/** A card's sheet, as the cards stand now: its rows in arrival order, and the cards it cut. */
export interface SheetOf {
  key: string;
  rows: DecisionRequested[];
  /** Pending cards of the same request, app and tab that arrived past the cap. */
  overflow: number;
}

/**
 * The sheet a card is a row of, or `null` when it is a card: no slot, past the cap, or the only
 * row still waiting. Rows keep the order the cards arrived in, which is the order the model
 * proposed them (rounds.py walks a reply's OP lines in order).
 */
export function sheetOf(
  cards: readonly DecisionRequested[],
  slots: Readonly<Record<string, SheetSlot>>,
  id: string,
): SheetOf | null {
  const slot = slots[id];
  if (!slot?.row) return null;
  const same = cards.filter((c) => slots[c.id]?.key === slot.key);
  const rows = same.filter((c) => slots[c.id]?.row);
  if (rows.length < 2) return null;
  return { key: slot.key, rows, overflow: same.length - rows.length };
}
