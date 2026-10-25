// The kit's coverage is defined over the whole tree, and its gate cannot shrink silently
// (scan-sweep challenge 2026-10-25, demo-kit-tests/B; README "Coverage").
//
// Node's report lists only the files a run imported, so the hooks no test can load were absent from
// it rather than low. These pin `scripts/coverage.ts`: the report's population comes from the
// filesystem, unreached files sit at 0%, the reached-only figure is never printed alone, and the
// floors over the pure modules fail on a regression, on a file the run stopped reaching, and on a
// floor whose file is gone.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  type MergedFile,
  gate,
  headline,
  listTree,
  mergeScope,
  parseLcov,
  ratchet,
} from "../scripts/coverage.ts";

const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function record(sf: string, lf: number, lh: number, brf: number, brh: number): string {
  return [`SF:${sf}`, "FN:1,f", `LF:${lf}`, `LH:${lh}`, `BRF:${brf}`, `BRH:${brh}`, "end_of_record"].join("\n");
}

function reached(path: string, linesFound: number, linesHit: number, branchesFound = 10, branchesHit = 10): MergedFile {
  return { path, status: "reached", linesFound, linesHit, branchesFound, branchesHit };
}

test("parseLcov reads per-file line and branch totals, keyed by kit-relative POSIX path from a Windows path or a file:// URL", () => {
  const root = "C:\\work\\kit";
  const text = [
    "TN:",
    record("C:\\work\\kit\\src\\zoom\\escape.ts", 84, 80, 20, 18),
    record("file:///C:/work/kit/template/lib/acts.ts", 145, 139, 22, 20),
    record("src\\db\\index.ts", 225, 206, 38, 30),
  ].join("\n");
  assert.deepEqual(parseLcov(text, root), {
    "src/zoom/escape.ts": { linesFound: 84, linesHit: 80, branchesFound: 20, branchesHit: 18 },
    "template/lib/acts.ts": { linesFound: 145, linesHit: 139, branchesFound: 22, branchesHit: 20 },
    "src/db/index.ts": { linesFound: 225, linesHit: 206, branchesFound: 38, branchesHit: 30 },
  });
  const posix = parseLcov(record("file:///home/ci/kit/src/a.ts", 10, 5, 0, 0), "/home/ci/kit");
  assert.deepEqual(Object.keys(posix), ["src/a.ts"]);
});

test("mergeScope lists a tree file the lcov never mentions at 0 of its line count, unreached, and omits no tree file", () => {
  const records = { "src/a.ts": { linesFound: 100, linesHit: 90, branchesFound: 4, branchesHit: 3 } };
  const merged = mergeScope(records, [
    { path: "src/a.ts", lines: 100 },
    { path: "src/zoom/useCameraRig.ts", lines: 658 },
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[1], {
    path: "src/zoom/useCameraRig.ts",
    status: "unreached",
    linesFound: 658,
    linesHit: 0,
    branchesFound: 0,
    branchesHit: 0,
  });
  assert.equal(merged[0]?.status, "reached");
});

test("headline prints the whole-tree figure with its population, and the reached-only figure only beside it", () => {
  const merged = mergeScope({ "a.ts": { linesFound: 100, linesHit: 90, branchesFound: 0, branchesHit: 0 } }, [
    { path: "a.ts", lines: 100 },
    { path: "b.ts", lines: 100 },
  ]);
  const h = headline(merged);
  assert.equal(h.whole.pct.toFixed(1), "45.0");
  assert.match(h.whole.label, /45\.0% .*2 of 2 files/);
  assert.equal(h.reached.pct.toFixed(1), "90.0");
  assert.match(h.reached.label, /90\.0% .*1 of 2 files/);
  assert.ok(h.text.includes(h.whole.label) && h.text.includes(h.reached.label), "both figures, together");
  assert.ok(h.text.indexOf(h.whole.label) < h.text.indexOf(h.reached.label), "the whole tree leads");
});

test("gate fails a floored file below its floor, naming file, floor and actual, and fails a floored file the run did not reach", () => {
  const floors = { "src/zoom/escape.ts": { lines: 95, branches: 90 }, "src/zoom/flight.ts": { lines: 100, branches: 100 } };
  const merged = mergeScope({ "src/zoom/escape.ts": { linesFound: 100, linesHit: 80, branchesFound: 10, branchesHit: 10 } }, [
    { path: "src/zoom/escape.ts", lines: 100 },
    { path: "src/zoom/flight.ts", lines: 94 },
  ]);
  const result = gate(floors, merged);
  assert.equal(result.ok, false);
  assert.ok(
    result.failures.some((f) => f.includes("src/zoom/escape.ts") && f.includes("95") && f.includes("80.00")),
    result.failures.join("; "),
  );
  assert.ok(
    result.failures.some((f) => f.includes("floored file not reached") && f.includes("src/zoom/flight.ts")),
    result.failures.join("; "),
  );
  assert.equal(gate({ "src/zoom/escape.ts": { lines: 80, branches: 100 } }, merged).ok, true, "at the floor passes");
});

test("gate fails a floor whose path is no longer in the tree, so the gated population cannot shrink silently", () => {
  const result = gate({ "src/zoom/renamed.ts": { lines: 90, branches: 90 } }, [reached("src/zoom/escape.ts", 10, 10)]);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.failures.filter((f) => f.startsWith("stale floor: src/zoom/renamed.ts")).length,
    1,
    result.failures.join("; "),
  );
});

