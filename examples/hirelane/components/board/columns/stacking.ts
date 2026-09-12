/**
 * How a row arranges itself, given how many people are in it.
 *
 * What a face can carry depends on how many are beside it, so a row picks one
 * of three arrangements from its own count: one or two get a full name, three
 * or four a first name, five or more just faces.
 *
 * The tuck is SOLVED, not tabulated. The line is `FACE + (n - 1) * (FACE -
 * overlap)` wide, so the overlap that makes it exactly `PILE_ROOM` falls
 * straight out of that — which is what keeps eleven faces inside a 250px column
 * without wrapping to a second line or shrinking to dots.
 */
import type { BdCandidate } from "../model";

/** Faces drawn before the row stops and counts the rest. */
export const PILE_CAP = 14;
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
/** How much of a column's width the line of faces may occupy. */
const PILE_ROOM = 200;

type Stacking = "full" | "first" | "pile";

export function stackingFor(count: number): Stacking {
  if (count <= 2) return "full";
  if (count <= 4) return "first";
  return "pile";
}

/**
 * How far each face tucks under the one before it, in pixels.
 *
 * Solved rather than tabulated: the line is `FACE + (n - 1) * (FACE - overlap)`
 * wide, so the overlap that makes it exactly `PILE_ROOM` falls straight out of
 * that. Six is the floor, because below it the tuck stops reading as a stack;
 * twenty is the ceiling, because past it a face is a sliver and the row becomes
 * one smeared shape.
 */
export function overlapFor(count: number): number {
  if (count < 2) return 0;
  const exact = FACE - (PILE_ROOM - FACE) / (count - 1);
  return Math.round(Math.min(20, Math.max(6, exact)));
}

export function labelFor(candidate: BdCandidate, stacking: Stacking): string | null {
  if (stacking === "full") return candidate.name;
  if (stacking === "first") return candidate.name.split(" ")[0] ?? candidate.name;
  return null;
}

/**
 * The one letter a tucked face can actually carry.
 *
 * A piled face shows a 12-17px strip of a 32px disc, and two centred mono
 * glyphs in that strip render as half-letters — the board was printing "BI" for
 * Bo Eriksen and "XH" for Xan Haddad. One glyph, aligned into the strip that is
 * still visible, is the most identity the geometry allows, and it is honest:
 * the row's job at this count is how many, not who. Who is one click away.
 */
export function pileGlyph(initials: string): string {
  return initials.slice(0, 1);
}
