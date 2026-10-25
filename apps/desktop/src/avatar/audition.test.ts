/**
 * The audition - a face speaks the calm sample line, silently, so a person choosing her form sees it
 * speak (ADR 0120). One audition at a time, on the window's one clock, nothing under Calm.
 */
import { describe, expect, it } from "vitest";

import type { Clock, FrameFn } from "@/lib/motion";

import { createAudition } from "./audition";
import { CALM_DURATION } from "./fixtures";
import type { FaceAvatarId, FaceSignal } from "./types";

/** A clock stepped by hand at 60 fps. */
function fakeClock() {
  const subs = new Set<FrameFn>();
  let time = 0;
  const clock: Clock = {
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    get size() {
      return subs.size;
    },
    get running() {
      return subs.size > 0;
    },
  };
  const step = (ms = 1000 / 60) => {
    time += ms;
    for (const fn of [...subs]) if (fn(time, ms) === false) subs.delete(fn);
  };
  /** Step until `seconds` have passed since the call. */
  const run = (seconds: number) => {
    const frames = Math.round(seconds * 60);
    for (let i = 0; i < frames; i++) step();
  };
  return { clock, step, run, subs };
}

function setup(calm = false) {
  const c = fakeClock();
  const audition = createAudition({ clock: () => c.clock, calm: () => calm });
  const heard: Record<FaceAvatarId, FaceSignal[]> = { "b04-owl": [], "d08-origami": [] };
  for (const form of ["b04-owl", "d08-origami"] as const) audition.source(form).subscribe((s) => heard[form].push(s));
  // the subscription hands each face its rest signal; count from after it
  heard["b04-owl"].length = 0;
  heard["d08-origami"].length = 0;
  return { ...c, audition, heard };
}

describe("the audition", () => {
  it("plays the calm line through the form's source, then one idle and no clock", () => {
    const { audition, heard, run, subs } = setup();
    audition.play("b04-owl");
    run(0.3);
    const atPP = heard["b04-owl"].at(-1)!;
    expect(atPP.phase).toBe("speaking");
    expect(atPP.viseme).toBe("PP");
    run(0.65);
    const atAa = heard["b04-owl"].at(-1)!;
    expect(atAa.phase).toBe("speaking");
    expect(atAa.viseme).toBe("aa");
    expect(atAa.level).toBeGreaterThan(0);
    run(CALM_DURATION);
    const after = heard["b04-owl"];
    expect(after.at(-1)!.phase).toBe("idle");
    expect(after.filter((s) => s.phase === "idle")).toHaveLength(1);
    expect(subs.size).toBe(0);
    expect(heard["d08-origami"]).toHaveLength(0);
  });

  it("is one at a time: a second form stops the first at once and only the second is driven", () => {
    const { audition, heard, run, subs } = setup();
    audition.play("b04-owl");
    run(0.5);
    const owlBefore = heard["b04-owl"].length;
    audition.play("d08-origami");
    expect(heard["b04-owl"].at(-1)!.phase).toBe("idle");
    expect(heard["b04-owl"]).toHaveLength(owlBefore + 1);
    run(0.5);
    expect(heard["b04-owl"]).toHaveLength(owlBefore + 1);
    expect(heard["d08-origami"].length).toBeGreaterThan(20);
    expect(heard["d08-origami"].at(-1)!.phase).toBe("speaking");
    expect(subs.size).toBe(1);
  });

  it("stop() mid-line sends one idle, holds no clock, and a later play starts from the top", () => {
    const { audition, heard, run, step, subs } = setup();
    audition.play("d08-origami");
    run(1);
    audition.stop();
    expect(heard["d08-origami"].at(-1)!.phase).toBe("idle");
    expect(subs.size).toBe(0);
    const n = heard["d08-origami"].length;
    audition.stop();
    run(0.5);
    expect(heard["d08-origami"]).toHaveLength(n);
    audition.play("d08-origami");
    step();
    // t = one frame: the line's opening silence, not where the last play left off
    const first = heard["d08-origami"].at(-1)!;
    expect(first.phase).toBe("speaking");
    expect(first.viseme).toBe("sil");
    run(0.3);
    expect(heard["d08-origami"].at(-1)!.viseme).toBe("PP");
  });

  it("under Calm subscribes to no clock and sends nothing past the rest signal", () => {
    const { audition, heard, run, subs } = setup(true);
    audition.play("b04-owl");
    expect(subs.size).toBe(0);
    run(1);
    audition.stop();
    expect(heard["b04-owl"]).toHaveLength(0);
    const late: FaceSignal[] = [];
    audition.source("b04-owl").subscribe((s) => late.push(s));
    expect(late).toHaveLength(1);
    expect(late[0]!.phase).toBe("idle");
    expect(late[0]!.level).toBe(0);
  });
});
