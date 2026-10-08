/**
 * The Browser surface's words: the first run (UAT backlog B5) and honest copy about what Athena can
 * do on a page today (B12, B2).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, test } from "vitest";

import { entry } from "./index";
import { fixtureIds } from "./fixtures";

test("the first run leads with one sentence, an Enter hint and the engine's standing", () => {
  const html = renderToStaticMarkup(entry.preview("first-run"));
  expect(html).toContain("Type the address of an app you use, for example your invoicing tool.");
  expect(html).toContain("Press Enter to open it");
  expect(html).toContain("Setup: Engine: Claude Code, ready.");
  // The example is only a muted example, never the placeholder passed off as advice.
  expect(html).not.toContain('placeholder="invoicing.example.test"');
});

test("no fixture claims hands that are not wired, or a switch that is not enforced", () => {
  for (const id of fixtureIds) {
    const html = renderToStaticMarkup(entry.preview(id));
    expect(html, id).not.toMatch(/hands|switched off|Switch off/i);
  }
});

describe("two layers (ADR 0029)", () => {
  it("leaves only navigation on the ledger: no field, no switch, no Forget", () => {
    const html = renderToStaticMarkup(entry.preview("typical"));
    expect(html).not.toMatch(/<input class="input register__field|role="radiogroup"|role="dialog"/);
    expect(html).not.toContain("Forget");
    expect(html).toContain("Register an app");
  });

  it("opens the register layer on a first run, and an app's layer holds its switch and Forget", () => {
    expect(renderToStaticMarkup(entry.preview("first-run"))).toContain('role="dialog"');
    const app = renderToStaticMarkup(entry.preview("app-details"));
    expect(app).toContain('role="radiogroup"');
    expect(app).toContain("Forget this app");
  });
});
