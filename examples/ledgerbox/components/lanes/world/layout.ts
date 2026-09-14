/**
 * The world: where every invoice IS, in one coordinate system, at every band.
 *
 * Round 3 replaced three levels with one map. That only works if there is exactly one answer to
 * "where is invoice `inv_0042`" — not one at L0 and another at L1 — so this file is the whole
 * geometry of the direction and every band reads the same rectangles out of it.
 *
 *   time  → x   the due date, left to right, June to October
 *   lane  → y   six bands stacked, each as tall as the rows it needs
 *   mark  → a CELL (the card's footprint) and a BAR (what the far band draws inside that cell)
 *
 * THE CELL IS THE CARD'S FOOTPRINT AT EVERY BAND, AND THAT IS THE ONE DESIGN DECISION HERE. The
 * far band could pack tighter — a bar is a fifth of a card's width — but then the near band would
 * have to re-pack, which is a layout change, which is a reflow, which is the remount the whole
 * round exists to avoid. So the rows are packed once, for the widest thing that will ever be
 * drawn in them, and a bar is simply a small object sitting in the middle of a large cell. The
 * lane looks a little airier at the far band than round 2's did; in exchange the invoice under
 * your pointer at zoom 1 is the same invoice under your pointer at zoom 8, at the same place.
 *
 * ZOOM 1 IS THE WORLD AT ITS NATURAL SIZE, and the natural size is the stage's own box — which
 * is why `buildWorld` takes the frame. The kit's camera declares `zoom: 1 = the resting frame`;
 * making that literally true means the far band needs no fit arithmetic and the band thresholds
 * are plain numbers rather than multiples of a viewport-dependent fit. A frame too short for the
 * rows the books actually have grows the world past it instead of shaving the marks to
 * hairlines, and the reader pans — which is what a map is for.
 *
 * THE FRAME OF REFERENCE IS THE KIT'S: `screen = centre + zoom · (world + pan)`, the origin at
 * the CENTRE of the scene element. Everything below is in scene-local coordinates measured from
 * the scene's top-left, because that is what CSS `inset-inline-start` wants; the two conversions
 * — `panTo` and `centreOf` — are the only places the halving happens.
 *
 * Pure: no DOM, no React, no `document`. `test/world.test.ts` pins it.
 */

import { SPAN, markWidth, packRows, type LnLane, type LnMark, type LnSheet } from "../model";

/* ------------------------------------------------------------------ the shape of the world */

export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WorldMark {
  id: string;
  laneId: string;
  mark: LnMark;
  /**
   * The card's footprint, in SCENE coordinates — which is what `laneAt`, `markAt` and every pose
   * are in. The renderer draws a mark inside its lane's own box and therefore subtracts the
   * lane's `y`; getting that subtraction wrong is worth a test of its own, because the symptom is
   * five empty lanes and one lane's invoices stacked over the lane below it.
   */
  cell: WorldRect;
  /** What the far and mid bands draw: a bar worth its balance, centred in the cell. */
  bar: WorldRect;
  /** The tail from the bar's right edge to the now-line, or zero width when not late. */
  tail: WorldRect;
  /** Packed sub-row inside the lane. */
  row: number;
}

export interface WorldLane {
  id: string;
  lane: LnLane;
  y: number;
  /** The lane's box, which is its rows or the floor its own head needs, whichever is larger. */
  h: number;
  /**
   * The rows alone — what the invoices actually occupy.
   *
   * The camera aims at THIS and not at the middle of `h`. A one-row area held at `LANE_MIN` is
   * mostly the room its name needs, and a pose centred on the box's middle looked at the empty
   * half of it: the first capture of the near band framed a twelve-invoice area with its cards
   * pressed against the top edge and two thirds of the screen showing nothing.
   */
  contentH: number;
  rows: number;
  marks: WorldMark[];
}

