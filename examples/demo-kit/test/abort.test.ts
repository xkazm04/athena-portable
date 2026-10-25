// "A move in flight is abortable" — formula §1 rule 6, as the half of the Escape rule the kit
// did not have until the consolidation round.
//
// `escapeLeavesLevel` answers whether the key is the nav's. `escapeAbortsFlight` answers what the
// nav does with it, which depends on whether the move the reader is watching has landed. Tidycrm
// carried the same shape locally (`escapeAbortsArrival`) for the window before its hand-off; this
// is the general case, and `navReducer`'s `abort` is what it runs.

import assert from "node:assert/strict";
import { test } from "node:test";

import { escapeAbortsFlight, escapeIntent } from "../src/zoom/escape.ts";
import { HOME, initialNavState, navReducer, sameFocus, type NavState } from "../src/zoom/state.ts";
import { keydown } from "./support/keys.ts";

// The composition is `escapeIntent`, the function `nav.ts`'s listener calls and dispatches the
// answer of (pinned at call level by oracle-reach.test.ts), so these cases reach the shipped rule
// and not a copy of it.

test("Escape mid-flight abandons the move; Escape once it has landed leaves the level", () => {
  assert.equal(escapeAbortsFlight(keydown("Escape"), true, 1), true);
  assert.equal(escapeAbortsFlight(keydown("Escape"), false, 1), false);
});

test("L0 has no arrival to abandon, and other keys are not ours", () => {
  assert.equal(escapeAbortsFlight(keydown("Escape"), true, 0), false);
  assert.equal(escapeAbortsFlight(keydown("Enter"), true, 2), false);
});

test("a decided event is left alone here too", () => {
  assert.equal(escapeAbortsFlight(keydown("Escape", { prevented: true }), true, 2), false);
});

test("ownership is asked FIRST: a modal, a hold, L0 or a decided event keeps the key even mid-flight", () => {
  assert.equal(escapeIntent(keydown("Escape", { modal: true }), 2, true), null);
  assert.equal(escapeIntent(keydown("Escape"), 2, true, 1), null);
  assert.equal(escapeIntent(keydown("Escape"), 0, true), null);
  assert.equal(escapeIntent(keydown("Escape", { prevented: true }), 2, true), null);
  assert.equal(escapeIntent(keydown("Escape"), 1, true), "abort");
  assert.equal(escapeIntent(keydown("Escape"), 1, false), "up");
});

test("abort puts the reader back where they were standing, not one level above it", () => {
  let s: NavState = initialNavState();
  s = navReducer(s, { type: "open-group", group: "a" });
  const atL1 = s.focus;
  s = navReducer(s, { type: "open-item", group: "a", item: "a1" });
  const flight = s.flight;

  const back = navReducer(s, { type: "abort" });
  assert.deepEqual(back.focus, atL1, "the focus the move left");
  assert.equal(back.flight, flight + 1, "and a flight of its own, so the surface re-flies");
});

test("abort out of the first move lands at L0, which is where that move started", () => {
  const opening = navReducer(initialNavState(), { type: "open-group", group: "a" });
  assert.deepEqual(navReducer(opening, { type: "abort" }).focus, HOME);
});

test("abort differs from up: up out of L2 goes to L1 even if L2 was opened from L0", () => {
  // An agent's `open_item` jumps straight to L2. Escape mid-flight means "not that one after
  // all" — L0 — while Escape after it has landed means "close this" — L1.
  let s = navReducer(initialNavState(), { type: "open-item", group: "a", item: "a1" });
  assert.deepEqual(navReducer(s, { type: "abort" }).focus, HOME);
  assert.deepEqual(navReducer(s, { type: "up" }).focus, { level: 1, group: "a", item: null });
});

test("nothing to go back to is not a flight — a bump with no move is a flicker", () => {
  const s = initialNavState();
  assert.equal(navReducer(s, { type: "abort" }), s);
  assert.equal(sameFocus(s.prev, s.focus), true);
});

test("prev is the focus the LAST change left, whichever action made it", () => {
  let s = navReducer(initialNavState(), { type: "open-group", group: "a" });
  s = navReducer(s, { type: "open-group", group: "b" });
  assert.deepEqual(s.prev, { level: 1, group: "a", item: null });
  s = navReducer(s, { type: "up" });
  assert.deepEqual(s.prev, { level: 1, group: "b", item: null });
  // ...and aborting that `up` goes back down into the group it was leaving.
  assert.deepEqual(navReducer(s, { type: "abort" }).focus, { level: 1, group: "b", item: null });
});

test("hover and highlight are not level changes and leave prev alone", () => {
  let s = navReducer(initialNavState(), { type: "open-group", group: "a" });
  const prev = s.prev;
  s = navReducer(s, { type: "hover", id: "a:1" });
  s = navReducer(s, { type: "highlight", ids: ["a"] });
  assert.equal(s.prev, prev);
  assert.equal(s.flight, 1);
});
