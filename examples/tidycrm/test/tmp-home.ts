/**
 * The scratch working directory a test file runs in.
 *
 * `openDb` resolves its SQLite file from `process.cwd()/data`, so each test file moves into a
 * fresh temp directory before it imports the library. This is the one place that makes it, and
 * the one place that removes it: the database handle is closed first (an open SQLite file cannot
 * be deleted on Windows), then the directory goes. Set `KEEP_TMP=1` to keep it for debugging.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

export function tempHome(prefix: string): string {
  const start = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.chdir(dir);
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