test("ratchet raises a floor to floor(actual), never lowers one, and reports a floor above the measured figure", () => {
  const merged = [reached("up.ts", 1000, 987, 100, 91), reached("down.ts", 100, 50, 10, 5)];
  const { floors, raised, above } = ratchet(
    { "up.ts": { lines: 90, branches: 80 }, "down.ts": { lines: 70, branches: 40 } },
    merged,
  );
  assert.deepEqual(floors["up.ts"], { lines: 98, branches: 91 });
  assert.deepEqual(floors["down.ts"], { lines: 70, branches: 50 }, "lines kept at 70 above 50; branches rose to 50");
  assert.equal(raised.length, 2);
  assert.ok(above.some((a) => a.startsWith("down.ts")), above.join("; "));
  assert.ok(!above.some((a) => a.startsWith("up.ts")));
});

test("listTree derives src/**/*.ts(x), template/lib/*.ts and root *.ts from the filesystem, so a new file appears with no config edit", () => {
  const root = mkdtempSync(join(tmpdir(), "dk-cov-"));
  made.push(root);
  const put = (rel: string, body = "export const x = 1;\n"): void => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  put("src/zoom/a.ts", "a\nb\nc\n");
  put("src/ui/B.tsx");
  put("src/types.d.ts");
  put("template/lib/constants.ts");
  put("template/lib/deep/no.ts");
  put("template/app/page.tsx");
  put("test/a.test.ts");
  put("scripts/coverage.ts");
  put("adopt.ts");
  const before = listTree(root).map((f) => f.path);
  assert.deepEqual(before, ["adopt.ts", "src/ui/B.tsx", "src/zoom/a.ts", "template/lib/constants.ts"]);
  assert.equal(listTree(root).find((f) => f.path === "src/zoom/a.ts")?.lines, 3);
  put("src/zoom/useNew.ts");
  assert.ok(listTree(root).some((f) => f.path === "src/zoom/useNew.ts"));
});

/** TAP from one node --test run: the count and the pass/fail set by test name. */
function tapRun(args: readonly string[]): { tests: number; outcomes: string[] } {
  // NODE_TEST_CONTEXT would make the child report to this runner instead of printing its own TAP,
  // and an inherited NODE_V8_COVERAGE would hand its coverage to this run instead of its own lcov.
  const { NODE_TEST_CONTEXT: _context, NODE_V8_COVERAGE: _coverage, ...env } = process.env;
  const res = spawnSync(process.execPath, args, {
    cwd: KIT,
    encoding: "utf8",
    env: { ...env, DEMO_KIT_COVERAGE_CHILD: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = res.stdout;
  const tests = Number(/^# tests (\d+)/m.exec(out)?.[1] ?? "-1");
  const outcomes = [...out.matchAll(/^(not ok|ok) \d+ - (.+?)(?: # .*)?$/gm)].map((m) => `${m[1]} ${m[2]}`).sort();
  return { tests, outcomes };
}

test(
  "guard: the package's coverage run executes the same tests as the plain node --test run",
  { skip: process.env.DEMO_KIT_COVERAGE_CHILD === "1" ? "inside the guard's own child run" : false },
  () => {
    const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    const script = pkg.scripts.test ?? "";
    const run = script.split("&&")[0]?.trim() ?? "";
    assert.match(run, /^node --test .*--experimental-test-coverage/);
    // The package's own argv, its reporters swapped for TAP so the two runs are compared like for like.
    const args = (run.match(/"[^"]*"|\S+/g) ?? [])
      .slice(1)
      .map((a) => a.replace(/"/g, ""))
      .filter((a) => !a.startsWith("--test-reporter"));
    const files = args.filter((a) => !a.startsWith("--"));
    assert.deepEqual(files, ["test/*.test.ts"], "the coverage run takes the same file set as the plain run");
    const lcov = join(mkdtempSync(join(tmpdir(), "dk-cov-run-")), "lcov.info");
    made.push(dirname(lcov));
    const covered = tapRun([
      ...args.filter((a) => a.startsWith("--")),
      "--test-reporter=tap",
      "--test-reporter-destination=stdout",
      "--test-reporter=lcov",
      `--test-reporter-destination=${lcov}`,
      ...files,
    ]);
    const plain = tapRun(["--test", "--test-reporter=tap", ...files]);
    assert.ok(plain.tests > 0, "the plain run ran tests");
    assert.equal(covered.tests, plain.tests);
    assert.deepEqual(covered.outcomes, plain.outcomes);
    assert.ok(readFileSync(lcov, "utf8").includes("SF:"), "and the coverage run wrote its lcov");
  },
);
