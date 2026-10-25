/**
 * THE LEVEL VOCABULARY IS THE MOUNTED VARIANT'S — the shell's tools, rail and pane links resolve a
 * group through the level map the variant declares in `meta.levels`, with the data model's layers
 * as the fallback.
 *
 * The failure being pinned: the lanes drawing groups by PHASE (arrive, compose, record) and the
 * shell used to speak LAYERS, so `read_view` at L1 answered "No layer arrive.", `open_group`
 * accepted six ids the drawing has no box for, the rail printed the generic "One layer", and a
 * pane link flew the camera into a layer id. Each case below is one of those, plus the parity that
 * keeps the map derived from the drawing rather than retyped beside it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { COMPONENTS, COMPONENT_BY_ID, LAYERS, componentsOfLayer } from "../data";
import { viewDetail } from "../components/atlas/tools/read";
import {
  DATA_LEVELS,
  LANES_LEVELS,
  groupsFor,
  itemsFor,
  railLabel,
  targetFor,
} from "../components/atlas/variants/levels";
import { NODES, PHASES, phaseOfCol } from "../components/atlas/variants/archify-lanes/workflow";

const LANES_VIEW = { id: "lanes", label: "Lanes", note: "rows are owners, columns are moments", runs: "then" };

const DRAWN = new Set(NODES.map((n) => n.item));
const UNDRAWN = COMPONENTS.find((c) => !DRAWN.has(c.id))!;
const nodesIn = (phase: string) => NODES.filter((n) => phaseOfCol(n.col).id === phase);

test("case 1: read_view at L1 on a phase answers the phase and its nodes' components", () => {
  const out = viewDetail({ level: 1, group: "arrive", item: null }, null, "archify-lanes", LANES_VIEW, LANES_LEVELS);
  assert.equal("error" in out ? out.error : undefined, undefined, "L1 of a phase is refused");
  assert.ok("group" in out && out.group, "no group in the L1 detail");
  assert.equal(out.group.id, "arrive");
  assert.equal(out.group.label, "Arrive");
  const listed = out.components.items.map((c) => c.id).sort();
  assert.deepEqual(listed, nodesIn("arrive").map((n) => n.item).sort());
});

test("case 2: the groups open_group accepts are the phases the drawing flies to", () => {
  /* Drawing.tsx: `export const GROUPS = PHASES.map((p) => p.id);` (a .tsx file node cannot load). */
  assert.deepEqual(
    groupsFor(LANES_LEVELS).map((g) => g.id),
    PHASES.map((p) => p.id),
  );
  for (const g of groupsFor(LANES_LEVELS)) assert.equal(g.count, nodesIn(g.id).length);
});

test("case 3: the items are one per node, each a component, each in its node's phase", () => {
  const all = itemsFor(LANES_LEVELS, null);
  assert.equal(all.length, NODES.length);
  assert.equal(all.length, 12);
  for (const row of all) {
    assert.ok(COMPONENT_BY_ID.has(row.id), `${row.id} is not a component id`);
    const node = NODES.find((n) => n.item === row.id)!;
    assert.ok(node, `${row.id} is no node's item`);
    assert.equal(row.group, phaseOfCol(node.col).id);
  }
  const compose = itemsFor(LANES_LEVELS, "compose");
  assert.deepEqual(
    compose.map((r) => r.id).sort(),
    nodesIn("compose").map((n) => n.item).sort(),
  );
  for (const row of compose) assert.equal(row.group, "compose");
});

test("case 4: the rail names the phase, and the level names come from the map", () => {
  assert.equal(railLabel(LANES_LEVELS, { level: 1, group: "record", item: null }), "Run and record");
  assert.equal(LANES_LEVELS.levelNames[1], "One phase");
  assert.equal(railLabel(LANES_LEVELS, { level: 1, group: "nowhere", item: null }), "One phase");
  const layer = LAYERS[0]!;
  assert.equal(railLabel(DATA_LEVELS, { level: 1, group: layer.id, item: null }), layer.name);
});

test("case 5: a pane link resolves to a phase, never to a layer", () => {
  const drawn = nodesIn("compose")[0]!.item;
  const kept = targetFor(LANES_LEVELS, UNDRAWN.id, { level: 2, group: "compose", item: drawn });
  assert.deepEqual(kept, { group: "compose", item: UNDRAWN.id, drawn: false });

  const node = nodesIn("record")[0]!;
  const flown = targetFor(LANES_LEVELS, node.item, { level: 2, group: "compose", item: drawn });
  assert.deepEqual(flown, { group: "record", item: node.item, drawn: true });

  const layerIds = new Set<string>(LAYERS.map((l) => l.id));
  for (const c of COMPONENTS) {
    const t = targetFor(LANES_LEVELS, c.id, { level: 2, group: "arrive", item: drawn });
    assert.ok(!layerIds.has(t.group), `${c.id} resolves to the layer ${t.group}`);
    assert.ok(PHASES.some((p) => p.id === t.group));
  }
});

test("case 6 (guard): with no level map, L1 on a layer answers exactly as before", () => {
  for (const layer of LAYERS) {
    const focus = { level: 1 as const, group: layer.id, item: null };
    const bare = viewDetail(focus, null, "archify-lanes", LANES_VIEW);
    const data = viewDetail(focus, null, "archify-lanes", LANES_VIEW, DATA_LEVELS);
    for (const out of [bare, data]) {
      assert.ok("layer" in out && out.layer, `${layer.id} lost its layer`);
      assert.equal(out.layer.id, layer.id);
      assert.ok(out.systems.length > 0);
      assert.deepEqual(
        out.components.items.map((c) => c.id),
        componentsOfLayer(layer.id).map((c) => c.id),
      );
    }
    assert.deepEqual(bare, data);
  }
  /* And the fallback's groups are the six layers open_group advertised before. */
  assert.deepEqual(groupsFor(DATA_LEVELS).map((g) => g.id), LAYERS.map((l) => l.id));
  assert.equal(itemsFor(DATA_LEVELS, null).length, COMPONENTS.length);
});

test("case 7 (guard): L0 and L2 are unchanged and name the variant first, with or without a map", () => {
  const c = COMPONENTS[0]!;
  for (const focus of [
    { level: 0 as const, group: null, item: null },
    { level: 2 as const, group: "arrive", item: c.id },
  ]) {
    const bare = viewDetail(focus, null, "archify-lanes", LANES_VIEW);
    const mapped = viewDetail(focus, null, "archify-lanes", LANES_VIEW, LANES_LEVELS);
    assert.deepEqual(mapped, bare);
    assert.equal(Object.keys(mapped)[0], "view");
    assert.equal(mapped.view.variant.id, "archify-lanes");
  }
});

test("case 8: parity — every node is in the map once, under its column's phase", () => {
  const phaseIds = new Set(PHASES.map((p) => p.id));
  for (const g of LANES_LEVELS.groups) assert.ok(phaseIds.has(g.id), `${g.id} is not a phase`);
  for (const node of NODES) {
    const homes = LANES_LEVELS.groups.filter((g) => g.items.includes(node.item));
    assert.equal(homes.length, 1, `${node.id} appears ${homes.length} times`);
    assert.equal(homes[0]!.id, phaseOfCol(node.col).id);
  }
  const total = LANES_LEVELS.groups.reduce((n, g) => n + g.items.length, 0);
  assert.equal(total, NODES.length);
});
