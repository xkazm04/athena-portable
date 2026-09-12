/** Money and dates, formatted one way everywhere. Safe on both sides of the wire. */
import { CURRENCY, LOCALE, TODAY } from "./constants";

const money = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  minimumFractionDigits: 2,
});

const moneyCompact = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  maximumFractionDigits: 0,
});

const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });
const fullDate = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const monthYear = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" });

/** Minor units in, currency out. Negative amounts keep their sign. */
export function formatMoney(cents: number): string {
  return money.format(cents / 100);
}

/** Same, rounded to whole units - for headline figures where cents are noise. */
export function formatMoneyShort(cents: number): string {
  return moneyCompact.format(cents / 100);
}

/** Grouping separators and currency symbols are noise; everything else must be a plain number. */
const NOISE = /[\s ,'’]|\p{Sc}/gu;
const MONEY = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

/**
 * A typed dollar amount to integer cents, or `null` when the string is not an amount.
 *
 * One rule, one answer, at every site that takes money from a human or an agent. It accepts what
 * the app itself prints - `$1,250.00` - and refuses what only looks numeric (`1e3`, `abc`, ``),
 * because a money field that quietly guesses is worse than one that says no. The minus sign is
 * kept so the callee can refuse a negative amount by its own rule rather than have it silently
 * flipped to a credit.
 */
export function parseDollars(input: string | number): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 100) : null;
  const cleaned = input.trim().replace(NOISE, "");
  if (!MONEY.test(cleaned)) return null;
  const dollars = Number(cleaned);
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
}

export function formatDate(iso: string): string {
  return dayMonth.format(new Date(iso));
}

export function formatFullDate(iso: string): string {
  return fullDate.format(new Date(iso));
}

export function formatMonth(iso: string): string {
  return monthYear.format(new Date(iso));
}

/** Whole days between two ISO instants, positive when `later` is after `earlier`. */
export function daysBetween(earlier: string, later: string = TODAY): number {
  const ms = Date.parse(later) - Date.parse(earlier);
  return Math.floor(ms / 86_400_000);
}

/** `2026-07` for any ISO instant - the key the period filter groups on. */
export function periodKey(iso: string): string {
  return iso.slice(0, 7);
}
