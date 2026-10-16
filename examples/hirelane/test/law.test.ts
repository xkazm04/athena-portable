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

test("§4.2: a colour typed in a component stylesheet fails, in any notation CSS accepts", () => {
  for (const body of [
    "color: #e11d48;",
    "color: rgb(225 29 72);",
    "color: hsl(347 77% 50%);",
    "color: oklch(0.6 0.2 15);",
    "color: lab(50% 60 20);",
    "color: hwb(347 11% 12%);",
    "color: color(display-p3 0.9 0.1 0.3);",
  ]) {
    const { code, out } = lawOn(css(body));
    assert.equal(code, 1, `${body} passed:\n${out}`);
    assert.match(out, /colour outside the token block/, body);
  }
});

test("§4.2: the alpha-stop exemption covers black and white, not every colour on the line", () => {
  // What the exemption is for: a mask's alpha stops and a white or black glass plane.
  for (const body of [
    "mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);",
    "background: rgb(255 255 255 / 7%);",
  ]) {
    const { code, out } = lawOn(css(body));
    assert.equal(code, 0, `${body} failed:\n${out}`);
  }
  // What it is not: a hue riding on the same line as an exempt literal.
  for (const body of [
    "box-shadow: inset 0 0 0 var(--bd-s1) #e11d48;",
    "mask-image: linear-gradient(#000, #e11d48);",
    "background: linear-gradient(rgb(255 255 255 / 7%), #e11d48);",
  ]) {
    const { code, out } = lawOn(css(body));
    assert.equal(code, 1, `${body} passed:\n${out}`);
  }
});

test("§4.2: a colour typed in a component's TypeScript fails like one typed in its stylesheet", () => {
  const tsx = (line: string): Record<string, string> => ({
    "components/board/Seeded.tsx": `export const Seeded = () => (\n  ${line}\n);\n`,
  });
  for (const line of ['<i style={{ color: "#e11d48" }} />', '<rect fill="hsl(347 77% 50%)" />']) {
    const { code, out } = lawOn(tsx(line));
    assert.equal(code, 1, `${line} passed:\n${out}`);
    assert.match(out, /colour outside the token block/, line);
  }
  // A white plane at an alpha is light, as it is in a stylesheet; a colour named in a comment is prose.
  for (const line of ['<i style={{ color: "rgb(255 255 255 / 40%)" }} />', "<i /> // was #e11d48"]) {
    const { code, out } = lawOn(tsx(line));
    assert.equal(code, 0, `${line} failed:\n${out}`);
  }
});
