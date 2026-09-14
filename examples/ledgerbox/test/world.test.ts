/**
 * The world, held where it is pure.
 *
 * Round 3 turned three levels into one map, and the whole of that claim rests on one property:
 * there is exactly ONE answer to "where is invoice X", read by every band. These tests are that
 * property, plus the camera arithmetic the app writes on top of the kit's — the pan that centres
 * a point, the clamp that keeps the world covering the frame, and the poses a click, a wheel and
 * a tool all have to agree on.
 *
 * No DOM and no React, which is why the geometry lives in `components/lanes/world/layout.ts`
 * rather than inside the component that draws it.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LANE_MIN,
  NAV_BANDS,
  ROW_H,
  ZOOM,
  buildWorld,
  centreOf,
  clampPan,
  laneAt,
  markAt,
  panTo,
  poseForFocus,
  poseForLane,
  poseForMark,
  timeAt,
  visibleSpan,
  type Frame,
  type LnWorld,
  type Pose,
} from "../components/lanes/world/layout";
import {
  BAND_LABEL,
  BANDS,
  INV_RATIO,
  bandOf,
  levelOfBand,
  quantizeInverse,
} from "../components/lanes/world/bands";
import type { LnMark, LnSheet } from "../components/lanes/model";

const FRAME: Frame = { w: 1440, h: 620 };

function mark(over: Partial<LnMark>): LnMark {
  return {
    id: "inv_0001",
    number: "LB-2026-0001",
    clientId: "c1",
    clientName: "Halcyon Works",
    category: "design",
    issuedAt: "2026-07-01T00:00:00.000Z",
    dueAt: "2026-07-31T00:00:00.000Z",
    amountCents: 100_00,
    paidCents: 0,
    balanceCents: 100_00,
    state: "open",
    daysOverdue: 0,
    candidateCount: 0,
    remindersSent: 0,
    hasDraft: false,
    heat: "watch",
    x: 0.5,
    weight: 0.5,
    row: 0,
    status: "within terms",
    ...over,
  };
}

/** Two lanes, six invoices, one of them late, on a quarter-long axis. */
function sheet(): LnSheet {
  const lane = (id: string, xs: number[], over: Partial<LnMark>[] = []) => ({
    id,
    label: id,
    blurb: `the ${id} area`,
    marks: xs.map((x, i) => mark({ id: `${id}_${i}`, x, ...(over[i] ?? {}) })),
    rows: 1,
    count: xs.length,
    invoicedCents: 0,
    collectedCents: 0,
    owedCents: 100,
    lateCents: 0,
    lateCount: 0,
    worstDays: 0,
    heat: "watch",
  });
  return {
    lanes: [
      lane("design", [0.05, 0.08, 0.6], [{ daysOverdue: 40 }, {}, {}]),
      lane("retainer", [0.2, 0.9, 0.92]),
    ],
    axis: {
      startIso: "2026-06-01T00:00:00.000Z",
      endIso: "2026-10-31T00:00:00.000Z",
      todayX: 0.62,
      months: [
        { label: "JUN", x: 0 },
        { label: "SEP", x: 0.62 },
      ],
    },
    clients: [],
    totals: {
      invoiceCount: 6,
      invoicedCents: 0,
      collectedCents: 0,
      outstandingCents: 0,
      overdueCents: 0,
      overdueCount: 0,
      disputedCount: 0,
      unmatchedCount: 0,
    },
    details: {},
  } as unknown as LnSheet;
}

const world = (frame: Frame = FRAME): LnWorld => buildWorld(sheet(), frame);

const pose = (over: Partial<Pose> = {}): Pose => ({
  yaw: 0,
  pitch: 0,
  zoom: 1,
  pan: { x: 0, y: 0 },
  ...over,
});

/* ------------------------------------------------------------------------ time, lane, invoice */

test("zoom 1 is the world at its natural size, and the natural size is the frame", () => {
  // The whole reason the band thresholds can be plain numbers. If this stops being true the
  // far band needs a fit, and `ZOOM.mid` stops meaning the same thing on two monitors.
  const w = world();
  assert.equal(w.w, FRAME.w);
  assert.equal(ZOOM.min, 1, "there is nothing further out than the resting frame");
});

test("the world fits the frame whenever the row height can make it fit", () => {
  // The far band's whole job is reading at a glance, so the map must be on the screen at rest.
  // The row is SOLVED for, not divided for, because a lane at its floor does not shrink with it.
  for (const h of [500, 620, 900, 1200]) {
    const w = world({ w: 1440, h });
    assert.ok(w.h <= h + 1e-6, `the world is ${w.h} in a frame of ${h}`);
  }
});

