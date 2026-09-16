/**
 * SHRINK TO FIT, AND REJECT WHAT SHRINKING CANNOT SAVE. Archify study §1, §2, §7.8.
 *
 * `text-fit.mjs` shrinks a node's text to a legibility floor and then REFUSES the diagram rather
 * than clipping it. Round 5 used `text-overflow: ellipsis`, which study Part 2 §2 lists as a named
 * divergence: an ellipsis is a drawing that has decided, silently, that the reader does not need
 * the end of the word.
 *
 * So the shrink is here, pure, and the refusal is a TEST (`test/lanes.model.test.ts`) rather than a
 * runtime branch — because every string in this drawing is authored in `workflow.ts` and a string
 * that cannot be drawn at the floor is a fact about the wording, discovered at build time, not a
 * condition to handle at render time.
 *
 * It lives in its own module and not beside the component that uses it because `node --test`
 * strips TypeScript and not JSX: a rule that can be wrong has to be reachable from a `.ts` file.
 */

/** IBM Plex Mono's advance, as a fraction of the font size. The one measurement this app makes. */
export const ADVANCE = 0.6;

/** The usable width inside a node: 130 less two 9-unit gutters. */
export const TEXT_BOX = 112;

/** The three tiers of archify's node anatomy, each with its base size and its floor. */
export const TIERS = {
  label: { base: 11, floor: 8 },
  sublabel: { base: 9, floor: 7 },
  tag: { base: 7, floor: 6 },
} as const;

export type Tier = keyof typeof TIERS;

export const fitSize = (text: string, base: number, floor: number, box = TEXT_BOX): number => {
  const per = box / Math.max(1, text.length * ADVANCE);
  return Math.max(floor, Math.min(base, per));
};

export const fitTier = (text: string, tier: Tier, box = TEXT_BOX): number =>
  fitSize(text, TIERS[tier].base, TIERS[tier].floor, box);

/** How wide the text actually lands. Over `TEXT_BOX` is a rejection, never a clip. */
export const widthAt = (text: string, size: number): number => text.length * ADVANCE * size;

/** A world length, as a `rem`, so `design/check-tokens.mjs` never sees a raw pixel. */
export const rem = (units: number): string => `${units / 16}rem`;
