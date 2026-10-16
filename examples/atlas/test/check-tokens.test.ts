/**
 * The design gate, run against seeded trees.
 *
 * `design/check-tokens.mjs` is chained into `pnpm --filter atlas lint`, and a gate that exits 0
 * says the same thing whether it looked or not. Each case copies the script and the real token
 * file into a scratch tree under the OS temp directory, seeds one thing the law forbids, and
 * asserts the exit code: the script resolves everything from its own location, so the copy is
 * the gate exactly as the app runs it.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const APP = fileURLToPath(new URL("../", import.meta.url));
const TOKENS = "components/atlas/style/base/tokens.css";

/** A scratch app holding the gate, the real token file, and `files` (path -> text). */
function run(files: Record<string, string>): { status: number | null; out: string } {
  const root = mkdtempSync(join(tmpdir(), "atlas-check-tokens-"));
  try {
    mkdirSync(join(root, "design"), { recursive: true });
    copyFileSync(join(APP, "design/check-tokens.mjs"), join(root, "design/check-tokens.mjs"));
    mkdirSync(dirname(join(root, TOKENS)), { recursive: true });
    copyFileSync(join(APP, TOKENS), join(root, TOKENS));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text, { flag: path === TOKENS ? "a" : "w" });
    }
    const r = spawnSync(process.execPath, [join(root, "design/check-tokens.mjs")], { encoding: "utf8" });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("control: a clean tree passes, and a raw px in a stylesheet fails", () => {
  const clean = run({ "components/atlas/x.css": ".x { color: var(--at-ground); }\n" });
  assert.equal(clean.status, 0, clean.out);
  const raw = run({ "components/atlas/x.css": ".x { padding: 12px; }\n" });
  assert.equal(raw.status, 1, raw.out);
});

test("a mistyped --at-* token inside the token file's own alias layer fails the gate", () => {
  /* The alias layer is where every kit `--dk-*` hook is re-pointed at an `--at-*` value; a typo
     there resolves to nothing in CSS, silently, exactly like a typo anywhere else. */
  const r = run({ [TOKENS]: '\n[data-variant="blueprint"] { --dk-seeded: var(--at-grund); }\n' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /undeclared token --at-grund/);
});
