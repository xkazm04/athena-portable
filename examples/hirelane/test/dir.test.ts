/**
 * The three directions' shared contract, and the two new spatial layouts.
 *
 * Round 3 prototypes three drawings of one pipeline. Two of them are pure
 * arithmetic with a surface drawn on top — where a room stands, where a seat
 * is, where a point lands — and arithmetic that is only ever checked by looking
 * at a screenshot is arithmetic nobody can change. Everything below is decided
 * without a DOM.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.chdir(mkdtempSync(join(tmpdir(), "hirelane-dir-test-")));

const { buildBoard } = await import("../lib/board");
const contract = await import("../components/board/dir/contract");
const rooms = await import("../components/board/dir/rooms/layout");
const field = await import("../components/board/dir/constellation/field");
const { STAGES } = await import("../lib/constants");

const board = buildBoard();
const ALL = { roleFilter: "all", onlyBorderline: false };
const groups = contract.groupsOf(board, ALL);

/* ------------------------------------------------------------- the contract */

test("the three directions are named, distinct, and every one is checkable", () => {
  assert.deepEqual([...contract.DIRECTIONS], ["board", "rooms", "constellation"]);
  assert.equal(new Set(contract.DIRECTIONS).size, contract.DIRECTIONS.length);
  for (const id of contract.DIRECTIONS) {
    assert.ok(contract.isDirection(id), `${id} round-trips through the guard`);
    assert.ok(contract.DIRECTION_LABEL[id], `${id} has a label`);
    assert.ok(contract.DIRECTION_NOTE[id], `${id} says what it is`);
    assert.ok(contract.DIRECTION_CONCEPT[id], `${id} says what it is a test OF`);
  }
  assert.ok(!contract.isDirection("plate"), "a sibling app's variant is not one of ours");
  assert.ok(!contract.isDirection(null));
});

test("the groups are stage-major, non-empty, and obey the filters", () => {
  assert.ok(groups.length > 0, "the seed produces groups, or this asserts nothing");

  const order = groups.map((g) => STAGES.indexOf(g.stage));
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i]! >= order[i - 1]!, "stage-major: a stage never comes back round");
  }
  for (const g of groups) {
    assert.ok(g.candidates.length > 0, `${g.id} holds somebody`);
    assert.equal(g.id, `${g.stage}::${g.role.id}`, "the id is the kit's group id");
  }

  const one = board.roles[0]!;
  const filtered = contract.groupsOf(board, { roleFilter: one.id, onlyBorderline: false });
  assert.ok(filtered.length > 0 && filtered.length < groups.length, "a role filter narrows");
  assert.ok(filtered.every((g) => g.role.id === one.id), "and it narrows to that role");

  const arguable = contract.groupsOf(board, { roleFilter: "all", onlyBorderline: true });
  assert.ok(
    arguable.every((g) => g.candidates.every((c) => c.borderline)),
    "borderline-only leaves only the flagged",
  );
});

test("the seeded population survives the grouping exactly once", () => {
  const seen = new Set<string>();
  let total = 0;
  for (const g of groups) {
    for (const c of g.candidates) {
      assert.ok(!seen.has(c.id), `${c.name} is in one group only`);
      seen.add(c.id);
      total += 1;
    }
  }
  const direct = board.roles.reduce((n, r) => n + r.totals.applicants, 0);
  assert.equal(total, direct, "every applicant is on the field, and only once");
});

test("the deterministic spread is in range and does not depend on the machine", () => {
  for (const id of ["a", "cand-17", "", "🙂", "a".repeat(200)]) {
    const v = contract.spread(id);
    assert.ok(v >= 0 && v < 1, `${JSON.stringify(id)} spreads into [0,1)`);
    assert.equal(v, contract.spread(id), "and it is the same answer twice");
  }
  assert.notEqual(contract.spread("a"), contract.spread("b"), "different ids, different places");
});

/* ----------------------------------------------------------------- the rooms */

test("the rooms stand in stage order, evenly spaced, and never overlap", () => {
  const n = STAGES.length;
  const xs = STAGES.map((_, i) => rooms.roomOrigin(i, n).x);
  for (let i = 1; i < n; i += 1) {
    assert.ok(xs[i]! > xs[i - 1]!, "left to right, the way the pipeline runs");
    assert.equal(
      Math.round(xs[i]! - xs[i - 1]!),
      rooms.ROOM_W + rooms.WALL,
      "one pitch apart, every time",
    );
    assert.ok(
      xs[i]! - xs[i - 1]! >= rooms.ROOM_W,
      "and the gap is at least a floor wide, so no two floors intersect",
    );
  }
  assert.ok(Math.abs(xs.reduce((a, b) => a + b, 0)) < 1e-9, "the set is centred on the origin");
  assert.equal(rooms.setExtent(n).w, (n - 1) * (rooms.ROOM_W + rooms.WALL) + rooms.ROOM_W);
  assert.equal(rooms.setExtent(0).w, 0, "no rooms is no extent, not a negative one");
});

