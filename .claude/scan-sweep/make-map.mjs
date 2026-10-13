// Builds context-map.json for the desktop UI from the directories below.
// Run from the repo root: node .claude/scan-sweep/make-map.mjs
import { readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const SRC = "apps/desktop/src";
const groups = [
  { name: "console", contexts: [
    ["console-root", "The depth console root: Console, hash mirror, preview", ["console"]],
    ["stage", "The stage: layers, backdrop, depth transitions", ["stage"]],
    ["bell", "The bell: Athena's jellyfish drawing and its states", ["bell"]],
    ["depth-model", "Depth path grammar and navigation", ["depth"]],
    ["art", "Illustrations and glyphs shared by the scenes", ["art"]],
  ]},
  { name: "scenes", contexts: [
    ["scene-surface", "The surface scene: marquee, ask row, lights", ["scenes/surface"]],
    ["scene-waking", "The first act: setup steps", ["scenes/waking"]],
    ["scene-apps", "Apps depth: origins, page band, tools", ["scenes/apps"]],
    ["scene-chores", "Chores depth: playbooks, runs, replay", ["scenes/chores"]],
    ["scene-accounts", "Accounts depth: connectors and allowlists", ["scenes/accounts"]],
    ["scene-voice", "Voice depth: studio, settings, frame loop", ["scenes/voice", "modules/voice"]],
    ["scene-mind", "Mind depth: engine, brain, look, data, mic", ["scenes/mind"]],
    ["scene-shared", "Pieces shared by the scenes", ["scenes/shared", "scenes/registry.ts"]],
  ]},
  { name: "windows", contexts: [
    ["companion", "Her own window: conversation, captures, drawing", ["companion"]],
    ["halo", "The halo overlay window", ["halo"]],
    ["components", "Shared components catalog", ["components"]],
    ["styles-tokens", "App-wide tokens, themes and motion tokens", ["styles"]],
    ["lib-motion", "Animation clock, ids, helpers, stores that drive the UI", ["lib", "stores"]],
  ]},
];

const keep = /\.(tsx?|css)$/;
const skip = /\.(test|fixtures?)\.|\/fixtures?\.|preview/;
const walk = (p) => {
  const abs = path.join(SRC, p);
  const st = statSync(abs);
  if (st.isFile()) return keep.test(p) ? [path.posix.join(SRC, p)] : [];
  return readdirSync(abs).flatMap((f) => walk(path.posix.join(p, f)));
};

const map = {
  groups: groups.map((g) => ({
    name: g.name,
    contexts: g.contexts.map(([name, description, dirs]) => ({
      name,
      description,
      file_paths: dirs.flatMap(walk).filter((f) => !skip.test(f)),
    })),
  })),
};
writeFileSync(".claude/scan-sweep/context-map.json", JSON.stringify(map, null, 2) + "\n");
for (const g of map.groups) for (const c of g.contexts) console.log(c.name.padEnd(16), c.file_paths.length);
