/**
 * Which overrides a surface may offer — README section 3.3, the last sentence of the gate page:
 * *"A surface may tighten a class per origin but never loosen one below what the flags imply."*
 *
 * **Nothing here decides a class.** The gate does, from the manifest's own flags, and it decides
 * again on every call with the stored override in hand (README invariant 3). What this file knows
 * is narrower and is the panel's own business: given a class the gate already derived, which
 * *other* classes is the user allowed to pin the tool at, and what does the surface say about the
 * ones it is not offering. A picker that offered `AUTO` on a tool the manifest declared `GATED`
 * would be a control whose every press is refused somewhere the user cannot see — so the control
 * does not offer it, and says why (ADR 0018).
 *
 * It lives in `lib/` rather than in either module because both spend it: the Panel's tool list
 * opens the same picker the Origins detail table holds, and two copies of a tightening order is
 * exactly the kind of divergence the first build found late.
 */
import type { ToolClass } from "@/lib/store";

/**
 * Loosest first. This is the only place the order is written down, and it is the order README
 * section 3.3 describes: `AUTO` fires on its validator, `READ` runs but is capped and recorded,
 * `GATED` does not run until a person has answered.
 */
export const CLASS_ORDER: readonly ToolClass[] = ["AUTO", "READ", "GATED"];

/** How the class reads on a surface, in the app's own words. Never a paraphrase of the daemon. */
export const CLASS_WORD: Record<ToolClass, string> = {
  AUTO: "runs unasked",
  READ: "reads, capped",
  GATED: "asks first",
};

/** True when `a` is strictly tighter than `b`. `GATED` is the tightest thing there is. */
export function isTighter(a: ToolClass, b: ToolClass): boolean {
  return CLASS_ORDER.indexOf(a) > CLASS_ORDER.indexOf(b);
}

/**
 * The classes a user may pin a tool at, given what its manifest declared. Tighten-only, so the
 * list is always a suffix of `CLASS_ORDER` and is empty for a tool that is already `GATED`.
 */
export function allowedOverrides(declared: ToolClass | null): readonly ToolClass[] {
  if (declared === null) return [];
  return CLASS_ORDER.slice(CLASS_ORDER.indexOf(declared) + 1);
}

/**
 * Why the picker is not offering anything, or `null` when it is. A control that is simply absent
 * is a fact the user cannot act on; house style §2.2 asks for the reason in the control's own
 * words.
 */
export function whyNoOverride(declared: ToolClass | null): string | null {
  if (declared === null) {
    return "This page is not open, so its declared class is not known.";
  }
  if (allowedOverrides(declared).length === 0) {
    // Short on purpose: this one sits on every `GATED` row of a list, and the rule it follows
    // from is said once under the list rather than on each of them (house style §2).
    return "Already the tightest class.";
  }
  return null;
}

/**
 * What the gate will actually enforce: the override when it is tighter than the declared class,
 * and the declared class otherwise.
 *
 * The second arm is not defensive programming for its own sake. An override is stored per origin
 * and a page may re-register the same tool with different flags the next morning, at which point
 * a stored `AUTO` sits under a tool the manifest now declares `GATED`. The gate ignores it; a
 * surface that showed `AUTO` there would be telling the user something no part of the system
 * believes.
 */
export function effectiveClass(declared: ToolClass, override: ToolClass | null): ToolClass {
  return override && isTighter(override, declared) ? override : declared;
}

/** True when a stored override is not the class the gate will use, so the surface can say so. */
export function overrideIgnored(declared: ToolClass, override: ToolClass | null): boolean {
  return override !== null && override !== declared && !isTighter(override, declared);
}
