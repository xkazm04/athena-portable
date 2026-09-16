/**
 * THE ABSTRACTION, PINNED. Archify study part 2 §1 and §2 are a set of QUANTITIES, so this file is
 * a set of quantities too — every assertion is one of the ceilings the study measured, or one of
 * the honesty conditions that make a ceiling affordable.
 *
 *   1. Twelve nodes, two boundaries, at most fourteen runs. The ceilings themselves.
 *   2. Every one of the nineteen systems maps to exactly one node. A merge that quietly dropped a
 *      system would make the sheet a lie rather than an abstraction.
 *   3. No component is lost: all sixty-eight are absorbed by exactly one of the three channels, and
 *      the `sublabel` channel's directory really does contain the file it claims.
 *   4. No label needs the floor. Archify shrinks to a floor and then REJECTS (study §7.8); the
 *      claim this variant makes is stronger — the twelve labels were chosen to fit at full size.
 *   5. Boundaries are derived from membership AND are honest: every member is inside its frame and
 *      no non-member is. That is the condition that makes two overlapping dashed frames readable.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { COMPONENTS, EDGES, SYSTEMS, componentById } from "../data";
import {
  ABSORPTION,
  ABSORPTION_COUNTS,
  BOUNDARIES,
  BOXES,
  CARDS,
  EDGE_CEILING,
  FLOOR,
  NODES,
  NODE_OF_SYSTEM,
  RUNS,
  SIZE,
  SPINE,
  WORLD,
  contains,
  fit,
  textOf,
} from "../components/atlas/variants/archify-density/sheet";

/* ------------------------------------------ the ceilings ------------------------------------- */

test("twelve nodes, two boundaries, at most fourteen runs", () => {
  assert.equal(NODES.length, 12, "archify's ceiling is 12 primary nodes (SKILL.md:21)");
  assert.equal(BOUNDARIES.length, 2, "one region and one security group; the study's range is 1-4");
  assert.ok(RUNS.length <= EDGE_CEILING, `${RUNS.length} runs is over the ${EDGE_CEILING} ceiling`);
  assert.ok(RUNS.length >= 6, "edges track nodes about 1:1; fewer than six is not a drawing");
});

test("one emphasised spine, and it is the turn", () => {
  const emphasised = RUNS.filter((r) => r.emphasis);
  assert.equal(emphasised.length, SPINE.length);
  assert.ok(SPINE.length >= 8, "README §3.2's twelve stops collapse to at least eight node hops");
  /* The spine is a single walk: every hop leaves where the last one arrived. */
  for (let i = 1; i < SPINE.length; i += 1) {
    assert.equal(SPINE[i]!.from, SPINE[i - 1]!.to, `hop ${i} does not continue the walk`);
  }
  /* It starts and ends at the surface, because a turn that does not come back is not a turn. */
  assert.equal(SPINE[0]!.from, "n-surfaces");
  assert.equal(SPINE[SPINE.length - 1]!.to, "n-surfaces");
});

test("every run joins two nodes that exist, and never a node to itself", () => {
  const ids = new Set(NODES.map((n) => n.id));
  for (const r of RUNS) {
    assert.ok(ids.has(r.from), `${r.id} leaves ${r.from}, which is not a node`);
    assert.ok(ids.has(r.to), `${r.id} enters ${r.to}, which is not a node`);
    assert.notEqual(r.from, r.to);
  }
  assert.equal(new Set(RUNS.map((r) => r.id)).size, RUNS.length, "run ids must be unique");
});

/* ------------------------------------------- the merge --------------------------------------- */

test("every one of the nineteen systems maps to exactly one node", () => {
  assert.equal(SYSTEMS.length, 19, "the model's own count; the merge below is written against it");
  const claimed = NODES.flatMap((n) => n.systems);
  assert.equal(claimed.length, new Set(claimed).size, "a system is claimed by two nodes");
  assert.deepEqual(
    [...claimed].sort(),
    SYSTEMS.map((s) => s.id).sort(),
    "the twelve nodes do not cover the nineteen systems exactly",
  );
  for (const s of SYSTEMS) assert.ok(NODE_OF_SYSTEM.get(s.id), `${s.id} has no node`);
});

test("no component is lost: sixty-eight, absorbed by one channel each", () => {
  assert.equal(COMPONENTS.length, 68);
  assert.equal(ABSORPTION.length, COMPONENTS.length, "a component was absorbed by nothing");
  assert.equal(new Set(ABSORPTION.map((a) => a.component)).size, COMPONENTS.length);
  assert.equal(
    ABSORPTION_COUNTS.tag + ABSORPTION_COUNTS.card + ABSORPTION_COUNTS.sublabel,
    COMPONENTS.length,
  );
  /* The `sublabel` channel is a citation, not a catch-all: the directory really contains the file. */
  for (const a of ABSORPTION) {
    if (a.channel !== "sublabel") continue;
    const component = componentById(a.component)!;
    assert.ok(
      component.file === a.where || component.file.startsWith(`${a.where}/`),
      `${a.component} (${component.file}) is not under ${a.where}`,
    );
  }
});

