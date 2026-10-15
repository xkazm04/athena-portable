// The rig's pointer, as a gesture machine — `docs/kit-camera-contract.md` §2, "The pointer".
//
// `src/zoom/gesture.ts` decides when a press is a click and when it is a drag, when the pointer is
// captured and released, and which click belongs to the camera. `useCameraRig` only carries the
// effects out. Each test is one acceptance case of the challenge card (0..6); case 7 is the rest
// of this folder passing unchanged.

import assert from "node:assert/strict";
import { test } from "node:test";

import { REST_POSE, mergePose, panDelta } from "../src/zoom/camera.ts";
import {
  DRAG_SLOP,
  gestureStep,
  initialGesture,
  swallowsClick,
  type GestureEffect,
  type GestureInput,
  type GestureOptions,
  type GestureState,
} from "../src/zoom/gesture.ts";

const PAN: GestureOptions = { drag: "pan" };

/** Feed inputs in order; return the final state and the effects of each step. */
const run = (inputs: GestureInput[], opts: GestureOptions = PAN, from: GestureState = initialGesture()) => {
  let state = from;
  const steps: GestureEffect[][] = [];
  for (const input of inputs) {
    const next = gestureStep(state, input, opts);
    state = next.state;
    steps.push(next.effects);
  }
  return { state, steps, all: steps.flat() };
};

const down = (x: number, y: number, id = 1, t = 0): GestureInput => ({ type: "down", id, x, y, t });
const move = (x: number, y: number, id = 1, t = 16): GestureInput => ({ type: "move", id, x, y, t });
const up = (id = 1, t = 32): GestureInput => ({ type: "up", id, t });
const kinds = (effects: GestureEffect[]) => effects.map((e) => e.type);

test("case 0: a 2.2 px sloppy press is a click: no capture, no drag, no swallow, idle", () => {
  assert.equal(DRAG_SLOP, 4);
  const { state, all } = run([down(100, 100), move(102, 101), up()]);
  assert.ok(!all.some((e) => e.type === "capture"), "nothing captured");
  assert.ok(!all.some((e) => e.type === "drag"), "nothing dragged");
  assert.ok(!all.some((e) => e.type === "swallowClick"), "no swallow");
  assert.equal(state.phase, "idle");
  assert.equal(state.pointers.length, 0);
  assert.equal(state.moving, false);
  // The child's own click is not eaten.
  assert.equal(swallowsClick(gestureStep(state, { type: "click" }, PAN)), false);
});

test("case 1: the move that crosses the slop captures once and catches up from the press origin", () => {
  const { steps, state } = run([down(100, 100), move(110, 100), move(115, 100)]);
  const [onDown, crossing, further] = steps;
  assert.ok(onDown && crossing && further);
  assert.ok(!onDown.some((e) => e.type === "capture"), "a press captures nothing");
  assert.deepEqual(
    crossing.filter((e) => e.type === "capture"),
    [{ type: "capture", id: 1 }],
  );
  const drags = crossing.filter((e) => e.type === "drag");
  assert.equal(drags.length, 1);
  assert.deepEqual(drags[0], { type: "drag", dx: 10, dy: 0, dt: 16 });
  assert.deepEqual(kinds(crossing), ["capture", "drag", "moving"]);
  assert.ok(!further.some((e) => e.type === "capture"), "no second capture");
  assert.deepEqual(
    further.filter((e) => e.type === "drag").map((e) => (e.type === "drag" ? e.dx : NaN)),
    [5],
  );
  assert.equal(state.phase, "drag");
  assert.equal(state.moving, true);
});

test("case 2: up after a drag releases once and swallows exactly the next click", () => {
  const dragged = run([down(100, 100), move(110, 100)]);
  const lift = gestureStep(dragged.state, up(), PAN);
  assert.deepEqual(
    lift.effects.filter((e) => e.type === "release"),
    [{ type: "release", id: 1 }],
  );
  assert.ok(lift.effects.some((e) => e.type === "coast"));
  const first = gestureStep(lift.state, { type: "click" }, PAN);
  assert.equal(swallowsClick(first), true, "the trailing click over a node does not open it");
  const second = gestureStep(first.state, { type: "click" }, PAN);
  assert.equal(swallowsClick(second), false, "the click after it is the reader's");
});

