/**
 * `design/check-contrast.mjs`, made to fail on the thing it promises to catch.
 *
 * The check runs under `lint`, and on the real tree it only ever passes. These cases copy the real
 * token block into a scratch tree, seed one change each, and assert the exit code - beside the
 * unchanged copy as a control - so a promise in the check's header is something a run has shown.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CHECK = fileURLToPath(new URL("../design/check-contrast.mjs", import.meta.url));
const REAL = readFileSync(
  fileURLToPath(new URL("../components/board/style/base/tokens.css", import.meta.url)),
  "utf8",
);

/** Run the check over the real token block with `extra` declared at the end of it. */
function contrastWith(extra: string): { code: number | null; out: string } {
  const root = mkdtempSync(join(tmpdir(), "hirelane-contrast-"));
  try {
    const dir = join(root, "components", "board", "style", "base");
    mkdirSync(dir, { recursive: true });
    const close = REAL.lastIndexOf("}");
    writeFileSync(join(dir, "tokens.css"), `${REAL.slice(0, close)}${extra}\n${REAL.slice(close)}`);
    const run = spawnSync(process.execPath, [CHECK, root], { encoding: "utf8" });
    return { code: run.status, out: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the real token block passes, copied unchanged, so a red below is the seed's", () => {
  const { code, out } = contrastWith("");
  assert.equal(code, 0, out);
});

test("a new rung on the ink ladder with no floor fails, rather than going unscored", () => {
  // The header: "A token added here with no floor is a token nobody decided about, so the check
  // fails on an unknown token rather than skipping it." A fifth rung at 2:1 is that token.
  const { code, out } = contrastWith("  --bd-ink-5: #3a3a40;");
  assert.equal(code, 1, `an unfloored --bd-ink-5 at about 2:1 passed:\n${out}`);
  assert.match(out, /--bd-ink-5/);
});

test("a token outside the text families is not asked for a floor", () => {
  const { code, out } = contrastWith("  --bd-rule-3: rgb(255 255 255 / 24%);");
  assert.equal(code, 0, out);
});
