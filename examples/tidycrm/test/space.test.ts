/**
 * ONE SPACE, three depths — the arithmetic, pinned.
 *
 * Round 3 made L0 and L1 the same scene at two camera distances. There is no
 * hand-off left to get wrong, and in its place there are three things that can
 * be, all of them pure:
 *
 *   1. the ENCODING. `CameraPose` has four degrees of freedom and a camera
 *      flying into an off-origin octant needs six. `camera.ts` decomposes the
 *      target in the view basis and absorbs the third component into `zoom`;
 *      if that round-trip is not exact, every flight lands beside its octant.
 *   2. the FIT. Nine cells in a cube, and a grid of table slabs inside each
 *      one. If the core overlaps the eight around it, or a slab overhangs its
 *      octant, the picture is a lie about what contains what.
 *   3. the AGREEMENT between the slab a table is drawn as and the label
 *      projected onto it. They are drawn by two different technologies from the
 *      same numbers, and this is where the numbers are held to each other.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const g = await import("../components/blocks/space/geometry");
const c = await import("../components/blocks/space/camera");
const { DATABASE_IDS, CAMERA_Z } = await import("../components/blocks/model");

const near = (a: number, b: number, eps = 1e-9, what = "") =>
  assert.ok(Math.abs(a - b) < eps, `${what} ${a} != ${b}`);

type Vec3 = { x: number; y: number; z: number };
const dot = (p: Vec3, q: Vec3) => p.x * q.x + p.y * q.y + p.z * q.z;
const len = (p: Vec3) => Math.hypot(p.x, p.y, p.z);

/* ------------------------------------------------------------- 1. the basis */

test("the view basis is orthonormal at every orientation", () => {
  for (const yaw of [-2.7, -0.32, 0, 0.42, 1.15, 2.9]) {
    for (const pitch of [-1.2, -0.1, 0, 0.3, 0.92, 1.2]) {
      const b = c.basisOf(yaw, pitch);
      for (const [name, v] of Object.entries(b)) near(len(v), 1, 1e-12, `|${name}|`);
      near(dot(b.right, b.up), 0, 1e-12, "right·up");
      near(dot(b.right, b.dir), 0, 1e-12, "right·dir");
      near(dot(b.up, b.dir), 0, 1e-12, "up·dir");
    }
  }
});

test("pitch lifts the eye and yaw turns it, in that handedness", () => {
  // At rest the eye is on +Z looking down -Z, which is the camera round 2 used.
  const flat = c.basisOf(0, 0);
  near(flat.dir.z, 1, 1e-12, "dir.z");
  near(flat.up.y, 1, 1e-12, "up.y");
  // Positive pitch puts the eye ABOVE, so the reader looks down on the cube.
  assert.ok(c.basisOf(0, 0.5).dir.y > 0, "pitch lifts the eye");
  assert.ok(c.basisOf(0.5, 0).dir.x > 0, "yaw turns the eye toward +x");
});

/* -------------------------------------------------------- 2. the encoding */

test("a pose looking at a point puts the eye exactly there, at exactly that range", () => {
  // The whole of `camera.ts`'s claim: four numbers can carry a six-degree
  // camera, because the sixth is a distance and distance is what zoom is.
  for (const at of [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 1, z: 1 },
    { x: -1, y: -1, z: 1 },
    { x: 0.3, y: -1.9, z: 2.2 },
  ]) {
    for (const [yaw, pitch, away] of [
      [0.42, 0.3, 3.5],
      [-2.1, -0.6, 1.9],
      [1.15, 0.92, 6],
    ] as const) {
      const pose = c.poseLookingAt(at, yaw, pitch, away);
      const { eye, basis } = c.eyeOf(pose);
      near(eye.x, at.x + basis.dir.x * away, 1e-9, "eye.x");
      near(eye.y, at.y + basis.dir.y * away, 1e-9, "eye.y");
      near(eye.z, at.z + basis.dir.z * away, 1e-9, "eye.z");
      near(c.offAxis(at, pose), 0, 1e-9, "the point is on the view axis");
    }
  }
});