export interface LnWorld {
  /** Scene size in world units. One world unit is one CSS pixel at zoom 1. */
  w: number;
  h: number;
  /** The left column the lane names live in. */
  gutter: number;
  /** The time axis: `timeX0 + x01 * timeW`. */
  timeX0: number;
  timeW: number;
  axisH: number;
  rowH: number;
  cardW: number;
  barH: number;
  lanes: WorldLane[];
  marks: Map<string, WorldMark>;
  months: { label: string; x: number }[];
  nowX: number;
  /** The clock the axis covers, for the readout that says what is under the camera. */
  startMs: number;
  endMs: number;
}

/* ----------------------------------------------------------------------------- the constants */

/** The gutter that carries the six lane names. Fluid, floored so a name still fits. */
export const GUTTER = { min: 150, of: 0.13, max: 240 } as const;
/** Room at the top for the month ticks, and at the right for the last month's label. */
export const AXIS_H = 34;
export const PAD = { top: 6, right: 44, bottom: 6 } as const;
/** Between two lanes. Small: the lanes are meant to read as one stack, not six panels. */
export const LANE_GAP = 10;
/**
 * A cell's own inset, so two rows of cards do not touch.
 *
 * Small on purpose: the cell's height IS the near band's card, and every unit taken here comes
 * off four lines of 13px type. Three units is a visible gutter between two cards at the near
 * band and invisible at the far one, which is the right way round.
 */
export const ROW_GAP = 3;
/**
 * A card's width in world units, as a share of the time axis.
 *
 * It is the packing footprint, so it is the number that decides how many rows a lane needs and
 * therefore how tall the world is. 3.8% of the quarter is about five and a half days: two
 * invoices in one area falling due in the same week stack, which is true of the books and is the
 * fact the stack is there to show.
 */
export const CARD_W = { min: 38, of: 0.038, max: 62 } as const;
/** A row, in world units. The floor is what stops a tall sheet from shaving the marks away. */
export const ROW_H = { min: 19, max: 46 } as const;
/**
 * The shortest a lane may be, whatever its row count.
 *
 * Measured off the rendered gutter at the 13px type floor, and measured against the FAR band
 * only: the name and the two figure lines, which is all that band draws. The lane's own sentence
 * arrives at the mid band, where `--ln-inv` is already below a half and the same four lines take
 * half the world height — so the floor does not have to carry it.
 *
 * Every unit here is a unit the rows do not get: the floor is what a short area's head costs the
 * whole sheet, and at 78 it held the row at its own floor on a 1440×900 frame and left a
 * twelve-invoice area two thirds empty at the near band.
 */
export const LANE_MIN = 62;

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

/** A fluid measure: a share of `of`, floored and capped. */
const span = (of: number, m: { min: number; of: number; max: number }): number =>
  clamp(of * m.of, m.min, m.max);

/* ------------------------------------------------------------------------------- the builder */

export interface Frame {
  w: number;
  h: number;
}

/**
 * The whole world, from the sheet and the box it is drawn in.
 *
 * Deterministic and total: a zero-sized frame (an element that has not been laid out) answers a
 * world with the same structure at its floors, so nothing downstream has to branch on it.
 */
