/**
 * The first-paint byte gate — README section 3.1, ADR 0095.
 *
 * Two halves. The instrument is tested on a hand-made build, so it is shown to count what the first
 * frame loads, leave out what a depth fetches later, and fail on a build it cannot read. Then the
 * real gate: a production build of this tree into the OS temp directory, measured and judged
 * against the ceiling in `first-paint.mjs`. It runs in `pnpm test`, so every desktop change is
 * judged by it, not only the ones that run `pnpm perf:all`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

// @ts-expect-error a plain .mjs gate, no declarations
import { FIRST_PAINT, judgeFirstPaint, measureFirstPaint } from "./first-paint.mjs";

type Measured = { files: { file: string; gzip: number }[]; gzip: number };
type Judged = { ok: boolean; failures: string[]; metrics: Record<string, number> };

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A build on disk: `files` maps a path under the out dir to its text. */
function fixture(files: Record<string, string>): string {
  const dir = temp("athena-fp-fixture-");
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const HTML = `<!doctype html><html><head>
<script type="module" crossorigin src="./assets/entry.js"></script>
<link rel="modulepreload" crossorigin href="./assets/shared.js">
<link rel="stylesheet" crossorigin href="./assets/app.css">
</head><body></body></html>`;

describe("measureFirstPaint", () => {
  it("counts the entry, its preloads and their static imports, and not a lazy chunk", () => {
    const out = fixture({
      "chrome.html": HTML,
      "assets/entry.js": `import{a}from"./shared.js";import"./side.js";const v=()=>import("./lazy.js");a(v);`,
      "assets/shared.js": `export*from"./deep.js";export const a=1;`,
      "assets/side.js": "console.log(1);",
      "assets/deep.js": "export const d=2;",
      "assets/lazy.js": "x".repeat(50_000),
      "assets/app.css": "body{}",
    });
    const m = measureFirstPaint(out) as Measured;
    expect(m.files.map((f) => f.file).sort()).toEqual([
      "assets/deep.js",
      "assets/entry.js",
      "assets/shared.js",
      "assets/side.js",
    ]);
    expect(m.gzip).toBe(m.files.reduce((n, f) => n + f.gzip, 0));
    expect(m.gzip).toBeGreaterThan(0);
  });

  it("fails when the document, its module script or a chunk it loads is missing", () => {
    expect(() => measureFirstPaint(fixture({ "other.html": HTML }))).toThrow(/chrome\.html is not in/);
    expect(() => measureFirstPaint(fixture({ "chrome.html": "<html><head></head></html>" }))).toThrow(
      /no module script/,
    );
    expect(() =>
      measureFirstPaint(fixture({ "chrome.html": HTML, "assets/entry.js": `import"./gone.js";` })),
    ).toThrow(/gone\.js, which is not in the build/);
  });
});

describe("judgeFirstPaint", () => {
  const measured = { gzip: 1000, files: [{ file: "assets/app.js", gzip: 1000 }] };

  it("passes at the ceiling and fails one byte over it, naming the largest chunk", () => {
    expect((judgeFirstPaint(measured, { ceilingBytes: 1000, targetBytes: 500 }) as Judged).ok).toBe(true);
    const over = judgeFirstPaint(measured, { ceilingBytes: 999, targetBytes: 500 }) as Judged;
    expect(over.ok).toBe(false);
    expect(over.failures[0]).toMatch(/over the 1\.0 kB ceiling.*assets\/app\.js/);
    expect(over.metrics.overTargetBytes).toBe(500);
  });

  it("keeps the ceiling a ratchet above the recorded target, never the other way round", () => {
    expect(FIRST_PAINT.targetBytes).toBe(125_000);
    expect(FIRST_PAINT.ceilingBytes).toBeGreaterThanOrEqual(FIRST_PAINT.targetBytes);
  });
});

describe("the first frame of this tree", () => {
  it("is under the first-paint ceiling in a production build", { timeout: 180_000 }, () => {
    const out = temp("athena-fp-build-");
    const vitePkg = createRequire(path.join(APP, "package.json")).resolve("vite/package.json");
    const vite = path.join(path.dirname(vitePkg), "bin", "vite.js");
    // The test runner's own variables must not reach the build: NODE_ENV=test would bundle React's
    // development build and measure something that never ships.
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^(VITEST|NODE_ENV$|TEST$)/.test(k)) env[k] = v;
    env.NODE_ENV = "production";
    const build = spawnSync(process.execPath, [vite, "build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], {
      cwd: APP,
      env,
      encoding: "utf8",
    });
    expect(build.status, build.stderr || build.stdout).toBe(0);
    const verdict = judgeFirstPaint(measureFirstPaint(out)) as Judged;
    expect(verdict.failures).toEqual([]);
  });
});
