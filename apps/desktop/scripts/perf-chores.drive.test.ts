/**
 * The Chores perf drive against the scene it drives — README section 3.1, ADR 0089 and 0096.
 *
 * The drive presses controls by their names and waits for selectors; when the scene renames or
 * removes one, the drive times out mid-run and `perf:all` stops at `perf:chores` without measuring
 * anything. This renders every level the drive walks, from the drive's own fixture and in the order
 * it walks them, and holds that each name and selector it needs is drawn there.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Path } from "@/depth/model";
import { filterLedger, sortLedger } from "@/modules/playbooks/model";
import { fixtures } from "@/scenes/chores/fixtures";
import { EDGE_ORDER, adoptPath, chorePath, runPath } from "@/scenes/chores/model";
import ChoresView from "@/scenes/chores/view";

// @ts-expect-error a plain .mjs scenario shared with the Node runner, no declarations
import drive, { CONTROLS } from "./perf-chores.drive.mjs";

const controls = CONTROLS as Record<"catalogue" | "topic" | "adopt", string[]>;
const fixture = new URLSearchParams(String(drive.query)).get("fixture") ?? "";
const model = fixtures[fixture];

const render = (path: Path) => renderToStaticMarkup(createElement(ChoresView, { model: model!, path, go: () => {} }));
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/gs)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));

describe("the chores perf drive", () => {
  it("drives a fixture the scene has", () => {
    expect(fixture).toBe("shipped");
    expect(model).toBeDefined();
  });

  // The drive resets the filters, orders by the edge, and opens the first row.
  const first = sortLedger(filterLedger(model!.items, { category: "all", job: "all" }), EDGE_ORDER)[0]!;

  it("finds every catalogue control it presses, and rows to walk", () => {
    const html = render({ root: "chores" });
    expect(html).toMatch(/<tr[^>]*aria-selected/);
    expect(html).toContain('class="pa-tab focus-ring"');
    for (const name of controls.catalogue) expect(buttons(html)).toContain(name);
  });

  it("opens a topic page that has a still to enlarge and every control it presses", () => {
    const html = render(chorePath(first.id));
    expect(html).toContain("pa-topic");
    expect(html).toContain('class="pa-frame focus-ring"');
    for (const name of controls.topic) expect(buttons(html)).toContain(name);
  });

  it("closes what the topic's first control opens, by name", () => {
    const html = render(adoptPath(first.id));
    for (const name of controls.adopt) expect(buttons(html)).toContain(name);
  });

  it("dives into a replay that has dots to step", () => {
    expect(render(runPath(first.id, 0))).toContain('class="ch-dot focus-ring"');
  });
});
