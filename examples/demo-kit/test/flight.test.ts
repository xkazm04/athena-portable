// A level change, as state: the derivation all three round-1 apps wrote for themselves.
//
// The reducer is deliberately React-free (`src/zoom/flight.ts`) so the two things that can be
// wrong — when `from` advances, and which settle counts — can be pinned under `node --test`
// without a renderer. `useLevelFlight` is the thin part.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ARMING_FLIGHT,
  FLIGHT_FALLBACK_MS,
  advanceFlight,
  initialFlight,
  isMoving,
  settleFlight,
} from "../src/zoom/flight.ts";
import { HOME, navReducer, initialNavState, type Focus } from "../src/zoom/state.ts";

const L1: Focus = { level: 1, group: "a", item: null };
const L2: Focus = { level: 2, group: "a", item: "a1" };

test("at rest, nothing is moving and from equals to", () => {
  const s = initialFlight(HOME);
  assert.deepEqual(s.from, HOME);
  assert.deepEqual(s.to, HOME);
  assert.equal(isMoving(s), false);
});

test("the counter moving is what starts a flight, and it is true on that very frame", () => {
  const s = advanceFlight(initialFlight(HOME), 1, L1);
  assert.deepEqual(s.from, HOME);
  assert.deepEqual(s.to, L1);
  assert.equal(s.flight, 1);
  assert.equal(isMoving(s), true);
});

test("the focus we were going to is the focus we came from", () => {
  const first = advanceFlight(initialFlight(HOME), 1, L1);
  const second = advanceFlight(first, 2, L2);
  assert.deepEqual(second.from, L1);
  assert.deepEqual(second.to, L2);
});

test("advancing to the same counter is the same object, so it is safe during render", () => {
  const s = advanceFlight(initialFlight(HOME), 1, L1);
  assert.equal(advanceFlight(s, 1, L2), s);
});

test("settling the current flight ends it; settling twice changes nothing", () => {
  const s = advanceFlight(initialFlight(HOME), 1, L1);
  const done = settleFlight(s, 1);
  assert.equal(isMoving(done), false);
  assert.equal(settleFlight(done, 1), done);
});

test("a STALE settle is dropped — the interruption case this shape exists for", () => {
  // Flight 1 is superseded by flight 2 while it is still playing, and flight 1's completion
  // element then reports in. It must not be able to declare flight 2 landed.
  const one = advanceFlight(initialFlight(HOME), 1, L1);
  const two = advanceFlight(one, 2, L2);
  assert.equal(settleFlight(two, 1), two);
  assert.equal(isMoving(two), true);
  assert.equal(isMoving(settleFlight(two, 2)), false);
});

test("the documented fallback is the rubric's budget for a DOM level change", () => {
  assert.equal(FLIGHT_FALLBACK_MS, 400);
});

test("the nav's counter is what a flight is keyed on, and it only goes up", () => {
  let s = initialNavState();
  const before = s.flight;
  s = navReducer(s, { type: "open-group", group: "a" });
  s = navReducer(s, { type: "open-item", group: "a", item: "a1" });
  s = navReducer(s, { type: "up" });
  assert.equal(s.flight, before + 3);
});

/* ------------------------------------------------------- round 3: the arming id for self-settle */

test("the arming claim id is never a real flight, so releasing it settles nothing", () => {
  // The nav's counter starts at 0 and only goes up, so -1 can never be the current flight.
  assert.ok(ARMING_FLIGHT < initialNavState().flight);
  const s = advanceFlight(initialFlight(HOME), 1, L1);
  assert.equal(settleFlight(s, ARMING_FLIGHT), s);
  assert.equal(isMoving(s), true);
});
