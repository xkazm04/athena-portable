/**
 * The first-paint byte gate — README section 3.1, ADR 0089 and 0095.
 *
 * ADR 0095 records the first frame of Main at about 125 kB gzipped. `console/graph.test.ts` keeps
 * named classes of file out of it, but counts files, not bytes: a module that grows, a dependency
 * added inside an allowed file or a shared chunk that fills up passes it. This measures the bytes
 * from a production build instead.
 *
 * What is counted: the JavaScript `chrome.html` loads before its first frame — its module script,
 * every `modulepreload` the build wrote beside it, and every chunk those import statically,
 * transitively. A chunk fetched by `import()` is a depth's lazy view and is not counted. Bytes are
 * gzip at zlib's default level, the transfer proxy the ADR's figure was taken in. Stylesheets are
 * reported, not judged.
 *
 * A missing document, a document with no module script, or a chunk it names that is not on disk
 * fails: a gate that cannot find its numbers must not pass on nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

/**
 * The ceiling, in gzipped bytes, and the record it answers to. A ratchet: it holds or goes down.
 * Lower it when a change lands the first frame well under it; raising it is an owner call with a
 * written reason, never part of the change that breached it.
 *
 * Founded 2026-10-16 at 161,000 B: the build measured 159,082 B in 12 chunks that day, plus
 * 1,918 B (1.2 %) of margin for minifier noise. `targetBytes` is the 125 kB ADR 0095 records; the
 * gap (about 34 kB at founding) is reported on every run, and closing it is the owner's call.
 *
 * Raised 2026-10-24 to 165,000 B by the owner's decision (fleet-surfaces): the task routes, the
 * task store and the tasks row beside her on the surface are first-frame code, and their stubs
 * alone carried the build past 161,000 B.
 *
 * Raised 2026-10-25 to 165,412 B, the measured figure (scan-sweep challenge, surface needs): the
 * tree stood at 164,982 B, and the "what needs you" list and its model on the surface are
 * first-frame code (+430 B after trimming). Ratified by the owner in triage 2026-10-25: the raise
 * landed inside the scan-sweep run, and the owner approved it after the fact.
 *
 * Raised 2026-10-25 to 165,426 B, the measured figure, owner-approved in triage 2026-10-25 (art-bell,
 * the Bell's speaking pose, ADR 0222): the tree stood at 165,247 B, and the Bell's mirror of her
 * face phase is first-frame code because both Bells read it (+179 B, 14 B over the ceiling).
 */
export const FIRST_PAINT = {
  entry: "chrome.html",
  ceilingBytes: 165_426,
  targetBytes: 125_000,
};

const MODULE_SCRIPT = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/gi;
const MODULE_PRELOAD = /<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']([^"']+)["']/gi;
const STYLESHEET = /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["']/gi;
// A static import or re-export in a built chunk: `import{a}from"./x.js"`, `import"./x.js"`,
// `export*from"./x.js"`. `import("./x.js")` has a parenthesis where these have a quote, so a lazy
// chunk never matches.
const STATIC_IMPORT = /(?:\bfrom|\bimport)\s*["'`](\.{1,2}\/[^"'`]+\.js)["'`]/g;

const gz = (buf) => gzipSync(buf).length;

/**
 * Measure the first frame of `entry` in the build at `outDir`.
 *
 * @returns {{ files: { file: string, raw: number, gzip: number }[], gzip: number, raw: number,
 *   css: { file: string, gzip: number }[] }}
 */
export function measureFirstPaint(outDir, entry = FIRST_PAINT.entry) {
  const html = path.join(outDir, entry);
  if (!existsSync(html)) throw new Error(`${entry} is not in ${outDir}: build first`);
  const text = readFileSync(html, "utf8");
  const roots = [...text.matchAll(MODULE_SCRIPT)].map((m) => m[1]);
  if (roots.length === 0) throw new Error(`${entry} has no module script: nothing to measure`);
  const preloads = [...text.matchAll(MODULE_PRELOAD)].map((m) => m[1]);

  const seen = new Map();
  const visit = (abs) => {
    if (seen.has(abs)) return;
    if (!existsSync(abs)) throw new Error(`${entry} loads ${path.relative(outDir, abs)}, which is not in the build`);
    const buf = readFileSync(abs);
    seen.set(abs, { file: path.relative(outDir, abs).replaceAll("\\", "/"), raw: buf.length, gzip: gz(buf) });
    for (const m of buf.toString("utf8").matchAll(STATIC_IMPORT)) visit(path.resolve(path.dirname(abs), m[1]));
  };
  for (const ref of [...roots, ...preloads]) visit(path.resolve(outDir, ref));

  const files = [...seen.values()].sort((a, b) => b.gzip - a.gzip);
  const css = [...text.matchAll(STYLESHEET)].map((m) => {
    const abs = path.resolve(outDir, m[1]);
    return { file: m[1], gzip: existsSync(abs) ? gz(readFileSync(abs)) : 0 };
  });
  return {
    files,
    gzip: files.reduce((n, f) => n + f.gzip, 0),
    raw: files.reduce((n, f) => n + f.raw, 0),
    css,
  };
}

const kB = (n) => `${(n / 1000).toFixed(1)} kB`;

/** Judge a measurement against a budget: pass or fail, with the numbers and the gap to the record. */
export function judgeFirstPaint(measured, budget = FIRST_PAINT) {
  const failures = [];
  if (measured.gzip > budget.ceilingBytes) {
    failures.push(
      `first paint is ${kB(measured.gzip)} gzipped, over the ${kB(budget.ceilingBytes)} ceiling ` +
        `(largest: ${measured.files.slice(0, 3).map((f) => `${f.file} ${kB(f.gzip)}`).join(", ")})`,
    );
  }
  return {
    ok: failures.length === 0,
    failures,
    metrics: {
      gzipBytes: measured.gzip,
      chunks: measured.files.length,
      ceilingBytes: budget.ceilingBytes,
      overTargetBytes: measured.gzip - budget.targetBytes,
    },
  };
}
