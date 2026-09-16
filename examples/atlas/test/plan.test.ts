/**
 * THE SHEET'S GEOMETRY, AND THE CAMERA'S TWO DIRECTIONS.
 *
 * Round 3's `scene.test.ts` pinned a 3D machine so that three renderers could not drift from each
 * other. There is one renderer now, so this file pins something else: the properties a DRAWING has
 * to have to be readable at all, and the one property the camera has to have for semantic zoom not
 * to flap.
 *
 * Every assertion names the property it defends, not the value it happens to have. A test that
 * says `blocks.length === 19` breaks the day a system is added to the model, which is the wrong
 * day to fail; a test that says no two blocks overlap in any view breaks only when a layout is
 * wrong.
 *
 * The four properties, in the order the brief asks for them:
 *
 *   1. NO BLOCK OVERLAPS ANOTHER, in any of the four views. A drawing where two rectangles are on
 *      top of each other is not a drawing.
 *   2. EVERY EDGE ENDPOINT IS PLACED. A run whose `from` or `to` is not a block on this sheet is a
 *      line to nowhere, and it does not look like a bug — it looks like a line.
 *   3. BAND MEMBERSHIP. In the layers view, every block is inside its own layer's region and
 *      inside no other's; the regions are in README order, surfaces first.
 *   4. RULE 14. `poseFor` and `resolveGroup`/`resolveItem` are exact inverses, for every layer and
 *      every component, in every view.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { COMPONENTS, LAYERS, LAYER_ORDER, SYSTEMS, systemById } from "../data";
import { DIM, blockHeight, boundsOf, overlaps, packRows, routeOrtho } from "../components/atlas/variants/blueprint/geometry";
import {
  PLANS,
  VIEWS,
  WORLD,
  blockIn,
  partIn,
  partRuns,
  regionOf,
  type ViewId,
} from "../components/atlas/variants/blueprint/plan";
import {
  BANDS,
  HOME_MAX,
  HOME_MIN,
  L1_MAX,
  L1_MIN,
  L1_ZOOM,
  L2_ZOOM,
  layerZoom,
  poseFor,
  quantise,
  resolveGroup,
  resolveItem,
} from "../components/atlas/variants/blueprint/poses";
import { GATE_STOP, TURN, TURN_BLOCKS } from "../components/atlas/variants/blueprint/turn";
import { EDGES } from "../data";

const FRAME = { w: 1150, h: 740 };

const full = (pose: Partial<{ zoom: number; pan: { x: number; y: number } }>) => ({
  yaw: 0,
  pitch: 0,
  zoom: pose.zoom ?? 1,
  pan: pose.pan ?? { x: 0, y: 0 },
});

/* ---------------------------------- 1. the blocks do not overlap ---------------------------------- */

test("every system becomes exactly one block, in every view", () => {
  for (const view of VIEWS) {
    const ids = PLANS[view].blocks.map((b) => b.id);
    assert.equal(ids.length, SYSTEMS.length, `${view} lost or duplicated a block`);
    assert.equal(new Set(ids).size, ids.length, `${view} drew a block twice`);
  }
});

test("a block is the same rectangle in every view — only its position moves", () => {
  for (const system of SYSTEMS) {
    const sizes = VIEWS.map((v) => {
      const b = blockIn(v, system.id);
      assert.ok(b, `${system.id} is missing from ${v}`);
      return `${b.w}x${b.h}`;
    });
    assert.equal(new Set(sizes).size, 1, `${system.id} changes size between views: ${sizes.join(", ")}`);
  }
});

test("no two blocks overlap, in any view", () => {
  for (const view of VIEWS) {
    const blocks = PLANS[view].blocks;
    for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        const a = blocks[i]!;
        const b = blocks[j]!;
        assert.ok(!overlaps(a, b), `${view}: ${a.id} overlaps ${b.id}`);
      }
    }
  }
});

test("no two parts overlap inside a block, and every part is inside its block", () => {
  for (const b of PLANS.layers.blocks) {
    for (let i = 0; i < b.parts.length; i += 1) {
      const p = b.parts[i]!;
      assert.ok(p.x >= 0 && p.y >= 0, `${p.id} starts outside its block`);
      assert.ok(p.x + p.w <= b.w + 0.001, `${p.id} runs past its block's right edge`);
      assert.ok(p.y + p.h <= b.h + 0.001, `${p.id} runs past its block's foot`);
      for (let j = i + 1; j < b.parts.length; j += 1) {
        assert.ok(!overlaps(p, b.parts[j]!), `${p.id} overlaps ${b.parts[j]!.id}`);
      }
    }
  }
});

test("a block is tall enough for the parts it holds, and no taller", () => {
  for (const b of PLANS.layers.blocks) {
    assert.equal(b.h, blockHeight(b.parts.length), `${b.id} is the wrong height for ${b.parts.length} parts`);
  }
});

