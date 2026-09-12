"use client";

/**
 * A candidate's face: a drawn mark for some, initials for the rest.
 *
 * WHY A MIX RATHER THAN ONE OR THE OTHER. A real hiring product has a picture
 * for some people and not for others, and a board where every tile is identical
 * hides how much that unevenness costs a reader. Mixing them is the honest
 * shape of the problem. Which candidate gets which is fixed by their id, so the
 * board does not reshuffle between renders or between machines.
 *
 * WHY THE MARKS ARE ABSTRACT. This database contains no photograph, no age, no
 * gender, no nationality and nothing standing in for one — that absence is
 * deliberate and `DESIGN-LAW.md` §8 forbids inventing a proxy for it. So the
 * drawn marks are generative geometry, not faces: they say "this person has a
 * picture" without asserting anything whatsoever about what they look like. A
 * cartoon portrait would have been the easy read of the brief and the wrong one.
 */
import { hasPortrait, Portrait } from "./Portrait";

export function Face({
  id,
  initials,
  className,
  size,
  glyph,
}: {
  id: string;
  initials: string;
  className?: string;
  size?: "lg";
  /**
   * What the initials variant prints, when it is not the full monogram.
   *
   * A face tucked into a pile shows a 12-17px strip of itself, and two centred
   * mono glyphs in that strip render as half-letters. The caller that knows the
   * geometry passes the one letter that fits; everybody else gets the monogram.
   */
  glyph?: string;
}) {
  return (
    <span
      className={className}
      data-size={size}
      data-kind={hasPortrait(id) ? "drawn" : "initials"}
    >
      {hasPortrait(id) ? (
        <Portrait id={id} initials={initials} />
      ) : (
        <span aria-hidden>{glyph ?? initials}</span>
      )}
    </span>
  );
}