test("the row height is bounded at both ends, and a short frame never grows a row", () => {
  // The floor is what stops a tall sheet of books from shaving the marks to hairlines: below
  // it the world grows past the frame instead and the reader pans, which is what a map is for.
  // The ceiling is what stops two lanes of three invoices from becoming a poster.
  for (const h of [240, 300, 620, 1400, 4000]) {
    const w = world({ w: 1440, h });
    assert.ok(w.rowH >= ROW_H.min && w.rowH <= ROW_H.max, `row ${w.rowH} at frame ${h}`);
  }
  assert.ok(world({ w: 1440, h: 300 }).rowH <= world({ w: 1440, h: 620 }).rowH);
});

test("many lanes push the row to its floor and the world past the frame", () => {
  // The real books are six lanes of a hundred and twenty-five invoices; this is that shape.
  const many = { ...sheet(), lanes: Array.from({ length: 14 }, () => sheet().lanes[0]!) };
  const w = buildWorld(many as unknown as LnSheet, { w: 1440, h: 400 });
  assert.equal(w.rowH, ROW_H.min, "the row is at its floor");
  assert.ok(w.h > 400, "so the world is taller than the frame and the reader pans");
});

test("time is x and it is the due date: later is further right, and now is where the axis says", () => {
  const w = world();
  const first = w.marks.get("design_0")!;
  const last = w.marks.get("retainer_2")!;
  assert.ok(first.cell.x < last.cell.x);
  assert.ok(first.cell.x >= w.timeX0, "nothing is drawn in the gutter");
  assert.ok(last.cell.x <= w.timeX0 + w.timeW);
  assert.ok(Math.abs(w.nowX - (w.timeX0 + 0.62 * w.timeW)) < 1e-6);
});

test("a lane is a band of y, the bands do not overlap, and every invoice is inside its own", () => {
  const w = world();
  let previousBottom = 0;
  for (const lane of w.lanes) {
    assert.ok(lane.y >= previousBottom, `${lane.id} overlaps the lane above it`);
    previousBottom = lane.y + lane.h;
    for (const m of lane.marks) {
      assert.ok(m.cell.y >= lane.y - 1e-9, `${m.id} is above its lane`);
      assert.ok(m.cell.y + m.cell.h <= lane.y + lane.h + 1e-9, `${m.id} is below its lane`);
    }
  }
});

test("a mark's cell is in SCENE coordinates, and its offset inside its lane is small", () => {
  // The bug this pins: `cell.y` is absolute, and the renderer draws a mark inside its lane's own
  // box. Forgetting to subtract the lane's `y` leaves five empty lanes and one lane's invoices
  // stacked over the lane below it — which is exactly what the first capture showed.
  const w = world();
  for (const lane of w.lanes) {
    for (const m of lane.marks) {
      const local = m.cell.y - lane.y;
      assert.ok(local >= 0, `${m.id} is above its lane in local coordinates`);
      assert.ok(local + m.cell.h <= lane.h + 1e-9, `${m.id} is below its lane in local coordinates`);
    }
  }
});

test("a one-row area is still as tall as its own name and figures", () => {
  for (const lane of world().lanes) {
    assert.ok(lane.h >= LANE_MIN, `${lane.id} is ${lane.h}, under the head's own floor`);
  }
});

test("the bar sits inside the cell it will become a card in — one answer, at every band", () => {
  // The claim of the round: zooming does not move an invoice, it only draws it larger.
  for (const m of world().marks.values()) {
    assert.equal(m.bar.x, m.cell.x, `${m.id}'s bar has left its cell`);
    const centre = m.cell.y + m.cell.h / 2;
    assert.ok(Math.abs(m.bar.y + m.bar.h / 2 - centre) < 1e-9, `${m.id}'s bar is off its row`);
    assert.ok(m.bar.h <= m.cell.h, `${m.id}'s bar is taller than its cell`);
  }
});

test("two invoices due in the same week take different rows; one alone takes the first", () => {
  const w = world();
  const design = w.lanes.find((l) => l.id === "design")!;
  const [a, b, c] = design.marks;
  // 0.05 and 0.08 are inside one card's footprint of the axis; 0.6 is not.
  assert.notEqual(a!.row, b!.row, "colliding invoices share a row");
  assert.equal(c!.row, 0, "an invoice with room takes the first row");
  assert.ok(design.rows >= 2);
});

test("the tail runs from the bar to the now-line, and only when the invoice is late", () => {
  const w = world();
  const late = w.marks.get("design_0")!;
  const not = w.marks.get("design_1")!;
  assert.ok(late.tail.w > 0);
  assert.ok(Math.abs(late.tail.x + late.tail.w - w.nowX) < 1e-6, "the tail ends at NOW");
  assert.equal(not.tail.w, 0);
});

/* -------------------------------------------------------------------------- the camera's math */

