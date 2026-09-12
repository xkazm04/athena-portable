/**
 * The tighten-only rule — README section 3.3 and ADR 0018.
 *
 * This is the one piece of the two surfaces that is a *policy* rather than a rendering, so it is
 * asserted directly rather than through a view-model: every class, in both directions, including
 * the case the gate has to survive but nobody designs for — a stored override that the page's own
 * manifest has since overtaken.
 */
import { expect, test } from "vitest";

import {
  CLASS_ORDER,
  allowedOverrides,
  effectiveClass,
  isTighter,
  overrideIgnored,
  whyNoOverride,
} from "./classes";

test("the order is loosest first, and tightness is read off it", () => {
  expect(CLASS_ORDER).toEqual(["AUTO", "READ", "GATED"]);
  expect(isTighter("GATED", "AUTO")).toBe(true);
  expect(isTighter("GATED", "READ")).toBe(true);
  expect(isTighter("READ", "AUTO")).toBe(true);
  expect(isTighter("AUTO", "READ")).toBe(false);
  expect(isTighter("READ", "READ")).toBe(false);
});

test("an AUTO tool may be pinned at either tighter class", () => {
  expect(allowedOverrides("AUTO")).toEqual(["READ", "GATED"]);
});

test("a READ tool may only be pinned at GATED", () => {
  expect(allowedOverrides("READ")).toEqual(["GATED"]);
});

test("a GATED tool offers nothing, and the surface is given the reason", () => {
  expect(allowedOverrides("GATED")).toEqual([]);
  expect(whyNoOverride("GATED")).toContain("tightest");
  expect(whyNoOverride("AUTO")).toBeNull();
  expect(whyNoOverride("READ")).toBeNull();
});

test("a tool whose declared class is unknown offers nothing, and says that is why", () => {
  expect(allowedOverrides(null)).toEqual([]);
  expect(whyNoOverride(null)).toContain("not open");
});

test("no allowed override ever loosens the declared class", () => {
  for (const declared of CLASS_ORDER) {
    for (const offered of allowedOverrides(declared)) {
      expect(isTighter(offered, declared), `${offered} under ${declared}`).toBe(true);
    }
  }
});

test("the effective class is the override when it tightens, and the declared class otherwise", () => {
  expect(effectiveClass("AUTO", "GATED")).toBe("GATED");
  expect(effectiveClass("AUTO", "READ")).toBe("READ");
  expect(effectiveClass("AUTO", null)).toBe("AUTO");
  expect(effectiveClass("READ", "GATED")).toBe("GATED");
});

test("a stored override the manifest has overtaken is ignored, and the surface can tell", () => {
  // The page registered `send_invoice` as AUTO yesterday and the user pinned it READ; today the
  // page declares it GATED. The gate runs the tighter of the two, and the override is dead.
  expect(effectiveClass("GATED", "READ")).toBe("GATED");
  expect(effectiveClass("GATED", "AUTO")).toBe("GATED");
  expect(overrideIgnored("GATED", "READ")).toBe(true);
  expect(overrideIgnored("GATED", "AUTO")).toBe(true);
  expect(overrideIgnored("AUTO", "GATED")).toBe(false);
  expect(overrideIgnored("READ", "READ")).toBe(false);
  expect(overrideIgnored("AUTO", null)).toBe(false);
});
