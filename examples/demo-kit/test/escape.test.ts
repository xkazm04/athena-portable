// The zoom nav's Escape rule, pinned.
//
// Run by `pnpm --filter @athena/demo-kit typecheck`, which CI reaches through `pnpm typecheck`
// over `./examples/*`. Node strips the types; the module under test imports nothing, which is why
// it is a module of its own rather than a branch inside `three/nav.ts`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { MODAL_SELECTOR, escapeLeavesLevel } from "../src/zoom/escape.ts";

/** A keydown, with an optional ancestor chain the fake `closest` answers from. */
function keydown(key: string, { prevented = false, modal = false } = {}) {
  return {
    key,
    defaultPrevented: prevented,
    target: { closest: (selector: string) => (modal && selector === MODAL_SELECTOR ? {} : null) },
  };
}

test("Escape on a level above L0 leaves the level", () => {
  assert.equal(escapeLeavesLevel(keydown("Escape"), 1), true);
  assert.equal(escapeLeavesLevel(keydown("Escape"), 2), true);
});

test("L0 has nowhere to go, and other keys are not ours", () => {
  assert.equal(escapeLeavesLevel(keydown("Escape"), 0), false);
  assert.equal(escapeLeavesLevel(keydown("Enter"), 2), false);
});

test("a consumer that already handled the key keeps it", () => {
  // clonedeck's arm panel and reject panel both call preventDefault in their own onKeyDown.
  // React's root listener runs before a window listener, so by the time the nav sees the event it
  // has been decided — which is what lets those two drop their stopPropagation workaround.
  assert.equal(escapeLeavesLevel(keydown("Escape", { prevented: true }), 2), false);
});

test("a modal owns its own dismiss", () => {
  assert.equal(escapeLeavesLevel(keydown("Escape", { modal: true }), 2), false);
  assert.equal(MODAL_SELECTOR.includes('[role="alertdialog"]'), true);
  assert.equal(MODAL_SELECTOR.includes('[aria-modal="true"]'), true);
});

test("an explicit hold wins even when nothing else applies", () => {
  // The only option open to an overlay listening on `window` itself (ledgerbox's CoinPop shape),
  // where the nav's listener fires first and preventDefault cannot have happened yet.
  assert.equal(escapeLeavesLevel(keydown("Escape"), 2, 1), false);
  assert.equal(escapeLeavesLevel(keydown("Escape"), 2, 0), true);
});

test("nested holds do not hand the key back early", () => {
  assert.equal(escapeLeavesLevel(keydown("Escape"), 1, 2), false);
  assert.equal(escapeLeavesLevel(keydown("Escape"), 1, 1), false);
});

test("a target with no closest() is not treated as a modal", () => {
  // `window` and `document` are legitimate targets and answer no selector query.
  assert.equal(escapeLeavesLevel({ key: "Escape", defaultPrevented: false, target: null }, 1), true);
  assert.equal(escapeLeavesLevel({ key: "Escape", defaultPrevented: false }, 1), true);
});
