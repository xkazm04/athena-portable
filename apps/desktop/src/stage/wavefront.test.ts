/**
 * The Wavefront field's shape — README section 3.1, ADR 0142. Pure, so held without a canvas.
 */
import { expect, test } from "vitest";

import { BAND, GAP, alive, band, front, lattice, light, lowerBound, rgba, standing } from "./wavefront";

test("the lattice covers the stage at its spacing and is sorted by distance from the source", () => {
  const f = lattice(320, 160, 40, 30);
  const rows = Math.ceil((160 - GAP / 2) / (GAP * 0.866));
  expect(f.d.length).toBeGreaterThan(rows * (320 / GAP - 1));
  for (let i = 1; i < f.d.length; i++) expect(f.d[i]!).toBeGreaterThanOrEqual(f.d[i - 1]!);
  for (const v of f.fall) expect(v).toBeGreaterThanOrEqual(0.35 - 1e-6); // stored as float32
  expect(f.maxD).toBeGreaterThan(280);
});

test("a front lights a gaussian band round itself, with a tail behind and nothing ahead", () => {
  expect(light(100, 100, 1, 1000)).toBeCloseTo(0.35 + 0.65 * (1 - 100 / 1050), 5);
  expect(light(100 + BAND, 100, 1, 1000)).toBe(0); // ahead of the front: dark
  expect(light(100 - BAND * 2, 100, 1, 1000)).toBeGreaterThan(0); // the tail
  expect(light(100 - BAND * 3, 100, 1, 1000)).toBe(0);
  expect(light(100, 100, 0.5, 1000)).toBeCloseTo(light(100, 100, 1, 1000) / 2, 5);
});

test("a frame visits only the band a front can light", () => {
  const f = lattice(1440, 900, 300, 250);
  const at = 400;
  const [from, to] = band(f, at);
  expect(to - from).toBeLessThan(f.d.length / 4);
  for (let i = 0; i < f.d.length; i++) {
    const inside = i >= from && i < to;
    if (!inside) expect(light(f.d[i]!, at, 1, f.maxD), `point ${i}`).toBe(0);
  }
  expect(lowerBound(f.d, -1)).toBe(0);
  expect(lowerBound(f.d, f.maxD * 2)).toBe(f.d.length);
});

test("a wave lives until its tail has left the furthest point", () => {
  const w = { t0: 0, gain: 1 };
  expect(front(w, 1000)).toBeCloseTo(620);
  expect(alive(w, 1000, 600)).toBe(true);
  expect(alive(w, 10_000, 600)).toBe(false);
  expect(alive({ t0: 500, gain: 1 }, 0, 600)).toBe(true); // yet to leave
});

test("the standing wave is four fixed rings, fainter outward", () => {
  const ws = standing(5000);
  expect(ws).toHaveLength(4);
  const fronts = ws.map((w) => front(w, 5000));
  for (let i = 1; i < 4; i++) {
    expect(fronts[i]! - fronts[i - 1]!).toBeCloseTo(260);
    expect(ws[i]!.gain).toBeLessThan(ws[i - 1]!.gain);
  }
});

test("a token colour is read as rgba, anything else falls back", () => {
  expect(rgba("rgba(168, 224, 58, 0.2)", [0, 0, 0, 0])).toEqual([168, 224, 58, 0.2]);
  expect(rgba("rgb(1,2,3)", [0, 0, 0, 0])).toEqual([1, 2, 3, 1]);
  expect(rgba("#a8e03a", [9, 9, 9, 9])).toEqual([9, 9, 9, 9]);
});
