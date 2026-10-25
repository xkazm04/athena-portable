/**
 * Where you were in each place — README section 3.1, ADR 0087 and 0193.
 *
 * The window keeps no history (`depth/store.ts`): Rise, Escape, a crumb and the brand are the only
 * ways back, so they carry the promise a back button would. When a move leaves a place, the stage
 * hands its layer here and this remembers how far each scroller in it was scrolled and which
 * element had focus. When an up move arrives at a place it remembers, the scroll and the focus come
 * back; a dive or an across move starts the place fresh, as it always did.
 *
 * Restoring is careful about two things. A scene often draws short and grows as its data lands, so
 * an offset the content cannot hold yet is retried as it grows (a `ResizeObserver`, for a bounded
 * while) instead of being clamped to nothing. And the person wins: a wheel, a key or a pointer on
 * the way back abandons whatever is left to restore, so a late restore never snaps the view away
 * from where they have since scrolled.
 *
 * Not first-frame code. The stage fetches this module (and the still it re-exports, ADR 0193) once
 * it has drawn.
 */
import { formatHash, type DepthState, type Path } from "@/depth/model";

/** The still of a leaving layer (ADR 0193), under the short names the first-frame stage calls. */
export { captureStill as capture, showStill as show } from "./still";

/** Places remembered. A person moves among a handful; the oldest beyond this are forgotten. */
export const KEEP = 24;

/** Give up on an offset the content has not grown tall enough to hold after this. */
const RETRY_MS = 2000;

/** An element found again by where it sat (child indexes from the layer) and what it said. */
export interface Locator {
  at: number[];
  tag: string;
  text: string;
}

export interface Place {
  /** Each scroller that was scrolled, by where it sat, and its offset. */
  scrolls: [number[], number][];
  focus: Locator | null;
}

/** A bounded memory, most recently used last. Reading a place refreshes it. Pure: no DOM. */
export function createPlaces(keep = KEEP) {
  const map = new Map<string, Place>();
  return {
    put(key: string, place: Place) {
      map.delete(key);
      map.set(key, place);
      while (map.size > keep) map.delete(map.keys().next().value!);
    },
    get(key: string): Place | undefined {
      const place = map.get(key);
      if (place) {
        map.delete(key);
        map.set(key, place);
      }
      return place;
    },
    keys: () => [...map.keys()],
  };
}

/** The stage's one memory, for the life of the window. */
export const places = createPlaces();

function indexPath(root: Element, el: Element): number[] {
  const at: number[] = [];
  for (let e = el; e !== root && e.parentElement; e = e.parentElement) {
    at.unshift([...e.parentElement.children].indexOf(e));
  }
  return at;
}

function walk(root: Element, at: number[]): Element | null {
  let e: Element | undefined = root;
  for (const i of at) e = e?.children[i];
  return e ?? null;
}

const textOf = (el: Element) => (el.textContent ?? "").trim().slice(0, 200);

function find(root: Element, loc: Locator): HTMLElement | null {
  const same = (e: Element | null): e is HTMLElement =>
    e instanceof HTMLElement && e.tagName === loc.tag && textOf(e) === loc.text;
  const there = walk(root, loc.at);
  if (same(there)) return there;
  // The scene drew something above it this time: the same element, by what it says.
  return [...root.querySelectorAll(loc.tag)].find(same) ?? null;
}

/** What a place looks like as it is left. `section` is its layer, still in the document. */
export function readPlace(section: Element): Place {
  const scrolls: Place["scrolls"] = [];
  for (const el of section.querySelectorAll("*")) {
    if (el.scrollTop > 0) scrolls.push([indexPath(section, el), el.scrollTop]);
  }
  const active = document.activeElement;
  const focus =
    active && active !== section && section.contains(active)
      ? { at: indexPath(section, active), tag: active.tagName, text: textOf(active) }
      : null;
  return { scrolls, focus };
}

/**
 * Remember the place a move is leaving: the top of `layers`, drawn in `section`. The stage calls it
 * as it derives the move, before React has touched the DOM, so a calm move (whose layer is simply
 * replaced) is remembered as surely as one that plays a still.
 */
export function record(section: HTMLElement | null, layers: { path: Path }[]) {
  const top = layers[layers.length - 1];
  if (section?.isConnected && top) places.put(formatHash(top.path), readPlace(section));
}

/**
 * The arriving layer is drawn: put the person where they were if this is an up move to a place
 * left before, and otherwise focus the layer. Returns a function that stops any restore still
 * waiting on the content to grow.
 */
export function land(section: HTMLElement | null, state: Pick<DepthState, "path" | "move">): () => void {
  if (!section) return () => {};
  const place = state.move === "up" ? places.get(formatHash(state.path)) : undefined;
  const target = (place?.focus && find(section, place.focus)) || section;
  target.focus({ preventScroll: true });
  return place ? restoreScroll(section, place.scrolls) : () => {};
}

/** Apply each offset once its scroller can hold it; give up on the person's own move or in time. */
export function restoreScroll(section: Element, scrolls: Place["scrolls"]): () => void {
  let pending = scrolls.flatMap(([at, top]) => {
    const el = walk(section, at);
    return el ? [{ el, top }] : [];
  });
  const apply = () => {
    pending = pending.filter(({ el, top }) => {
      if (el.scrollHeight - el.clientHeight < top) return true;
      el.scrollTop = top;
      return false;
    });
    if (pending.length === 0) stop();
  };
  const Observer = globalThis.ResizeObserver;
  const watch = Observer
    ? new Observer(() => {
        apply();
        observe();
      })
    : null;
  const observe = () => {
    for (const { el } of pending) for (const e of [el, ...el.children]) watch?.observe(e);
  };
  const quit = ["wheel", "keydown", "pointerdown", "touchmove"] as const;
  const timer = setTimeout(() => stop(), RETRY_MS);
  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    watch?.disconnect();
    for (const t of quit) window.removeEventListener(t, stop, true);
  }
  for (const t of quit) window.addEventListener(t, stop, true);
  apply();
  if (!stopped) {
    if (watch) observe();
    else stop();
  }
  return stop;
}
