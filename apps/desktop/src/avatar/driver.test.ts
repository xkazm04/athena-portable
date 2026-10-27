/**
 * The face driver - ADR 0120 ("Athena has a face"), motion: seeded procedural motion, the speech
 * drive (the producer's mouth, followed), the neural crossfade, and settling at rest.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createDriver, mulberry32, speechTarget, type Pose } from "./driver";
import { CALM_DURATION, fixtureSignal } from "./fixtures";
import { RESTING, type FaceSignal } from "./types";
import { mouthTarget } from "./visemes";

const FRAME = 1 / 60;
const signal = (s: Partial<FaceSignal>): FaceSignal => ({ ...RESTING, ...s });
const snap = (p: Pose) => ({ yaw: p.yaw, pitch: p.pitch, roll: p.roll, blink: p.blinkL, gx: p.gazeX, gy: p.gazeY, open: p.open });

/** Run `seconds` of frames, feeding `at(t)` as the signal each frame; returns every pose. */
function run(driver: ReturnType<typeof createDriver>, seconds: number, at: (t: number) => FaceSignal) {
  const out: ReturnType<typeof snap>[] = [];
  for (let t = 0; t < seconds; t += FRAME) {
    driver.setSignal(at(t));
    out.push(snap(driver.step(FRAME)));
  }
  return out;
}

describe("procedural motion is seeded", () => {
  it("the same seed and the same signals give the same poses", () => {
    const line = (t: number) => fixtureSignal("calm", t, "speaking");
    const a = run(createDriver({ seed: 3 }), 8, line);
    const b = run(createDriver({ seed: 3 }), 8, line);
    expect(a).toEqual(b);
  });

  it("another seed moves differently", () => {
    const idle = () => signal({ phase: "idle" });
    const a = run(createDriver({ seed: 3 }), 4, idle);
    const b = run(createDriver({ seed: 4 }), 4, idle);
    expect(a).not.toEqual(b);
  });

  it("the generator is the spike's mulberry32", () => {
    const r = mulberry32(1);
    expect(r()).toBeCloseTo(0.6270739405881613, 12);
  });

  it("an idle face blinks every few seconds and its head drifts", () => {
    const poses = run(createDriver({ seed: 11, idleLinger: 60 }), 20, () => signal({ phase: "idle" }));
    const closed = poses.filter((p, i) => p.blink > 0.9 && !(poses[i - 1]?.blink > 0.9)).length;
    expect(closed).toBeGreaterThanOrEqual(3); // 2-6 s apart over 20 s
    expect(closed).toBeLessThanOrEqual(12);
    const yaws = poses.map((p) => p.yaw);
    expect(Math.max(...yaws) - Math.min(...yaws)).toBeGreaterThan(0.5);
  });

  it("thinking looks off-centre; the gate holds stiller than idle", () => {
    const think = run(createDriver({ seed: 2 }), 4, () => signal({ phase: "thinking" }));
    const last = think[think.length - 1];
    expect(Math.abs(last.gx)).toBeGreaterThan(0.2);
    const spread = (ps: ReturnType<typeof snap>[]) => {
      const ys = ps.slice(60).map((p) => p.yaw);
      return Math.max(...ys) - Math.min(...ys);
    };
    const idle = run(createDriver({ seed: 2, idleLinger: 60 }), 6, () => signal({ phase: "idle" }));
    const gate = run(createDriver({ seed: 2, gateLinger: 60 }), 6, () => signal({ phase: "gate" }));
    expect(spread(gate)).toBeLessThan(spread(idle) * 0.6);
  });
});

describe("speech opens the mouth, as the producer shapes it", () => {
  const said = (viseme: FaceSignal["viseme"], level: number) =>
    signal({ phase: "speaking", level, viseme, open: mouthTarget(viseme, level) });

  it("a shape's opening is the producer's rule: scaled by the level, and a closure shuts", () => {
    expect(speechTarget(said("aa", 1))).toBeGreaterThan(speechTarget(said("aa", 0.3)));
    expect(speechTarget(said("PP", 1))).toBe(0);
    expect(speechTarget(said("sil", 1))).toBe(0);
    expect(speechTarget(said("FF", 1))).toBeLessThan(speechTarget(said("E", 1)));
    // A closure shuts even when the mirrored opening was still falling.
    expect(speechTarget({ viseme: "PP", level: 0.8, open: 0.4 })).toBe(0);
  });

  it("an open vowel followed by a bilabial closes within a few frames", () => {
    const d = createDriver({ seed: 1 });
    let p: Pose = d.pose;
    d.setSignal(said("aa", 0.8));
    for (let i = 0; i < 10; i++) p = d.step(FRAME);
    const wide = p.open;
    expect(wide).toBeGreaterThan(0.7);
    d.setSignal(said("PP", 0.8));
    for (let i = 0; i < 3; i++) p = d.step(FRAME);
    expect(p.open).toBeLessThan(wide * 0.05);
  });

  it("with no shape it follows the producer's opening: it opens, and closes faster than it opened", () => {
    const d = createDriver({ seed: 1 });
    d.setSignal(signal({ phase: "speaking", level: 0.7, open: 0.8 }));
    let p: Pose = d.pose;
    for (let i = 0; i < 4; i++) p = d.step(FRAME); // 67 ms
    const attacked = p.open / 0.8;
    d.setSignal(signal({ phase: "speaking", level: 0, open: 0 }));
    const top = p.open;
    for (let i = 0; i < 1; i++) p = d.step(FRAME);
    const released = 1 - p.open / top;
    expect(attacked).toBeGreaterThan(0.85);
    expect(released).toBeGreaterThan(1 - Math.exp(-FRAME / 0.035));
  });
});

