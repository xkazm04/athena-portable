/**
 * CSS custom properties, read into JS. One clock per level change, in one module.
 *
 * WHY THE KIT OWNS THIS NOW. Formula §1 rule 4 says durations and easings live in a single
 * exported map that the CSS tokens alias and a test compares against, and that JS reads tokens
 * and never types a millisecond. All three round-1 apps got there and all three wrote their own
 * reader: ledgerbox's `token()/seconds()/easing()` with a module cache scoped to
 * `[data-variant="lanes"]`, tidycrm's `readMotionTokens()` behind a `useSyncExternalStore`, and
 * hirelane's — which gave up on reading the cascade and declared the numbers in TypeScript with
 * a test parsing the stylesheet to keep the two in step. Three parsers for `"260ms"` is three
 * places for `"0.26s"` to be mishandled.
 *
 * WHAT IS HERE AND WHAT IS NOT. Parsing is pure and exported, because parsing is the part that
 * can be wrong and it does not need a browser to be wrong in (`test/tokens.test.ts`). Reading is
 * SSR-safe: with no `window` every reader answers its documented default rather than throwing,
 * and the default for a duration is the caller's — usually 0, which lands on the final state,
 * which is the same branch reduced motion takes and never a second set of numbers.
 *
 * No React in this file; `useTokens.ts` is the hook.
 */

/** Anything that can answer a custom property. `getComputedStyle(el)` is the usual one. */
export interface StyleSource {
  getPropertyValue: (property: string) => string;
}

/** One token, in the three shapes a motion call site asks for. */
export interface TokenValue {
  /** Exactly what the cascade said, trimmed. `""` when the token is not set. */
  raw: string;
  /** `raw` as milliseconds, or the reader's fallback when it is not a duration. */
  ms: number;
  /** `raw` as an easing — a string, because that is what both CSS and motion accept. */
  ease: string;
}

const DURATION = /^(-?[0-9]*\.?[0-9]+)(ms|s)$/;
const BEZIER = /^cubic-bezier\(([^)]+)\)$/;

/** Milliseconds to the seconds `motion` counts in. The other half of rule 4's arithmetic. */
export const secs = (ms: number): number => ms / 1000;

/**
 * `"260ms"` or `"0.26s"` as a number of milliseconds; `fallback` for anything else.
 *
 * A token that is not set at all reads as `""` and therefore as the fallback, which is why an
 * unmounted scope is not an exception to handle at the call site.
 */
export function parseMs(raw: string | null | undefined, fallback = 0): number {
  const m = DURATION.exec((raw ?? "").trim());
  if (!m) return fallback;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return fallback;
  return m[2] === "s" ? n * 1000 : n;
}

/** An easing token as the string CSS and `motion` both take; `fallback` when it is not set. */
export function parseEase(raw: string | null | undefined, fallback = ""): string {
  const value = (raw ?? "").trim();
  return value === "" ? fallback : value;
}

/**
 * `cubic-bezier(0.2, 0, 0, 1)` as the four numbers `motion`'s `ease` array wants.
 *
 * `null` for a keyword (`ease-out`, `linear`) or for anything unparseable — a caller hands that
 * straight to `motion`, which understands the keywords itself.
 */
export function parseBezier(raw: string | null | undefined): [number, number, number, number] | null {
  const m = BEZIER.exec((raw ?? "").trim());
  if (!m) return null;
  const parts = (m[1] ?? "").split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return null;
  return parts as [number, number, number, number];
}

/** Both readings of one raw value, so a record does not have to guess which the caller wants. */
export const tokenValue = (raw: string | null | undefined, fallbackMs = 0): TokenValue => {
  const value = (raw ?? "").trim();
  return { raw: value, ms: parseMs(value, fallbackMs), ease: value };
};

/**
 * The computed style of `el`, or of the document element, or `null` on the server.
 *
 * Exported because a caller that reads many tokens at once should take the style ONCE:
 * `getComputedStyle` is a layout read, and ten of them per level change is not a budget worth
 * defending (hirelane's origin map makes the same argument about `getBoundingClientRect`).
 */
export function styleOf(el?: Element | null): StyleSource | null {
  if (typeof window === "undefined") return null;
  const node = el ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!node) return null;
  return window.getComputedStyle(node);
}

/**
 * A `--*` duration token in milliseconds, read off `el ?? document.documentElement`.
 *
 * SSR-safe: `fallback` (0 by default) when there is no window.
 */
export function cssMs(name: string, el?: Element | null, fallback = 0): number {
  const style = styleOf(el);
  return style ? parseMs(style.getPropertyValue(name), fallback) : fallback;
}

/** A `--*` easing token as a string, read off `el ?? document.documentElement`. */
export function cssEase(name: string, el?: Element | null, fallback = ""): string {
  const style = styleOf(el);
  return style ? parseEase(style.getPropertyValue(name), fallback) : fallback;
}

/**
 * Several tokens off one style read.
 *
 * Pure over the style source so a test can hand it a stub, which is the shape tidycrm's
 * `readMotionTokens` had and the one part of that module worth keeping. `style` may be `null`
 * (the server, or a scope that is not mounted yet); every token then answers its fallback.
 */
export function readTokens<const N extends readonly string[]>(
  names: N,
  style: StyleSource | null,
  fallbackMs = 0,
): { readonly [K in N[number]]: TokenValue } {
  const out: Record<string, TokenValue> = {};
  for (const name of names) {
    out[name] = tokenValue(style?.getPropertyValue(name), fallbackMs);
  }
  return out as { readonly [K in N[number]]: TokenValue };
}
