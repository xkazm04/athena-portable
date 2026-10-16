/**
 * The scratch working directory a test file runs in.
 *
 * `openDb` resolves its SQLite file from `process.cwd()/data`, so each test file moves into a
 * fresh temp directory before it imports the library. This is the one place that makes it, and
 * the one place that removes it: the database handle is closed first (an open SQLite file cannot
 * be deleted on Windows), then the directory goes. Set `KEEP_TMP=1` to keep it for debugging.
 *
 * It also confines the kit's `openDb` to that directory (`DB_SCRATCH_ENV`) for the rest of the
 * process, and never lifts it. The `after` hook is a root hook: a file that awaits at top level
 * between two `test()` calls lets it fire mid-file, and every later test then opened the app's
 * own `data/` database - the dev server's books. Under the confinement those tests throw instead.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

import { DB_SCRATCH_ENV } from "@athena/demo-kit/db";

export function tempHome(prefix: string): string {
  const start = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.chdir(dir);
  process.env[DB_SCRATCH_ENV] = process.cwd();
  after(async () => {
    try {
      (await import("../lib/db")).db().close();
    } catch {
      // The library never loaded, so there is no handle to close.
    }
    process.chdir(start);
    if (process.env.KEEP_TMP) return;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return dir;
}
