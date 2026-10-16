/**
 * No test can reach the app's own books (scan-sweep stabilize, 2026-10-16).
 *
 * `tempHome` moves a test file into a scratch directory and restores the working directory in a
 * root `after` hook. A file that awaits at top level between its `test()` calls lets that hook
 * fire mid-file, and every later test then opened `data/ledgerbox.sqlite` in the app directory -
 * the running dev server's database (95 activity rows were written there that way before 3460add
 * guarded the one file that did it). The guard now lives in the harness: `tempHome` confines the
 * kit's `openDb` to the scratch home for the rest of the process, so the same file fails loudly
 * instead of writing to the live books.
 *
 * Driven against a stand-in for the app directory, never the real one: the control runs in a
 * child process whose starting directory is a throwaway, so a regression writes there.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));

test("a test declared after a top-level await cannot open the books where the run started", () => {
  const app = mkdtempSync(join(tmpdir(), "ledgerbox-standin-app-"));
  try {
    const run = spawnSync(
      process.execPath,
      ["--import", new URL("./register.mjs", import.meta.url).href, here("./reaper-control.fixture.ts")],
      { cwd: app, encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: undefined } },
    );
    const out = `${run.stdout}\n${run.stderr}`;
    // The control is live: the reaper really fired before the second test ran.
    assert.match(out, new RegExp(`REAPER_CONTROL cwd=${escape(app)}`), out);
    assert.equal(existsSync(join(app, "data")), false, `the stand-in app dir now holds ${list(app)}`);
    assert.match(out, /DEMO_KIT_DB_SCRATCH/, "the refusal names the guard");
    assert.notEqual(run.status, 0, "the test that reached for the app's books failed");
  } finally {
    rmSync(app, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function list(dir: string): string {
  return existsSync(join(dir, "data")) ? readdirSync(join(dir, "data")).join(", ") : "nothing";
}
