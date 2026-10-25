/**
 * WALK THE LENS: A CLAIM IS STEPPED THROUGH ITS CARRIERS, AND A LIT PART SAYS WHY IT IS LIT.
 *
 * A lens used to be a count and a glow. The mast printed "19 of 68" and offered only "clear", so a
 * reader who wanted the nineteen had to hunt the sheet for them. Worse, the lanes drawing lights a
 * node when ANY of the systems it stands for holds a carrier (`archify-lanes/Drawing.tsx`,
 * `intentOf`), so a reader could open a lit node and be shown a pane whose "Claims it carries" did
 * not include the lens at all: for seven of the seventeen claims, none of the nodes that light
 * carry the claim themselves. The drawing made a claim the pane then contradicted, silently.
 *
 * This module reconciles them, from the sets `lensFor` already computes and nothing else:
 *
 *   carriersOf    the lens's carriers in MODEL order (layer, then system, then component) - the
 *                 order README section 3.1 prints the stack, and the order `read_lens` lists them.
 *   stepCarrier   one step of the walk, wrapping at both ends; from a part that does not carry the
 *                 claim it goes to the first carrier AFTER that part, so Next from where the reader
 *                 stands never throws them back to the top of the model.
 *   whyLit        whether a part carries the claim, or which systems drawn with it hold carriers.
 *   stepLensRead  the same step, as the answer `step_lens` gives an agent.
 *
 * Pure and React-free, so `test/evidence.test.ts` pins it under `node --test`. The mast's stepper,
 * the pane's "Under this lens" block, `step_lens` and `read_view`'s `lens.at` / `lens.why` all
 * read these functions, so the four cannot disagree about where a reader is in the walk.
 */
import {
  LAYERS,
  componentById,
  componentsOf,
  systemById,
  systemsOf,
  type Lens,
} from "@/data";

import { NODES } from "../variants/archify-lanes/workflow";
import { LANES_LEVELS, type LevelMap } from "../variants/levels";

/** Every component id in model order. The walk's one ordering. */
const MODEL_ORDER: readonly string[] = LAYERS.flatMap((l) =>
  systemsOf(l.id).flatMap((s) => componentsOf(s.id).map((c) => c.id)),
);
const POSITION: ReadonlyMap<string, number> = new Map(MODEL_ORDER.map((id, i) => [id, i]));

const CARRIERS = new WeakMap<Lens, readonly string[]>();

/** The lens's carriers, in model order. Empty when no lens is set. */
export function carriersOf(lens: Lens): readonly string[] {
  if (!lens.concept) return [];
  const hit = CARRIERS.get(lens);
  if (hit) return hit;
  const out = MODEL_ORDER.filter((id) => lens.components.has(id));
  CARRIERS.set(lens, out);
  return out;
}

/** One stop of the walk: the carrier, and where it sits in it (1-based). */
export interface CarrierStop {
  id: string;
  index: number;
  of: number;
}

/** Where a component sits in the walk, or null if it does not carry the claim. */
export function carrierAt(lens: Lens, id: string | null): { index: number; of: number } | null {
  if (id === null) return null;
  const carriers = carriersOf(lens);
  const i = carriers.indexOf(id);
  return i < 0 ? null : { index: i + 1, of: carriers.length };
}

/**
 * One step of the walk from `current` (+1 next, -1 previous). Null when the lens has no carriers.
 *
 * From nothing open, Next is the first carrier and Previous the last. From a carrier, the
 * neighbour, wrapping. From a part that does not carry the claim, the nearest carrier after it
 * (or before it) in model order, wrapping - the reader keeps their place.
 */
export function stepCarrier(lens: Lens, current: string | null, dir: 1 | -1): CarrierStop | null {
  const carriers = carriersOf(lens);
  const of = carriers.length;
  if (of === 0) return null;
  const stop = (i: number): CarrierStop => ({ id: carriers[i]!, index: i + 1, of });

  const here = current === null ? -1 : carriers.indexOf(current);
  if (here >= 0) return stop((here + dir + of) % of);

  const pos = current === null ? undefined : POSITION.get(current);
  if (pos === undefined) return stop(dir === 1 ? 0 : of - 1);
  if (dir === 1) {
    const i = carriers.findIndex((id) => (POSITION.get(id) ?? -1) > pos);
    return stop(i < 0 ? 0 : i);
  }
  for (let i = of - 1; i >= 0; i--) {
    if ((POSITION.get(carriers[i]!) ?? Infinity) < pos) return stop(i);
  }
  return stop(of - 1);
}

/**
 * The systems the mounted drawing draws a component with - the set its lens glow is computed over.
 *
 * The lanes drawing merges systems into nodes and lights a node when any of them holds a carrier,
 * so a node's item is drawn with every system of that node. Any other drawing (the data model's
 * own layers) draws a component in its own system alone.
 */
export function systemsDrawnWith(levels: LevelMap, id: string): readonly string[] {
  const own = componentById(id)?.system;
  if (levels === LANES_LEVELS) {
    const node = NODES.find((n) => n.item === id);
    if (node) return own && !node.systems.includes(own) ? [own, ...node.systems] : node.systems;
  }
  return own ? [own] : [];
}

/** Why a part is lit: it carries the claim, or these systems drawn with it hold carriers. */
export type WhyLit =
  | { carries: true }
  | { carries: false; via: { system: string; name: string; carriers: string[] }[] };

/**
 * Whether `id` carries the lens's claim, and if not, which of the systems drawn with it hold
 * carriers (and which). An empty `via` means nothing drawn with it is lit.
 */
export function whyLit(lens: Lens, id: string, drawnWith?: readonly string[]): WhyLit {
  if (lens.components.has(id)) return { carries: true };
  const own = componentById(id)?.system;
  const systems = drawnWith ?? (own ? [own] : []);
  const via = [...new Set(systems)]
    .filter((s) => lens.systems.has(s))
    .map((s) => ({
      system: s,
      name: systemById(s)?.name ?? s,
      carriers: componentsOf(s)
        .map((c) => c.id)
        .filter((c) => lens.components.has(c)),
    }))
    .filter((v) => v.carriers.length > 0);
  return { carries: false, via };
}

/** `step_lens`'s directions. */
export const STEP_DIRECTIONS = ["next", "prev"] as const;
export type StepDirection = (typeof STEP_DIRECTIONS)[number];

/**
 * What `step_lens` answers: the carrier the handler LEAVES open - never the part open before the
 * call - or a refusal that names `set_lens` as the way in.
 */
export function stepLensRead(lens: Lens, current: string | null, direction: StepDirection = "next") {
  const stop = stepCarrier(lens, current, direction === "prev" ? -1 : 1);
  if (!lens.concept || !stop) {
    return {
      ok: false as const,
      error: "No lens is set, so there are no carriers to step through.",
      hint: "Call set_lens with a concept id from read_concepts, then step_lens walks its carriers.",
    };
  }
  const c = componentById(stop.id);
  return {
    ok: true as const,
    lens: { id: lens.concept.id, part: lens.concept.part, name: lens.concept.name },
    opened: {
      id: stop.id,
      part: c?.part ?? "?",
      name: c?.name ?? stop.id,
      system: c?.system ?? null,
      index: stop.index,
      of: stop.of,
    },
  };
}
