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

test("the canvas's label tells a keyboard reader what its keys do there", () => {
  /* On the focused canvas the rig binds the arrows to PAN, plus and minus to zoom, and Home; the
     arrows move between nodes only once focus is on a node. A label that promises the second on
     the first sends the reader the wrong way. */
  const label = /role="application"\s+aria-label="([^"]+)"/.exec(SOURCE)?.[1];
  assert.ok(label, "no labelled application canvas in Drawing.tsx");
  assert.match(label, /arrow keys to pan/i, `"${label}" does not say the arrows pan the canvas`);
  assert.match(label, /plus and minus/i, `"${label}" does not name the zoom keys`);
  assert.match(label, /Home/, `"${label}" does not name Home`);
  assert.match(label, /on a node, the arrows/i, `"${label}" does not say where the arrows rove`);
});

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

const stripped = (file: string): string =>
  readFileSync(new URL(`../components/atlas/variants/archify-lanes/${file}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

test("case 8: every run is a press target, roved to from a node, and read out aloud", () => {
  /* The pointer: each run carries a hit path that names its run and answers a press. */
  const scene = stripped("Scene.tsx");
  const hit = /<path\s+className="al-run-hit"[\s\S]*?\/>/.exec(scene)?.[0];
  assert.ok(hit, "Scene.tsx draws no .al-run-hit path per run");
  assert.match(hit, /data-run-id=\{run\.id\}/, "the hit path does not name its run");
  assert.match(hit, /onClick=\{/, "the hit path answers no press");

  /* The keyboard: '[' and ']' on a focused node rove its runs, through the pure cycle. */
  const key = callback("onNodeKey");
  assert.match(key, /runKey\(/, "a node's keys do not reach the runs it touches");
  assert.match(callback("onOpen"), /setRun\(null\)/, "opening a node leaves a run open");

  /* The readout: a polite live region, never hidden from assistive tech. */
  const chrome = stripped("Chrome.tsx");
  const region = /<div\s+className="al-readout"[^>]*>/.exec(chrome)?.[0];
  assert.ok(region, "Chrome.tsx has no .al-readout region");
  assert.match(region, /aria-live="polite"/, "the readout is not announced");
  assert.doesNotMatch(region, /aria-hidden/, "the readout is hidden from assistive tech");
});