test("the rest pose is the whole cube at zoom one", () => {
  assert.equal(c.REST.zoom, 1);
  assert.deepEqual(c.REST.pan, { x: 0, y: 0 });
  near(c.eyeOf(c.REST).eye.y, CAMERA_Z * Math.sin(c.REST.pitch), 1e-9, "the eye is at camera-z");
  // Every one of the nine is in front of the camera and inside the frame.
  for (const id of DATABASE_IDS) {
    const box = g.boxOf(id);
    const p = c.project({ x: box.cx, y: box.cy, z: box.cz }, c.REST, { w: 1000, h: 700 });
    assert.ok(p.depth > 0, `${id} is behind the camera at rest`);
    assert.ok(p.x > 0 && p.x < 1000 && p.y > 0 && p.y < 700, `${id} is off frame at rest`);
  }
});

/* ------------------------------------------------------------- 3. the fit */

test("the nine cells do not overlap: the core fits in the gap the eight leave", () => {
  const boxes = DATABASE_IDS.map((id) => ({ id, box: g.boxOf(id) }));
  assert.equal(boxes.filter((b) => b.box.core).length, 1, "exactly one core");
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!.box;
      const b = boxes[j]!.box;
      const apart =
        Math.abs(a.cx - b.cx) >= (a.w + b.w) / 2 - 1e-9 ||
        Math.abs(a.cy - b.cy) >= (a.h + b.h) / 2 - 1e-9 ||
        Math.abs(a.cz - b.cz) >= (a.d + b.d) / 2 - 1e-9;
      assert.ok(apart, `${boxes[i]!.id} and ${boxes[j]!.id} intersect`);
    }
  }
});

test("a database's table slabs stand inside its own octant", () => {
  // Four to seven, which is the band `model/databases.ts` commits to, plus the
  // edges either side of it so a merge that empties a domain cannot overhang.
  for (const id of DATABASE_IDS) {
    const box = g.boxOf(id);
    const basis = c.basisOf(c.faceOf(id).yaw, c.faceOf(id).pitch);
    for (const count of [1, 3, 4, 5, 6, 7, 9]) {
      for (let i = 0; i < count; i += 1) {
        const slot = g.slotOf(i, count, box);
        assert.ok(
          Math.abs(slot.u) + slot.w / 2 <= box.w / 2 + 1e-9,
          `${id}: slab ${i} of ${count} overhangs across`,
        );
        assert.ok(
          Math.abs(slot.v) + slot.h / 2 <= box.h / 2 + 1e-9,
          `${id}: slab ${i} of ${count} overhangs up`,
        );
        assert.ok(slot.n > 0 && slot.n < box.d / 2, `${id}: slab ${i} is not inside the volume`);
        // And in world units it is still within the octant's own sphere.
        const w = g.slotWorld(slot, box, basis);
        const off = Math.hypot(w.x - box.cx, w.y - box.cy, w.z - box.cz);
        assert.ok(off <= (box.w / 2) * Math.sqrt(3) + 1e-9, `${id}: slab ${i} is outside its cell`);
      }
    }
  }
});

test("no two slabs in one database overlap", () => {
  const box = g.boxOf("billing");
  for (const count of [4, 5, 6, 7]) {
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const a = g.slotOf(i, count, box);
        const b = g.slotOf(j, count, box);
        const apart = Math.abs(a.u - b.u) >= (a.w + b.w) / 2 || Math.abs(a.v - b.v) >= (a.h + b.h) / 2;
        assert.ok(apart, `slabs ${i} and ${j} of ${count} overlap`);
      }
    }
  }
});