export function buildWorld(sheet: LnSheet, frame: Frame): LnWorld {
  const w = Math.max(320, Number.isFinite(frame.w) ? frame.w : 320);
  const frameH = Math.max(240, Number.isFinite(frame.h) ? frame.h : 240);

  const gutter = span(w, GUTTER);
  const timeX0 = gutter;
  const timeW = Math.max(120, w - gutter - PAD.right);
  const cardW = span(timeW, CARD_W);

  /* The packing footprint in the model's own span units, so the one tested packer answers both
     the row count and, at the near band, which cards may sit beside each other. */
  const footprint = ((cardW + ROW_GAP) / timeW) * SPAN;

  const packed = sheet.lanes.map((lane) => {
    const { rows, rowOf } = packRows(lane.marks, () => footprint);
    return { lane, rows, rowOf };
  });
  const chrome = AXIS_H + PAD.top + PAD.bottom + LANE_GAP * Math.max(0, packed.length - 1);

  /*
   * THE ROW HEIGHT IS SOLVED FOR, NOT DIVIDED FOR.
   *
   * The obvious arithmetic — the height left over, shared out among the rows — is wrong the
   * moment a lane has a floor: a two-row area held at `LANE_MIN` does not shrink when the row
   * does, so the division under-counts and the world spills past the frame. The first capture of
   * this showed it as a 671-unit world in a 598-unit stage, with the axis and the first lane's
   * name clipped at rest — on the one band whose whole job is reading at a glance.
   *
   * Total height is monotone in the row, so the largest row that still fits is a bisection. If
   * even the floor does not fit, the world is simply taller than the frame and the reader pans,
   * which is what a map is for.
   */
  const heightAt = (row: number) =>
    chrome + packed.reduce((n, p) => n + Math.max(LANE_MIN, p.rows * row), 0);
  let lo: number = ROW_H.min;
  let hi: number = ROW_H.max;
  if (heightAt(lo) >= frameH) {
    hi = lo;
  } else {
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (heightAt(mid) <= frameH) lo = mid;
      else hi = mid;
    }
    hi = lo;
  }
  const rowH = hi;
  const barH = clamp(rowH * 0.4, 7, 18);

  const timeX = (x01: number) => timeX0 + clamp(x01, 0, 1) * timeW;
  const nowX = timeX(sheet.axis.todayX);

  const lanes: WorldLane[] = [];
  const marks = new Map<string, WorldMark>();
  let y = AXIS_H + PAD.top;

  for (const { lane, rows, rowOf } of packed) {
    const laneH = Math.max(LANE_MIN, rows * rowH);
    const built: WorldMark[] = [];
    for (const mark of lane.marks) {
      const row = rowOf.get(mark) ?? 0;
      const cell: WorldRect = {
        x: timeX(mark.x),
        y: y + row * rowH,
        w: cardW,
        h: Math.max(8, rowH - ROW_GAP),
      };
      const barW = Math.max(6, (markWidth(mark.weight) / SPAN) * timeW);
      const bar: WorldRect = {
        x: cell.x,
        y: cell.y + cell.h / 2 - barH / 2,
        w: barW,
        h: barH,
      };
      const late = mark.daysOverdue > 0 && mark.balanceCents > 0;
      const tail: WorldRect = {
        x: bar.x + bar.w,
        y: cell.y + cell.h / 2,
        w: late ? Math.max(0, nowX - bar.x - bar.w) : 0,
        h: 1,
      };
      const wm: WorldMark = { id: mark.id, laneId: lane.id, mark, cell, bar, tail, row };
      built.push(wm);
      marks.set(mark.id, wm);
    }
    lanes.push({ id: lane.id, lane, y, h: laneH, contentH: rows * rowH, rows, marks: built });
    y += laneH + LANE_GAP;
  }

  const h = Math.max(frameH, y - LANE_GAP + PAD.bottom);

  return {
    w,
    h,
    gutter,
    timeX0,
    timeW,
    axisH: AXIS_H,
    rowH,
    cardW,
    barH,
    lanes,
    marks,
    months: sheet.axis.months.map((m) => ({ label: m.label, x: timeX(m.x) })),
    nowX,
    startMs: Date.parse(sheet.axis.startIso),
    endMs: Date.parse(sheet.axis.endIso),
  };
}

/* --------------------------------------------------------------------- the camera's own math */

/** The kit's pose, as much of it as a flat map uses. Structural, so this file imports nothing. */
export interface Pose {
  yaw: number;
  pitch: number;
  zoom: number;
  pan: { x: number; y: number };
}

