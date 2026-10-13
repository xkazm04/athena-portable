/**
 * Pure helpers for the dev inspector — README section 3.1, ADR 0086.
 *
 * The DOM walk and the call-site rule live here so they are unit-testable without a DOM. They are
 * only meaningful in a session where `scripts/dev-source-loc.mjs` stamped `data-loc`.
 */

export interface LocEntry {
  /** The element carrying the stamp. */
  el: Element;
  /** `src/.../File.tsx:88`, the form pasted into a terminal. */
  loc: string;
  /** `src/.../File.tsx`. */
  path: string;
  line: number;
}

/** Reusable internals: skipped for the default copy, reachable with Alt. */
const LIBRARY_PREFIXES = ["src/components/", "src/lib/", "src/stores/"];

export function isLibraryPath(path: string): boolean {
  return LIBRARY_PREFIXES.some((p) => path.startsWith(p));
}

export function parseLoc(raw: string): Omit<LocEntry, "el"> | null {
  const m = /^(.*):(\d+):(\d+)$/.exec(raw);
  if (!m || !m[1] || !m[2]) return null;
  return { path: m[1], line: Number(m[2]), loc: `${m[1]}:${m[2]}` };
}

/** The `[data-loc]` ancestors of `start`, innermost first. */
export function buildChain(start: Element | null): LocEntry[] {
  const out: LocEntry[] = [];
  let el = start?.closest("[data-loc]") ?? null;
  while (el) {
    const parsed = parseLoc(el.getAttribute("data-loc") ?? "");
    if (parsed) out.push({ el, ...parsed });
    el = el.parentElement?.closest("[data-loc]") ?? null;
  }
  return out;
}

/** The call site: the first file outside the library folders, else the innermost element. */
export function pickDefaultIndex(chain: LocEntry[]): number {
  const i = chain.findIndex((c) => !isLibraryPath(c.path));
  return i === -1 ? 0 : i;
}

/** Collapse neighbours that resolve to the same `path:line`. */
export function dedupeChain(chain: LocEntry[]): LocEntry[] {
  return chain.filter((c, i) => i === 0 || c.loc !== chain[i - 1]?.loc);
}

/** True while the user is typing: the `;` `i` chord must not steal those keys. */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}
