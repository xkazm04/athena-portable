/** Tests for the Apps scene's model — README section 3.4 and 3.5, ADR 0063, 0087 and 0088. */
import { describe, expect, it } from "vitest";

import { isValid } from "@/depth/model";

import { PATHS, fixtures } from "./fixtures";
import {
  appFor,
  appPath,
  itemLabel,
  itemOfTab,
  pageFor,
  pagePath,
  toolPath,
  toolView,
} from "./model";

const typical = fixtures.typical!;

describe("how a path names an app or a page", () => {
  it("is the origin for a page that has one, and tab-<id> for a page that has none", () => {
    expect(itemOfTab({ id: 1, url: "http://localhost:3004/invoices" })).toBe("http://localhost:3004");
    expect(itemOfTab({ id: 7, url: "about:blank" })).toBe("tab-7");
  });

  it("builds only places the grammar allows", () => {
    for (const p of [appPath("x"), pagePath("x"), toolPath("x", "send")]) expect(isValid(p)).toBe(true);
    for (const p of Object.values(PATHS)) expect(isValid(p)).toBe(true);
  });
});

describe("pages", () => {
  it("lists every open tab, keyed by the item that names it", () => {
    expect(typical.pages.map((p) => p.item)).toEqual([
      "http://localhost:3004",
      "https://example.test",
      "http://example.test", // an origin of its own, not registered
    ]);
    expect(typical.pages.find((p) => p.focused)?.tabId).toBe(1);
  });

  it("resolves a path item to a registered app or to an open page, or to nothing", () => {
    expect(appFor(typical, "http://localhost:3004")?.host).toBe("localhost:3004");
    expect(appFor(typical, "http://example.test")).toBeNull();
    expect(pageFor(typical, "http://example.test")?.tabId).toBe(3);
    expect(appFor(typical, "https://forgotten.example.test")).toBeNull();
    expect(pageFor(typical, "https://forgotten.example.test")).toBeNull();
  });

  it("names an item for the breadcrumb by its host", () => {
    expect(itemLabel(typical, "http://localhost:3004")).toBe("localhost:3004");
    expect(itemLabel(typical, "https://forgotten.example.test")).toBeUndefined();
  });
});

describe("the tools an open page registered", () => {
  const tools = typical.tools["http://localhost:3004"]!;

  it("are what the page said, with the person's pins, and no class of the gate's", () => {
    expect(tools.answered).toBe(true);
    expect(tools.tools.map((t) => t.name)).toEqual(["list_invoices", "draft_reminder", "send_reminder"]);
    const send = tools.tools.find((t) => t.name === "send_reminder")!;
    expect(send.pinned).toBe("GATED");
    expect(send.reversible).toBe(false);
    expect(send.sideEffects).toBe("external");
    expect(Object.keys(send)).not.toContain("class");
    expect(tools.tools[0]!.pinned).toBeNull();
  });

  it("are not answered while the relay is asking, and an app with no open tab has none listed", () => {
    expect(typical.tools["https://example.test"]?.answered).toBe(false);
    expect(typical.tools["https://crm.example.test"]).toBeUndefined();
  });

  it("answer with an empty list for a page that offers nothing of its own", () => {
    const quiet = fixtures["no-bridge"]!.tools["http://localhost:3004"]!;
    expect(quiet).toEqual({ answered: true, tools: [] });
  });

  it("read a page's hints defensively, as claims", () => {
    const v = toolView(
      { name: "x", title: null, description: "d", annotations: "nonsense", athena: { reversible: "yes" } },
      undefined,
    );
    expect(v).toMatchObject({ title: "", readOnly: null, reversible: null, sideEffects: "", pinned: null });
  });
});
