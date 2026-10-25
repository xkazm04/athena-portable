/**
 * Every place the finder can go, and how a few typed letters rank them — README section 3.5,
 * ADR 0087.
 *
 * The corpus is built from what exists, never kept by hand: every root, the fixed items the
 * depth grammar itself offers (`itemsOf`, so a new Mind item is findable with no edit here), the
 * Chores front door, Athena's core, and the projects, apps, chores and accounts the stores hold
 * (a project by its name, ADR 0225; core is always there, so it is findable before the list has
 * answered and when it could not be read). Each place carries its
 * breadcrumb trail from `crumbs`, so the finder speaks the bar's words. A place the grammar refuses
 * is dropped here, and the reducer would ignore it anyway, so no hit can lead somewhere the stage
 * cannot draw.
 *
 * Ranking is banded: the name starts with the query, then each piece of the query starts a word in
 * order ("mdev" for Mind > Devices), then the query sits inside the trail, then its letters do in
 * order within a short span (the floor: three letters do not match everything). Ties go to the place
 * visited most recently, then to the path's hash, so the order is the same on every run. Pure: no
 * store, no DOM. A lazy chunk with the finder; the first frame never carries it.
 */
import {
  ROOTS,
  crumbs,
  formatHash,
  isValid,
  itemsOf,
  samePath,
  type Labeller,
  type Path,
} from "@/depth/model";
import { CORE_ITEM } from "@/lib/spaces";
import { NEW_ITEM } from "@/scenes/chores/model";

export interface PlaceSources {
  /** The person's projects (spaces): `id` is the `spc_…` item under `projects`. */
  projects: readonly { id: string; name: string }[];
  apps: readonly { item: string; label: string }[];
  chores: readonly { id: string; title: string }[];
  accounts: readonly { id: string; label: string }[];
}

export interface Place {
  path: Path;
  /** The breadcrumb's words below the surface: `["Chores", "Invoice chase"]`. */
  trail: readonly string[];
  /** The trail as one line: `Chores > Invoice chase`. */
  crumb: string;
}

/** The corpus. `label` is the console's labeller, for the names the scenes know (Mind's words). */
export function placesOf(sources: PlaceSources, label?: Labeller): Place[] {
  const own = new Map<string, string>();
  const paths: Path[] = [];
  const add = (path: Path, name?: string) => {
    if (!isValid(path)) return;
    if (name !== undefined) own.set(formatHash(path), name);
    paths.push(path);
  };
  for (const root of ROOTS) add({ root });
  for (const root of ROOTS) for (const item of itemsOf(root)) add({ root, item });
  add({ root: "chores", item: NEW_ITEM }, "New chore");
  add({ root: "projects", item: CORE_ITEM }, "Core");
  for (const p of sources.projects) {
    if (p.id !== CORE_ITEM) add({ root: "projects", item: p.id }, p.name || "Untitled project");
  }
  for (const a of sources.apps) add({ root: "apps", item: a.item }, a.label);
  for (const c of sources.chores) if (c.id !== NEW_ITEM) add({ root: "chores", item: c.id }, c.title);
  for (const a of sources.accounts) add({ root: "accounts", item: a.id }, a.label);

  const name: Labeller = (p) => own.get(formatHash(p)) ?? label?.(p);
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const path of paths) {
    const key = formatHash(path);
    if (seen.has(key)) continue;
    seen.add(key);
    const trail = crumbs(path, name)
      .slice(1)
      .map((c) => c.label);
    out.push({ path, trail, crumb: trail.join(" > ") });
  }
  return out;
}

const WORD = /[\s\-_./>]+/;

/** Does `q` split into pieces that each start a word of `words`, in order? */
function startsWords(q: string, words: readonly string[], from: number): boolean {
  if (q === "") return true;
  for (let w = from; w < words.length; w++) {
    const word = words[w]!;
    for (let k = Math.min(q.length, word.length); k > 0; k--) {
      if (word.startsWith(q.slice(0, k)) && startsWords(q.slice(k), words, w + 1)) return true;
    }
  }
  return false;
}

/** The letters of `q` in order within `text`, inside a span the floor allows; its start, or -1. */
function gapped(q: string, text: string): number {
  for (let start = text.indexOf(q[0]!); start !== -1; start = text.indexOf(q[0]!, start + 1)) {
    let at = start;
    let ok = true;
    for (let i = 1; i < q.length && ok; i++) {
      at = text.indexOf(q[i]!, at + 1);
      ok = at !== -1 && at - start < q.length * 3;
    }
    if (ok) return start;
  }
  return -1;
}

/** A place's score for a query: higher is better, 0 is no match. */
export function score(query: string, place: Place): number {
  const q = query.trim().toLowerCase();
  if (q === "") return 0;
  const text = place.trail.join(" ").toLowerCase();
  const leaf = (place.trail.at(-1) ?? "").toLowerCase();
  if (leaf.startsWith(q)) return 4000;
  const bare = q.replace(/\s+/g, "");
  if (startsWords(bare, text.split(WORD).filter(Boolean), 0)) return 3000;
  const inside = text.indexOf(q);
  if (inside !== -1) return 2000 - Math.min(inside, 999);
  if (bare.length < 2) return 0;
  const spread = gapped(bare, text);
  return spread === -1 ? 0 : 1000 - Math.min(spread, 999);
}

export interface RankContext {
  /** Places visited, most recent first. */
  recent?: readonly Path[];
  /** Where the window is now: never offered, going there is no move. */
  here?: Path;
}

/**
 * The places a query finds, best first. With no query, the recent places (the "switch back"
 * gesture) and then the roots.
 */
export function rank(query: string, places: readonly Place[], ctx: RankContext = {}): Place[] {
  const recent = ctx.recent ?? [];
  const away = (p: Place) => ctx.here === undefined || !samePath(p.path, ctx.here);
  const recency = (p: Place) => {
    const i = recent.findIndex((r) => samePath(r, p.path));
    return i === -1 ? recent.length : i;
  };

  if (query.trim() === "") {
    const out: Place[] = [];
    for (const r of recent) {
      const p = places.find((x) => samePath(x.path, r));
      if (p && away(p) && !out.includes(p)) out.push(p);
    }
    for (const p of places) if (p.path.item === undefined && away(p) && !out.includes(p)) out.push(p);
    return out;
  }

  return places
    .filter(away)
    .map((p) => ({ p, s: score(query, p), r: recency(p), h: formatHash(p.path) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.r - b.r || (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
    .map((x) => x.p);
}
