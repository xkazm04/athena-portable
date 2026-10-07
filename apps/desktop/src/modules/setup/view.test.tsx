/**
 * Setup's settings mood is two layers (ADR 0029): the overview reads and each fact's layer writes.
 * The onboarding letter keeps its controls inline — the ADR's first-run exception.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { entry } from "./index";

test("the settings overview is one tile per fact and renders no control", () => {
  const html = renderToStaticMarkup(entry.preview("settings"));
  expect(html.match(/class="tile /g)?.length).toBe(7);
  expect(html).not.toMatch(/<input|<textarea|role="radiogroup"|role="dialog"/);
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
