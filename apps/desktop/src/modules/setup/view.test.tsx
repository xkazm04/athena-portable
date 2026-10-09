/**
 * Setup's settings mood is two layers (ADR 0029): the overview reads and each fact's layer writes.
 * The onboarding letter keeps its controls inline — the ADR's first-run exception.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { entry } from "./index";

test("the settings overview is one card per fact and renders no control", () => {
  const html = renderToStaticMarkup(entry.preview("settings"));
  expect(html.match(/class="setup-card /g)?.length).toBe(7);
  expect(html).not.toMatch(/<input|<textarea|role="radiogroup"|role="dialog"/);
});

test("every card carries a pill, a fact without a standing says what it is set to", () => {
  const html = renderToStaticMarkup(entry.preview("settings"));
  expect(html.match(/class="setup-card__pill"><span/g)?.length).toBe(7);
  // Every drawing is stroked: none fills a shape, so the seven read as one family.
  expect(html).not.toMatch(/fill="currentColor"/);
});

test("a fact's layer holds its controls, and the theme layer previews both themes", () => {
  const theme = renderToStaticMarkup(entry.preview("open-theme"));
  expect(theme).toContain('role="dialog"');
  expect(theme).toContain('role="radiogroup"');
  expect(theme.match(/class="theme-preview"/g)?.length).toBe(2);
  const engine = renderToStaticMarkup(entry.preview("open-engine-missing"));
  expect(engine).toContain("Check again");
});

test("the onboarding letter keeps its controls inline (the first-run exception)", () => {
  const html = renderToStaticMarkup(entry.preview("onboarding"));
  expect(html).not.toContain('role="dialog"');
  expect(html).toContain("Start using Athena");
});
