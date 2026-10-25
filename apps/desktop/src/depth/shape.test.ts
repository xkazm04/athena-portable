/** Tests for the shape seam to Rust — README section 3.5, ADR 0088. */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INITIAL } from "./model";
import { SHAPE_ID, shapeSyncState, startShapeSync } from "./shape";
import { useDepth } from "./store";

beforeEach(() => useDepth.setState({ ...INITIAL }));

/** Let every settled send run its continuation. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** A send whose deliveries the test settles by hand, in order. */
function heldSend() {
  const held: { id: string; resolve: () => void; reject: (e: Error) => void }[] = [];
  const send = vi.fn<(id: string) => Promise<void>>(
    (id) => new Promise<void>((resolve, reject) => held.push({ id, resolve, reject })),
  );
  return { send, held };
}

const page = (item: string) => ({ root: "apps" as const, item, sub: { kind: "page" as const } });

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

  it("tells Rust the scene at the start, the page when a page opens, and the scene when it closes", async () => {
    const send = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve());
    stop = startShapeSync(send);
    expect(send).toHaveBeenLastCalledWith("scene");
    await flush();

    useDepth.getState().go({ root: "apps", item: "a" });
    expect(send).toHaveBeenCalledTimes(1); // still the scene

    useDepth.getState().go(page("a"));
    expect(send).toHaveBeenLastCalledWith("page");
    await flush();

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

  it("keeps one select in flight: a second shape waits for the first to be delivered", async () => {
    const { send, held } = heldSend();
    stop = startShapeSync(send);
    held.shift()?.resolve(); // the opening scene
    await flush();
    send.mockClear();

    useDepth.getState().go(page("a"));
    useDepth.getState().rise();
    expect(send.mock.calls).toEqual([["page"]]);

    held.shift()?.resolve();
    await flush();
    expect(send.mock.calls).toEqual([["page"], ["scene"]]);
  });

  it("coalesces the shapes wanted while a select is in flight to the latest one", async () => {
    const { send, held } = heldSend();
    stop = startShapeSync(send);
    held.shift()?.resolve();
    await flush();
    send.mockClear();

    useDepth.getState().go(page("a")); // in flight
    useDepth.getState().rise(); // scene
    useDepth.getState().go(page("a")); // page
    useDepth.getState().rise(); // scene, the latest
    held.shift()?.resolve();
    await flush();
    expect(send.mock.calls).toEqual([["page"], ["scene"]]);

    held.shift()?.resolve();
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(shapeSyncState().synced).toBe(true);
  });

  it("re-sends a refused shape on the next move, even to the same shape", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { send, held } = heldSend();
    stop = startShapeSync(send);
    held.shift()?.resolve();
    await flush();
    send.mockClear();

    useDepth.getState().go(page("a"));
    held.shift()?.reject(new Error("no window"));
    await flush();

    useDepth.getState().go(page("b"));
    expect(send.mock.calls).toEqual([["page"], ["page"]]);
    held.shift()?.resolve();
    await flush();
    expect(shapeSyncState().synced).toBe(true);
    error.mockRestore();
  });
});
