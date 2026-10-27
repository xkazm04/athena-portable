/**
 * The Wavefront field and the waves that cross it — README section 3.1, ADR 0142.
 *
 * Pure: a close-packed lattice of points, one per accelerator of the cluster, each with its distance
 * from the bell, and the light a wave front gives a point it is passing. `WavefrontField.tsx` draws
 * them; nothing here touches a canvas. The front is scalloped like the bell's own rim: it runs a
 * little ahead between the rim's arcs. Points are kept sorted by distance, so a frame lights only
 * the band a front is crossing (a binary search), never the whole field.
 */

/** Lattice spacing, px. */
export const GAP = 16;
/** Front speed, px per ms. */
export const SPEED = 0.62;
/** Half-width of the lit band, px. */
export const BAND = 26;
/** Arcs in the bell's rim, which the front's scallop repeats. */
const SCALLOPS = 18;
/** How far the scallop pushes the front ahead, px. */
const SCALLOP_DEPTH = 7;
/** A busy pose rings one wave per beat, ms. */
export const BEAT = 1600;

export interface Field {
  /** Point positions and scalloped distance from the source, sorted by `d` ascending. */
  x: Float32Array;
  y: Float32Array;
  d: Float32Array;
  /** Rest brightness: points fall off towards the far corners. */
  fall: Float32Array;
  /** The furthest point, so a wave knows when it has crossed. */
  maxD: number;
}

export interface Wave {
  /** When the front left the source, on the field's own clock (ms); may be in the future. */
  t0: number;
  gain: number;
}

/** The lattice for a `w` x `h` stage with the wave's source at (`sx`, `sy`). */
export function lattice(w: number, h: number, sx: number, sy: number): Field {
  const pts: { x: number; y: number; d: number; fall: number }[] = [];
  const rowH = GAP * 0.866;
  const reach = Math.hypot(w, h) * 0.9;
  let maxD = 1;
  for (let row = 0, y = GAP / 2; y < h; row++, y += rowH) {
    for (let x = (row % 2 ? GAP / 2 : 0) + GAP / 2; x < w; x += GAP) {
      const dx = x - sx;
      const dy = y - sy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const s = Math.abs(Math.sin((Math.atan2(dy, dx) * SCALLOPS) / 2)) * SCALLOP_DEPTH;
      pts.push({ x, y, d: d - s, fall: Math.max(0.35, 1 - d / reach) });
      if (d > maxD) maxD = d;
    }
  }
  pts.sort((a, b) => a.d - b.d);
  return {
    x: Float32Array.from(pts, (p) => p.x),
    y: Float32Array.from(pts, (p) => p.y),
    d: Float32Array.from(pts, (p) => p.d),
    fall: Float32Array.from(pts, (p) => p.fall),
    maxD,
  };
}

/** Where a wave's front is at `now`, px from the source (negative before it leaves). */
export function front(wave: Wave, now: number): number {
  return (now - wave.t0) * SPEED;
}

/** True while some of the wave is still on the field (or yet to leave). */
export function alive(wave: Wave, now: number, maxD: number): boolean {
  return front(wave, now) < maxD + BAND * 4;
}

/**
 * The light a front at `f` gives a point at distance `d`: a gaussian band, with a long tail behind
 * the front, fading as the wave spreads across the field.
 */
export function light(d: number, f: number, gain: number, maxD: number): number {
  const off = d - f;
  if (off <= -BAND * 3 || off >= BAND) return 0;
  const e = Math.exp(-(off * off) / (BAND * BAND));
  const fade = Math.max(0, 1 - f / (maxD * 1.05));
  return e * (0.35 + 0.65 * fade) * gain;
}

/** The first index whose distance is at least `v`, in a field sorted by distance. */
export function lowerBound(d: Float32Array, v: number): number {
  let lo = 0;
  let hi = d.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (d[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The index range [from, to) of the points a front at `f` can light. */
export function band(field: Field, f: number): [number, number] {
  return [lowerBound(field.d, f - BAND * 3), lowerBound(field.d, f + BAND)];
}

/** Under Calm the field is a standing wave: four rings frozen round the bell at the tideline's spacing. */
export function standing(now: number): Wave[] {
  return [0, 1, 2, 3].map((n) => ({ t0: now - (140 + n * 260) / SPEED, gain: 0.55 - n * 0.1 }));
}

/** The three waves that greet a scene as it arrives: delay (ms) and gain. */
export const ARRIVAL: readonly (readonly [number, number])[] = [
  [150, 1],
  [1500, 0.75],
  [2850, 0.5],
];

/** Parse a `rgb()`/`rgba()` token into [r, g, b, a]; anything else is `fallback`. */
export function rgba(value: string, fallback: [number, number, number, number]): [number, number, number, number] {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) return fallback;
  const p = m[1]!.split(",").map((n) => Number.parseFloat(n));
  if (p.length < 3 || p.some((n) => Number.isNaN(n))) return fallback;
  return [p[0]!, p[1]!, p[2]!, p.length > 3 ? p[3]! : 1];
}
