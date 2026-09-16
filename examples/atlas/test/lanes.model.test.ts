/**
 * THE LANE DIAGRAM'S ABSTRACTION, AND THE CEILINGS IT IS AUTHORED UNDER.
 *
 * Every assertion names the PROPERTY it defends rather than the value the drawing happens to have,
 * so a system added to `data/systems.ts` fails this file (as it should — it has no home in the
 * drawing yet) and a wording change never does.
 *
 *   1. Coverage: every system of the model is in exactly one node, and no node claims a system the
 *      model does not have. That is the merge's receipt.
 *   2. The archify ceilings, from the second study: at most twelve nodes and at most fourteen
 *      edges, zero boundary rectangles, all five roles used, exactly one `error` run.
 *   3. The main path never climbs a column — archify's `mainPath` lint, which is the claim "the
 *      turn descends the stack left to right" stated as an inequality.
 *   4. Every authored string fits its node at or above its floor, so the drawing never clips and
 *      never ellipsises (study §7.8: reject rather than overflow).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { SYSTEMS, componentById } from "../data";
import { KINDS } from "../components/atlas/variants/archify/kinds";
import {
  COLS,
  EDGES,
  LANES,
  MAIN_PATH,
  NODES,
  NODE_OF_SYSTEM,
  PHASES,
  ROLES,
  kindOfNode,
  roleCounts,
  systemCoverage,
} from "../components/atlas/variants/archify-lanes/workflow";
import { TEXT_BOX, fitSize, fitTier } from "../components/atlas/variants/archify-lanes/text";

test("every system of the model is in exactly one node", () => {
  const missing = systemCoverage().filter((c) => !c.node);
  assert.deepEqual(
    missing.map((m) => m.system),
    [],
    "systems with no node",
  );

  const claimed = NODES.flatMap((n) => n.systems);
  assert.equal(claimed.length, new Set(claimed).size, "a system is claimed twice");
  assert.equal(claimed.length, SYSTEMS.length, "the drawing claims a different number of systems");

  const known = new Set(SYSTEMS.map((s) => s.id));
  for (const id of claimed) assert.ok(known.has(id), `${id} is not a system of the model`);
  assert.equal(NODE_OF_SYSTEM.size, SYSTEMS.length);
});

test("the abstraction ceilings hold: <= 12 nodes, <= 14 edges, no boundary frames", () => {
  assert.ok(NODES.length <= 12, `${NODES.length} nodes exceeds archify's ceiling of 12`);
  assert.ok(EDGES.length <= 14, `${EDGES.length} edges exceeds archify's ceiling of 14`);
  assert.equal(NODES.length, 12);
  assert.equal(EDGES.length, 14);
  /* There is no boundary type in this IR at all — that is the variant's thesis, as a type. */
  assert.equal(
    Object.keys(NODES[0]!).includes("boundary"),
    false,
    "a node may not carry a boundary",
  );
});

test("the lanes and phases are archify's shape", () => {
  assert.equal(LANES.length, 4);
  assert.equal(PHASES.length, 3);
  assert.equal(COLS, 6);
  assert.equal(
    LANES.filter((l) => l.variant === "exception").length,
    1,
    "exactly one exception lane",
  );
  assert.equal(
    PHASES.filter((p) => p.variant === "emphasis").length,
    1,
    "exactly one emphasis phase",
  );
  assert.equal(PHASES.filter((p) => p.variant === "dashed").length, 1);

  /* The phases tile the six columns with no gap and no overlap. */
  const covered = PHASES.flatMap((p) =>
    Array.from({ length: p.toCol - p.fromCol + 1 }, (_, i) => p.fromCol + i),
  ).sort((a, b) => a - b);
  assert.deepEqual(covered, [0, 1, 2, 3, 4, 5]);

  /* Every node is on a real lane and inside the column range. */
  const laneIds = new Set(LANES.map((l) => l.id));
  for (const n of NODES) {
    assert.ok(laneIds.has(n.lane), `${n.id} is on no lane`);
    assert.ok(n.col >= 0 && n.col < COLS, `${n.id} is off the grid at col ${n.col}`);
  }

  /* No two nodes share a cell. */
  const cells = NODES.map((n) => `${n.lane}:${n.col}`);
  assert.equal(cells.length, new Set(cells).size, "two nodes share a lane and column");
});

