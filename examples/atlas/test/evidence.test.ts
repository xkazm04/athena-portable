/**
 * WALK THE LENS - a claim is stepped through carrier by carrier, and a lit part says why it is lit.
 *
 * A lens used to be a count and a glow: the mast printed "19 of 68" and the lanes drawing lit a
 * node whenever ANY of its systems held a carrier, so a reader could open a lit node whose pane
 * did not list the claim at all. These cases pin the pure walk (`chrome/evidence.ts`), the tool
 * read an agent gets for it, the `lens.at` / `lens.why` block `read_view` carries at L2, and that
 * the mast and the pane draw no stepper while no lens is set.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { CONCEPTS, LAYERS, NO_LENS, componentById, componentsOf, lensFor, systemsOf } from "../data";
import {
  carriersOf,
  stepCarrier,
  stepLensRead,
  systemsDrawnWith,
  whyLit,
} from "../components/atlas/chrome/evidence";
import { lensRead, viewDetail } from "../components/atlas/tools/read";
import { DATA_LEVELS, LANES_LEVELS } from "../components/atlas/variants/levels";
import { NODES } from "../components/atlas/variants/archify-lanes/workflow";

/** Every component id in model order: layer, then system, then component. */
const MODEL_ORDER: string[] = LAYERS.flatMap((l) =>
  systemsOf(l.id).flatMap((s) => componentsOf(s.id).map((c) => c.id)),
);

const GATE = lensFor("inv-gate");
const DISK = lensFor("inv-disk");

/* Case 1 */
test("case 1: carriersOf lists a lens's carriers in model order, and nothing without a lens", () => {
  const carriers = carriersOf(GATE);
  assert.equal(carriers.length, 19);
  for (const id of carriers) assert.ok(GATE.components.has(id), `${id} does not carry inv-gate`);
  const expected = MODEL_ORDER.filter((id) => GATE.components.has(id));
  assert.deepEqual(carriers, expected);
  assert.deepEqual(carriersOf(NO_LENS), []);
});

/* Case 2 */
test("case 2: stepCarrier starts at the first carrier and wraps both ways", () => {
  const carriers = carriersOf(GATE);
  const first = stepCarrier(GATE, null, 1);
  assert.deepEqual(first, { id: carriers[0], index: 1, of: 19 });
  const last = carriers[carriers.length - 1]!;
  assert.deepEqual(stepCarrier(GATE, last, 1), { id: carriers[0], index: 1, of: 19 });
  assert.deepEqual(stepCarrier(GATE, carriers[0]!, -1), { id: last, index: 19, of: 19 });
  assert.deepEqual(stepCarrier(GATE, carriers[3]!, 1), { id: carriers[4], index: 5, of: 19 });
  assert.equal(stepCarrier(NO_LENS, null, 1), null);
});

/* Case 3 */
test("case 3: stepping from a non-carrier goes to the first carrier after it in model order", () => {
  const carriers = carriersOf(GATE);
  /* A non-carrier that sits between two carriers in model order. */
  const firstAt = MODEL_ORDER.indexOf(carriers[0]!);
  const between = MODEL_ORDER.find((id, i) => i > firstAt && !GATE.components.has(id))!;
  assert.ok(between, "no non-carrier after the first carrier");
  const after = MODEL_ORDER.slice(MODEL_ORDER.indexOf(between) + 1).find((id) => GATE.components.has(id))!;
  const before = MODEL_ORDER.slice(0, MODEL_ORDER.indexOf(between)).reverse().find((id) => GATE.components.has(id))!;
  const next = stepCarrier(GATE, between, 1);
  assert.equal(next?.id, after);
  assert.notEqual(next?.id, carriers[0], "it restarted from the top of the model");
  assert.equal(next?.index, carriers.indexOf(after) + 1);
  assert.equal(stepCarrier(GATE, between, -1)?.id, before);
});

