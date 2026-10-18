/**
 * The face's loop - ADR 0120, ADR 0089 and 0092: one clock, no frames once settled, a still frame
 * under Calm, none while unseen.
 */
import { describe, expect, it } from "vitest";

import { createClock } from "@/lib/motion";

import { createDriver, type Pose } from "./driver";
import { createFaceLoop } from "./runtime";
import { RESTING, type FaceSignal } from "./types";

/** A clock stepped by hand: `tick()` runs one frame 1/60 s after the last. */
function handClock() {
  let pending: ((t: number) => void) | null = null;
  let now = 0;
  const clock = createClock({
    raf: (cb) => {
      pending = cb;
      return 1;
    },
    caf: () => {
      pending = null;
    },
    hidden: () => false,
    onVisible: () => {},
  });
  return {
    clock,
    tick() {
      const cb = pending;
      pending = null;
      now += 1000 / 60;
      cb?.(now);
    },
    get scheduled() {
      return pending !== null;
    },
  };
}

function rig(calm = false, idleLinger = 1) {
  const h = handClock();
  const driver = createDriver({ seed: 1, idleLinger });
  const drawn: Pose[] = [];
  const states: string[] = [];
  const loop = createFaceLoop({
    driver,
    clock: h.clock,
    calm,
    draw: (p) => drawn.push({ ...p }),
    onState: (s) => states.push(s),
  });
  return { h, driver, loop, drawn, states };
}

const say = (s: Partial<FaceSignal>): FaceSignal => ({ ...RESTING, ...s });

describe("the face's loop", () => {
  it("runs while she moves and stops asking for frames once settled", () => {
    const { h, loop, drawn, states } = rig();
    loop.wake();
    expect(loop.running).toBe(true);
    expect(h.clock.size).toBe(1);
    let frames = 0;
    while (h.scheduled && frames < 60 * 10) {
      h.tick();
      frames++;
    }
    expect(loop.running).toBe(false);
    expect(h.clock.size).toBe(0);
    expect(h.scheduled).toBe(false); // nothing pending with the browser: an idle second costs nothing
    expect(states[states.length - 1]).toBe("still");
    expect(drawn.length).toBe(frames);
    const last = drawn[drawn.length - 1];
    expect([last.yaw, last.blinkL, last.open, last.activity]).toEqual([0, 0, 0, 0]);
  });

  it("a signal change wakes a settled face; speaking keeps it running", () => {
    const { h, driver, loop } = rig();
    loop.wake();
    while (h.scheduled) h.tick();
    expect(driver.setSignal(say({ phase: "speaking", level: 0.6, viseme: "aa" }))).toBe(true);
    loop.wake();
    for (let i = 0; i < 600; i++) h.tick();
    expect(loop.running).toBe(true);
  });

  it("two faces on one clock are one frame callback", () => {
    const h = handClock();
    const mk = () =>
      createFaceLoop({ driver: createDriver({ seed: 2 }), clock: h.clock, calm: false, draw: () => {} });
    const a = mk();
    const b = mk();
    a.wake();
    b.wake();
    expect(h.clock.size).toBe(2);
    expect(h.clock.running).toBe(true); // one pending request for both
  });

  it("under Calm it draws one still frame at rest and never subscribes", () => {
    const { h, driver, loop, drawn } = rig(true);
    loop.wake();
    expect(loop.running).toBe(false);
    expect(h.scheduled).toBe(false);
    expect(drawn).toHaveLength(1);
    expect([drawn[0].yaw, drawn[0].blinkL, drawn[0].open]).toEqual([0, 0, 0]);
    driver.setSignal(say({ phase: "speaking", level: 0.9, viseme: "aa" }));
    loop.wake();
    expect(h.scheduled).toBe(false);
    expect(drawn.every((p) => p.open === 0)).toBe(true);
  });

  it("turning Calm on mid-speech stops the loop on a still; turning it off resumes", () => {
    const { h, driver, loop, drawn } = rig();
    driver.setSignal(say({ phase: "speaking", level: 0.9, viseme: "aa" }));
    loop.wake();
    for (let i = 0; i < 20; i++) h.tick();
    loop.setCalm(true);
    expect(loop.running).toBe(false);
    expect(h.clock.size).toBe(0);
    expect(drawn[drawn.length - 1].open).toBe(0);
    loop.setCalm(false);
    expect(loop.running).toBe(true);
  });

  it("an unseen face asks for no frames and resumes when seen", () => {
    const { h, driver, loop } = rig();
    driver.setSignal(say({ phase: "speaking", level: 0.5 }));
    loop.wake();
    loop.setVisible(false);
    expect(h.clock.size).toBe(0);
    loop.wake();
    expect(h.clock.size).toBe(0);
    loop.setVisible(true);
    expect(loop.running).toBe(true);
  });

  it("dispose stops it for good", () => {
    const { h, loop } = rig();
    loop.wake();
    loop.dispose();
    expect(h.clock.size).toBe(0);
    loop.wake();
    expect(h.clock.size).toBe(0);
  });
});
