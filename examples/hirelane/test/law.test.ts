/**
 * `design/check-law.mjs`, made to fail on the thing each of its rules names.
 *
 * The check is a gate - `lint` chains it - and DESIGN-LAW §9 says why a gate has to be seen failing:
 * "A check nobody can fail is worse than no check." Its run on the real tree only ever proves it
 * passes. These cases build a one-direction tree in a scratch directory, seed one violation each,
 * and assert the exit code, with a clean control beside them so a check that fails on everything
 * cannot pass either.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CHECK = fileURLToPath(new URL("../design/check-law.mjs", import.meta.url));
const TOKENS = "components/board/style/base/tokens.css";

/** Run the check over a tree holding a token block and `files`; the exit code and what it printed. */
function lawOn(files: Record<string, string>): { code: number | null; out: string } {
  const root = mkdtempSync(join(tmpdir(), "hirelane-law-"));
  try {
    const tree: Record<string, string> = { [TOKENS]: '[data-variant="board"] { --bd-s1: 4px; }\n', ...files };
    for (const [path, text] of Object.entries(tree)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const run = spawnSync(process.execPath, [CHECK, root], { encoding: "utf8" });
    return { code: run.status, out: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const css = (body: string): Record<string, string> => ({
  "components/board/style/level0/seeded.css": `.bd-seeded {\n  ${body}\n}\n`,
});

test("the real tree passes, and a clean fixture passes, so a red below is the seed's", () => {
  const real = spawnSync(process.execPath, [CHECK], { encoding: "utf8" });
  assert.equal(real.status, 0, real.stdout);
  const clean = lawOn(css("margin: var(--bd-s1);"));
  assert.equal(clean.code, 0, clean.out);
});

test("§9.1: a raw px length outside the token block fails, positive or negative", () => {
  for (const body of ["padding: 12px;", "margin-block-start: -12px;", "inset: 0 -0.5px;", "translate: 0 calc(-1 * 8px);"]) {
    const { code, out } = lawOn(css(body));
    assert.equal(code, 1, `${body} passed:\n${out}`);
    assert.match(out, /raw px/, body);
  }
});

test("§9.1: a px inside a custom-property name or an identifier is not a length", () => {
  const { code, out } = lawOn(css("margin: var(--bd-gap-12px); grid-area: col-2px;"));
  assert.equal(code, 0, out);
});
