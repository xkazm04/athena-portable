/**
 * The loop current's motes and where they are — README section 3.1, ADR 0142.
 *
 * Pure: a fixed field of motes on three wide, lopsided loops (a figure-of-eight under the words, an
 * eddy around the bell, a long swell along the floor), and the function that places one on its
 * loop. `LoopCurrent.tsx` draws them; nothing here touches a canvas, so the shape of the water is
 * tested without one. A closed loop is never drawn: the loop is only the way the water moves.
 */
import type { Pose } from "@/bell/pose";

export interface Loop {
  /** Share of the motes on this loop. */
  w: number;
  /** Centre and radii, in fractions of the stage. */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Radians. */
  tilt: number;
  /** A figure-of-eight rather than an ellipse. */
  eight: boolean;
  /** How far a mote strays from the loop's line, as a fraction of its radii. */
  spread: number;
}

export const LOOPS: readonly Loop[] = [
  { w: 0.5, cx: 0.52, cy: 0.6, rx: 0.47, ry: 0.15, tilt: -0.08, eight: true, spread: 0.05 },
  { w: 0.26, cx: 0.24, cy: 0.33, rx: 0.2, ry: 0.13, tilt: 0.18, eight: false, spread: 0.07 },
  { w: 0.24, cx: 0.58, cy: 0.84, rx: 0.56, ry: 0.07, tilt: 0.03, eight: false, spread: 0.12 },
];

/** How fast the current runs in each pose: the bell's own sway numbers. Resting flows only after a move. */
export const POSE_SPEED: Readonly<Record<Pose, number>> = { resting: 1, working: 2.2, hearing: 1.6, asking: 1.3 };

/** A pose in which the current keeps flowing with nothing moving on screen: she is busy. */
export function flowsAtRest(pose: Pose): boolean {
  return pose !== "resting";
}

export interface Mote {
  loop: Loop;
  /** Phase on the loop, radians. */
  th: number;
  /** Offset from the loop's line. */
  d: number;
  /** Angular speed at pose speed 1, radians per second. */
  w: number;
  /** Radius in CSS pixels. */
  r: number;
  /** Alpha. */
  a: number;
}

const MAX_MOTES = 560;

/** The motes for a stage of this size: one per 3,200 square pixels, at most 560. */
export function moteCount(width: number, height: number): number {
  return Math.min(MAX_MOTES, Math.max(0, Math.round((width * height) / 3200)));
}

/**
 * A fixed field, not Math.random: the same water every launch, and a test that can know it. The
 * quasi-random sequences spread the motes as evenly as the prototype's random draws did.
 */
export function seedMotes(n: number): Mote[] {
  const frac = (x: number) => x - Math.floor(x);
  const motes: Mote[] = [];
  for (let i = 0; i < n; i++) {
    const pick = frac(i * 0.6180339887);
    let acc = 0;
    let loop = LOOPS[0]!;
    for (const l of LOOPS) {
      acc += l.w;
      if (pick <= acc) {
        loop = l;
        break;
      }
    }
    // A sum of three uniforms, centred: a gentle bell curve around the loop's line.
    const g = (frac(i * 0.7548776662) + frac(i * 0.5698402910) + frac(i * 0.4301597090) - 1.5) / 1.5;
    const u = frac(i * 0.3247179572);
    motes.push({
      loop,
      th: frac(i * 0.2451223338) * Math.PI * 2,
      d: g * loop.spread * 2,
      w: (0.045 + frac(i * 0.8191725134) * 0.05) * (loop.eight ? 1 : 1.25),
      r: 0.5 + u * u * 1.3,
      a: 0.18 + frac(i * 0.1366341767) * 0.62,
    });
  }
  return motes;
}

/** Where a mote is at phase `th`, in pixels of a `width` x `height` stage. */
export function place(m: Mote, th: number, width: number, height: number): [number, number] {
  const l = m.loop;
  const s = Math.sin(th);
  const c = Math.cos(th);
  let x = l.eight ? l.rx * s : l.rx * c;
  let y = l.eight ? l.ry * Math.sin(2 * th) : l.ry * s;
  x *= 1 + m.d;
  y *= 1 + m.d * 1.6;
  const ct = Math.cos(l.tilt);
  const st = Math.sin(l.tilt);
  return [(l.cx + x * ct - y * st) * width, (l.cy + x * st + y * ct) * height];
}

/** One step of the current's speed towards its target, eased over about two thirds of a second. */
export function ease(speed: number, target: number, dtSeconds: number): number {
  return speed + (target - speed) * Math.min(1, dtSeconds * 1.5);
}
