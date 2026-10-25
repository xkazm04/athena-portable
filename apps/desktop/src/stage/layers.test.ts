/** Tests for the layers of a depth move — README section 3.1, ADR 0087 and 0089. */
import { describe, expect, it } from "vitest";

import type { Path } from "@/depth/model";

import { initLayers, isLive, isSettled, reduceLayers, type Layer } from "./layers";

const surface: Path = { root: null };
const apps: Path = { root: "apps" };
const mind: Path = { root: "mind" };

const move = (layers: Layer[], seq: number, path: Path, m: "down" | "up" | "across", calm = false) =>
  reduceLayers(layers, { type: "move", seq, path, move: m, calm });

describe("a move", () => {
  it("starts with one layer at rest", () => {
    const l = initLayers(surface);
    expect(isSettled(l)).toBe(true);
  });

  it("plays the old layer out and the new one in, and settles when both have ended", () => {
    let l = move(initLayers(surface), 1, apps, "down");
    expect(l.map((x) => x.phase)).toEqual(["leave-down", "enter-down"]);
    expect(isSettled(l)).toBe(false);
    l = reduceLayers(l, { type: "ended", key: 0 });
    expect(l.map((x) => x.phase)).toEqual(["enter-down"]);
    l = reduceLayers(l, { type: "ended", key: 1 });
    expect(l).toEqual([{ key: 1, path: apps, phase: "rest" }]);
    expect(isSettled(l)).toBe(true);
  });

  it("uses the direction of the move for both layers", () => {
    const up = move(initLayers(apps), 1, surface, "up");
    expect(up.map((x) => x.phase)).toEqual(["leave-up", "enter-up"]);
    const across = move(initLayers(apps), 1, mind, "across");
    expect(across.map((x) => x.phase)).toEqual(["leave-across", "enter-across"]);
  });

  it("under calm is one layer at rest, with nothing to play", () => {
    const l = move(initLayers(surface), 1, apps, "down", true);
    expect(l).toEqual([{ key: 1, path: apps, phase: "rest" }]);
  });
});

describe("a move during a move", () => {
  it("turns the arriving layer into a leaving one and brings the newest in", () => {
    let l = move(initLayers(surface), 1, apps, "down");
    l = move(l, 2, surface, "up"); // changed their mind
    expect(l.map((x) => [x.key, x.phase])).toEqual([
      [0, "leave-up"],
      [1, "leave-up"],
      [2, "enter-up"],
    ]);
  });

  it("never keeps more than two ghosts", () => {
    let l = move(initLayers(surface), 1, apps, "down");
    l = move(l, 2, mind, "across");
    l = move(l, 3, apps, "across");
    l = move(l, 4, mind, "across");
    expect(l.filter((x) => x.phase.startsWith("leave-"))).toHaveLength(2);
    expect(l[l.length - 1]).toMatchObject({ key: 4, phase: "enter-across" });
  });

  it("ignores an end for a layer that is already gone", () => {
    const l = move(initLayers(surface), 1, apps, "down");
    expect(reduceLayers(l, { type: "ended", key: 99 })).toEqual(l);
  });
});

describe("flush", () => {
  it("settles a stuck move: the leaving layers go, the arriving one rests", () => {
    let l = move(initLayers(surface), 1, apps, "down");
    l = move(l, 2, mind, "across");
    l = reduceLayers(l, { type: "flush" });
    expect(l).toEqual([{ key: 2, path: mind, phase: "rest" }]);
    expect(isSettled(l)).toBe(true);
  });
});

describe("which layer is live", () => {
  it("only the arriving or resting layer is live; a leaving one is a still", () => {
    expect(initLayers(surface).map(isLive)).toEqual([true]);
    let l = move(initLayers(surface), 1, apps, "down");
    l = move(l, 2, mind, "across");
    l = move(l, 3, surface, "up");
    expect(l.map(isLive)).toEqual([false, false, true]);
    expect(l.filter(isLive)).toHaveLength(1);
    expect(reduceLayers(l, { type: "flush" }).map(isLive)).toEqual([true]);
  });
});
