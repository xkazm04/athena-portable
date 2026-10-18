/**
 * The face driver - ADR 0120 ("Athena has a face"), motion: seeded procedural motion, the speech
 * drive, the neural crossfade, and settling at rest.
 */
import { describe, expect, it } from "vitest";

import { createDriver, mulberry32, type Pose } from "./driver";
import { CALM_DURATION, fixtureSignal } from "./fixtures";
import { RESTING, type FaceSignal } from "./types";
import { levelOpen, visemeOpen } from "./visemes";

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

describe("speech opens the mouth", () => {
  it("a viseme's opening is scaled by the level and a closure dips to shut", () => {
    expect(visemeOpen("aa", 1)).toBeGreaterThan(visemeOpen("aa", 0.3));
    expect(visemeOpen("PP", 1)).toBe(0);
    expect(visemeOpen("sil", 1)).toBe(0);
    expect(visemeOpen("FF", 1)).toBeLessThan(visemeOpen("E", 1));
  });

  it("an open vowel followed by a bilabial closes within a few frames", () => {
    const d = createDriver({ seed: 1 });
    let p: Pose = d.pose;
    d.setSignal(signal({ phase: "speaking", level: 0.8, viseme: "aa" }));
    for (let i = 0; i < 10; i++) p = d.step(FRAME);
    const wide = p.open;
    expect(wide).toBeGreaterThan(0.7);
    d.setSignal(signal({ phase: "speaking", level: 0.8, viseme: "PP" }));
    for (let i = 0; i < 5; i++) p = d.step(FRAME);
    expect(p.open).toBeLessThan(wide * 0.2);
  });

  it("with no viseme the level alone opens it: fast attack, slower release", () => {
    expect(levelOpen(0.02)).toBe(0);
    const d = createDriver({ seed: 1 });
    d.setSignal(signal({ phase: "speaking", level: 0.7 }));
    let p: Pose = d.pose;
    for (let i = 0; i < 4; i++) p = d.step(FRAME); // 67 ms
    const attacked = p.open / levelOpen(0.7);
    d.setSignal(signal({ phase: "speaking", level: 0 }));
    const top = p.open;
    for (let i = 0; i < 4; i++) p = d.step(FRAME);
    const released = 1 - p.open / top;
    expect(attacked).toBeGreaterThan(0.85);
    expect(released).toBeLessThan(attacked);
    expect(released).toBeGreaterThan(0.2);
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