describe("neural motion crossfades over the procedural", () => {
  const motion = { yaw: 10, pitch: -4, roll: 2, blink: 1, gazeX: 0.5, gazeY: 0 };

  it("takes the head and the blink over about 200 ms, at 0.55x, and hands them back", () => {
    const d = createDriver({ seed: 5 });
    for (let i = 0; i < 30; i++) d.step(FRAME);
    d.setSignal(signal({ phase: "speaking", motion }));
    const p50 = d.step(0.05);
    expect(p50.yaw).not.toBeCloseTo(10 * 0.55, 1); // still blending at 50 ms
    let p: Pose = p50;
    for (let i = 0; i < 9; i++) p = d.step(FRAME); // 200 ms in
    expect(p.yaw).toBeCloseTo(10 * 0.55, 5);
    expect(p.pitch).toBeCloseTo(-4 * 0.55, 5);
    expect(p.blinkL).toBe(1);
    expect(p.gazeX).toBeCloseTo(0.5, 5);

    d.setSignal(signal({ phase: "speaking", motion: null }));
    const out50 = d.step(0.05);
    expect(out50.blinkL).toBeGreaterThan(0.5); // fading out, not dropped
    for (let i = 0; i < 12; i++) p = d.step(FRAME);
    expect(p.blinkL).toBeLessThan(1);
    expect(Math.abs(p.yaw - 10 * 0.55)).toBeGreaterThan(1);
  });

  it("the glow forms' 0.55x is applied once across the seam, not by the helper and again here", () => {
    // The helper's retarget (face_helper/motion.py) and this driver both claimed the spike's one
    // x0.55; applied twice her neural head moved at 0.30x. A gain the helper applies is read off it.
    const motionPy = readFileSync(resolve(__dirname, "../../../../src/athena/channels/voice/face_helper/motion.py"), "utf8");
    const helperGain = Number(/^HEAD_GAIN = ([\d.]+)/m.exec(motionPy)?.[1] ?? 1);
    const d = createDriver({ seed: 5 });
    let p: Pose = d.pose;
    for (let i = 0; i < 30; i++) {
      d.setSignal(signal({ phase: "speaking", motion }));
      p = d.step(FRAME);
    }
    expect(helperGain * (p.yaw / motion.yaw)).toBeCloseTo(0.55, 5);
  });

  it("a track whose blink is null moves the head but leaves her own blinks running", () => {
    const d = createDriver({ seed: 11, idleLinger: 60 });
    const noLids = { ...motion, blink: null };
    let p: Pose = d.pose;
    let closed = 0;
    for (let t = 0; t < 20; t += FRAME) {
      d.setSignal(signal({ phase: "speaking", motion: noLids }));
      const prev = p.blinkL;
      p = d.step(FRAME);
      if (p.blinkL > 0.9 && prev <= 0.9) closed++;
    }
    expect(p.yaw).toBeCloseTo(10 * 0.55, 5);
    expect(closed).toBeGreaterThanOrEqual(3); // procedural blinks, 2-6 s apart
  });

  it("a track that omits gaze moves the head and keeps her own saccades on the eyes", () => {
    // The same seed with no track at all: the gaze she would have had on her own.
    const own = run(createDriver({ seed: 9, idleLinger: 60 }), 4, () => signal({ phase: "speaking" }));
    const headOnly = { ...motion, gazeX: null, gazeY: null };
    const poses = run(createDriver({ seed: 9, idleLinger: 60 }), 4, () => signal({ phase: "speaking", motion: headOnly }));
    const last = poses[poses.length - 1];
    expect(last.yaw).toBeCloseTo(10 * 0.55, 5); // the head is the track's
    for (let i = 0; i < poses.length; i++) {
      expect(poses[i].gx).toBeCloseTo(own[i].gx, 9); // the eyes are hers, saccades and all
      expect(poses[i].gy).toBeCloseTo(own[i].gy, 9);
    }
    const gxs = own.map((p) => p.gx);
    expect(Math.max(...gxs) - Math.min(...gxs)).toBeGreaterThan(0.01); // and hers do move
  });

  it("a track that sends gaze 0 centres her eyes on purpose", () => {
    const d = createDriver({ seed: 9, idleLinger: 60 });
    let p: Pose = d.pose;
    for (let t = 0; t < 4; t += FRAME) {
      d.setSignal(signal({ phase: "speaking", motion: { ...motion, gazeX: 0, gazeY: 0 } }));
      p = d.step(FRAME);
    }
    expect(p.gazeX).toBe(0);
    expect(p.gazeY).toBe(0);
  });

  it("a track that omits the head turns the eyes and leaves her head its own drift", () => {
    const own = run(createDriver({ seed: 9, idleLinger: 60 }), 2, () => signal({ phase: "speaking" }));
    const eyesOnly = { yaw: null, pitch: null, roll: null, blink: null, gazeX: 0.5, gazeY: 0 };
    const poses = run(createDriver({ seed: 9, idleLinger: 60 }), 2, () => signal({ phase: "speaking", motion: eyesOnly }));
    const last = poses[poses.length - 1];
    expect(last.gx).toBeCloseTo(0.5, 5);
    // the head trails her own gaze (procedural), so it matches the trackless run only where the
    // eyes were not yet handed over: compare roll, which no gaze moves
    for (let i = 0; i < poses.length; i++) expect(poses[i].roll).toBeCloseTo(own[i].roll, 9);
  });

  it("a full frame moves her exactly as before channels could be absent", () => {
    // Fingerprint of the poses a whole-frame track gives, taken on the tree before this change
    // (every channel a number; the track starts, toggles its lids and ends).
    const d = createDriver({ seed: 13, idleLinger: 60 });
    const at = (t: number): FaceSignal =>
      t < 0.5 || t > 2.5
        ? signal({ phase: "speaking", level: 0.4 })
        : signal({
            phase: "speaking",
            level: 0.4,
            motion: {
              yaw: 8 * Math.sin(t * 3),
              pitch: -3 + Math.cos(t * 2),
              roll: 1.5 * Math.sin(t),
              blink: t > 1.5 && t < 2 ? null : 0.1 * t,
              gazeX: 0.4 * Math.sin(t * 5),
              gazeY: -0.2 * Math.cos(t * 4),
            },
          });
    const poses = run(d, 3.5, at);
    const text = poses.map((p) => Object.values(p).map((v) => v.toFixed(9)).join(",")).join(";");
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    expect(h.toString(16)).toBe("175bc4db");
  });

  it("breathing and the floats stay procedural: activity holds while neural motion plays", () => {
    const d = createDriver({ seed: 5 });
    d.setSignal(signal({ phase: "speaking", motion }));
    let p: Pose = d.pose;
    for (let i = 0; i < 60; i++) p = d.step(FRAME);
    expect(p.activity).toBe(1);
  });
});