/* Case 4 */
test("case 4: whyLit names the systems whose carriers lit a part, and says a carrier carries", () => {
  /* The connectors node is lit under inv-disk; its component does not carry the claim. */
  const node = NODES.find((n) => n.id === "connectors")!;
  assert.ok(node.systems.some((s) => DISK.systems.has(s)), "the connectors node is no longer lit");
  assert.equal(DISK.components.has(node.item), false);
  const why = whyLit(DISK, node.item, systemsDrawnWith(LANES_LEVELS, node.item));
  assert.equal(why.carries, false);
  assert.ok(why.via.length > 0, "a lit part with no reason");
  for (const v of why.via) {
    assert.ok(v.carriers.length > 0, `${v.system} lists no carriers`);
    for (const id of v.carriers) {
      assert.ok(DISK.components.has(id), `${id} does not carry inv-disk`);
      assert.equal(componentById(id)?.system, v.system, `${id} is not in ${v.system}`);
    }
  }
  /* The record node is lit by a system it merges, not by its own component's system. */
  const record = NODES.find((n) => n.id === "record")!;
  const merged = whyLit(DISK, record.item, systemsDrawnWith(LANES_LEVELS, record.item));
  assert.equal(merged.carries, false);
  assert.ok(merged.via.some((v) => v.system === "sys-brain"), "the merged system is not named");
  /* A carrier carries. */
  const carrier = carriersOf(DISK)[0]!;
  assert.equal(whyLit(DISK, carrier).carries, true);
});

/* Case 5 */
test("case 5: stepLensRead refuses without a lens, and names the part it leaves open", () => {
  const off = stepLensRead(NO_LENS, null, "next");
  assert.equal(off.ok, false);
  assert.match(JSON.stringify(off), /set_lens/);
  const carriers = carriersOf(GATE);
  const before = carriers[2]!;
  const on = stepLensRead(GATE, before, "next");
  assert.ok(on.ok);
  if (!on.ok) return;
  assert.equal(on.opened.id, carriers[3]);
  assert.notEqual(on.opened.id, before, "it named the part open BEFORE the call");
  assert.equal(on.opened.name, componentById(carriers[3]!)?.name);
  assert.equal(on.opened.index, 4);
  assert.equal(on.opened.of, 19);
  const back = stepLensRead(GATE, before, "prev");
  assert.ok(back.ok && back.opened.id === carriers[1]);
});

/* Case 6 */
/** read_view's lens block at L2, with the walk's two fields. */
type WalkedLens = {
  at: { index: number; of: number } | null;
  why: { system: string; name: string; carriers: string[] }[] | null;
} | null;
const lensOf = (out: unknown): WalkedLens => (out as { lens: WalkedLens }).lens;

test("case 6: read_view at L2 says where the open part sits in the walk, or why it is lit", () => {
  const carriers = carriersOf(GATE);
  const id = carriers[4]!;
  const at = viewDetail({ level: 2, group: null, item: id }, "inv-gate", "archify-lanes", null, LANES_LEVELS);
  assert.deepEqual(lensOf(at)?.at, { index: 5, of: 19 });
  assert.equal(lensOf(at)?.why, null);

  const node = NODES.find((n) => n.id === "connectors")!;
  const off = viewDetail({ level: 2, group: "record", item: node.item }, "inv-disk", "archify-lanes", null, LANES_LEVELS);
  assert.equal(lensOf(off)?.at, null);
  const why = lensOf(off)?.why;
  assert.ok(why && why.length > 0, "a non-carrier with no reason");
  assert.ok(why.every((v) => DISK.systems.has(v.system)));
  assert.ok(why.some((v) => v.system === componentById(node.item)?.system));
});

/* Case 7 (guard: green before by design) */
test("case 7 (guard): lensRead and read_view at L0/L1 light exactly what the lens lights", () => {
  for (const c of CONCEPTS) {
    const lens = lensFor(c.id);
    const out = lensRead(c.id);
    assert.equal(out.components?.of, lens.components.size);
    assert.equal(out.systems?.length, lens.systems.size);
    assert.equal(out.layers?.length, lens.layers.size);
    const l0 = viewDetail({ level: 0, group: null, item: null }, c.id, "archify-lanes", null, DATA_LEVELS);
    assert.equal(l0.lens?.components, lens.components.size);
  }
});

/* Case 8 */
/** A source file under components/atlas, with block and line comments removed. */
function source(path: string): string {
  return readFileSync(new URL(`../components/atlas/${path}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("case 8: with no lens, the mast and the pane render no stepper", () => {
  for (const file of ["Mast.tsx", "pane/Pane.tsx"]) {
    const src = source(file);
    const at = src.indexOf("data-lens-step");
    assert.ok(at > 0, `${file} draws no lens stepper`);
    /* The stepper sits inside a branch on the carriers count. */
    const guard = src.lastIndexOf("carriers.length > 0", at);
    assert.ok(guard > 0 && guard < at, `${file}'s stepper is not conditional on the carriers count`);
  }
  assert.deepEqual(carriersOf(lensFor(null)), []);
});