test("case 2 (revised): the swallow is cleared by the next down, and expires with the up's task", () => {
  // A touch pan produces no click at all: the next press-and-click on a node is NOT swallowed.
  const pan = run([down(100, 100), move(140, 100), up()]);
  assert.equal(pan.state.swallow, true);
  const tap = run([down(200, 200), up(1, 80)], PAN, pan.state);
  assert.equal(swallowsClick(gestureStep(tap.state, { type: "click" }, PAN)), false);

  // And when the up's task ends with no click, the swallow is gone too.
  const expired = gestureStep(pan.state, { type: "expire" }, PAN);
  assert.equal(swallowsClick(gestureStep(expired.state, { type: "click" }, PAN)), false);
});

test("case 3: a mid-drag cancel or lost capture releases at most once and leaves no pointer", () => {
  for (const exit of ["cancel", "lostcapture"] as const) {
    const dragged = run([down(100, 100), move(110, 100)]);
    const ended = run([{ type: exit, id: 1 }, { type: exit, id: 1 }, up()], PAN, dragged.state);
    const releases = ended.all.filter((e) => e.type === "release");
    assert.ok(releases.length <= 1, `${exit}: released ${releases.length} times`);
    if (exit === "cancel") assert.equal(releases.length, 1, "cancel releases the capture it holds");
    assert.equal(ended.state.moving, false, exit);
    assert.equal(ended.state.pointers.length, 0, exit);
    assert.ok(ended.all.some((e) => e.type === "moving" && e.value === false), exit);
    assert.equal(swallowsClick(gestureStep(ended.state, { type: "click" }, PAN)), false, exit);

    // The next down starts a fresh press: no stale pointer, no pinch with a ghost.
    const fresh = gestureStep(ended.state, down(300, 300, 2), PAN);
    assert.equal(fresh.state.phase, "press", exit);
    assert.deepEqual(
      fresh.state.pointers.map((p) => p.id),
      [2],
    );
    assert.ok(!fresh.effects.some((e) => e.type === "capture" || e.type === "pinch"), exit);
  }
});

test("case 3: a pointer whose up was lost outside the scene does not haunt the next press", () => {
  const stale = run([down(100, 100), move(101, 100)]);
  const again = gestureStep(stale.state, down(400, 400), PAN);
  assert.equal(again.state.phase, "press");
  assert.deepEqual(again.state.origin, { x: 400, y: 400 });
  assert.equal(again.state.pointers.length, 1);
});

test("case 4 (guard): two pointers pinch, both captured; lifting one does not jump the other", () => {
  const { state, steps } = run([down(100, 100, 1), down(200, 100, 2, 4)]);
  assert.equal(state.phase, "pinch");
  assert.deepEqual(
    steps[1]?.filter((e) => e.type === "capture").map((e) => (e.type === "capture" ? e.id : -1)),
    [1, 2],
  );
  const spread = gestureStep(state, move(250, 100, 2, 20), PAN);
  const pinch = spread.effects.find((e) => e.type === "pinch");
  assert.ok(pinch && pinch.type === "pinch");
  assert.equal(pinch.factor, 1.5);

  const lifted = gestureStep(spread.state, up(2, 30), PAN);
  assert.deepEqual(kinds(lifted.effects), ["release"]);
  const still = gestureStep(lifted.state, move(100, 100, 1, 40), PAN);
  assert.deepEqual(
    still.effects.filter((e) => e.type === "drag").map((e) => (e.type === "drag" ? [e.dx, e.dy] : [])),
    [[0, 0]],
  );
});

test("case 5 (guard): drag 'none' makes down, move and up produce no effects at all", () => {
  const { all, state } = run([down(100, 100), move(150, 100), up()], { drag: "none" });
  assert.deepEqual(all, []);
  assert.equal(state.phase, "idle");
});

test("case 6: the slop is screen space: 3 px at zoom 4 is a click, measured before panDelta", () => {
  const zoomed = mergePose(REST_POSE, { zoom: 4 });
  // In world units the press moved 0.75, a quarter of the slop; on the screen it moved 3 px.
  assert.equal(panDelta(3, 0, zoomed.zoom).x, 0.75);
  const click = run([down(100, 100), move(103, 100), up()]);
  assert.ok(!click.all.some((e) => e.type === "drag" || e.type === "capture"));
  // And the drag it becomes at 4 screen px is reported in screen px, for the hook to divide.
  const drag = run([down(100, 100), move(104, 100)]);
  assert.deepEqual(
    drag.all.filter((e) => e.type === "drag").map((e) => (e.type === "drag" ? e.dx : NaN)),
    [4],
  );
});