test("three cards, three bullets each, every id real and claimed once", () => {
  assert.equal(CARDS.length, 3, "the study's range is 1-3 cards");
  const seen = new Set<string>();
  for (const card of CARDS) {
    assert.equal(card.bullets.length, 3, `${card.id} — the study's range is 2-3 bullets`);
    assert.ok(NODES.some((n) => n.id === card.node), `${card.id} names no node`);
    for (const b of card.bullets) {
      assert.ok(b.covers.length > 0, `a bullet in ${card.id} covers nothing`);
      for (const id of b.covers) {
        assert.ok(componentById(id), `${card.id} names ${id}, which is not in the model`);
        assert.ok(!seen.has(id), `${id} is covered by two bullets`);
        seen.add(id);
      }
    }
  }
});

/* -------------------------------------------- the node --------------------------------------- */

test("no label needs the floor, and no tier is rejected", () => {
  for (const spec of NODES) {
    const text = textOf(spec);
    const label = fit(text.label, "label");
    assert.ok(label !== null, `"${text.label}" cannot be drawn above the ${FLOOR.label}-unit floor`);
    assert.equal(
      label,
      SIZE.label,
      `"${text.label}" has to shrink to ${label}; archify's labels fit at full size`,
    );
    assert.ok(fit(text.sublabel, "sub") !== null, `sublabel "${text.sublabel}" is rejected`);
    assert.ok(fit(text.tag, "tag") !== null, `tag "${text.tag}" is rejected`);
  }
});

test("the node is a fixed unit and the sheet is authored to fit", () => {
  for (const b of BOXES) {
    assert.equal(b.w, 140, "archify's node is a fixed width");
    assert.equal(b.h, 60, "archify's node is a fixed height");
    assert.ok(b.x >= 0 && b.x + b.w <= WORLD.w, `${b.id} leaves the world horizontally`);
    assert.ok(b.y >= 0 && b.y + b.h <= WORLD.h, `${b.id} leaves the world vertically`);
  }
  /* No two nodes overlap. A drawing where two boxes are on top of each other is not a drawing. */
  for (const a of BOXES) {
    for (const b of BOXES) {
      if (a === b) continue;
      const apart =
        a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(apart, `${a.id} overlaps ${b.id}`);
    }
  }
});

test("the world fills a 1440x900 reading column at 100%", () => {
  /* The atlas stage at 1440x900 is the viewport less the claims rail (15rem) and the mast; the
     canvas gets what is left after the title band and the legend strip. These are the numbers the
     home pose is computed against, and the point of the test is that the fit is >= 1 without one. */
  const column = 1440 - 240 - 40;
  assert.ok(column / WORLD.w >= 1, `${WORLD.w} units do not fit in a ${column}px reading column`);
  assert.ok(WORLD.w / WORLD.h > 1.4, "the world must be flat: archify's typical viewBox is 1080x520");
});

/* ---------------------------------------- the boundaries ------------------------------------- */

test("boundaries are derived from membership, and are honest about who is inside", () => {
  for (const boundary of BOUNDARIES) {
    assert.ok(boundary.wraps.length >= 2, `${boundary.id} wraps fewer than two nodes`);
    for (const box of BOXES) {
      const inside =
        box.x >= boundary.x &&
        box.y >= boundary.y &&
        box.x + box.w <= boundary.x + boundary.w &&
        box.y + box.h <= boundary.y + boundary.h;
      const member = boundary.wraps.includes(box.id);
      if (member) assert.ok(inside, `${boundary.id} does not contain its member ${box.id}`);
      else {
        const overlaps =
          box.x < boundary.x + boundary.w &&
          boundary.x < box.x + box.w &&
          box.y < boundary.y + boundary.h &&
          boundary.y < box.y + box.h;
        assert.ok(!overlaps, `${boundary.id} encloses ${box.id}, which is not a member`);
      }
    }
  }
});

test("the trust boundary crosses the runtime region's top edge", () => {
  const region = BOUNDARIES.find((b) => b.kind === "region")!;
  const trust = BOUNDARIES.find((b) => b.kind === "security-group")!;
  assert.ok(trust.y < region.y, "the gate that runs in the page must break out of the runtime");
  /* And the two frames never draw on the same line: a shared member edge would give two dashed
     rectangles a common side, which reads as one badly drawn rectangle. */
  const SEPARATION = 10;
  for (const [a, b] of [
    [region.x, trust.x],
    [region.x + region.w, trust.x + trust.w],
    [region.y + region.h, trust.y + trust.h],
  ]) {
    assert.ok(Math.abs(a! - b!) >= SEPARATION, `two frame edges are ${Math.abs(a! - b!)} units apart`);
  }
});

test("the sheet says what it leaves out", () => {
  const drawn = RUNS.reduce((n, r) => n + r.weight, 0);
  assert.ok(drawn > 0 && drawn < EDGES.length, "the runs must stand for real authored edges");
  assert.ok(
    EDGES.length - drawn > 0,
    "the omitted count is the honest half of a 14-edge ceiling over 120 edges",
  );
});

test("a node's centre is inside itself — the property rule 14 rests on", () => {
  for (const b of BOXES) {
    assert.ok(contains(b, { x: b.x + b.w / 2, y: b.y + b.h / 2 }));
  }
});
