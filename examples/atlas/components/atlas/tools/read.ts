/**
 * What Atlas answers an agent, as pure functions.
 *
 * Pure and React-free on purpose: the projections are the part that can be WRONG — a bound that
 * does not announce itself, a detail that contradicts `read_view`, an id an agent cannot pass
 * back — and `test/tools.test.ts` pins all three under `node --test` without a DOM.
 *
 * THE BOUND. Every list goes through the kit's `bounded`, which is the one truncation envelope in
 * `examples/` (`{ showing, of, items }`). The kit's README advertises "plus a `(showing N of M)`
 * footer" but `bounded()` returns no such field, so the sentence is added here by `announce()`.
 * Logged as a kit gap (KIT-GAPS.md, 2026-09-14, #5) rather than worked around silently.
 */
import { bounded } from "@athena/demo-kit/webmcp";
import type { Focus } from "@athena/demo-kit/zoom";

import {
  ADRS,
  CONCEPTS,
  COUNTS,
  LAYERS,
  SYSTEMS,
  adrByN,
  componentById,
  componentsOf,
  componentsOfLayer,
  conceptById,
  edgesIn,
  edgesOut,
  layerById,
  layerLinks,
  lensFor,
  litIn,
  litInLayer,
  systemById,
  systemsOf,
  type Component,
  type ConceptKind,
} from "@/data";
import { READ_CAP } from "@/lib/constants";

import { VIEW_META, type ViewId } from "../canvas/plan";
import { GATE_STOP, TURN } from "../canvas/turn";

/** The one sentence AGENTS.md requires of any bounded output. */
export const announce = (showing: number, of: number): string => `(showing ${showing} of ${of})`;

/** A bounded list, with its bound stated in words as well as in numbers. */
export interface Announced<T> {
  showing: number;
  of: number;
  items: T[];
  footer: string;
}

export function announced<T, U>(
  all: readonly T[],
  project: (row: T) => U,
  cap: number = READ_CAP,
): Announced<U> {
  const cut = bounded(all, cap, project);
  return { ...cut, footer: announce(cut.showing, cut.of) };
}

/* ------------------------------------------------------------------ projections -- */

const conceptRow = (id: string) => {
  const c = conceptById(id);
  return c ? { id: c.id, part: c.part, kind: c.kind, name: c.name } : { id, part: "?", name: id };
};

const componentRow = (c: Component) => ({
  id: c.id,
  part: c.part,
  name: c.name,
  file: c.file,
  system: c.system,
  status: c.status,
  concepts: c.concepts,
});

/* --------------------------------------------------------------------- the reads -- */

export const CONCEPT_KINDS: readonly ConceptKind[] = ["invariant", "tier", "act", "decision"];

/**
 * The population at L0. `kind` narrows it; anything else is refused with the list of kinds rather
 * than quietly answering with all of them.
 */
export function conceptsRead(kind?: unknown) {
  const asked = kind === undefined || kind === null || kind === "" ? null : String(kind);
  if (asked !== null && !CONCEPT_KINDS.includes(asked as ConceptKind)) {
    return { ok: false as const, error: `No concept kind named ${asked}.`, available: [...CONCEPT_KINDS] };
  }
  const rows = asked === null ? CONCEPTS : CONCEPTS.filter((c) => c.kind === asked);
  return {
    ok: true as const,
    ...announced(rows, (c) => ({
      id: c.id,
      part: c.part,
      kind: c.kind,
      name: c.name,
      claim: c.claim,
      source: c.source,
      /* How many components carry it, so an agent can rank the claims without seventeen calls. */
      components: lensFor(c.id).components.size,
    })),
  };
}

/** One system, with every component in it. The ids come back ready for `open_item`. */
export function systemRead(id: unknown) {
  const wanted = String(id ?? "");
  const system = systemById(wanted);
  if (!system) {
    return {
      ok: false as const,
      error: `No system with id ${wanted}.`,
      available: SYSTEMS.map((s) => ({ id: s.id, name: s.name, layer: s.layer })),
    };
  }
  const layer = layerById(system.layer);
  return {
    ok: true as const,
    id: system.id,
    part: system.part,
    name: system.name,
    blurb: system.blurb,
    home: system.home,
    source: system.source,
    status: system.status,
    layer: layer ? { id: layer.id, name: layer.name, blurb: layer.blurb } : null,
    components: announced(componentsOf(system.id), componentRow),
  };
}

/** One component at full depth: what it enforces, both directions of its edges, its ADRs. */
export function componentRead(id: unknown) {
  const wanted = String(id ?? "");
  const component = componentById(wanted);
  if (!component) {
    return {
      ok: false as const,
      error: `No component with id ${wanted}.`,
      hint: "read_view lists every layer; read_system lists the components in one system.",
      available: announced(
        [...COMPONENT_IDS],
        (row) => row,
      ),
    };
  }
  const system = systemById(component.system);
  const layer = system ? layerById(system.layer) : undefined;
  const edge = (e: { from: string; to: string; kind: string; note: string }, other: string) => {
    const o = componentById(other);
    return {
      id: other,
      name: o?.name ?? other,
      part: o?.part ?? "?",
      system: o?.system ?? null,
      kind: e.kind,
      note: e.note,
    };
  };
  return {
    ok: true as const,
    id: component.id,
    part: component.part,
    name: component.name,
    enforces: component.enforces,
    file: component.file,
    status: component.status,
    system: system ? { id: system.id, name: system.name } : null,
    layer: layer ? { id: layer.id, name: layer.name } : null,
    concepts: component.concepts.map(conceptRow),
    called_by: announced(edgesIn(component.id), (e) => edge(e, e.from)),
    reaches: announced(edgesOut(component.id), (e) => edge(e, e.to)),
    adrs: component.adrs.map((n) => {
      const adr = adrByN(n);
      return { n, title: adr?.title ?? "unknown", file: adr?.file ?? "" };
    }),
  };
}

