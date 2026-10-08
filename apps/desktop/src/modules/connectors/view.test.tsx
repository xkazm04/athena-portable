/**
 * The Connectors surface is two layers (ADR 0029): the overview reads, the layer writes. Rendered
 * with `renderToStaticMarkup`, no shell, as every module test here.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { entry } from "./index";

const OVERVIEWS = ["empty", "typical", "heavy", "degraded", "unreadable", "unreachable", "needs-reauth", "flow-failed"];

test("no overview renders a field, a text area or a switch: nothing on it writes", () => {
  for (const fixture of OVERVIEWS) {
    const html = renderToStaticMarkup(entry.preview(fixture));
    expect(html, fixture).not.toMatch(/<input|<textarea|role="radiogroup"/);
    expect(html, fixture).not.toContain('role="dialog"');
  }
});

test("every connector is a tile with its emblem, inked only when it is connected", () => {
  const html = renderToStaticMarkup(entry.preview("typical"));
  expect(html.match(/class="tile /g)?.length).toBe(2);
  expect(html.match(/emblem emblem--done/g)?.length).toBe(1);
});

test("a connected connector's layer holds the decisions; an unconnected one's holds the way in", () => {
  const notion = renderToStaticMarkup(entry.preview("open-notion"));
  expect(notion).toContain('role="dialog"');
  expect(notion).toContain("Allowed page ids");
  expect(notion).toContain("Disconnect");
  const gmail = renderToStaticMarkup(entry.preview("open-gmail"));
  expect(gmail).toContain("Connect with Google");
  expect(gmail).not.toContain("Allowed recipients");
});
