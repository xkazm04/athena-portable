/**
 * The Playbooks surface (ADR 0029, ADR 0040): the overview reads, a playbook's layer proves. The
 * replay shows the latest run turn by turn when the bench kept a trace, and says nothing when it
 * did not. Rendered with `renderToStaticMarkup`, no shell, as every module test here.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { entry } from "./index";

test("a benched playbook with a trace opens on its first turn, with a dot for every turn", () => {
  const html = renderToStaticMarkup(entry.preview("open"));
  expect(html).toContain("Watch the run");
  expect(html).toContain("Turn 1 of 4");
  expect(html.match(/class="pb-rail__dot"/g)?.length).toBe(4);
  expect(html.match(/class="pb-rail__visit"/g)?.length).toBe(3);
  expect(html).toContain('aria-current="step"');
  expect(html.includes("list invoice ×2"), "a tool read twice is one chip with its count").toBe(true);
  expect(html.includes("read guarantee ×"), "a tool read once has no count").toBe(false);
  expect(html.includes("(showing"), "a turn kept whole announces no cut").toBe(false);
});

test("a run without a trace, or no run at all, shows no replay", () => {
  expect(renderToStaticMarkup(entry.preview("open-short"))).not.toContain("Watch the run");
  expect(renderToStaticMarkup(entry.preview("open-unbenched"))).not.toContain("Watch the run");
});

test("no overview renders the replay: it belongs to the layer", () => {
  for (const fixture of ["typical", "heavy", "empty", "degraded"]) {
    expect(renderToStaticMarkup(entry.preview(fixture)), fixture).not.toContain("pb-replay");
  }
});

test("a turn the run loop continued says the page answered, not that the person spoke", () => {
  const html = renderToStaticMarkup(entry.preview("open-turn-2"));
  expect(html.includes("Turn 2 of 4")).toBe(true);
  expect(html.includes("the run loop handed her their results")).toBe(true);
  expect(html.includes("1Z88A0")).toBe(true);
});

test("the traps she walked past are listed by id, a filed one first, folded past five", () => {
  const clean = renderToStaticMarkup(entry.preview("open"));
  expect(clean.includes("2 of 2 traps walked past")).toBe(true);
  expect(clean.includes("1Z88B7")).toBe(true);
  const short = renderToStaticMarkup(entry.preview("open-short"));
  expect(short.includes("6 of 7 traps walked past")).toBe(true);
  const first = short.indexOf('class="pb-trap"');
  expect(short.slice(first, first + 400).includes("DP-124")).toBe(true);
  expect(short.includes("Filed anyway.")).toBe(true);
  expect(short.includes("(showing 5 of 7)")).toBe(true);
  expect(short.includes("DP-129")).toBe(false);
});

test("the grid offers whose chore and the order as two radio groups, counted", () => {
  const html = renderToStaticMarkup(entry.preview("typical"));
  expect(html.match(/role="radiogroup"/g)?.length).toBe(2);
  expect(html.includes("All 3")).toBe(true);
  expect(html.includes("At home 1")).toBe(true);
  expect(html.includes("At work 2")).toBe(true);
  expect(html.includes("Hardest first")).toBe(true);
});

test("the overview says what the bench walked past, not only what it found", () => {
  const html = renderToStaticMarkup(entry.preview("typical"));
  expect(html.includes("Traps walked past")).toBe(true);
  expect(html.includes("8 of 9")).toBe(true);
  expect(html.includes("1 false claim")).toBe(true);
  expect(html.includes("by hand")).toBe(true);
});