/**
 * The pan that puts a scene-local point in the middle of the frame.
 *
 * From `screen = centre + zoom · (world + pan)` with the scene's own centre as the world origin:
 * the point `p` is at `p − size/2` in world coordinates, and it is at the frame's centre when
 * `world + pan = 0`. Independent of zoom, which is the whole reason the camera is expressed this
 * way — flying and zooming are separable.
 */
export function panTo(point: { x: number; y: number }, world: LnWorld): { x: number; y: number } {
  return { x: world.w / 2 - point.x, y: world.h / 2 - point.y };
}

/** The scene-local point the camera is looking at. The inverse of `panTo`. */
export function centreOf(pose: Pose, world: LnWorld): { x: number; y: number } {
  return { x: world.w / 2 - pose.pan.x, y: world.h / 2 - pose.pan.y };
}

/** How much of the world the frame holds at this zoom, in world units. */
export function visibleSpan(pose: Pose, frame: Frame): { w: number; h: number } {
  const z = pose.zoom > 0 ? pose.zoom : 1;
  return { w: frame.w / z, h: frame.h / z };
}

/**
 * The pan that keeps the world covering the frame.
 *
 * The rig's `bounds.pan` is a single static rectangle, which cannot express this: how far the
 * camera may travel depends on the zoom, and a bound wide enough for zoom 12 lets the reader
 * drag the whole map off the screen at zoom 1. So the bound is set once, generously, for the
 * closest band, and this is handed to the rig as its `snap` — the per-zoom half of the same
 * rule. An axis whose world is smaller than the frame at this zoom is centred rather than
 * clamped: there is no "edge" to hold on to.
 */
export function clampPan(pose: Pose, world: LnWorld, frame: Frame): Pose {
  const { w: vw, h: vh } = visibleSpan(pose, frame);
  const here = centreOf(pose, world);
  const axis = (centre: number, extent: number, visible: number) => {
    if (visible >= extent) return extent / 2;
    return clamp(centre, visible / 2, extent - visible / 2);
  };
  const next = panTo(
    { x: axis(here.x, world.w, vw), y: axis(here.y, world.h, vh) },
    world,
  );
  return { ...pose, pan: next };
}

/** The static bound, sized for the closest band — the rig's coarse clamp. See `clampPan`. */
export function panBounds(world: LnWorld): { x: [number, number]; y: [number, number] } {
  return { x: [-world.w / 2, world.w / 2], y: [-world.h / 2, world.h / 2] };
}

/* ------------------------------------------------------------------- what is under the camera */

/** The lane whose band holds this scene-local y, or the nearest one. */
export function laneAt(world: LnWorld, y: number): string | null {
  if (world.lanes.length === 0) return null;
  let best = world.lanes[0]!;
  let bestD = Infinity;
  for (const lane of world.lanes) {
    if (y >= lane.y && y <= lane.y + lane.h) return lane.id;
    const d = y < lane.y ? lane.y - y : y - (lane.y + lane.h);
    if (d < bestD) {
      bestD = d;
      best = lane;
    }
  }
  return best.id;
}

/**
 * The invoice nearest this scene-local point inside one lane, or `null` for an empty lane.
 *
 * Nearest rather than "the one whose cell contains it", because at the closest band the camera
 * is somewhere between two cards as often as it is on one, and answering `null` there would
 * bounce the reader back out of L2 in the middle of a drag.
 */