test("a room is deep enough for what stands in it, at every count", () => {
  assert.equal(rooms.roomDepth(1), rooms.ROOM_D, "one table fits the resting floor");
  assert.equal(rooms.roomDepth(0), rooms.ROOM_D, "and so does an empty one");
  for (let n = 1; n <= 8; n += 1) {
    const depth = rooms.roomDepth(n);
    assert.ok(depth >= rooms.roomDepth(n - 1), "a room never shrinks as roles open");
    for (let i = 0; i < n; i += 1) {
      assert.ok(
        Math.abs(rooms.tablePose(i, n).y) + rooms.TABLE_RY < depth / 2,
        `table ${i} of ${n} is inside the room's own back wall`,
      );
    }
  }
});

test("tables stand on their own floor and are centred down it", () => {
  for (const count of [1, 2, 3, 4]) {
    const ys = Array.from({ length: count }, (_, i) => rooms.tablePose(i, count).y);
    assert.ok(Math.abs(ys.reduce((a, b) => a + b, 0)) < 1e-9, `${count} tables centre on the room`);
    for (let i = 1; i < count; i += 1) {
      assert.ok(ys[i]! > ys[i - 1]!, "tables run down the room in group order");
      assert.ok(
        ys[i]! - ys[i - 1]! > 2 * rooms.TABLE_RY,
        "and two table tops never touch",
      );
    }
  }
  assert.deepEqual(rooms.tablePose(0, 1), { x: 0, y: 0 }, "one table is in the middle");
});

test("seats ring the table, start at its head, and run clockwise", () => {
  for (const count of [1, 2, 3, 5, 8, 12]) {
    const seats = Array.from({ length: count }, (_, i) => rooms.seatPose(i, count));
    const first = seats[0]!;
    assert.ok(Math.abs(first.x) < 1e-9, "the first seat is on the table's axis");
    assert.ok(first.y < 0, "at the head, nearest the reader");

    for (const s of seats) {
      /* On the ellipse, to the precision the arithmetic promises. */
      const rx = rooms.TABLE_RX + rooms.SEAT_OUT;
      const ry = rooms.TABLE_RY + rooms.SEAT_OUT;
      const on = (s.x / rx) ** 2 + (s.y / ry) ** 2;
      assert.ok(Math.abs(on - 1) < 1e-9, `a seat of ${count} sits on the ring`);
    }
    if (count >= 3) {
      const second = seats[1]!;
      assert.ok(second.x > 0, "the second seat is to the right: clockwise");
    }
    const keys = new Set(seats.map((s) => `${s.x.toFixed(6)},${s.y.toFixed(6)}`));
    assert.equal(keys.size, count, "no two of the same table share a seat");
  }
  assert.deepEqual(rooms.seatPose(0, 0), { x: 0, y: 0 }, "an empty table seats nobody at 0,0");
});

test("a table over the cap counts the rest instead of drawing it", () => {
  assert.deepEqual(rooms.seatingFor(4), { seated: 4, hidden: 0 });
  assert.deepEqual(rooms.seatingFor(rooms.SEAT_CAP), { seated: rooms.SEAT_CAP, hidden: 0 });
  assert.deepEqual(rooms.seatingFor(rooms.SEAT_CAP + 5), { seated: rooms.SEAT_CAP, hidden: 5 });
  assert.deepEqual(rooms.seatingFor(0), { seated: 0, hidden: 0 });
});

