/** The companion stylesheet's rules — ADR 0026, README sections 3.1 and 3.5. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("./companion.css", import.meta.url), "utf8");

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const head = "\n" + selector + " {";
  const at = css.indexOf(head);
  if (at === -1) throw new Error(`no rule ${selector}`);
  return css.slice(at, css.indexOf("\n}", at));
}

test("nothing readable is set under 12px, at either text-size step", () => {
  const sizes = [
    ...css.matchAll(/font-size:\s*(?:calc\()?(\d+(?:\.\d+)?)px/g),
    ...css.matchAll(/font:\s*[\w.]+\s+(?:calc\()?(\d+(?:\.\d+)?)px/g),
  ].map((m) => Number(m[1]));
  expect(sizes.length).toBeGreaterThan(10);
  for (const px of sizes) expect(px).toBeGreaterThanOrEqual(12);
});

test("the icon buttons (pin, put away) ease their hover and their pressed state on the fast duration", () => {
  const t = rule(".aw .ico-btn").match(/transition:([^;]*);/);
  expect(t).not.toBeNull();
  for (const prop of ["background", "color", "border-color"]) expect(t![1]).toContain(`${prop} var(--dur-fast)`);
});

test("the selected tab's edge fades in as a bar; no box-shadow snaps, and colour eases with the background", () => {
  expect(rule('.tabs button[aria-selected="true"]')).not.toMatch(/box-shadow/);
  expect(rule(".tabs button::before")).toContain("transition: opacity var(--dur-fast)");
  expect(rule('.tabs button[aria-selected="true"]::before')).toContain("opacity: 1");
  expect(rule(".tabs button")).toContain("color var(--dur-fast)");
});

test("a button that is answered or sending dims on the fast duration, instead of jumping to 0.45", () => {
  expect(rule(".aw .aw-btn:disabled")).toContain("opacity: 0.45");
  expect(rule(".aw .aw-btn")).toContain("opacity var(--dur-fast)");
});

test("the text buttons (Main is hidden, done) answer a pointer and ease the change", () => {
  expect(rule(".aw .aw-textbtn")).toContain("transition: color var(--dur-fast)");
  expect(rule(".aw .aw-textbtn:hover")).toContain("color: var(--paper-ink)");
});

test("a count badge centres its figure: the line is as tall as the badge, at either text-size step", () => {
  expect(rule(".pip-n")).toContain("height: 18px");
  expect(rule(".pip-n")).toContain("/18px ");
  expect(rule(".aw-badge")).toContain("height: 20px");
  expect(rule(".aw-badge")).toContain("line-height: 20px");
});
