/** Tests for the shape seam to Rust — README section 3.5, ADR 0088. */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INITIAL } from "./model";
import { SHAPE_ID, startShapeSync } from "./shape";
import { useDepth } from "./store";

beforeEach(() => useDepth.setState({ ...INITIAL }));

describe("the shape ids", () => {
  const rust = readFileSync(new URL("../../src-tauri/src/layout.rs", import.meta.url), "utf8");
  const constant = (name: string) =>
    new RegExp(`pub const ${name}: &str = "([^"]+)";`).exec(rust)?.[1];

  it("are the ones layout.rs spells", () => {
    expect(constant("PAGE_SHAPE")).toBe(SHAPE_ID.page);
    expect(constant("SCENE_SHAPE")).toBe(SHAPE_ID.scene);
  });
});

describe("startShapeSync", () => {
  let stop: () => void = () => {};
  afterEach(() => stop());

  it("tells Rust the scene at the start, the page when a page opens, and the scene when it closes", () => {
    const send = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve());
    stop = startShapeSync(send);
    expect(send).toHaveBeenLastCalledWith("scene");

    useDepth.getState().go({ root: "apps", item: "a" });
    expect(send).toHaveBeenCalledTimes(1); // still the scene

    useDepth.getState().go({ root: "apps", item: "a", sub: { kind: "page" } });
    expect(send).toHaveBeenLastCalledWith("page");

    useDepth.getState().rise();
    expect(send).toHaveBeenLastCalledWith("scene");
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("does not repeat a shape it has already sent", () => {
    const send = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve());
    stop = startShapeSync(send);
    useDepth.getState().go({ root: "apps" });
    useDepth.getState().go({ root: "mind" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("survives a re-lay that is refused", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn<(id: string) => Promise<void>>(() => Promise.reject(new Error("no window")));
    stop = startShapeSync(send);
    await new Promise((r) => setTimeout(r, 0));
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
