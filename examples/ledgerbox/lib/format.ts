/** Money and dates, formatted one way everywhere. Safe on both sides of the wire. */
import { CURRENCY, LOCALE } from "./constants";

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

/** Minor units in, currency out. Negative amounts keep their sign. */
export function formatMoney(cents: number): string {
  return money.format(cents / 100);
}

/** Same, rounded to whole units - for headline figures where cents are noise. */
export function formatMoneyShort(cents: number): string {
  return moneyCompact.format(cents / 100);
}

/** Currency symbols are noise wherever they sit. */
const SYMBOL = /\p{Sc}/gu;
/** A grouping mark: removed only after MONEY has said it sits between groups of three. */
const GROUPING = /[,'’\s]/gu;

/**
 * The only shapes an amount may take once the symbol is gone: whole units, either plain or in
 * groups of three split by one grouping mark (`,` `'` `’` or a space), then at most two decimals.
 */
const MONEY = /^-?(?:(?:\d{1,3}(?:[,'’\s]\d{3})+|\d+)(?:\.\d{1,2})?|\.\d{1,2})$/u;

/** How far from a whole cent a number may sit and still be that cent (binary fractions). */
const CENT_EPSILON = 1e-6;

/**
 * A typed dollar amount to integer cents, or `null` when it is not exactly one amount.
 *
 * One rule, one answer, at every site that takes money from a human or an agent. It accepts what
 * the app itself prints - `$1,250.00` - and refuses what only looks numeric (`1e3`, `abc`, ``),
 * because a money field that quietly guesses is worse than one that says no. A grouping mark is
 * only accepted between groups of three: `1,25` is a decimal comma and `1.250,00` a continental
 * thousands point, and stripping them as noise read the one as $125.00 and the other as $1.25 on
 * the way into `mark_paid`, which cannot be taken back. A fraction of a cent, typed or computed,
 * is refused for the same reason rather than rounded. The minus sign is kept so the callee can
 * refuse a negative amount by its own rule rather than have it silently flipped to a credit.
 */
export function parseDollars(input: string | number): number | null {
  const dollars = typeof input === "number" ? input : readAmount(input);
  if (dollars === null || !Number.isFinite(dollars)) return null;
  const cents = dollars * 100;
  const whole = Math.round(cents);
  return Math.abs(cents - whole) <= CENT_EPSILON ? whole : null;
}

function readAmount(input: string): number | null {
  // The symbol goes, then the space a person leaves after it or after the sign (`$ 42`, `- $42`).
  const text = input.replace(SYMBOL, "").trim().replace(/^(-?)\s+/u, "$1");
  return MONEY.test(text) ? Number(text.replace(GROUPING, "")) : null;
}

export function formatDate(iso: string): string {
  return dayMonth.format(new Date(iso));
}

export function formatFullDate(iso: string): string {
  return fullDate.format(new Date(iso));
}