test("panTo and centreOf are inverses, at any zoom", () => {
  const w = world();
  const point = { x: 812, y: 240 };
  for (const zoom of [ZOOM.min, 1, ZOOM.mid, ZOOM.near, ZOOM.max]) {
    const p = pose({ zoom, pan: panTo(point, w) });
    const back = centreOf(p, w);
    assert.ok(Math.abs(back.x - point.x) < 1e-9, `x at zoom ${zoom}`);
    assert.ok(Math.abs(back.y - point.y) < 1e-9, `y at zoom ${zoom}`);
  }
});

test("the visible span halves as the zoom doubles", () => {
  const a = visibleSpan(pose({ zoom: 2 }), FRAME);
  const b = visibleSpan(pose({ zoom: 4 }), FRAME);
  assert.equal(a.w, FRAME.w / 2);
  assert.equal(b.w, a.w / 2);
});

test("the clamp keeps the world covering the frame, and centres an axis with nothing to hold", () => {
  const w = world();
  // Dragged far off the left at a close zoom: the camera comes back to half a screen in.
  const off = clampPan(pose({ zoom: 6, pan: { x: 99_999, y: 99_999 } }), w, FRAME);
  const here = centreOf(off, w);
  const span = visibleSpan(off, FRAME);
  assert.ok(here.x >= span.w / 2 - 1e-9 && here.x <= w.w - span.w / 2 + 1e-9);
  assert.ok(here.y >= span.h / 2 - 1e-9 && here.y <= w.h - span.h / 2 + 1e-9);
  // At zoom 1 the frame is wider than nothing is left over on x: the world is centred.
  const rest = clampPan(pose({ zoom: 1, pan: { x: 400, y: 0 } }), w, FRAME);
  assert.ok(Math.abs(centreOf(rest, w).x - w.w / 2) < 1e-9, "no edge to hold, so it centres");
});

test("a clamped pose is already clamped — the snap is idempotent", () => {
  const w = world();
  const once = clampPan(pose({ zoom: 5, pan: { x: -800, y: -300 } }), w, FRAME);
  const twice = clampPan(once, w, FRAME);
  assert.deepEqual(twice.pan, once.pan);
});

/* ------------------------------------------------------------------ what is under the camera */

test("the lane under the camera is the lane whose band the camera is in", () => {
  const w = world();
  for (const lane of w.lanes) {
    assert.equal(laneAt(w, lane.y + lane.h / 2), lane.id);
  }
  // Above everything and below everything both answer the nearest lane, never null: the reader
  // is always somewhere, and a null here would drop them out of the level mid-drag.
  assert.equal(laneAt(w, -500), w.lanes[0]!.id);
  assert.equal(laneAt(w, 99_999), w.lanes[w.lanes.length - 1]!.id);
});

test("the invoice under the camera is the nearest one in that lane, never null in a full lane", () => {
  const w = world();
  const m = w.marks.get("retainer_1")!;
  assert.equal(markAt(w, "retainer", m.cell.x + m.cell.w / 2, m.cell.y + m.cell.h / 2), "retainer_1");
  // Between two cards it still answers one of them.
  assert.ok(markAt(w, "design", w.timeX0 + w.timeW / 2, w.lanes[0]!.y) !== null);
  assert.equal(markAt(w, "nothing", 0, 0), null);
});

test("the date under a point is the date the axis says, and it is clamped to the quarter", () => {
  const w = world();
  assert.equal(timeAt(w, w.timeX0), w.startMs);
  assert.equal(timeAt(w, w.timeX0 + w.timeW), w.endMs);
  assert.equal(timeAt(w, -9999), w.startMs, "left of the axis is its start, not a year in 1970");
});

/* --------------------------------------------------------------------------------- the poses */

test("a click and a wheel land in the same place: the lane's pose is inside the near band", () => {
  const w = world();
  const p = poseForLane(w, "retainer", FRAME) as Pose;
  assert.ok(p.zoom >= NAV_BANDS[0], "the pose a click flies to must read as L1");
  assert.ok(p.zoom < NAV_BANDS[1], "and must not read as L2");
  const lane = w.lanes.find((l) => l.id === "retainer")!;
  const here = centreOf(p, w);
  assert.ok(here.y > lane.y && here.y < lane.y + lane.h, "the camera is in the lane it opened");
  assert.ok(Math.abs(here.y - (lane.y + lane.h / 2)) < 1e-6, "the camera is off the area's centre");
  // And the area does not fill the frame: a neighbour's edge has to stay in view, or the reader
  // has arrived somewhere rather than moved closer.
  const seen = FRAME.h / p.zoom;
  assert.ok(seen > lane.h, `the area fills the whole frame (${lane.h} of ${seen})`);
});

