/** Tests for the depth following Rust and the tabs — README section 3.5, ADR 0088. */
import { describe, expect, it } from "vitest";

import { followFocus, followLayout } from "./follow";

const scene = { root: "mind" as const, item: "engine" };
const page = { root: "apps" as const, item: "https://a.example.test", sub: { kind: "page" as const } };
const tab = (id: number, url: string) => ({ id, url });

describe("followLayout: Rust selected a shape", () => {
  it("goes to the focused tab's page when Rust asks for a page and the depth is a scene", () => {
    expect(followLayout(scene, "page", tab(4, "https://a.example.test/x"))).toEqual({
      root: "apps",
      item: "https://a.example.test",
      sub: { kind: "page" },
    });
  });

  it("goes to the apps when Rust asks for a page and there is no tab to show", () => {
    expect(followLayout(scene, "page", null)).toEqual({ root: "apps" });
  });

  it("rises out of a page when Rust asks for a scene, onto that app's own layer", () => {
    expect(followLayout(page, "scene", null)).toEqual({ root: "apps", item: "https://a.example.test" });
  });

  it("does nothing when the depth already agrees, which is how its own round trip is ignored", () => {
    expect(followLayout(page, "page", tab(1, "https://a.example.test"))).toBeNull();
    expect(followLayout(scene, "scene", null)).toBeNull();
  });
});

describe("followFocus: the focused tab changed under a page", () => {
  it("names the page now on screen when another tab takes focus", () => {
    expect(followFocus(page, 1, tab(2, "https://b.example.test/y"))).toEqual({
      root: "apps",
      item: "https://b.example.test",
      sub: { kind: "page" },
    });
  });

  it("leaves a page whose last tab closed, because an empty band is not a place", () => {
    expect(followFocus(page, 1, null)).toEqual({ root: "apps" });
  });

  it("does nothing when the focused tab is the same, or already named", () => {
    expect(followFocus(page, 1, tab(1, "https://a.example.test/z"))).toBeNull();
    expect(followFocus(page, 9, tab(2, "https://a.example.test/other"))).toBeNull();
  });

  it("does nothing in a scene: a tab opening in the background must not yank the person out", () => {
    expect(followFocus(scene, null, tab(2, "https://b.example.test"))).toBeNull();
    expect(followFocus(scene, 2, null)).toBeNull();
  });

  it("names a blank page by its tab, not by an origin it does not have", () => {
    expect(followFocus(page, 1, tab(3, "about:blank"))).toEqual({
      root: "apps",
      item: "tab-3",
      sub: { kind: "page" },
    });
  });
});
