/** Tests for the depth store and its hash mirror — README section 3.5, ADR 0087. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INITIAL } from "./model";
import { startDepth, useDepth } from "./store";

/** The slice of `window` the store touches: a hash, an event target and `history`. */
function fakeWindow(hash = "") {
  const listeners = new Map<string, () => void>();
  const w = {
    location: { hash },
    history: {
      replaceState: vi.fn((_s: unknown, _t: string, url: string) => {
        w.location.hash = url;
      }),
    },
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
    fire: (name: string) => listeners.get(name)?.(),
  };
  return w;
}

beforeEach(() => {
  useDepth.setState({ ...INITIAL });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the store", () => {
  it("dives, rises and settles through the reducer", () => {
    useDepth.getState().go({ root: "apps" });
    expect(useDepth.getState().path).toEqual({ root: "apps" });
    expect(useDepth.getState().move).toBe("down");
    const seq = useDepth.getState().seq;
    useDepth.getState().settle(seq);
    expect(useDepth.getState().from).toBeNull();
    useDepth.getState().rise();
    expect(useDepth.getState().path).toEqual({ root: null });
  });

  it("does not notify for a move the reducer ignored", () => {
    const seen = vi.fn();
    const stop = useDepth.subscribe(seen);
    useDepth.getState().rise(); // already at the surface
    useDepth.getState().go({ root: "voice", item: "nope" });
    stop();
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("the hash mirror", () => {
  it("takes the place the hash names without a move", () => {
    const w = fakeWindow("#/chores/c1/run/2");
    vi.stubGlobal("window", w);
    const stop = startDepth();
    expect(useDepth.getState().path).toEqual({
      root: "chores",
      item: "c1",
      sub: { kind: "run", arg: "2" },
    });
    expect(useDepth.getState().move).toBe("none");
    // A change of place the stage must redraw for (it keys its layers on `seq`); the surface is not.
    expect(useDepth.getState().seq).toBe(1);
    stop();
  });

  it("writes the hash on a move, with replaceState", () => {
    const w = fakeWindow("");
    vi.stubGlobal("window", w);
    const stop = startDepth();
    useDepth.getState().go({ root: "mind", item: "engine" });
    expect(w.history.replaceState).toHaveBeenCalledWith(null, "", "#/mind/engine");
    stop();
  });

  it("follows a hash that changes under it, and ignores one it wrote itself", () => {
    const w = fakeWindow("");
    vi.stubGlobal("window", w);
    const stop = startDepth();
    w.location.hash = "#/accounts";
    w.fire("hashchange");
    expect(useDepth.getState().path).toEqual({ root: "accounts" });
    const calls = useDepth.getState().seq;
    w.fire("hashchange"); // the hash now equals the path: no second move
    expect(useDepth.getState().seq).toBe(calls);
    stop();
  });

  it("falls back to the surface for a hash that is not a place", () => {
    const w = fakeWindow("#/nowhere/at/all");
    vi.stubGlobal("window", w);
    const stop = startDepth();
    expect(useDepth.getState().path).toEqual({ root: null });
    stop();
  });

  it("rewrites a hash that is not canonical to the place it resolved to, once, at start", () => {
    const w = fakeWindow("#/nowhere/at/all");
    vi.stubGlobal("window", w);
    const stop = startDepth();
    expect(w.history.replaceState).toHaveBeenCalledTimes(1);
    expect(w.history.replaceState).toHaveBeenCalledWith(null, "", "#/");
    expect(w.location.hash).toBe("#/");
    stop();
  });

  it("leaves a canonical hash and an absent one alone", () => {
    for (const hash of ["#/mind/engine", ""]) {
      const w = fakeWindow(hash);
      vi.stubGlobal("window", w);
      const stop = startDepth();
      expect(w.history.replaceState, hash).not.toHaveBeenCalled();
      stop();
    }
  });
});
