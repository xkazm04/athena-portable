/** Tests for the dev inspector's pure half — README section 3.1, ADR 0086. */
import { describe, expect, it } from "vitest";

import { dedupeChain, isLibraryPath, parseLoc, pickDefaultIndex, type LocEntry } from "./locate";

const entry = (loc: string): LocEntry => {
  const p = parseLoc(`${loc}:1`);
  if (!p) throw new Error("bad fixture");
  return { el: null as unknown as Element, ...p };
};

describe("parseLoc", () => {
  it("drops the column and keeps the line", () => {
    expect(parseLoc("src/app.tsx:88:7")).toEqual({
      path: "src/app.tsx",
      line: 88,
      loc: "src/app.tsx:88",
    });
  });
  it("rejects a value that is not a stamp", () => {
    expect(parseLoc("nope")).toBeNull();
  });
});

describe("pickDefaultIndex", () => {
  it("lands on the first file outside the library folders", () => {
    const chain = [
      entry("src/components/Button.tsx:3"),
      entry("src/modules/Tools.tsx:40"),
      entry("src/app.tsx:9"),
    ];
    expect(pickDefaultIndex(chain)).toBe(1);
  });
  it("falls back to the innermost when everything is library code", () => {
    expect(pickDefaultIndex([entry("src/lib/a.tsx:1"), entry("src/stores/b.tsx:1")])).toBe(0);
  });
  it("does not treat a feature folder as a library", () => {
    expect(isLibraryPath("src/companion/views.tsx")).toBe(false);
  });
});

describe("dedupeChain", () => {
  it("collapses neighbours on the same line", () => {
    const a = entry("src/a.tsx:1");
    expect(dedupeChain([a, { ...a }, entry("src/b.tsx:2")])).toHaveLength(2);
  });
});
