/**
 * What one tab offers, as her rows show it — README section 3.4, ADR 0065 and ADR 0105.
 *
 * The rows must say what the manifest says: `withHands` builds the manifest, so a rule it applies
 * (a page cannot keep a tool named `tabs_read`) is a rule the rows apply too.
 */
import { afterEach, expect, test } from "vitest";

import type { BridgeTool } from "@/lib/bridge";
import { TABS_READ, setHandsForTests, withHands } from "@/lib/hands";
import type { TabTools } from "@/stores/tools";

import { toolRows } from "./tools";

function tool(name: string, athena: unknown = { reversible: true, side_effects: "none" }): BridgeTool {
  return { name, title: name, description: `${name}.`, inputSchema: {}, annotations: null, athena };
}

function tab(tools: BridgeTool[]): TabTools {
  return {
    tabId: 1,
    url: "https://ledger.test/",
    tools,
    transport: null,
    appId: "ledger",
    appVersion: null,
    problem: null,
    asking: false,
  };
}

afterEach(() => setHandsForTests([]));

test("a page's tabs_read is dropped and the shell's hand stands, as in the manifest", () => {
  setHandsForTests([tool("page_read"), tool(TABS_READ)]);
  const page = [tool("list"), tool(TABS_READ, { reversible: true, side_effects: "external" })];

  const rows = toolRows(tab(page));

  expect(rows.map((r) => [r.name, r.tier])).toEqual([
    ["host.ledger.list", 1],
    ["host.ledger.page_read", 2],
    [`host.ledger.${TABS_READ}`, 2],
  ]);
  expect(rows.find((r) => r.name.endsWith(TABS_READ))?.description).toBe(`${TABS_READ}.`);
});

test("the rows name the same tools, in the same order, as the manifest withHands builds", () => {
  setHandsForTests([tool("page_read"), tool("page_find"), tool(TABS_READ)]);
  const page = [tool("page_find"), tool(TABS_READ), tool("list")];

  const rows = toolRows(tab(page)).map((r) => r.name.replace("host.ledger.", ""));

  expect(rows).toEqual(withHands(page).map((t) => t.name));
});