/* ------------------------------- 2. every edge endpoint is placed ------------------------------- */

test("every run in every view connects two blocks that are on that sheet", () => {
  for (const view of VIEWS) {
    const placed = new Set(PLANS[view].blocks.map((b) => b.id));
    for (const e of PLANS[view].edges) {
      assert.ok(placed.has(e.from), `${view}: run from ${e.from}, which is not on the sheet`);
      assert.ok(placed.has(e.to), `${view}: run to ${e.to}, which is not on the sheet`);
      assert.ok(e.run.points.length >= 2, `${view}: run ${e.id} has no path`);
      for (const p of e.run.points) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${view}: run ${e.id} has a NaN corner`);
      }
    }
  }
});

test("a run's first and last corners sit on the rectangles it joins", () => {
  const view: ViewId = "layers";
  for (const e of PLANS[view].edges) {
    const a = blockIn(view, e.from)!;
    const b = blockIn(view, e.to)!;
    const first = e.run.points[0]!;
    const last = e.run.points[e.run.points.length - 1]!;
    const on = (r: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }) =>
      p.x >= r.x - 0.001 && p.x <= r.x + r.w + 0.001 && p.y >= r.y - 0.001 && p.y <= r.y + r.h + 0.001;
    assert.ok(on(a, first), `run ${e.id} does not start on ${e.from}`);
    assert.ok(on(b, last), `run ${e.id} does not end on ${e.to}`);
  }
});

test("every segment of every run is horizontal or vertical — a blueprint has no diagonals", () => {
  for (const view of VIEWS) {
    for (const e of PLANS[view].edges) {
      const pts = e.run.points;
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const straight = Math.abs(a.x - b.x) < 0.001 || Math.abs(a.y - b.y) < 0.001;
        assert.ok(straight, `${view}: run ${e.id} segment ${i} is a diagonal`);
      }
    }
  }
});

test("component runs inside a layer place both ends, and mark the ones that leave", () => {
  for (const layer of LAYER_ORDER) {
    const runs = partRuns("layers", layer, EDGES);
    assert.ok(runs.length > 0, `${layer} draws no component runs at all`);
    for (const r of runs) {
      assert.ok(partIn("layers", r.from), `run from ${r.from}, which is not drawn`);
      assert.ok(partIn("layers", r.to), `run to ${r.to}, which is not drawn`);
      const fromLayer = systemById(COMPONENTS.find((c) => c.id === r.from)!.system)!.layer;
      const toLayer = systemById(COMPONENTS.find((c) => c.id === r.to)!.system)!.layer;
      const crosses = fromLayer !== layer || toLayer !== layer;
      assert.equal(
        r.leaves !== null,
        crosses,
        `${r.id} in ${layer}: "leaves" disagrees with where its ends are`,
      );
    }
  }
});

/* ----------------------------------- 3. band membership ----------------------------------- */

test("the layers view has one region per layer, in README order, surfaces first", () => {
  const regions = PLANS.layers.regions;
  assert.equal(regions.length, LAYERS.length);
  assert.deepEqual(
    regions.map((r) => r.id),
    [...LAYER_ORDER],
  );
  for (let i = 1; i < regions.length; i += 1) {
    assert.ok(
      regions[i]!.y > regions[i - 1]!.y,
      `${regions[i]!.id} is not below ${regions[i - 1]!.id}`,
    );
  }
});

test("every block in the layers view is inside its own band and no other", () => {
  const regions = PLANS.layers.regions;
  for (const b of PLANS.layers.blocks) {
    const mine = regions.find((r) => r.id === b.layer)!;
    assert.ok(
      b.x >= mine.x && b.x + b.w <= mine.x + mine.w,
      `${b.id} runs outside ${b.layer} horizontally`,
    );
    assert.ok(
      b.y >= mine.y && b.y + b.h <= mine.y + mine.h,
      `${b.id} runs outside ${b.layer} vertically`,
    );
    for (const other of regions) {
      if (other.id === b.layer) continue;
      assert.ok(!overlaps(b, other), `${b.id} strays into ${other.id}`);
    }
    assert.equal(regionOf("layers", b.id)?.id, b.layer);
  }
});

test("every view puts every block inside a region it claims", () => {
  for (const view of VIEWS) {
    for (const b of PLANS[view].blocks) {
      const r = regionOf(view, b.id);
      assert.ok(r, `${view}: ${b.id} belongs to no region`);
      assert.ok(
        b.x >= r.x && b.x + b.w <= r.x + r.w && b.y >= r.y && b.y + b.h <= r.y + r.h,
        `${view}: ${b.id} is drawn outside ${r.id}, the region that claims it`,
      );
    }
  }
});

test("the world box is big enough for every arrangement", () => {
  for (const view of VIEWS) {
    assert.ok(PLANS[view].bounds.w <= WORLD.w + 0.001, `${view} is wider than the world`);
    assert.ok(PLANS[view].bounds.h <= WORLD.h + 0.001, `${view} is taller than the world`);
  }
});

test("every plan is centred on the world origin, which is what makes a view switch a translate", () => {
  for (const view of VIEWS) {
    const b = PLANS[view].bounds;
    assert.ok(Math.abs(b.x + b.w / 2) < 0.001, `${view} is not centred horizontally`);
    assert.ok(Math.abs(b.y + b.h / 2) < 0.001, `${view} is not centred vertically`);
  }
});

/* -------------------------------- 4. rule 14: exact inverses -------------------------------- */

test("the bands leave room around every zoom poseFor can produce (rule 12 and 14 together)", () => {
  const [l1, l2] = BANDS;
  assert.ok(HOME_MAX < l1, "the whole-sheet zoom can reach the first band");
  assert.ok(HOME_MIN > 0, "the floor zoom is not a zoom");
  assert.ok(L1_ZOOM > l1, "opening a layer does not cross into the layer band");
  assert.ok(L1_ZOOM < l2, "opening a layer overshoots into the component band");
  assert.ok(L2_ZOOM > l2, "opening a component does not cross into the component band");
  /* Round 5: the L1 zoom is a FIT, so what has to be inside the band is the fit's whole range. */
  assert.ok(L1_MIN > l1, "a fitted layer can fall out of the bottom of its own band");
  assert.ok(L1_MAX < l2, "a fitted layer can climb into the component band");
});

/**
 * ROUND 4'S CARRY-OVER, CLOSED (item 1, rule 15).
 *
 * "L1 framing (narrower regions vs L0 legibility)". The near band must show the WHOLE open layer,
 * and the test says so in the units a reader has: at the pose `poseFor` produces, the layer's frame
 * must fit inside the viewport. A layer that cannot is named, with its size, rather than discovered
 * by scrolling.
 */
test("opening any layer in the layers view frames the whole layer (round-4 carry-over)", () => {
  for (const layer of LAYER_ORDER) {
    const box = PLANS.layers.frames[layer];
    const zoom = layerZoom("layers", layer, FRAME);
    assert.ok(
      box.w * zoom <= FRAME.w + 0.5,
      `layers/${layer}: ${Math.round(box.w * zoom)}px wide in a ${FRAME.w}px frame`,
    );
    assert.ok(
      box.h * zoom <= FRAME.h + 0.5,
      `layers/${layer}: ${Math.round(box.h * zoom)}px tall in a ${FRAME.h}px frame`,
    );
  }
});

/**
 * THE OTHER THREE ARRANGEMENTS CANNOT PROMISE IT, AND THE TEST SAYS SO RATHER THAN LOOKING AWAY.
 *
 * A layer's frame in the layers view IS its band. In the turn, trust and packages views it is the
 * bounding box of blocks the ARRANGEMENT has scattered — `surfaces` in the packages view is six
 * systems in four different folders — and no zoom inside the L1 band can frame that, because
 * framing it would mean standing at a distance the band calls L0. So the promise here is the
 * weaker true one: the fit is attempted, and when it cannot be met the camera is at the band floor
 * rather than at some third number nobody chose.
 */
test("a scattered layer is fitted as far as the band allows, and then pinned at its floor", () => {
  for (const view of VIEWS) {
    for (const layer of LAYER_ORDER) {
      const box = PLANS[view].frames[layer];
      const zoom = layerZoom(view, layer, FRAME);
      const fits = box.w * zoom <= FRAME.w + 0.5 && box.h * zoom <= FRAME.h + 0.5;
      assert.ok(
        fits || Math.abs(zoom - L1_MIN) < 1e-9,
        `${view}/${layer}: neither fits nor is at the band floor (zoom ${zoom.toFixed(3)})`,
      );
      assert.ok(zoom >= L1_MIN - 1e-9 && zoom <= L1_MAX + 1e-9, `${view}/${layer}: out of band`);
    }
  }
});

test("resolveGroup is the exact inverse of poseFor, for every layer in every view", () => {
  for (const view of VIEWS) {
    for (const layer of LAYER_ORDER) {
      const pose = full(poseFor({ level: 1, group: layer, item: null }, view, FRAME));
      assert.equal(resolveGroup(pose, view), layer, `${view}: opening ${layer} resolves elsewhere`);
    }
  }
});

test("resolveItem is the exact inverse of poseFor, for every component in every view", () => {
  for (const view of VIEWS) {
    for (const c of COMPONENTS) {
      const layer = systemById(c.system)!.layer;
      const pose = full(poseFor({ level: 2, group: layer, item: c.id }, view, FRAME));
      assert.equal(resolveGroup(pose, view), layer, `${view}: ${c.id} resolves to the wrong layer`);
      assert.equal(resolveItem(pose, view, layer), c.id, `${view}: ${c.id} resolves to another part`);
    }
  }
});

test("the home pose frames the whole sheet and is inside the declared limits", () => {
  for (const view of VIEWS) {
    const pose = full(poseFor({ level: 0, group: null, item: null }, view, FRAME));
    assert.ok(pose.zoom >= HOME_MIN && pose.zoom <= HOME_MAX, `${view}: home zoom is out of range`);
    assert.ok(Math.abs(pose.pan.x) < 0.001 && Math.abs(pose.pan.y) < 0.001, `${view}: home is off-centre`);
  }
});

test("the inverse scale is quantised, monotone, and exactly 1 at zoom 1", () => {
  assert.equal(quantise(1), 1);
  const steps = new Set<number>();
  let previous = 0;
  for (let z = 0.2; z <= 4; z += 0.01) {
    const q = quantise(z);
    steps.add(Math.round(q * 1e6));
    assert.ok(q >= previous - 1e-9, "quantise went backwards");
    previous = q;
  }
  /* Coarse enough to matter: a continuous scale over this range would be 380 distinct values. */
  assert.ok(steps.size < 20, `quantise produced ${steps.size} steps, which is not a quantisation`);
});

/* ----------------------------------------- the turn ----------------------------------------- */

test("every stop of the turn names a component the model has", () => {
  const ids = new Set(COMPONENTS.map((c) => c.id));
  for (const s of TURN) {
    assert.ok(ids.has(s.part), `stop ${s.index + 1} names ${s.part}, which is not in the model`);
    assert.ok(s.label.length < 60, `stop ${s.index + 1}'s label is a sentence, not a label`);
    assert.ok(s.cite.length > 0, `stop ${s.index + 1} cites nothing`);
  }
});

test("the turn touches every layer, waits exactly once, and returns where it started", () => {
  const layers = new Set(TURN.map((s) => s.layer));
  for (const l of LAYER_ORDER) {
    assert.ok(layers.has(l), `the turn never enters ${l}`);
  }
  assert.equal(TURN.filter((s) => s.kind === "wait").length, 1, "the gate waits once, or not at all");
  assert.ok(GATE_STOP > 0 && GATE_STOP < TURN.length - 1, "the gate is at one end of the turn");
  assert.equal(TURN[0]!.part, TURN[TURN.length - 1]!.part, "the turn does not come back");
});

test("the turn view puts every visited block in the path region and the rest on the shelf", () => {
  const path = PLANS.turn.regions.find((r) => r.id === "turn-path")!;
  const shelf = PLANS.turn.regions.find((r) => r.id === "turn-off")!;
  assert.deepEqual([...path.blocks], [...TURN_BLOCKS]);
  for (const s of SYSTEMS) {
    const where = TURN_BLOCKS.includes(s.id) ? path : shelf;
    assert.ok(where.blocks.includes(s.id), `${s.id} is in neither region of the turn view`);
  }
});

/* ------------------------------------ the pure primitives ------------------------------------ */

test("packRows wraps at the column count, centres each row, and never overlaps", () => {
  const sizes = Array.from({ length: 7 }, (_, i) => ({ w: 100, h: 20 + i }));
  const pack = packRows(sizes, 3, 10, 10);
  assert.equal(pack.at.length, 7);
  assert.equal(pack.w, 320);
  const boxes = pack.at.map((p, i) => ({ x: p.x, y: p.y, w: sizes[i]!.w, h: sizes[i]!.h }));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.ok(!overlaps(boxes[i]!, boxes[j]!), `packed items ${i} and ${j} overlap`);
    }
  }
  assert.equal(boundsOf(boxes).w, 320);
});

test("routeOrtho leaves the side that faces its target", () => {
  const a = { x: 0, y: 0, w: 100, h: 40 };
  const below = routeOrtho(a, { x: 0, y: 200, w: 100, h: 40 });
  assert.equal(below.from, "bottom");
  assert.equal(below.to, "top");
  assert.ok(below.down);

  const above = routeOrtho(a, { x: 0, y: -200, w: 100, h: 40 });
  assert.equal(above.from, "top");
  assert.ok(!above.down);

  const right = routeOrtho(a, { x: 300, y: 0, w: 100, h: 40 });
  assert.equal(right.from, "right");
  assert.equal(right.to, "left");
});

test("DIM is self-consistent: the part columns fit inside a block's padding", () => {
  const inner = DIM.blockW - DIM.pad * 2;
  const w = (inner - DIM.partGap * (DIM.partCols - 1)) / DIM.partCols;
  assert.ok(w > 0, "a part column has no width");
  assert.ok(DIM.partCols * w + DIM.partGap * (DIM.partCols - 1) <= inner + 0.001);
});
