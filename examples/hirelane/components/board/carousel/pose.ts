/**
 * Where a card sits, given how far it is from the loupe.
 *
 * The bend is OUTWARD, and the sign is the whole reason this is a file rather
 * than a line. A positive `rotateY` turns a right-hand card's outer edge away
 * from the reader; the first cut had it the other way round and the deck curled
 * into itself, so cards collided in the middle instead of fanning past the edge
 * of the screen. Getting it wrong looks like a layout bug and is a geometry
 * one.
 */

/** Cards this near the focus stay at full size: the head-to-head set. */
export const LOUPE = 1;
/** Cards further out than this are not drawn at all. Three each side is the
 *  most that can recede without the far ones becoming a pile. */
export const VISIBLE = 3;

/**
 * Card width, and the two step sizes, in px. The near step clears the card so the three under the
 * loupe sit side by side rather than overlapping.
 *
 * `CARD` is exported and pushed into the stylesheet as `--card` by `Carousel.tsx`, because the
 * step sizes are solved from it: a width edited in the CSS alone leaves STEP_NEAR pointing at the
 * old geometry and the three loupe cards gain or lose their gap - or, edited the other way, they
 * overlap. The half-width the rail centres by is `calc(var(--card) / -2)` for the same reason; it
 * used to be a third copy of the number.
 */
export const CARD = 352;
const STEP_NEAR = CARD + 16;
/* Fifty px further out than the cards' own geometry needs. The extra is not
   spacing for its own sake: at 38 degrees the far cards were still clipping the
   loupe set's corners, and reading three cards at once is the whole level. */
const STEP_FAR = 308;

/**
 * Where a card sits, given how far it is from the focus.
 *
 * THE BEND IS OUTWARD. `rotateY` about the Y axis sends a card's +X edge toward
 * -Z, so a POSITIVE angle on a right-hand card turns its outer edge away from
 * the reader and presents its inner face — the deck opening toward you, like a
 * hand of cards. The first cut used the opposite sign, which curled the far
 * cards inward around a point in front of the screen and made them lean into
 * each other; that is the collision the review saw, and the sign is why.
 *
 * The far step is also wider than the flat card width suggests. Turning a card
 * 38 degrees and pushing it back foreshortens it, and a step chosen from the
 * unturned width still lets the near edges touch.
 */
export function poseOf(offset: number) {
  const d = Math.abs(offset);
  const sign = Math.sign(offset);
  if (d <= LOUPE) {
    return { x: offset * STEP_NEAR, rotateY: offset * 6, z: -d * 26, scale: 1, opacity: 1 };
  }
  const out = d - LOUPE;
  return {
    x: sign * (STEP_NEAR + out * STEP_FAR),
    rotateY: sign * 38,
    z: -(26 + out * 190),
    scale: Math.max(0.6, 0.8 - (out - 1) * 0.09),
    opacity: Math.max(0.14, 0.36 - (out - 1) * 0.11),
  };
}