test("the invoice's pose is inside the closest band and on the invoice", () => {
  const w = world();
  const p = poseForMark(w, "design_2", FRAME) as Pose;
  assert.ok(p.zoom >= NAV_BANDS[1], "the pose a click flies to must read as L2");
  assert.ok(p.zoom <= ZOOM.max);
  const m = w.marks.get("design_2")!;
  const here = centreOf(p, w);
  // Within half a cell of the card, after the clamp has had its say.
  assert.ok(Math.abs(here.x - (m.cell.x + m.cell.w / 2)) < m.cell.w, "not on the invoice");
});

test("poseForFocus is the one table: home, a group, an item", () => {
  const w = world();
  assert.deepEqual(poseForFocus(w, { level: 0, group: null, item: null }, FRAME), {
    zoom: 1,
    pan: { x: 0, y: 0 },
  });
  assert.deepEqual(
    poseForFocus(w, { level: 1, group: "design", item: null }, FRAME),
    poseForLane(w, "design", FRAME),
  );
  assert.deepEqual(
    poseForFocus(w, { level: 2, group: "design", item: "design_2" }, FRAME),
    poseForMark(w, "design_2", FRAME),
  );
});

test("an unknown group or invoice flies home rather than to NaN", () => {
  const w = world();
  assert.deepEqual(poseForLane(w, "nope", FRAME), { zoom: 1, pan: { x: 0, y: 0 } });
  assert.deepEqual(poseForMark(w, "nope", FRAME), { zoom: 1, pan: { x: 0, y: 0 } });
});

/* ---------------------------------------------------------------------------------- the bands */

test("far and mid are both L0: more detail is not another level", () => {
  // The whole point of the round in one assertion.
  assert.equal(levelOfBand("far"), 0);
  assert.equal(levelOfBand("mid"), 0);
  assert.equal(levelOfBand("near"), 1);
  assert.equal(levelOfBand("closest"), 2);
  assert.equal(BANDS.length, 4);
  for (const band of BANDS) assert.ok(BAND_LABEL[band], `${band} has no word`);
});

test("the nav owns the two bands that are navigation; the camera only decides far vs mid", () => {
  // At L1 the band is `near` even if the camera has drifted below the threshold mid-drag —
  // otherwise a reader dragging sideways would watch the cards blink out from under them.
  assert.equal(bandOf(1, 0.9), "near");
  assert.equal(bandOf(2, 0.9), "closest");
  assert.equal(bandOf(0, 1), "far");
  assert.equal(bandOf(0, ZOOM.mid * 1.5), "mid");
});

test("the mid threshold has hysteresis, so a trackpad flick cannot strobe the amounts", () => {
  const onThe = ZOOM.mid;
  // Sitting exactly on the band stays where it came from, whichever side that was.
  assert.equal(bandOf(0, onThe, "far"), "far");
  assert.equal(bandOf(0, onThe, "mid"), "mid");
  // And it takes a real overshoot to cross.
  assert.equal(bandOf(0, ZOOM.mid * 1.2, "far"), "mid");
  assert.equal(bandOf(0, ZOOM.mid * 0.8, "mid"), "far");
});

test("the type ladder never puts a glyph under its nominal size, at any zoom", () => {
  // The legibility rule is `font-size: calc(token * --ln-inv)`, which is a LAYOUT input: writing
  // it every frame relaid out fourteen hundred elements and cost the first capture 23fps. The
  // ladder is what makes it a handful of writes per flight — and it rounds UP, so the 13px floor
  // holds by construction rather than half the time. The price is a glyph up to `INV_RATIO`
  // larger than nominal, never smaller.
  for (let z = ZOOM.min; z <= ZOOM.max; z += 0.05) {
    const ratio = quantizeInverse(z) * z;
    assert.ok(ratio >= 1 - 1e-9, `type under its nominal size at zoom ${z} (${ratio})`);
    assert.ok(ratio <= INV_RATIO + 1e-9, `type more than one rung oversize at zoom ${z}`);
  }
  assert.equal(quantizeInverse(1), 1, "the resting frame is exactly its own rung");
  // The whole range is a handful of rungs, which is the point: a flight is a handful of writes
  // and a drag at a fixed zoom is none. Un-quantised it would be one relayout per frame.
  const rungs = new Set<number>();
  for (let z = ZOOM.min; z <= ZOOM.max; z += 0.01) rungs.add(quantizeInverse(z));
  assert.ok(rungs.size <= 16, `${rungs.size} rungs is too many writes`);
  assert.ok(rungs.size >= 8, `${rungs.size} rungs is a visible jump in the type`);
  // Total: a zero or a NaN answers the resting rung rather than an infinity.
  assert.equal(quantizeInverse(0), 1);
  assert.equal(quantizeInverse(Number.NaN), 1);
});
