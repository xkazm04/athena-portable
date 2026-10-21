/**
 * An opaque tab has no origin — the Browser module's `originOf` rule, which the companion shares.
 * `new URL("about:blank").origin` is the string "null"; that must not reach `catalogIdOf`.
 */
import { expect, test } from "vitest";

import type { BridgeTool } from "@/lib/bridge";
import type { TabTools } from "@/stores/tools";

import { toolRows } from "./tools";

const list: BridgeTool = {
  name: "list",
  title: "list",
  description: "list.",
  inputSchema: {},
  annotations: null,
  athena: { reversible: true, side_effects: "none" },
};

function tab(url: string): TabTools {
  return { tabId: 1, url, tools: [list], transport: null, appId: null, appVersion: null, problem: null, asking: false };
}

test("an opaque tab's rows carry no app, as no origin gives none", () => {
  for (const url of ["about:blank", "file:///tmp/a.html", "data:text/html,hi"]) {
    const rows = toolRows(tab(url));

    expect(rows.map((r) => [r.name, r.origin]), url).toEqual([["list", ""]]);
  }
});
