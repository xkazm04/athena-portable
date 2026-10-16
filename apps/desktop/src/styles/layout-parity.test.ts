/**
 * The two chrome heights app.css shares with the shell — README section 3.5, ADR 0088.
 *
 * `layout.rs` cuts the window into rectangles by `BAR_HEIGHT` and `STRIP_HEIGHT`, and the stage
 * draws its bar and its band to `--bar-height` and `--strip-height`. Both files say that editing
 * one without the other is how the chrome and its rectangle drift apart; this is the check that
 * holds them to it.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");
const rust = readFileSync(new URL("../../src-tauri/src/layout.rs", import.meta.url), "utf8");

function cssPx(name: string): number {
  const m = new RegExp(`\\n\\s*${name}:\\s*(\\d+(?:\\.\\d+)?)px;`).exec(css);
  if (!m) throw new Error(`app.css spells no ${name} in px`);
  return Number(m[1]);
}

function rustF64(name: string): number {
  const m = new RegExp(`pub const ${name}: f64 = (\\d+(?:\\.\\d+)?);`).exec(rust);
  if (!m) throw new Error(`layout.rs has no f64 ${name}`);
  return Number(m[1]);
}

test.each([
  ["--bar-height", "BAR_HEIGHT"],
  ["--strip-height", "STRIP_HEIGHT"],
])("%s is the height layout.rs reserves as %s", (token, constant) => {
  expect(cssPx(token)).toBe(rustF64(constant));
});
