/**
 * The recipe for one drawn mark: everything decided before anything is drawn.
 *
 * TWO RULES HOLD THIS FILE, and both were learned the hard way.
 *
 * ONE PASS. `describe` walks its seeded generator from start to finish and
 * returns the whole mark as plain data. It used to hand the generator to the
 * components that drew each layer, which meant React's render order decided
 * what came out — and React's render order is not the same on the server as in
 * the browser. The result was a hydration mismatch that looked like a rendering
 * bug and was a determinism bug.
 *
 * TWO DECIMALS. Every number is rounded before it leaves. `Math.cos` differs in
 * its last bit between Node and Chrome, and a last-bit difference in a
 * coordinate is still a different string in the markup.
 *
 * WHY THE MARKS ARE ABSTRACT. This database holds no photograph, no age, no
 * gender, no nationality and nothing standing in for one. `DESIGN-LAW.md` §8
 * forbids inventing a proxy, so a mark says "this person has a picture" and
 * asserts nothing whatever about what they look like.
 */

/**
 * WHY THE MARKS CARRY NO HUE.
 *
 * They used to be drawn from five pastels, two of which — a mint `#b7e4c7` and
 * a coral `#e3a9a0` — sat next to `--bd-auto` (`#9fe3c0`) and `--bd-gate`
 * (`#ffab9c`). DESIGN-LAW §4.2 reserves exactly those two hues for a reversible
 * act and an irreversible one and says plainly: "If those two hues appear as
 * decoration anywhere in the UI, the gate signal is destroyed." Forty marks on
 * the board were spending them on nothing. Worse for the reading: the most
 * colourful thing on the surface carried the least meaning, so the eye went to
 * the identicons and not to the six candidates a person had flagged.
 *
 * Value replaces hue. Four steps of white at fixed opacities give each mark the
 * same distinctness — geometry was always doing most of that work — and it
 * suits the source direction better than colour ever did: a contact sheet is
 * monochrome, and what is written on it in colour is written by a person.
 */
const PALETTE = [
  "rgb(255 255 255 / 88%)",
  "rgb(255 255 255 / 62%)",
  "rgb(255 255 255 / 40%)",
  "rgb(255 255 255 / 24%)",
  "rgb(255 255 255 / 14%)",
] as const;
const FALLBACK = "rgb(255 255 255 / 40%)";

/**
 * Two decimals, which is finer than a 100-unit viewBox can show.
 *
 * The last remaining hydration diff was a single unit in the last place:
 * `Math.cos` in Node and `Math.cos` in Chrome do not always agree on the final
 * bit, so the server wrote `69.52354615658938` and the client wanted
 * `...39`. Transcendental functions are not required to be correctly rounded
 * and different engines land differently. Rounding before the number ever
 * reaches an attribute makes the two agree by construction, and no shape moves
 * by a distance anyone could see.
 */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** FNV-1a-ish string hash. Deterministic, no external dependency. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Forced unsigned, so it is a stable positive seed regardless of platform.
  return h >>> 0;
}

/**
 * Linear congruential generator over a closure. Enough spread for layout
 * choices; never used for anything needing cryptographic quality.
 */
function rng(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 48271) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

/**
 * Roughly three in five, so a board reads as a believable mix rather than an
 * obvious pattern. Seeded from a differently salted string than the drawing, so
 * whether a candidate has a mark does not correlate with what it looks like.
 */
export function hasPortrait(id: string): boolean {
  return rng(hashId(`portrait:${id}`))() < 0.6;
}

/* ------------------------------------------------------------ the recipe */

interface Disc {
  kind: "disc";
  cx: number;
  cy: number;
  r: number;
  colour: string;
}

interface Ring {
  kind: "ring";
  cx: number;
  cy: number;
  r: number;
  width: number;
  colour: string;
}

interface Band {
  kind: "band";
  y: number;
  height: number;
  angle: number;
  colour: string;
}

interface Dots {
  kind: "dots";
  points: { x: number; y: number; r: number }[];
  colour: string;
}

export type Layer = Disc | Ring | Band | Dots;

export interface Mark {
  /** True for a circular ground, false for a rounded square. */
  roundGround: boolean;
  rotation: number;
  ground: string;
  layers: Layer[];
}

const KINDS = ["disc", "ring", "band", "dots"] as const;

/** One pass over the sequence, in a fixed order, producing the whole mark. */
export function describe(id: string): Mark {
  const next = rng(hashId(`mark:${id}`));
  const pick = () => PALETTE[Math.floor(next() * PALETTE.length)] ?? FALLBACK;

  const ground = pick();
  const roundGround = next() < 0.5;
  const rotation = Math.floor(next() * 360);

  const layers: Layer[] = [];
  const count = 2 + Math.floor(next() * 3);
  for (let i = 0; i < count; i += 1) {
    const kind = KINDS[Math.floor(next() * KINDS.length)] ?? "disc";
    const colour = pick();
    if (kind === "disc") {
      layers.push({
        kind,
        cx: round(30 + next() * 40),
        cy: round(30 + next() * 40),
        r: round(10 + next() * 18),
        colour,
      });
    } else if (kind === "ring") {
      layers.push({
        kind,
        cx: round(25 + next() * 50),
        cy: round(25 + next() * 50),
        r: round(20 + next() * 20),
        width: round(3 + next() * 6),
        colour,
      });
    } else if (kind === "band") {
      layers.push({
        kind,
        angle: round(next() * 180),
        height: round(10 + next() * 16),
        y: round(-20 + next() * 40),
        colour,
      });
    } else {
      const n = 3 + Math.floor(next() * 3);
      const cx = 20 + next() * 60;
      const cy = 20 + next() * 60;
      const spread = 6 + next() * 8;
      const points: Dots["points"] = [];
      for (let k = 0; k < n; k += 1) {
        const a = (k / n) * Math.PI * 2 + next();
        points.push({
          x: round(cx + Math.cos(a) * spread),
          y: round(cy + Math.sin(a) * spread),
          r: round(1.5 + next() * 2),
        });
      }
      layers.push({ kind, points, colour });
    }
  }

  return { roundGround, rotation, ground, layers };
}
