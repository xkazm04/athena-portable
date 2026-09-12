/** Pure geometry for the Strip: which day is which x, and how cards pack into rows without overlap. */
import { TODAY } from "@/lib/constants";
import type { BankLine, InvoiceRow } from "@/lib/types";

export const DAY_PX = 44;
export const CARD_W = 168;
export const CARD_H = 96;
export const COIN_W = 128;
export const COIN_H = 52;
export const GAP = 8;
export const LANE_TOP = 40;
/** Vertical air between the card tray and the coin tray. Not a day width - it only looks like one. */
export const LANE_GAP = 44;

const MS_DAY = 86_400_000;

export interface Placed<T> {
  item: T;
  day: number;
  x: number;
  row: number;
}

export interface StripGeometry {
  startIso: string;
  days: number;
  width: number;
  todayX: number;
  cards: Placed<InvoiceRow>[];
  cardRows: number;
  coins: Placed<BankLine>[];
  coinRows: number;
  months: { label: string; x: number }[];
}

function dayOf(iso: string, startMs: number): number {
  return Math.floor((Date.parse(iso) - startMs) / MS_DAY);
}

/** Greedy interval packing: each item takes the first row whose last item ends before it starts. */
function pack<T>(items: { item: T; day: number }[], width: number): { placed: Placed<T>[]; rows: number } {
  const ends: number[] = [];
  const placed = items
    .slice()
    .sort((a, b) => a.day - b.day)
    .map(({ item, day }) => {
      const x = day * DAY_PX;
      let row = ends.findIndex((end) => end + GAP <= x);
      if (row === -1) row = ends.length;
      ends[row] = x + width;
      return { item, day, x, row };
    });
  return { placed, rows: ends.length };
}

export function stripGeometry(rows: InvoiceRow[], credits: BankLine[]): StripGeometry {
  const stamps = [...rows.map((r) => r.due_at), ...credits.map((c) => c.posted_at), TODAY];
  const min = Math.min(...stamps.map((s) => Date.parse(s)));
  const start = new Date(min);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const startMs = start.getTime();
  const last = Math.max(...stamps.map((s) => dayOf(s, startMs)));
  const days = last + 6;

  const { placed: cards, rows: cardRows } = pack(rows.map((r) => ({ item: r, day: dayOf(r.due_at, startMs) })), CARD_W);
  const { placed: coins, rows: coinRows } = pack(credits.map((c) => ({ item: c, day: dayOf(c.posted_at, startMs) })), COIN_W);

  const months: { label: string; x: number }[] = [];
  const cursor = new Date(start);
  while (dayOf(cursor.toISOString(), startMs) < days) {
    months.push({
      label: cursor.toLocaleString("en-US", { month: "long", timeZone: "UTC" }),
      x: dayOf(cursor.toISOString(), startMs) * DAY_PX,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return {
    startIso: start.toISOString(),
    days,
    width: days * DAY_PX,
    todayX: dayOf(TODAY, startMs) * DAY_PX,
    cards,
    cardRows,
    coins,
    coinRows,
    months,
  };
}

/** Money still owed on everything due on or before day `d`, so the counter can read it per pixel. */
export function owedByDay(cards: Placed<InvoiceRow>[], days: number): number[] {
  const perDay = new Array<number>(days + 1).fill(0);
  for (const c of cards) if (c.day >= 0 && c.day <= days) perDay[c.day] = (perDay[c.day] ?? 0) + c.item.balance_cents;
  let running = 0;
  return perDay.map((v) => (running += v));
}

export function monthAtX(months: StripGeometry["months"], x: number): string {
  let label = months[0]?.label ?? "";
  for (const m of months) if (m.x <= x) label = m.label;
  return label;
}