test("every edge's role is in the enum, and the roles are the turn's", () => {
  for (const e of EDGES) {
    assert.ok((ROLES as readonly string[]).includes(e.role), `${e.id} has role ${e.role}`);
    assert.ok(
      NODES.some((n) => n.id === e.from),
      `${e.id} leaves a node that does not exist`,
    );
    assert.ok(
      NODES.some((n) => n.id === e.to),
      `${e.id} enters a node that does not exist`,
    );
    assert.notEqual(e.from, e.to, `${e.id} is a self edge`);
    assert.ok(e.label.length > 0, `${e.id} has no label`);
    assert.ok(e.cite.length > 0, `${e.id} cites nothing`);
  }

  const counts = new Map(roleCounts().map((r) => [r.role, r.n]));
  assert.equal(counts.size, ROLES.length, "all five roles are used");
  assert.equal(counts.get("error"), 1, "exactly one error branch — the gate's decline");
  assert.equal(counts.get("async"), 1, "exactly one async run — the ledger write");
});

test("the main path is a chain that never climbs a column", () => {
  const main = EDGES.filter((e) => e.role === "main");
  assert.equal(MAIN_PATH.length, main.length + 1, "the main edges do not form one chain");

  const colOf = (id: string) => NODES.find((n) => n.id === id)!.col;
  for (let i = 1; i < MAIN_PATH.length; i += 1) {
    const before = colOf(MAIN_PATH[i - 1]!);
    const here = colOf(MAIN_PATH[i]!);
    assert.ok(here >= before, `${MAIN_PATH[i]} climbs back from column ${before} to ${here}`);
  }

  /* It starts on the surface and ends in the evidence: the stack, descended. */
  assert.equal(NODES.find((n) => n.id === MAIN_PATH[0])!.lane, "surface");
  assert.equal(NODES.find((n) => n.id === MAIN_PATH[MAIN_PATH.length - 1])!.lane, "tools");
});

test("a node's kind comes from the model's own rule, and a merge never invents one", () => {
  for (const n of NODES) {
    const kind = kindOfNode(n);
    assert.ok((KINDS as readonly string[]).includes(kind), `${n.id} has kind ${kind}`);
  }
  const used = new Set(NODES.map((n) => kindOfNode(n)));
  assert.equal(used.size, KINDS.length, "all seven kinds are used; the legend counts them");
});

test("every node names a real component for the pane to open", () => {
  const items = NODES.map((n) => n.item);
  assert.equal(items.length, new Set(items).size, "two nodes open the same component");
  for (const n of NODES) {
    const c = componentById(n.item);
    assert.ok(c, `${n.id} opens ${n.item}, which the model does not have`);
    assert.ok(
      n.systems.includes(c!.system),
      `${n.id} opens ${n.item}, which belongs to ${c!.system} — not one of its systems`,
    );
  }
});

test("the two reading tiers never shrink at all: every label draws at 11 and 9", () => {
  /* Shrink-to-fit is the safety net, not the plan. The round-6 brief measures "labels under 9 px"
     on the live DOM at home, where scale is 1, so a sublabel that shrank to 8.9 would be a drawing
     that had quietly decided the wording mattered more than the reader. The tag is 7 because
     archify's tag is 7 — that is the anatomy, not a shrink. */
  for (const n of NODES) {
    assert.equal(fitTier(n.label, "label"), 11, `${n.id}: "${n.label}" does not draw at 11`);
    assert.equal(fitTier(n.sublabel, "sublabel"), 9, `${n.id}: "${n.sublabel}" does not draw at 9`);
    assert.equal(fitTier(n.tag, "tag"), 7, `${n.id}: "${n.tag}" does not draw at 7`);
  }
});

test("shrink-to-fit never reaches the floor: no label clips and no label ellipsises", () => {
  const fits = (text: string, base: number, floor: number) => {
    const size = fitSize(text, base, floor);
    return { size, width: text.length * 0.6 * size };
  };
  for (const n of NODES) {
    for (const [text, base, floor, tier] of [
      [n.label, 11, 8, "label"],
      [n.sublabel, 9, 7, "sublabel"],
      [n.tag, 7, 6, "tag"],
    ] as const) {
      const { size, width } = fits(text, base, floor);
      assert.ok(size >= floor, `${n.id} ${tier} shrinks below ${floor}`);
      assert.ok(
        width <= TEXT_BOX + 0.5,
        `${n.id} ${tier} "${text}" needs ${width.toFixed(1)} of ${TEXT_BOX} — shorten the wording`,
      );
    }
  }
});
