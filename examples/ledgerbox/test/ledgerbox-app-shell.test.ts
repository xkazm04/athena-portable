/**
 * The app shell's own agreements, pinned (scan-sweep stabilize, 2026-10-16).
 *
 * `app/actions.ts` is where an agent's tool call, or a person's click, becomes a write to the
 * books, so each test here is a statement about what a call may change: which invoices money can
 * be applied to, which a letter may chase, what a server action accepts from a caller that did not
 * come through the tool layer. Plus the one thing the project config promises about itself: the
 * Node it runs on. Each one was seen red on the tree before its fix.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** `22.18.0` -> [22, 18, 0]. */
function parse(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version.replace(/^v/, "").split(".").map(Number);
  return [major, minor, patch];
}

function compare(a: string, b: string): number {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/**
 * Whether `version` is inside an `engines` range. Only the comparators a range here is written
 * with - `||`, `>=`, `>`, `<`, `<=`, `^` - and a form this does not know fails the test rather than
 * being read as "anything".
 */
function satisfies(range: string, version: string): boolean {
  return range.split("||").some((alternative) =>
    alternative
      .trim()
      .split(/\s+/)
      .every((comparator) => {
        const m = /^(>=|<=|>|<|\^)?(\d+(?:\.\d+){0,2})$/.exec(comparator);
        if (!m) throw new Error(`engines comparator ${JSON.stringify(comparator)} is not one this test reads`);
        const [, op = "", bound = ""] = m;
        const c = compare(version, bound);
        if (op === ">=") return c >= 0;
        if (op === ">") return c > 0;
        if (op === "<=") return c <= 0;
        if (op === "<") return c < 0;
        if (op === "^") return c >= 0 && parse(version)[0] === parse(bound)[0];
        return c === 0;
      }),
  );
}

/**
 * What `pnpm test` and the app itself need from Node, and where each line got it: the first
 * release that has it in the 22 line and in the current line (`null` = never in that line).
 *
 * - `module.registerHooks` - `test/register.mjs` (`@types/node` module.d.ts: since v22.15.0).
 * - `module.stripTypeScriptTypes` - `test/register.mjs`, for `.tsx` (module.d.ts: since v22.13.0).
 * - `.ts` loaded with no flag - `package.json`'s test script runs `test/**\/*.test.ts` with no
 *   `--experimental-strip-types`; type stripping is on by default from v22.18.0 (Node changelog).
 * - `node:sqlite` with no flag - every read of the books (`@athena/demo-kit/db`); `node:sqlite`
 *   arrived in v22.5.0 behind `--experimental-sqlite`, and the flag went in v22.13.0.
 * - `DatabaseSync#isTransaction` - the kit's `withTx` rollback (sqlite.d.ts: since v24.0.0; the
 *   Node changelog has it in v22.16.0). Without it a failed write is never rolled back.
 */
const NEEDS: { what: string; since: Record<number, string | null> }[] = [
  { what: "module.registerHooks", since: { 22: "22.15.0", 23: "23.5.0", 24: "24.0.0" } },
  { what: "module.stripTypeScriptTypes", since: { 22: "22.13.0", 23: "23.2.0", 24: "24.0.0" } },
  { what: ".ts with no flag", since: { 22: "22.18.0", 23: "23.6.0", 24: "24.0.0" } },
  { what: "node:sqlite with no flag", since: { 22: "22.13.0", 23: "23.4.0", 24: "24.0.0" } },
  { what: "DatabaseSync#isTransaction", since: { 22: "22.16.0", 23: null, 24: "24.0.0" } },
];

function runsOn(version: string): string[] {
  const major = parse(version)[0];
  return NEEDS.filter(({ since }) => {
    const first = major in since ? since[major] : major > 24 ? "0.0.0" : null;
    return first === null || first === undefined || compare(version, first) < 0;
  }).map(({ what }) => what);
}

test("the Node range package.json declares is one the tests and the books actually run on", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    engines?: { node?: string };
  };
  const range = pkg.engines?.node;
  assert.ok(range, "package.json declares engines.node");
  // Every boundary in the table, on both sides, plus the majors around them.
  const probes = ["20.19.0", "22.5.0", "22.12.0", "22.13.0", "22.15.0", "22.17.1", "22.18.0", "22.20.0",
    "23.0.0", "23.5.0", "23.6.0", "23.11.0", "24.0.0", "24.12.0", "25.0.0"];
  for (const version of probes) {
    const missing = runsOn(version);
    assert.equal(
      satisfies(range, version),
      missing.length === 0,
      missing.length === 0
        ? `${range} refuses Node ${version}, which has everything the app and its tests need`
        : `${range} admits Node ${version}, which lacks ${missing.join(", ")}`,
    );
  }
  // And the Node running this test is one the range admits.
  assert.ok(satisfies(range, process.versions.node), `${range} admits the running Node ${process.versions.node}`);
});