test("the camera's room pose and the room under the camera are inverses", () => {
  const n = STAGES.length;
  for (let i = 0; i < n; i += 1) {
    const pose = rooms.roomPose(i, n);
    assert.equal(rooms.roomAt(pose.pan, n), i, `flying to room ${i} lands over room ${i}`);
    assert.equal(pose.zoom, rooms.ZOOM_ROOM, "and at the room band");
  }
  const rest = rooms.roomPose(null, n);
  assert.deepEqual(rest, { zoom: rooms.ZOOM_REST, pan: { x: 0, y: 0 } });
  assert.equal(rooms.roomAt({ x: 0, y: 0 }, n), Math.floor(n / 2), "at rest, the middle room");
  assert.equal(rooms.roomAt({ x: 1e9, y: 0 }, n), 0, "panned past the end, clamped, never null");
  assert.equal(rooms.roomAt({ x: -1e9, y: 0 }, n), n - 1);
  assert.equal(rooms.roomAt({ x: 0, y: 0 }, 0), null, "no rooms, no room");

  for (const tables of [1, 2, 3]) {
    for (let t = 0; t < tables; t += 1) {
      const pose = rooms.roomPose(2, n, t, tables);
      assert.equal(rooms.roomAt(pose.pan, n), 2, "a table pose stays in its own room");
      assert.equal(rooms.tableAt(pose.pan, tables), t, `and over table ${t}`);
      assert.equal(pose.zoom, rooms.ZOOM_TABLE);
    }
  }
});

test("the rooms' zoom bands are ordered and the bounds contain them", () => {
  assert.ok(rooms.ZOOM_REST < rooms.ZOOM_ROOM && rooms.ZOOM_ROOM < rooms.ZOOM_TABLE);
  const bounds = rooms.roomsBounds(STAGES.length);
  assert.ok(bounds.zoom[0] < rooms.ZOOM_REST, "you may stand further back than rest");
  assert.ok(bounds.zoom[1] > rooms.ZOOM_TABLE, "and closer than a table");
  const end = rooms.roomPose(STAGES.length - 1, STAGES.length).pan.x;
  assert.ok(
    end >= bounds.pan.x[0] && end <= bounds.pan.x[1],
    "the last room is reachable inside the pan bounds",
  );
});

/* --------------------------------------------------------- the constellation */

test("the bands partition the field with no gap and no overlap", () => {
  const bands = field.bandsOf(groups);
  assert.equal(bands.length, groups.length, "one band per group");
  assert.equal(bands[0]!.x0, 0, "the field starts at 0");
  assert.equal(bands[bands.length - 1]!.x1, 1, "and ends at 1");
  for (let i = 0; i < bands.length; i += 1) {
    assert.ok(bands[i]!.x1 > bands[i]!.x0, "a band has width");
    if (i > 0) assert.equal(bands[i]!.x0, bands[i - 1]!.x1, "and abuts the one before it");
  }
  const widths = bands.map((b) => b.x1 - b.x0);
  for (const w of widths) {
    assert.ok(Math.abs(w - widths[0]!) < 1e-12, "every score axis is the same length");
  }
  assert.deepEqual(field.bandsOf([]), [], "no groups, no bands");
});

test("every candidate lands inside their own band, and the unscored in its gutter", () => {
  const bands = field.bandsOf(groups);
  const ceiling = field.evidenceCeiling(groups);
  assert.ok(ceiling > 0, "somebody in this seed quoted something");

  let scored = 0;
  let unscored = 0;
  for (const [i, g] of groups.entries()) {
    const band = bands[i]!;
    assert.equal(band.id, g.id, "bands and groups are in the same order");
    for (const c of g.candidates) {
      const p = field.pointOf(c, band, ceiling);
      assert.ok(p.x >= band.x0 && p.x <= band.x1, `${c.name} is inside ${band.id}`);
      assert.ok(p.y >= 0 && p.y <= 1, `${c.name} is on the field`);
      assert.equal(p.unscored, !c.scored, "the gutter flag is the stored fact");
      if (c.scored) {
        assert.ok(p.x > field.gutterEdge(band), `${c.name} is scored, so off the gutter`);
        scored += 1;
      } else {
        assert.ok(p.x < field.gutterEdge(band), `${c.name} is unscored, so in the gutter`);
        unscored += 1;
      }
      assert.deepEqual(field.pointOf(c, band, ceiling), p, "the same point twice");
    }
  }
  assert.ok(scored > 0 && unscored > 0, "the seed exercises both sides of the gutter");
});