describe("a face at rest settles", () => {
  it("an idle face lingers, then settles at the rest pose", () => {
    const d = createDriver({ seed: 9, idleLinger: 2 });
    d.setSignal(signal({ phase: "idle" }));
    let steps = 0;
    let p: Pose = d.pose;
    while (!d.settled && steps < 60 * 10) {
      p = d.step(FRAME);
      steps++;
    }
    expect(d.settled).toBe(true);
    expect(steps / 60).toBeGreaterThan(2);
    expect(steps / 60).toBeLessThan(4.5);
    expect([p.yaw, p.pitch, p.roll, p.blinkL, p.open, p.activity]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("speaking never settles; the end of the line settles after its linger", () => {
    const d = createDriver({ seed: 9, idleLinger: 1 });
    for (let t = 0; t < CALM_DURATION; t += FRAME) {
      d.setSignal(fixtureSignal("calm", t, "speaking"));
      d.step(FRAME);
      expect(d.settled).toBe(false);
    }
    d.setSignal(fixtureSignal("calm", CALM_DURATION, "idle"));
    let steps = 0;
    while (!d.settled && steps < 600) {
      d.step(FRAME);
      steps++;
    }
    expect(d.settled).toBe(true);
  });

  it("an identical signal is not news; a changed one is", () => {
    const d = createDriver();
    expect(d.setSignal(signal({ phase: "idle" }))).toBe(false);
    expect(d.setSignal(signal({ phase: "listening" }))).toBe(true);
    expect(d.setSignal(signal({ phase: "listening" }))).toBe(false);
  });
});