const COMPONENT_IDS: readonly string[] = LAYERS.flatMap((l) =>
  componentsOfLayer(l.id).map((c) => c.id),
);

/**
 * What a lens lights, at all three depths. Answers the read even when nothing changes, so an
 * agent can ask "what is marked" without setting anything.
 */
export function lensRead(conceptId: string | null) {
  const lens = lensFor(conceptId);
  if (!lens.concept) {
    return {
      ok: true as const,
      lens: null,
      note: "No lens is set. Pass a concept id to mark up the stack.",
      concepts: announced(CONCEPTS, (c) => ({ id: c.id, part: c.part, name: c.name })),
    };
  }
  return {
    ok: true as const,
    lens: {
      id: lens.concept.id,
      part: lens.concept.part,
      name: lens.concept.name,
      claim: lens.concept.claim,
      source: lens.concept.source,
    },
    layers: LAYERS.filter((l) => lens.layers.has(l.id)).map((l) => ({
      id: l.id,
      name: l.name,
      lit: litInLayer(lens, l.id),
      of: componentsOfLayer(l.id).length,
    })),
    systems: SYSTEMS.filter((s) => lens.systems.has(s.id)).map((s) => ({
      id: s.id,
      name: s.name,
      layer: s.layer,
      lit: litIn(lens, s.id),
    })),
    components: announced(
      COMPONENT_IDS.filter((id) => lens.components.has(id)).map((id) => componentById(id)!),
      componentRow,
    ),
  };
}

/**
 * What the current level actually shows — the figures a reader would see. For `read_view`.
 *
 * ROUND 4 CLOSES ROUND 2'S GAP 8. `useZoomTools` has exactly two tiers and Atlas's model has
 * three (layer → system → component), so `read_view` at L1 used to hand an agent sixty-eight flat
 * component ids with no hint that they were grouped. It now answers `systems`, each with its OWN
 * components nested inside it, bounded per system as well as in total — so one call tells an agent
 * the shape of the layer it is standing in and not just its contents.
 *
 * Every projection also carries the VIEW, because the same focus looks different in four
 * arrangements and an agent that cannot tell which one is on the sheet cannot describe what a
 * reader is seeing.
 */
export function viewDetail(focus: Focus, conceptId: string | null, view: ViewId) {
  const lens = lensFor(conceptId);
  const marked = lens.concept
    ? { id: lens.concept.id, part: lens.concept.part, name: lens.concept.name, components: lens.components.size }
    : null;
  const arrangement = {
    id: view,
    label: VIEW_META[view].label,
    shows: VIEW_META[view].note,
    runs: VIEW_META[view].runs,
  };

  if (focus.level === 2) {
    return { view: arrangement, lens: marked, component: componentRead(focus.item) };
  }
  if (focus.level === 1) {
    const layer = layerById(focus.group);
    if (!layer) return { view: arrangement, lens: marked, error: `No layer ${focus.group}.` };
    return {
      view: arrangement,
      lens: marked,
      layer: { id: layer.id, name: layer.name, blurb: layer.blurb, source: layer.source },
      edges: layerLinks(layer.id),
      /* The middle tier, nested. This is the structure the flat list never had. */
      systems: systemsOf(layer.id).map((s) => ({
        id: s.id,
        part: s.part,
        name: s.name,
        blurb: s.blurb,
        home: s.home,
        status: s.status,
        lit: litIn(lens, s.id),
        components: announced(componentsOf(s.id), componentRow),
      })),
      components: announced(componentsOfLayer(layer.id), componentRow),
    };
  }
  return {
    view: arrangement,
    lens: marked,
    counts: COUNTS,
    adrs: ADRS.length,
    concepts: announced(CONCEPTS, (c) => ({ id: c.id, part: c.part, kind: c.kind, name: c.name })),
    stack: LAYERS.map((l) => ({
      id: l.id,
      name: l.name,
      blurb: l.blurb,
      systems: systemsOf(l.id).length,
      components: componentsOfLayer(l.id).length,
      lit: litInLayer(lens, l.id),
    })),
  };
}

/* ---------------------------------------- the turn ---------------------------------------- */

/**
 * The turn, as an agent reads it: every stop in order, the module it happens in, the one label
 * the scene shows there, and the README section it was read from.
 *
 * Bounded like everything else — the whole turn is twelve stops, comfortably under the cap, and
 * the announcement is still made, because "every truncated block announces (showing N of M)" is
 * an invariant of this repository (README §2, #4) and an invariant that only fires when it is
 * needed is an invariant nobody has tested.
 */
export function turnRead(at: number) {
  return {
    ...announced(TURN, (s) => ({
      stop: s.index + 1,
      label: s.label,
      kind: s.kind,
      component: s.part,
      system: s.block,
      layer: s.layer,
      file: componentById(s.part)?.file ?? null,
      source: s.cite,
      waitsHere: s.kind === "wait",
      revisit: s.revisit,
    })),
    at: at + 1,
    of: TURN.length,
    here: TURN[at]?.label ?? null,
    gate: GATE_STOP + 1,
    note: "The path is drawn all at once in the turn view; the step control lights one stop at a time. The turn WAITS at the gate until a decision resolves it. set_turn moves the step; set_view('turn') puts the path on the sheet.",
  };
}