test("every slab is portrait, and the card is told which portrait", () => {
  // The card is authored at one width and given its OWN slab's aspect in
  // height, written per cell. A card sized from a constant hangs off the slabs
  // of a seven-table database, which is dealt three rows instead of two — and
  // the first cut of this level printed its last figure on the wall behind.
  const box = g.boxOf("billing");
  for (const count of [4, 5, 6, 7]) {
    const slot = g.slotOf(0, count, box);
    assert.ok(slot.h > slot.w, `${count} tables gives a landscape slab`);
  }
  // The two-row case is every database in this seed, and it is the CSS fallback.
  const two = g.slotOf(0, 6, box);
  const css = readFileSync(
    fileURLToPath(new URL("../components/blocks/style/level0/l0.css", import.meta.url)),
    "utf8",
  );
  const fallback = /var\(--ar,\s*([\d.]+)\)/.exec(css);
  assert.ok(fallback, "l0.css does not size the card from --ar");
  assert.ok(
    Math.abs(two.h / two.w - Number(fallback[1])) < 0.03,
    `the slab is ${(two.h / two.w).toFixed(3)} tall and the fallback says ${fallback[1]}`,
  );
  const projector = readFileSync(
    fileURLToPath(new URL("../components/blocks/field/useProjector.ts", import.meta.url)),
    "utf8",
  );
  assert.match(projector, /setProperty\("--ar"/, "nothing writes the per-card aspect");
});

test("the slabs are dealt three across, in reading order", () => {
  const box = g.boxOf("billing");
  const six = [0, 1, 2, 3, 4, 5].map((i) => g.slotOf(i, 6, box));
  assert.ok(six[0]!.u < six[1]!.u && six[1]!.u < six[2]!.u, "the first row reads left to right");
  assert.ok(six[3]!.v < six[0]!.v, "the second row is below the first");
  near(six[0]!.u, six[3]!.u, 1e-12, "columns line up");
});

/* --------------------------------------------- 4. what is under the camera */

test("flying to a database puts that database under the camera", () => {
  for (const id of DATABASE_IDS) {
    const pose = c.poseFor({ level: 1, group: id });
    assert.equal(c.resolveGroup(pose), id, id);
  }
});

test("the resting pose is above the band, and every database's is below it", () => {
  // The band is what `useSemanticZoom` reads. If a database's own pose did not
  // clear it, arriving there would immediately dispatch a return to L0.
  assert.ok(c.REST.zoom < c.BANDS[0], "rest is L0");
  for (const id of DATABASE_IDS) {
    const pose = c.poseFor({ level: 1, group: id });
    assert.ok(pose.zoom > c.BANDS[0] * 1.1, `${id} arrives at zoom ${pose.zoom.toFixed(2)}`);
    assert.ok(pose.zoom <= c.BOUNDS.zoom[1], `${id} arrives past the zoom bound`);
  }
});

test("L2 holds the camera where L1 left it", () => {
  assert.deepEqual(c.poseFor({ level: 2, group: "support" }), c.poseFor({ level: 1, group: "support" }));
  assert.deepEqual(c.poseFor({ level: 0, group: null }), c.REST);
  assert.deepEqual(c.poseFor({ level: 1, group: null }), c.REST);
});

test("a camera aimed at one slab resolves to that table and no other", () => {
  const idents = ["BLK-01", "BLK-02", "BLK-03", "BLK-04", "BLK-05", "BLK-06"];
  const box = g.boxOf("crm-eu");
  const face = c.faceOf("crm-eu");
  const basis = c.basisOf(face.yaw, face.pitch);
  idents.forEach((ident, i) => {
    const at = g.slotWorld(g.slotOf(i, idents.length, box), box, basis);
    const pose = c.poseLookingAt(at, face.yaw, face.pitch, c.standOff(box));
    assert.equal(c.resolveItem(pose, "crm-eu", idents), ident, `slab ${i}`);
  });
});

/* ------------------------------------------------------- 5. the projection */

test("what the camera looks at lands in the middle of the frame", () => {
  const frame = { w: 1200, h: 640 };
  for (const id of DATABASE_IDS) {
    const box = g.boxOf(id);
    const p = c.project({ x: box.cx, y: box.cy, z: box.cz }, c.poseFor({ level: 1, group: id }), frame);
    near(p.x, frame.w / 2, 1e-6, `${id} x`);
    near(p.y, frame.h / 2, 1e-6, `${id} y`);
    assert.ok(p.scale > 0, `${id} has no scale`);
  }
});

test("a slab and its label agree about how big the slab is on screen", () => {
  // The slab is drawn by three and the label is placed by this arithmetic. The
  // agreement is the whole reason L1 can be WebGL and DOM at once.
  const frame = { w: 1200, h: 640 };
  const box = g.boxOf("billing");
  const face = c.faceOf("billing");
  const basis = c.basisOf(face.yaw, face.pitch);
  const pose = c.poseFor({ level: 1, group: "billing" });
  const slot = g.slotOf(0, 6, box);
  const at = g.slotWorld(slot, box, basis);
  const mid = c.project(at, pose, frame);
  const edge = c.project(
    { x: at.x + (slot.w / 2) * basis.right.x, y: at.y + (slot.w / 2) * basis.right.y, z: at.z + (slot.w / 2) * basis.right.z },
    pose,
    frame,
  );
  // Within a tenth of a pixel: the edge is off-axis, so the perspective divide
  // is not quite the centre's, and a label sized by the centre's scale is
  // allowed to be that wrong and no wronger.
  assert.ok(
    Math.abs(edge.x - mid.x - (slot.w / 2) * mid.scale) < 0.1,
    "the label's scale does not match the slab's width",
  );
});

test("a point behind the camera has no scale and is not placed", () => {
  const behind = c.project({ x: 0, y: 0, z: 40 }, { ...c.REST, yaw: 0, pitch: 0 }, { w: 800, h: 600 });
  assert.ok(behind.depth < 0);
  assert.equal(behind.scale, 0);
});

/* ---------------------------------------------------------- 6. the magnet */

test("the magnet takes a pose released near one of the four, and no other", () => {
  const front = c.POSES[0]!;
  const nudged = { ...c.REST, yaw: front.yaw + 0.05, pitch: front.pitch - 0.04 };
  assert.deepEqual(c.snapNear(nudged, false), { ...nudged, yaw: front.yaw, pitch: front.pitch });

  const chosen = { ...c.REST, yaw: front.yaw + 0.7, pitch: front.pitch + 0.5 };
  assert.deepEqual(c.snapNear(chosen, false), chosen, "a pose the reader chose is left alone");
});

test("the magnet is off inside a database", () => {
  // The four poses are readings of the WHOLE cube. Snapping to one from inside
  // an octant would throw the reader out of the thing they opened.
  const front = c.POSES[0]!;
  const nudged = { ...c.REST, yaw: front.yaw + 0.05, pitch: front.pitch - 0.04, zoom: 1.9 };
  assert.deepEqual(c.snapNear(nudged, true), nudged);
});

test("yaw wraps, so a pose a full turn away is still near", () => {
  const front = c.POSES[0]!;
  const round = { ...c.REST, yaw: front.yaw + 2 * Math.PI + 0.03 };
  assert.equal(c.snapNear(round, false).yaw, front.yaw);
  assert.equal(c.poseName(round), "front");
  assert.equal(c.poseName({ ...c.REST, yaw: front.yaw + 0.4 }), null);
});

test("the four poses are far enough apart that the magnet is unambiguous", () => {
  for (let i = 0; i < c.POSES.length; i += 1) {
    for (let j = i + 1; j < c.POSES.length; j += 1) {
      const a = c.POSES[i]!;
      const b = c.POSES[j]!;
      const off = Math.hypot(a.yaw - b.yaw, a.pitch - b.pitch);
      assert.ok(off > 2 * c.SNAP_NEAR, `${a.id} and ${b.id} are ${off.toFixed(2)} apart`);
    }
  }
});

test("the pitch bound stops short of the poles", () => {
  assert.ok(c.BOUNDS.pitch[0] > -Math.PI / 2, "a camera under the floor has no horizon");
  assert.ok(c.BOUNDS.pitch[1] < Math.PI / 2);
  assert.equal(c.BOUNDS.yaw, "free", "a cube has no front");
});
