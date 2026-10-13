/**
 * The Apps scene's fixtures — README section 3.5. The Browser module's own view-models, with the
 * tools their pages registered added where a fixture is about one. Actions are inert, so the
 * preview and the tests render every state with no Tauri, no store and no daemon.
 */
import type { Path } from "@/depth/model";
import { fixtures as browser } from "@/modules/browser/fixtures";
import type { FixtureId } from "@/modules/types";

import { selectApps, type AppsModel, type RawTool, type ToolSources } from "./model";

const NONE: ToolSources = { byTab: {}, pins: {} };

/** What the invoicing page registered: a read, a reversible edit and an external send. */
const INVOICING_TOOLS: RawTool[] = [
  {
    name: "list_invoices",
    title: "List invoices",
    description: "Every invoice for a month, with its status and amount.",
    annotations: { readOnlyHint: true },
    athena: { reversible: true, side_effects: "none" },
  },
  {
    name: "draft_reminder",
    title: "Draft a reminder",
    description: "Write a payment reminder to a customer and keep it as a draft.",
    annotations: { readOnlyHint: false },
    athena: { reversible: true, side_effects: "none" },
  },
  {
    name: "send_reminder",
    title: null,
    description: "Send the drafted reminder to the customer's address.",
    annotations: { readOnlyHint: false },
    athena: { reversible: false, side_effects: "external" },
  },
];

const typicalSources: ToolSources = {
  byTab: { 1: { tools: INVOICING_TOOLS, asking: false } },
  pins: { "http://localhost:3004": { send_reminder: "GATED" } },
};

const make = (name: string, sources: ToolSources = NONE): AppsModel => selectApps(browser[name]!, sources);

export const fixtures: Record<string, AppsModel> = {
  empty: make("empty"),
  "first-run": make("first-run"),
  typical: make("typical", typicalSources),
  heavy: make("heavy"),
  degraded: make("degraded"),
  // The ordinary case for a real site: the page is open and offers nothing of its own.
  "no-bridge": make("no-bridge", { byTab: { 1: { tools: [], asking: false } }, pins: {} }),
  "apps-unread": make("apps-unread"),
};

export const fixtureIds: readonly FixtureId[] = Object.keys(fixtures);

/** The place each fixture's story is about, for the preview and the tests. */
export const PATHS: Record<string, Path> = {
  field: { root: "apps" },
  app: { root: "apps", item: "http://localhost:3004" },
  tool: { root: "apps", item: "http://localhost:3004", sub: { kind: "tool", arg: "send_reminder" } },
  bare: { root: "apps", item: "tab-3" },
  missing: { root: "apps", item: "https://forgotten.example.test" },
};
