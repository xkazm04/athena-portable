/**
 * The memory of places is bounded and ordered by use — README section 3.1, `places.ts`.
 */
import { describe, expect, it } from "vitest";

import { formatHash, type Path } from "@/depth/model";

import { KEEP, createPlaces, type Place } from "./places";

const blank: Place = { scrolls: [], focus: null };
const key = (i: number) => formatHash({ root: "apps", item: `host-${i}` } as Path);

describe("createPlaces", () => {
  it("keeps only the 24 most recent of 30 places, and reading one refreshes its recency", () => {
    expect(KEEP).toBe(24);
    const places = createPlaces();
    for (let i = 0; i < 30; i++) places.put(key(i), { ...blank, scrolls: [[[0], i]] });
    expect(places.keys()).toHaveLength(24);
    expect(places.get(key(5))).toBeUndefined(); // one of the six oldest, forgotten
    expect(places.keys()[0]).toBe(key(6));
    // Read the oldest kept: it is now the newest, so the next put forgets host-7, not host-6.
    expect(places.get(key(6))!.scrolls).toEqual([[[0], 6]]);
    places.put(key(99), blank);
    expect(places.keys()).toHaveLength(24);
    expect(places.keys()).toContain(key(6));
    expect(places.keys()).not.toContain(key(7));
    expect(places.keys().at(-1)).toBe(key(99));
  });

  it("a place put again replaces the old record and moves to the newest", () => {
    const places = createPlaces(3);
    places.put("a", blank);
    places.put("b", blank);
    places.put("a", { ...blank, scrolls: [[[1], 9]] });
    expect(places.keys()).toEqual(["b", "a"]);
    expect(places.get("a")!.scrolls).toEqual([[[1], 9]]);
  });
});
