"use client";

/**
 * Several `--*` tokens, read once and memoised — the JS half of "one clock per level change".
 *
 * Formula §1 rule 4: durations and easings live in one place, the CSS tokens alias them, and JS
 * reads the tokens rather than typing a millisecond. This is the read.
 *
 *     const t = useTokens(["--bd-dur-move", "--bd-ease"], rootRef.current);
 *     const move = { duration: secs(t["--bd-dur-move"].ms), ease: t["--bd-ease"].ease };
 *
 * WHY `useSyncExternalStore` AND NOT AN EFFECT. The cascade is external state: there is none on
 * the server and none during the first client render of a scoped wrapper, and mirroring it into
 * component state from an effect is a setState in an effect and a second render behind the
 * first. The snapshot is cached per element per name set, so it is referentially stable — which
 * is what this hook requires and what makes the record safe in a dependency array.
 *
 * WHAT IS RETURNED BEFORE THE SCOPE EXISTS. The documented defaults: `raw: ""`, `ms: 0`,
 * `ease: ""`. Zero lands on the final state, which is the branch reduced motion takes, and never
 * a second set of numbers. A partial read — some of the names answered, some not — is treated as
 * no read at all and is NOT cached, so the next render tries again; name only tokens the scope
 * you pass actually declares.
 *
 * The tokens do not change while the page is up, so there is nothing to subscribe to.
 */
import { useSyncExternalStore } from "react";

import { readTokens, styleOf, type TokenValue } from "./tokens";

type TokenRecord<N extends readonly string[]> = { readonly [K in N[number]]: TokenValue };

const stay = (): (() => void) => () => {};

/** Complete reads, per element, per name set. The values are static for the life of the page. */
const readCache = new WeakMap<Element, Map<string, Record<string, TokenValue>>>();
/** The all-defaults answer, per name set, so "not readable yet" is a stable object too. */
const blankCache = new Map<string, Record<string, TokenValue>>();

function blank(key: string, names: readonly string[]): Record<string, TokenValue> {
  const hit = blankCache.get(key);
  if (hit) return hit;
  const made = readTokens(names, null) as Record<string, TokenValue>;
  blankCache.set(key, made);
  return made;
}

function snapshot(
  key: string,
  names: readonly string[],
  el?: Element | null,
): Record<string, TokenValue> {
  const style = styleOf(el);
  const node = el ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!style || !node) return blank(key, names);
  const perElement = readCache.get(node) ?? new Map<string, Record<string, TokenValue>>();
  const hit = perElement.get(key);
  if (hit) return hit;
  const read = readTokens(names, style) as Record<string, TokenValue>;
  if (names.some((name) => read[name]?.raw === "")) return blank(key, names);
  perElement.set(key, read);
  readCache.set(node, perElement);
  return read;
}

export function useTokens<const N extends readonly string[]>(
  names: N,
  el?: Element | null,
): TokenRecord<N> {
  const key = names.join("|");
  return useSyncExternalStore(
    stay,
    () => snapshot(key, names, el),
    () => blank(key, names),
  ) as TokenRecord<N>;
}
