/**
 * The seeded control for `test/scratch-guard.test.ts` - not a suite of its own (the runner's glob
 * is `*.test.ts`, so it never runs this file directly).
 *
 * A top-level `await` between two `test()` calls lets node:test finish the tests declared so far
 * and fire `tempHome`'s root `after` hook, which closes the books and puts the working directory
 * back. The second test then asks for the books from the directory the run STARTED in - the app's
 * own, whose `data/ledgerbox.sqlite` is the dev server's database. The guard test runs this file
 * from a throwaway stand-in for that directory and checks nothing was opened there.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { tempHome } from "./tmp-home";

const home = tempHome("ledgerbox-reaper-control-");
const { db } = await import("../lib/db");

test("the first test reads the scratch books", () => {
  assert.ok(db().file.startsWith(home), `opened ${db().file}`);
});

// The await that lets the reaper fire mid-file (the shape 3460add removed from one file by hand).
await new Promise((resolve) => setTimeout(resolve, 50));

test("a test declared after a top-level await", () => {
  console.log(`REAPER_CONTROL cwd=${process.cwd()}`);
  db().get("SELECT COUNT(*) AS n FROM invoices");
});
