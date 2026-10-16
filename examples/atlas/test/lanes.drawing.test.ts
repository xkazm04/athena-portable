/**
 * THE DRAWING'S WIRING, READ OFF `Drawing.tsx` — what `node --test` can reach of a `.tsx` file.
 *
 * The pose arithmetic is pinned in `lanes.poses.test.ts`; this file pins the places `Drawing.tsx`
 * hands that arithmetic to the camera, where a second path to the same place can quietly differ.
 * Comments are stripped before matching, so prose describing the rule cannot satisfy it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { poseFor } from "../components/atlas/variants/archify-lanes/poses";

const SOURCE = readFileSync(
  new URL("../components/atlas/variants/archify-lanes/Drawing.tsx", import.meta.url),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The body of `const <name> = useCallback(...)`, up to the dependency list. */
function callback(name: string): string {
  const at = SOURCE.indexOf(`const ${name} = useCallback(`);
  assert.ok(at !== -1, `no ${name} callback in Drawing.tsx`);
  const end = SOURCE.indexOf("\n  );", at);
  return SOURCE.slice(at, end === -1 ? undefined : end);
}

test("Home goes to the same place from the keyboard as from the toolbar", () => {
  /* The rig's own Home flies to its `initial` pose, which is the kit's rest pose: pan 0,0. On this
     sheet that is the world's top-left corner, so the drawing slid three quarters off the frame. */
  const home = poseFor({ level: 0, group: null, item: null }, { w: 1188, h: 660 });
  assert.notDeepEqual(home.pan, { x: 0, y: 0 }, "home is the rest pose — this test is moot");

  const key = callback("onCanvasKey");
  assert.match(key, /event\.key === "Home"/, "the canvas hands Home to the rig's rest pose");
  assert.match(key, /flyHome\(\)/, "the canvas's Home is not the toolbar's home");
  assert.match(callback("flyHome"), /poseFor\(\{ level: 0, group: null, item: null \}/);
  assert.match(SOURCE, /onHome=\{flyHome\}/, "the toolbar's home is a second copy of the pose");
});
