/**
 * How a row arranges itself, given how many people are in it.
 *
 * What a face can carry depends on how many are beside it, so a row picks one
 * of three arrangements from its own count: one or two get a full name, three
 * or four a first name, five or more just faces.
 *
 * Past the cap the row stops drawing and counts: `+5` is an exact statement about five people,
 * where five more overlapping slivers were a texture. That is the whole of the L0 readability fix
 * — a cluster you can count, and an overflow that does not pretend to be a portrait.
 */
import type { BdCandidate } from "../model";

/**
 * Faces drawn before the row stops and counts the rest.
 *
 * It was fourteen, and the eleven-strong Backend queue drew all eleven — which is what made the
 * row an unreadable heap of half-discs. A cluster is a count you can take in at a glance plus an
 * overflow that states the rest exactly; six and a `+5` says "eleven" better than eleven
 * overlapping slivers do, and it says it in a third of the width.
 */
export const PILE_CAP = 6;
/**
 * The face's own side, in pixels, and the ONLY place it is written.
 *
 * `overlapFor` solves the tuck from this number, and the stylesheet draws the face at it, so the
 * two have to be the same number or the arithmetic is about a different row than the one on screen.
 * It used to be a copy of `--bd-s6` with a comment saying "matches" and nothing enforcing it: a
 * single edit to `--hl-space-6` - a legitimate scale change under DESIGN-LAW §1 - would have left
 * an eleven-face pile 90px wider than the 250px column it has to fit inside, with no compile error
 * and no test. Columns.tsx pushes it into CSS as `--face`, the way `--overlap` already goes.
 */
export const FACE = 32;
/**
 * How far each face tucks under the one before it, in pixels.
 *
 * It used to be solved from a target line width, which is the right arithmetic for a line that has
 * to hold everybody: eleven faces inside 200px means each one shows a 17px sliver of a 32px disc,
 * and eleven slivers are one smeared shape. The row is capped at six now, so the tuck is a fixed,
 * deliberate overlap — every face shows three-quarters of itself and its whole monogram — and the
 * people past the sixth are counted rather than drawn.
 */
const OVERLAP = 8;

type Stacking = "full" | "first" | "pile";

export function stackingFor(count: number): Stacking {
  if (count <= 2) return "full";
  if (count <= 4) return "first";
  return "pile";
}

export function overlapFor(count: number): number {
  return count < 2 ? 0 : OVERLAP;
}

export function labelFor(candidate: BdCandidate, stacking: Stacking): string | null {
  if (stacking === "full") return candidate.name;
  if (stacking === "first") return candidate.name.split(" ")[0] ?? candidate.name;
  return null;
}
