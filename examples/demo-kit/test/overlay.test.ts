// An L2 overlay's two decisions: is this Escape mine, and where does focus go when I leave.
//
// Formula §1 rule 5. Round 1 found Escape dead at L2 in all three apps — every pane is
// `aria-modal`, the kit's window rule correctly declines a modal's Escape, and no pane handled
// it — and focus dropped to the top of the document on the way out. `useOverlayEscape` is the
// hook; these are the parts that can be wrong without a DOM.

import assert from "node:assert/strict";
import { test } from "node:test";

import { escapeClosesOverlay, focusReturnTarget, isOpener } from "../src/zoom/overlay.ts";
import { escapeLeavesLevel } from "../src/zoom/escape.ts";

const key = (k: string, prevented = false) => ({ key: k, defaultPrevented: prevented });

test("Escape on the pane is the pane's, and other keys are not", () => {
  assert.equal(escapeClosesOverlay(key("Escape")), true);
  assert.equal(escapeClosesOverlay(key("Enter")), false);
});

test("a nested overlay speaks first, so the outer one declines", () => {
  assert.equal(escapeClosesOverlay(key("Escape", true)), false);
});

test("preventDefault is the protocol between the pane and the kit's window rule", () => {
  // The pane calls preventDefault and the nav then sees a decided event — which is why one press
  // leaves one level rather than two, and why no `stopPropagation` is needed anywhere.
  const event = { key: "Escape", defaultPrevented: false, target: null };
  assert.equal(escapeClosesOverlay(event), true);
  event.defaultPrevented = true;
  assert.equal(escapeLeavesLevel(event, 2), false);
});

test("the opener is where focus goes back to", () => {
  const opener = { isConnected: true };
  const cell = { isConnected: true };
  assert.equal(focusReturnTarget(opener, cell, {}), opener);
});

test("an opener that has left the document hands over to the fallback", () => {
  const gone = { isConnected: false };
  const cell = { isConnected: true };
  assert.equal(focusReturnTarget(gone, cell, {}), cell);
});

test("the body is not an answer — it is what a dropped focus looks like", () => {
  const body = { isConnected: true };
  const cell = { isConnected: true };
  assert.equal(focusReturnTarget(body, cell, body), cell);
});

test("no opener and no fallback is nowhere, not somewhere arbitrary", () => {
  assert.equal(focusReturnTarget(null, null, {}), null);
  assert.equal(focusReturnTarget(undefined, undefined), null);
});

test("an agent-opened overlay had no opener, so the fallback is the whole answer", () => {
  const cell = { isConnected: true };
  assert.equal(focusReturnTarget(null, cell, {}), cell);
});

test("the opener is recorded once — the StrictMode guard", () => {
  const body = {};
  const row = {};
  const closeButton = {};
  assert.equal(isOpener(row, null, body), true);
  // Second pass of the mount effect: focus is now inside the overlay. Recording it would hand
  // focus back to a control that is about to be unmounted with the pane.
  assert.equal(isOpener(closeButton, row, body), false);
  assert.equal(isOpener(body, null, body), false);
  assert.equal(isOpener(null, null, body), false);
});
