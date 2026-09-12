/**
 * Compile the panel and copy its two pages beside it.
 *
 * No bundler. The panel is plain ES modules with explicit `.js` specifiers, which a webview and a
 * browser tab both load directly — so `tsc` plus three `cp` calls is the whole build, and
 * `preview.html` works off the same output the shell loads (README §3.5's automation seam).
 */

import { cp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..");
const dist = path.join(app, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// The compiler is resolved as a module rather than as a command: `npx` and `pnpm exec` behave
// differently across platforms and package managers, and a build that works on one machine is not
// a build.
const compiler = fileURLToPath(import.meta.resolve("typescript/bin/tsc"));
const tsc = spawnSync(process.execPath, [compiler, "-p", "tsconfig.build.json"], {
  cwd: app,
  stdio: "inherit",
});
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

for (const file of ["index.html", "preview.html"]) {
  await cp(path.join(app, file), path.join(dist, file));
}
await cp(path.join(app, "src", "panel.css"), path.join(dist, "panel.css"));
console.log("panel built into dist/");
