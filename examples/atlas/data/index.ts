/**
 * The model, assembled, plus every derivation the surface and the tools read.
 *
 * PURE, AND NO REACT. Everything here is a lookup or a fold over the five data modules, so
 * `test/model.test.ts` can pin the model's integrity and `test/lens.test.ts` the lens's arithmetic
 * under `node --test` without a DOM. The components render this; they never re-derive it.
 *
 * THE LENS is the app's one idea and it is computed in exactly one place (`lensFor`). A concept
 * names the components that carry it; those components name their systems; those systems name
 * their layers. Nothing downstream is allowed to widen or narrow that set — the plate, the stack,
 * the L1 columns and the `set_lens` tool all read the same three sets, which is the only way the
 * mark on a band and the mark on a row can be guaranteed to mean the same thing.
 */
import { ADRS } from "./adrs";
import { COMPONENTS } from "./components";
import { CONCEPTS } from "./concepts";
import { EDGES } from "./edges";
import { LAYERS, SYSTEMS } from "./systems";
import type { Adr, Component, Concept, Edge, Layer, LayerId, System } from "./types";

export * from "./types";
export { ADRS, COMPONENTS, CONCEPTS, EDGES, LAYERS, SYSTEMS };

const index = <T extends { id: string }>(rows: readonly T[]): ReadonlyMap<string, T> =>
  new Map(rows.map((r) => [r.id, r]));

export const CONCEPT_BY_ID = index(CONCEPTS);
export const LAYER_BY_ID: ReadonlyMap<string, Layer> = new Map(LAYERS.map((l) => [l.id, l]));
export const SYSTEM_BY_ID = index(SYSTEMS);
export const COMPONENT_BY_ID = index(COMPONENTS);
export const ADR_BY_N: ReadonlyMap<number, Adr> = new Map(ADRS.map((a) => [a.n, a]));

/** Layer order, top of the stack first — the order README §3.1 prints them. */
export const LAYER_ORDER: readonly LayerId[] = LAYERS.map((l) => l.id);

export const conceptById = (id: string | null): Concept | undefined =>
  id === null ? undefined : CONCEPT_BY_ID.get(id);
export const layerById = (id: string | null): Layer | undefined =>
  id === null ? undefined : LAYER_BY_ID.get(id);
export const systemById = (id: string | null): System | undefined =>
  id === null ? undefined : SYSTEM_BY_ID.get(id);
export const componentById = (id: string | null): Component | undefined =>
  id === null ? undefined : COMPONENT_BY_ID.get(id);
export const adrByN = (n: number): Adr | undefined => ADR_BY_N.get(n);

const group = <T>(rows: readonly T[], key: (row: T) => string): ReadonlyMap<string, T[]> => {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
};

const SYSTEMS_BY_LAYER = group(SYSTEMS, (s) => s.layer);
const COMPONENTS_BY_SYSTEM = group(COMPONENTS, (c) => c.system);

export const systemsOf = (layer: string): System[] => SYSTEMS_BY_LAYER.get(layer) ?? [];
export const componentsOf = (system: string): Component[] => COMPONENTS_BY_SYSTEM.get(system) ?? [];

/** Every component in a layer, in system order then part order. */
export const componentsOfLayer = (layer: string): Component[] =>
  systemsOf(layer).flatMap((s) => componentsOf(s.id));

/** The layer a component sits in, through its system. `undefined` only if the model is broken. */
export const layerOfComponent = (component: Component): Layer | undefined =>
  layerById(systemById(component.system)?.layer ?? null);

/* ------------------------------------- the lens -------------------------------------- */

/** What a concept lights, at all three depths. Empty sets when nothing is chosen. */
export interface Lens {
  concept: Concept | null;
  components: ReadonlySet<string>;
  systems: ReadonlySet<string>;
  layers: ReadonlySet<string>;
}

export const NO_LENS: Lens = {
  concept: null,
  components: new Set<string>(),
  systems: new Set<string>(),
  layers: new Set<string>(),
};

const LENS_CACHE = new Map<string, Lens>();

/**
 * The one derivation. A concept names components; components name systems; systems name layers.
 *
 * Memoised because it is read on every render of every cell, and because the identity of the sets
 * is what lets `nav.highlight` be given a stable array.
 */
