// The database's test confinement (scan-sweep stabilize, 2026-10-16): with DB_SCRATCH_ENV set, as
// every app's test/tmp-home.ts sets it, openDb opens nothing outside that directory - so a test
// whose working directory was restored early fails instead of writing to the dev server's books.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The module imports the `server-only` build marker, which only a bundler resolves.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    return next(specifier, context);
  },
});

const { DB_SCRATCH_ENV, openDb } = await import("../src/db/index.ts");

const seed = (d: { exec(sql: string): void }) => d.exec("CREATE TABLE x (v INTEGER)");

test("under a scratch confinement openDb opens inside it and refuses everything else", (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "dk-db-scratch-"));
  const live = mkdtempSync(join(tmpdir(), "dk-db-live-"));
  // A sibling whose name merely starts with the scratch path is outside it.
  const sibling = `${scratch}-app`;
  const before = process.env[DB_SCRATCH_ENV];
  process.env[DB_SCRATCH_ENV] = scratch;
  t.after(() => {
    if (before === undefined) delete process.env[DB_SCRATCH_ENV];
    else process.env[DB_SCRATCH_ENV] = before;
    for (const dir of [scratch, live, sibling]) rmSync(dir, { recursive: true, force: true });
  });

  const inside = openDb("s", { file: join(scratch, "data", "s.sqlite"), seed });
  inside.close();

  for (const file of [join(live, "data", "s.sqlite"), join(sibling, "data", "s.sqlite")]) {
    assert.throws(() => openDb("s", { file, seed }), new RegExp(DB_SCRATCH_ENV), file);
    assert.equal(existsSync(file), false, `${file} was created before the refusal`);
  }
});

test("without the confinement openDb opens any file it is given", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dk-db-free-"));
  const before = process.env[DB_SCRATCH_ENV];
  delete process.env[DB_SCRATCH_ENV];
  t.after(() => {
    if (before !== undefined) process.env[DB_SCRATCH_ENV] = before;
    rmSync(dir, { recursive: true, force: true });
  });
  const db = openDb("f", { file: join(dir, "f.sqlite"), seed });
  db.close();
});