test("the unread stand in a queue, longest wait at the top", () => {
  const bands = field.bandsOf(groups);
  const ceiling = field.evidenceCeiling(groups);
  const longest = field.waitCeiling(groups);
  assert.ok(longest > 0, "the seed has somebody waiting, or this asserts nothing");

  const g = groups.find((x) => x.candidates.filter((c) => !c.scored).length >= 3);
  assert.ok(g, "the seed has a group with three unread applications");
  const band = bands[groups.indexOf(g!)]!;
  const queue = g!.candidates
    .filter((c) => !c.scored)
    .slice()
    .sort((a, b) => a.meta.waitingDays - b.meta.waitingDays);
  for (let i = 1; i < queue.length; i += 1) {
    if (queue[i]!.meta.waitingDays === queue[i - 1]!.meta.waitingDays) continue;
    const shorter = field.pointOf(queue[i - 1]!, band, ceiling, longest);
    const longerWait = field.pointOf(queue[i]!, band, ceiling, longest);
    assert.ok(
      longerWait.y > shorter.y,
      `${queue[i]!.name} has waited longer than ${queue[i - 1]!.name}, so stands higher`,
    );
    assert.ok(shorter.x < field.gutterEdge(band), "and both stay off the score axis");
  }
});

test("no two people on the field are drawn at the same place", () => {
  const bands = field.bandsOf(groups);
  const ceiling = field.evidenceCeiling(groups);
  const seen = new Set<string>();
  for (const [i, g] of groups.entries()) {
    for (const c of g.candidates) {
      const p = field.pointOf(c, bands[i]!, ceiling, field.waitCeiling(groups));
      const key = `${p.x.toFixed(9)},${p.y.toFixed(9)}`;
      assert.ok(!seen.has(key), `${c.name} has a place of their own`);
      seen.add(key);
    }
  }
});

test("a higher weighted score is always further right in the same band", () => {
  const bands = field.bandsOf(groups);
  const ceiling = field.evidenceCeiling(groups);
  const g = groups.find((x) => x.candidates.filter((c) => c.scored).length >= 3);
  assert.ok(g, "the seed has a group with three scored candidates");
  const band = bands[groups.indexOf(g!)]!;
  const scored = g!.candidates.filter((c) => c.scored).slice().sort((a, b) => a.overall - b.overall);
  for (let i = 1; i < scored.length; i += 1) {
    if (scored[i]!.overall === scored[i - 1]!.overall) continue;
    const lo = field.pointOf(scored[i - 1]!, band, ceiling);
    const hi = field.pointOf(scored[i]!, band, ceiling);
    assert.ok(hi.x > lo.x, `${scored[i]!.name} outscores ${scored[i - 1]!.name}, so sits right of them`);
  }
});

test("the camera's band pose and the band under the camera are inverses", () => {
  const bands = field.bandsOf(groups);
  for (const band of bands) {
    const pose = field.bandPose(band);
    assert.equal(field.bandAt(pose.pan, bands)?.id, band.id, `${band.id} flies to itself`);
    assert.equal(pose.zoom, field.ZOOM_BAND);
  }
  assert.deepEqual(field.bandPose(null), { zoom: field.ZOOM_REST, pan: { x: 0, y: 0 } });
  assert.equal(field.bandAt({ x: 1e9, y: 0 }, bands)?.id, bands[0]!.id, "clamped, never null");
  assert.equal(field.bandAt({ x: -1e9, y: 0 }, bands)?.id, bands[bands.length - 1]!.id);
  assert.equal(field.bandAt({ x: 0, y: 0 }, []), null, "an empty field has no band");
});

test("flying to a point puts that point nearest the camera", () => {
  const bands = field.bandsOf(groups);
  const ceiling = field.evidenceCeiling(groups);
  const g = groups[0]!;
  const band = bands[0]!;
  const points = g.candidates.map((c) => ({ key: c.id, point: field.pointOf(c, band, ceiling) }));
  for (const p of points) {
    const pose = field.pointPose(p.point);
    assert.equal(field.pointAt(pose.pan, points), p.key, "the point you flew to is the one under you");
    assert.equal(pose.zoom, field.ZOOM_CARD);
  }
  assert.equal(field.pointAt({ x: 0, y: 0 }, []), null, "nothing there is nothing found");
});

test("the constellation's zoom bands are ordered and the bounds contain them", () => {
  assert.ok(field.ZOOM_REST < field.ZOOM_BAND && field.ZOOM_BAND < field.ZOOM_CARD);
  const bounds = field.fieldBounds();
  assert.ok(bounds.zoom[0] < field.ZOOM_REST && bounds.zoom[1] > field.ZOOM_CARD);
  const bands = field.bandsOf(groups);
  for (const band of bands) {
    const pan = field.bandPose(band).pan;
    assert.ok(
      pan.x >= bounds.pan.x[0] && pan.x <= bounds.pan.x[1],
      `${band.id} is reachable inside the pan bounds`,
    );
  }
});