export function lensFor(conceptId: string | null): Lens {
  if (conceptId === null) return NO_LENS;
  const hit = LENS_CACHE.get(conceptId);
  if (hit) return hit;
  const concept = CONCEPT_BY_ID.get(conceptId);
  if (!concept) return NO_LENS;

  const components = new Set<string>();
  const systems = new Set<string>();
  const layers = new Set<string>();
  for (const c of COMPONENTS) {
    if (!c.concepts.includes(conceptId)) continue;
    components.add(c.id);
    systems.add(c.system);
    const layer = systemById(c.system)?.layer;
    if (layer) layers.add(layer);
  }
  const lens: Lens = { concept, components, systems, layers };
  LENS_CACHE.set(conceptId, lens);
  return lens;
}

/** How many of a system's components the lens lights. Drawn as the tick on a band and a column. */
export const litIn = (lens: Lens, system: string): number =>
  componentsOf(system).reduce((n, c) => n + (lens.components.has(c.id) ? 1 : 0), 0);

/** The same, for a whole layer — the figure the L0 stack prints on each band. */
export const litInLayer = (lens: Lens, layer: string): number =>
  systemsOf(layer).reduce((n, s) => n + litIn(lens, s.id), 0);

/**
 * The ids `nav.highlight` is given: components AND systems AND layers, in one flat array.
 *
 * All three go in because the kit's highlight set is the model's own answer to "what is something
 * pointing at", and at L0 the thing pointed at is a layer, at L1 a system, at L2 a component. One
 * array, read at three depths — which is the same trick `emphasis()` plays with focus.
 */
export const highlightIds = (lens: Lens): string[] => [
  ...lens.layers,
  ...lens.systems,
  ...lens.components,
];

/* -------------------------------------- edges ---------------------------------------- */

const OUT_BY_COMPONENT = group(EDGES, (e) => e.from);
const IN_BY_COMPONENT = group(EDGES, (e) => e.to);

export const edgesOut = (component: string): Edge[] => OUT_BY_COMPONENT.get(component) ?? [];
export const edgesIn = (component: string): Edge[] => IN_BY_COMPONENT.get(component) ?? [];

/** One derived edge between two systems, with the component edges that make it. */
export interface SystemEdge {
  from: string;
  to: string;
  /** How many component edges cross this way. */
  weight: number;
}

function deriveSystemEdges(): SystemEdge[] {
  const seen = new Map<string, SystemEdge>();
  for (const e of EDGES) {
    const from = componentById(e.from)?.system;
    const to = componentById(e.to)?.system;
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}`;
    const hit = seen.get(key);
    if (hit) hit.weight += 1;
    else seen.set(key, { from, to, weight: 1 });
  }
  return [...seen.values()];
}

export const SYSTEM_EDGES: readonly SystemEdge[] = deriveSystemEdges();

/**
 * What a layer connects to, split by which way the stack it runs.
 *
 * `down` is toward contracts (a dependency), `up` is back toward surfaces. The margin rails at L1
 * draw `up` on the left and `down` on the right, so an edge running the wrong way up the stack is
 * visible as a tick on the wrong side rather than as a line nobody traces.
 */
export interface LayerLink {
  layer: LayerId;
  weight: number;
}

export function layerLinks(layer: string): { up: LayerLink[]; down: LayerLink[] } {
  const depth = (id: string): number => LAYER_ORDER.indexOf(id as LayerId);
  const here = depth(layer);
  const tally = new Map<LayerId, number>();
  for (const e of EDGES) {
    const from = componentById(e.from);
    const to = componentById(e.to);
    if (!from || !to) continue;
    const fromLayer = systemById(from.system)?.layer;
    const toLayer = systemById(to.system)?.layer;
    if (fromLayer !== layer || !toLayer || toLayer === layer) continue;
    tally.set(toLayer, (tally.get(toLayer) ?? 0) + 1);
  }
  const links = [...tally].map(([id, weight]) => ({ layer: id, weight }));
  return {
    up: links.filter((l) => depth(l.layer) < here).sort((a, b) => b.weight - a.weight),
    down: links.filter((l) => depth(l.layer) > here).sort((a, b) => b.weight - a.weight),
  };
}

/* -------------------------------------- counts --------------------------------------- */

export interface ModelCounts {
  concepts: number;
  layers: number;
  systems: number;
  components: number;
  edges: number;
  adrs: number;
  planned: number;
}

export const COUNTS: ModelCounts = {
  concepts: CONCEPTS.length,
  layers: LAYERS.length,
  systems: SYSTEMS.length,
  components: COMPONENTS.length,
  edges: EDGES.length,
  adrs: ADRS.length,
  planned: COMPONENTS.filter((c) => c.status !== "built").length,
};
