/**
 * The Apps scene's view-model — README section 3.4 and 3.5, ADR 0063, 0087 and 0088.
 *
 * The Browser module's own model (`BrowserModel`: tabs, registered apps, their standing, the
 * actions) plus what a depth needs that the module did not: how a depth path names an app or a
 * page, and what one app's open page registered as tools. Nothing is re-derived: an app's standing
 * is `appOf`'s, a tab is `selectBrowser`'s, and the gate's class of a tool is not here at all (a
 * page's tools are claims; which are `AUTO` and which `GATED` is the gate's answer, README
 * invariant 3, so the tool level shows what the page said and what the person pinned, nothing more).
 *
 * **Paths name things by origin.** `apps/<origin>` is an app (registered or only open), and a tab
 * on no origin (a blank page) is `apps/tab-<id>`. `apps/<item>/page` is the page shape (ADR 0088).
 */
import type { Path } from "@/depth/model";
import type { ToolClass } from "@/lib/store";

import type { BrowserModel, BrowserTab, RegisteredApp } from "@/modules/browser/model";
import { originOf } from "@/modules/browser/model";

/** What a page said about one tool, as the scene shows it. Never a class: the gate decides that. */
export interface ToolView {
  name: string;
  /** The page's own title for the tool, or "" when it gave none. */
  title: string;
  description: string;
  /** The standard hint: this tool only reads. `null` when the page did not say. */
  readOnly: boolean | null;
  /** The README 3.3 block's `reversible`. `null` when the page did not say. */
  reversible: boolean | null;
  /** The README 3.3 block's `side_effects`, verbatim. "" when the page did not say. */
  sideEffects: string;
  /** A class the person pinned for it, or `null`. A pin only ever tightens. */
  pinned: ToolClass | null;
}

/** A page that is open, whether or not its origin is registered. */
export interface PageEntry {
  tabId: number;
  title: string;
  host: string;
  url: string;
  focused: boolean;
  /** The path item that names it: its origin, or `tab-<id>` for a page with none. */
  item: string;
}

/** What one open app's page registered, or why that is not known. */
export interface AppTools {
  /** The page answered (even with none). False while the relay is asking or the app is closed. */
  answered: boolean;
  tools: readonly ToolView[];
}

export interface AppsModel {
  browser: BrowserModel;
  /** Every open tab as a page entry, in tab order. */
  pages: readonly PageEntry[];
  /** Per path item: the tools its open page registered. Only apps with an open tab have an entry. */
  tools: Readonly<Record<string, AppTools>>;
}

/** The input the hook gathers of the stores that `BrowserModel` does not carry. */
export interface ToolSources {
  /** Per tab id: what its page registered, or `undefined` while nothing has answered. */
  byTab: Readonly<Record<number, { tools: readonly RawTool[]; asking: boolean } | undefined>>;
  /** Per origin: the classes pinned for its tools. */
  pins: Readonly<Record<string, Readonly<Record<string, ToolClass>> | undefined>>;
}

/** The slice of `BridgeTool` the scene reads. Declared here so a fixture needs no bridge. */
export interface RawTool {
  name: string;
  title: string | null;
  description: string;
  annotations: unknown;
  athena: unknown;
}

/** The path item for a tab: its origin when it has one, else `tab-<id>`. */
export function itemOfTab(tab: Pick<BrowserTab, "id" | "url">): string {
  const origin = originOf(tab.url);
  return origin !== "" && origin !== "null" ? origin : `tab-${tab.id}`;
}

export function pagePath(item: string): Path {
  return { root: "apps", item, sub: { kind: "page" } };
}

export function appPath(item: string): Path {
  return { root: "apps", item };
}

export function toolPath(item: string, name: string): Path {
  return { root: "apps", item, sub: { kind: "tool", arg: name } };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Read one tool's hints defensively: a page's claims are rendered, never trusted or required. */
export function toolView(raw: RawTool, pin: ToolClass | undefined): ToolView {
  const ann = isRecord(raw.annotations) ? raw.annotations : {};
  const athena = isRecord(raw.athena) ? raw.athena : {};
  return {
    name: raw.name,
    title: raw.title ?? "",
    description: raw.description,
    readOnly: typeof ann.readOnlyHint === "boolean" ? ann.readOnlyHint : null,
    reversible: typeof athena.reversible === "boolean" ? athena.reversible : null,
    sideEffects: typeof athena.side_effects === "string" ? athena.side_effects : "",
    pinned: pin ?? null,
  };
}

export function selectApps(browser: BrowserModel, sources: ToolSources): AppsModel {
  const pages: PageEntry[] = browser.tabs.map((t) => ({
    tabId: t.id,
    title: t.title,
    host: t.host,
    url: t.url,
    focused: t.focused,
    item: itemOfTab(t),
  }));

  const tools: Record<string, AppTools> = {};
  for (const page of pages) {
    const entry = sources.byTab[page.tabId];
    if (tools[page.item] && !page.focused) continue; // the focused tab on an origin speaks for it
    if (!entry || entry.asking) {
      tools[page.item] = { answered: false, tools: [] };
      continue;
    }
    const pins = sources.pins[page.item] ?? {};
    tools[page.item] = { answered: true, tools: entry.tools.map((t) => toolView(t, pins[t.name])) };
  }
  return { browser, pages, tools };
}

/** The registered app a path item names, or null. */
export function appFor(model: AppsModel, item: string): RegisteredApp | null {
  return model.browser.apps.find((a) => a.origin === item) ?? null;
}

/** The open page a path item names, or null. */
export function pageFor(model: AppsModel, item: string): PageEntry | null {
  return model.pages.find((p) => p.item === item) ?? null;
}

/** What to call a path item in the breadcrumb: the host of an app, the title of a bare page. */
export function itemLabel(model: AppsModel, item: string): string | undefined {
  const app = appFor(model, item);
  if (app) return app.host;
  const page = pageFor(model, item);
  return page ? page.host || page.title : undefined;
}