export function markAt(world: LnWorld, laneId: string | null, x: number, y: number): string | null {
  const lane = world.lanes.find((l) => l.id === laneId);
  if (!lane || lane.marks.length === 0) return null;
  let best: WorldMark | null = null;
  let bestD = Infinity;
  for (const m of lane.marks) {
    const cx = m.cell.x + m.cell.w / 2;
    const cy = m.cell.y + m.cell.h / 2;
    /* The x axis counts for more: two cards in the same week are a row apart vertically and
       half a card apart horizontally, and the reader aimed with the time axis. */
    const d = Math.hypot((x - cx) * 1.6, y - cy);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best?.id ?? null;
}

/** The date under a scene-local x, as milliseconds. For the readout, not for the books. */
export function timeAt(world: LnWorld, x: number): number {
  const x01 = world.timeW > 0 ? clamp((x - world.timeX0) / world.timeW, 0, 1) : 0;
  return world.startMs + (world.endMs - world.startMs) * x01;
}

/* ---------------------------------------------------------------------------------- the poses */

/**
 * The band thresholds, in zoom. Two of them are navigation and one is only ink — see
 * `design/round3-map-brief.md` §2.
 */
export const ZOOM = {
  /*
   * THE RESTING FRAME IS THE FARTHEST OUT, and that is a legibility rule rather than a taste.
   *
   * Below zoom 1 the world is letterboxed inside the stage AND `--ln-inv` climbs above 1, so
   * every glyph in the map drops under the 13px floor this app has been held to since round 2 —
   * measured at 11.9px in the first capture, when the bound was 0.75. There is nothing further
   * out to see: at 1 the whole quarter is already on the screen.
   */
  min: 1,
  /** Bars gain their amounts and the lanes gain their readings. Not a level. */
  mid: 1.75,
  /** L1: the lane under the camera is open and its invoices are cards. */
  near: 3.2,
  /** L2: the invoice under the camera is open. */
  closest: 7.5,
  max: 14,
} as const;

/** The two thresholds `useSemanticZoom` is given. */
export const NAV_BANDS: readonly [number, number] = [ZOOM.near, ZOOM.closest];

/** Far enough in to be unambiguously inside the lane, close enough to see all of its rows. */
export function poseForLane(world: LnWorld, laneId: string, frame: Frame): Partial<Pose> {
  const lane = world.lanes.find((l) => l.id === laneId);
  if (!lane) return { zoom: 1, pan: { x: 0, y: 0 } };
  /*
   * The lane fills about seven tenths of the frame: close enough that its invoices are cards and
   * not bars, far enough that the reader can still see a neighbour's edge above or below and
   * knows the map did not end where the area did.
   *
   * The BOX and not the rows, and that is the correction the near band's first capture asked for
   * in both directions: aiming at `contentH` framed a short area's cards against the top edge
   * with two thirds of the screen empty, and sizing by it zoomed a two-row area past the closest
   * band. The box is what the reader sees as "the area", floor and all.
   */
  const zoom = clamp((frame.h * 0.72) / Math.max(1, lane.h), ZOOM.near * 1.12, ZOOM.closest * 0.86);
  const centre = { x: world.nowX, y: lane.y + lane.h / 2 };
  return clampPan({ yaw: 0, pitch: 0, zoom, pan: panTo(centre, world) }, world, frame);
}

/** On the invoice, inside the closest band. The pane covers the world; the world is still true. */
export function poseForMark(world: LnWorld, markId: string, frame: Frame): Partial<Pose> {
  const m = world.marks.get(markId);
  if (!m) return { zoom: 1, pan: { x: 0, y: 0 } };
  const zoom = clamp((frame.h * 0.44) / Math.max(1, m.cell.h), ZOOM.closest * 1.1, ZOOM.max * 0.86);
  const centre = { x: m.cell.x + m.cell.w / 2, y: m.cell.y + m.cell.h / 2 };
  return clampPan({ yaw: 0, pitch: 0, zoom, pan: panTo(centre, world) }, world, frame);
}

/** Where the camera goes for a focus: the one table a click, a wheel and a tool all read. */
export function poseForFocus(
  world: LnWorld,
  focus: { level: number; group: string | null; item: string | null },
  frame: Frame,
): Partial<Pose> {
  if (focus.level === 2 && focus.item) return poseForMark(world, focus.item, frame);
  if (focus.level >= 1 && focus.group) return poseForLane(world, focus.group, frame);
  return { zoom: 1, pan: { x: 0, y: 0 } };
}
