/**
 * The face driver - ADR 0120 ("Athena has a face"), motion.
 *
 * Turns the stream of `FaceSignal`s into one rig pose a frame. Pure and deterministic: the only
 * randomness is a seeded generator consumed in time order, so the same seed and the same signals
 * stepped by the same deltas give the same poses (the tests hold it). Three layers, in order:
 *
 * 1. **Procedural motion per phase.** Slow drift (incommensurate sines), blinks every 2-6 s with
 *    occasional doubles, micro-saccades, and a per-phase profile: listening leans in and steadies
 *    the gaze, thinking slows the drift, looks off-centre and pulses softly, speaking nods on
 *    stressed vowels, the gate holds still and expectant. Profiles cross-blend, so a phase change
 *    never jumps. The spike's procedural head ran at 0.7x on the glow forms, so this does too.
 * 2. **Speech.** The producer is the one mouth authority (ADR 0120, Measured): with a shape the
 *    target is its rule (`visemes.ts` `mouthTarget`, the one table, loudness against
 *    `SPEECH_LEVEL`), never a second copy; without one it is the producer's `open` as sent, floor
 *    and all. The jaw opens over 35 ms and closes over 12 ms, so a closure shuts.
 * 3. **Neural motion.** When `signal.motion` is set it takes the head, the gaze and (unless its
 *    `blink` is null: the track leaves the lids to her own blinks) the blinks over
 *    a 200 ms crossfade, and hands them back over another when it ends; breathing and the floating
 *    parts stay procedural throughout. The spike ran neural motion at 0.55x; it is applied here
 *    and only here (the helper's retarget sends the head unscaled).
 *
 * **It settles.** At rest (idle or gate, silent, no neural track) it keeps living for a short linger
 * and then eases every motion to zero and reports `settled`; the runtime then stops its frame loop
 * (ADR 0089, 0092: none when nothing moves). Any new signal wakes it.
 */
import type { FacePhase, FaceSignal, Viseme } from "./types";
import { CLOSE_TAU_MS, mouthTarget, VISEME_SHAPES, VOWELS } from "./visemes";

/** One frame of the rig. Reused between frames: read it, do not keep it. */
export interface Pose {
  /** Face clock, seconds: what breathing and the floating parts are timed by. */
  t: number;
  /** Degrees: yaw right-positive, pitch down-positive, roll clockwise-positive. */
  yaw: number;
  pitch: number;
  roll: number;
  /** 0 open .. 1 closed. */
  blinkL: number;
  blinkR: number;
  /** -1..1. */
  gazeX: number;
  gazeY: number;
  /** Mouth (seam, aperture) opening, 0..1, smoothed. */
  open: number;
  /** Voice level, smoothed (fast attack, slow release), 0..1.2. */
  voice: number;
  /** How alive the idle motion is, 0 (at rest, still) .. 1: scales breath, sway and floats. */
  activity: number;
  /** The thinking pulse, 0..1. */
  pulse: number;
  /** Voice level history at 40 Hz, [0] = now: the owl's fibre-tip ripple reads it. */
  history: Float32Array;
}

export interface DriverOptions {
  seed?: number;
  /** Procedural head scale (the spike's glow forms: 0.7). */
  motionScale?: number;
  /** Neural head scale (the spike: 0.55), the only one: the helper sends her head unscaled. */
  neuralScale?: number;
  /** Seconds an idle face keeps moving after its last signal change before it settles. */
  idleLinger?: number;
  /** The same for the gate: still and expectant, so shorter. */
  gateLinger?: number;
}

export interface Driver {
  /** Hand in the latest signal. Returns whether anything in it changed (an identical one is not news). */
  setSignal(signal: FaceSignal): boolean;
  /** Advance by `dt` seconds and return the pose. */
  step(dt: number): Pose;
  /** The current pose without advancing. */
  readonly pose: Pose;
  /** True when nothing moves and nothing will until the next signal change. */
  readonly settled: boolean;
  /** Jump to rest (still, eyes open, mouth shut): what Calm draws. */
  rest(): Pose;
}

/** A seeded generator (mulberry32): the spike's, so a seed means the same thing in both. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth = (x: number) => {
  const y = clamp(x, 0, 1);
  return y * y * (3 - 2 * y);
};
/** 0 -> 1 over `up` s before `t0`, back to 0 over `down` s after it. */
function bump(t: number, t0: number, up: number, down: number): number {
  if (t < t0 - up || t > t0 + down) return 0;
  return t < t0 ? smooth((t - (t0 - up)) / up) : 1 - smooth((t - t0) / down);
}
/** Exponential approach with time constant `tau`. */
const approach = (x: number, target: number, dt: number, tau: number) =>
  x + (target - x) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));

/** What a phase does to the procedural motion. Numbers blend, so a change never jumps. */
interface Profile {
  /** Drift amplitude. */
  drift: number;
  /** Drift speed (time warp of the sines). */
  speed: number;
  /** Head bias, degrees (negative pitch raises the head). */
  pitch: number;
  /** Gaze bias, -1..1 (x is mirrored per thinking spell). */
  gazeX: number;
  gazeY: number;
  /** Saccade size. */
  sacc: number;
  /** Thinking pulse depth. */
  pulse: number;
  /** Speech sway depth. */
  speech: number;
}

const PROFILES: Record<FacePhase, Profile> = {
  idle: { drift: 1, speed: 1, pitch: 0, gazeX: 0, gazeY: 0, sacc: 1, pulse: 0, speech: 0 },
  listening: { drift: 0.55, speed: 0.9, pitch: -1.4, gazeX: 0, gazeY: 0, sacc: 0.45, pulse: 0, speech: 0 },
  thinking: { drift: 1.1, speed: 0.55, pitch: -0.4, gazeX: 0.3, gazeY: -0.22, sacc: 0.6, pulse: 1, speech: 0 },
  speaking: { drift: 1, speed: 1, pitch: 0, gazeX: 0, gazeY: 0, sacc: 0.8, pulse: 0, speech: 1 },
  gate: { drift: 0.2, speed: 0.7, pitch: -0.8, gazeX: 0, gazeY: 0, sacc: 0.25, pulse: 0, speech: 0 },
};
const PROFILE_KEYS = Object.keys(PROFILES.idle) as (keyof Profile)[];

/**
 * Where the mouth heads for `signal`: with a shape, the producer's own rule on the shape and level
 * (`mouthTarget`, so her window and Main aim where the producer aimed, and a closure's first frame
 * shuts at once); without one, the producer's `open` as sent, so its floor holds.
 */
export function speechTarget(signal: Pick<FaceSignal, "viseme" | "level" | "open">): number {
  if (signal.viseme !== null) return mouthTarget(signal.viseme, signal.level);
  return clamp(Number.isFinite(signal.open) ? signal.open : 0, 0, 1);
}

/**
 * The face's own jaw on top of the producer's: opening over 35 ms (softer than the producer's 22,
 * which keeps a surface fed every frame and one fed the 40 Hz mirror close), closing over the
 * producer's 12 ms so a closure reads.
 */
const OPEN_TAU_S = 0.035;
const NEURAL_FADE_S = 0.2;
const BLINK_S = 0.28;

export function createDriver(options: DriverOptions = {}): Driver {
  const rnd = mulberry32(options.seed ?? 7);
  const motionScale = options.motionScale ?? 0.7;
  const neuralScale = options.neuralScale ?? 0.55;
  const idleLinger = options.idleLinger ?? 6;
  const gateLinger = options.gateLinger ?? 2.5;

  const ph = Array.from({ length: 10 }, () => rnd() * Math.PI * 2);
  const pose: Pose = {
    t: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    blinkL: 0,
    blinkR: 0,
    gazeX: 0,
    gazeY: 0,
    open: 0,
    voice: 0,
    activity: 0,
    pulse: 0,
    history: new Float32Array(48),
  };

  let signal: FaceSignal = { phase: "idle", level: 0, viseme: null, open: 0, motion: null, generation: 0 };
  const prof: Profile = { ...PROFILES.idle };
  let t = 0;
  let clock = 0; // drift clock, warped by the profile's speed
  let linger = idleLinger;
  let awake = 0; // 0..1, linear; eased when used
  let speech = 0; // speaking amount, smoothed
  let pulseClock = 0;
  let thinkSide = 1;

  // blinks
  let nextBlink = 0.6 + rnd() * 1.6;
  const blinks: number[] = [];
  // saccades
  let nextSacc = 0.4 + rnd();
  let saccFrom = { x: 0, y: 0 };
  let saccTo = { x: 0, y: 0 };
  let saccAt = -1;
  // nods
  const nods: { t: number; amp: number }[] = [];
  let lastNod = -10;
  let lastViseme: Viseme | null = null;
  // neural
  let w = 0;
  /** The same crossfade for the lids alone: up only while the track drives them. */
  let wLid = 0;
  const neural = { yaw: 0, pitch: 0, roll: 0, blink: 0, gazeX: 0, gazeY: 0 };
  // level history at 40 Hz
  let histAcc = 0;

  const lingerFor = (p: FacePhase) => (p === "gate" ? gateLinger : idleLinger);
  const resting = () =>
    (signal.phase === "idle" || signal.phase === "gate") && signal.level < 0.005 && signal.motion === null;

  function scheduleBlinkSoon(at: number) {
    if (blinks.every((b) => Math.abs(b - at) > 0.35) && Math.abs(nextBlink - at) > 0.35) blinks.push(at);
  }

  function setSignal(next: FaceSignal): boolean {
    const m = next.motion;
    const pm = signal.motion;
    const changed =
      next.phase !== signal.phase ||
      next.level !== signal.level ||
      next.viseme !== signal.viseme ||
      next.open !== signal.open ||
      next.generation !== signal.generation ||
      (m === null) !== (pm === null) ||
      (m !== null &&
        pm !== null &&
        (m.yaw !== pm.yaw || m.pitch !== pm.pitch || m.roll !== pm.roll || m.blink !== pm.blink || m.gazeX !== pm.gazeX || m.gazeY !== pm.gazeY));
    if (!changed) return false;
    const prevPhase = signal.phase;
    signal = { ...next, motion: m ? { ...m } : null };
    if (m) {
      neural.yaw = m.yaw;
      neural.pitch = m.pitch;
      neural.roll = m.roll;
      neural.gazeX = m.gazeX;
      neural.gazeY = m.gazeY;
      // a track that leaves the lids out (blink null) keeps her own blinks; the last lid it drove
      // is held only while the lids fade back
      if (m.blink !== null) neural.blink = m.blink;
    }
    if (next.phase !== prevPhase) {
      if (next.phase === "thinking") thinkSide = rnd() < 0.5 ? -1 : 1;
      // a blink near the start of speech, as people do
      if (next.phase === "speaking") scheduleBlinkSoon(t + 0.12);
    }
    // a stressed vowel while speaking may earn a nod
    if (next.phase === "speaking" && next.viseme !== lastViseme && next.viseme !== null && VOWELS.has(next.viseme)) {
      const score = VISEME_SHAPES[next.viseme].open * (0.4 + Math.min(1, next.level));
      if (score > 0.3 && t - lastNod > 0.65 && rnd() < 0.5) {
        nods.push({ t: t + 0.06, amp: 1.4 + 1.6 * rnd() });
        lastNod = t;
      }
    }
    lastViseme = next.viseme;
    // A phase change restarts the linger; a quiet idle signal that only twitches does not.
    if (next.phase !== prevPhase) linger = lingerFor(next.phase);
    return true;
  }

  function blinkAt(time: number): number {
    let v = 0;
    for (const b of blinks) {
      const d = time - b; // close 75 ms, hold 35 ms, open 170 ms
      if (d < 0 || d > BLINK_S) continue;
      v = Math.max(v, d < 0.075 ? smooth(d / 0.075) : d < 0.11 ? 1 : 1 - smooth((d - 0.11) / 0.17));
    }
    return v;
  }

  function step(dtIn: number): Pose {
    const dt = clamp(Number.isFinite(dtIn) ? dtIn : 0, 0, 0.1);
    t += dt;

    // rest or awake
    if (resting()) linger = Math.max(0, linger - dt);
    else linger = lingerFor(signal.phase);
    const wantAwake = linger > 0;
    awake = clamp(awake + (wantAwake ? dt / 0.5 : -dt / 1.2), 0, 1);
    const act = smooth(awake);

    // profile blend
    const target = PROFILES[signal.phase];
    for (const k of PROFILE_KEYS) prof[k] = approach(prof[k], target[k], dt, 0.45);
    clock += dt * prof.speed;
    pulseClock += dt;
    speech = approach(speech, signal.phase === "speaking" ? 1 : 0, dt, 0.4);

    // events: blinks (only while awake), saccades, expiry
    if (wantAwake && t >= nextBlink) {
      scheduleBlinkSoon(t);
      if (rnd() < 0.2) blinks.push(t + 0.26 + rnd() * 0.08);
      nextBlink = t + 2 + 4 * Math.pow(rnd(), 1.3);
    }
    for (let i = blinks.length - 1; i >= 0; i--) if (t - blinks[i] > BLINK_S) blinks.splice(i, 1);
    if (t >= nextSacc) {
      const r = (0.03 + 0.07 * rnd()) * prof.sacc;
      const a = rnd() * Math.PI * 2;
      saccFrom = currentGaze();
      saccTo = { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6 };
      saccAt = t;
      nextSacc = t + (0.5 + 1.7 * rnd()) / Math.max(0.4, prof.sacc);
    }
    for (let i = nods.length - 1; i >= 0; i--) if (t - nods[i].t > 0.4) nods.splice(i, 1);

    // procedural head
    const c = clock;
    const d = prof.drift;
    const sp = speech * prof.speech;
    let yaw = d * (1.5 * Math.sin(c * 0.43 + ph[0]) + 0.8 * Math.sin(c * 1.07 + ph[1])) + sp * 0.9 * Math.sin(c * 2.9 + ph[2]);
    let pitch = d * (0.8 * Math.sin(c * 0.37 + ph[3]) + 0.45 * Math.sin(c * 0.93 + ph[4])) + sp * 0.6 * Math.sin(c * 3.4 + ph[5]);
    const roll = d * (0.9 * Math.sin(c * 0.29 + ph[6]) + 0.4 * Math.sin(c * 0.81 + ph[7]));
    pitch += prof.pitch;
    for (const n of nods) {
      const b = bump(t, n.t, 0.13, 0.34);
      pitch += n.amp * b;
      yaw += 0.25 * n.amp * b * Math.sin(ph[8]);
    }
    const g = currentGaze();
    const gx = g.x + prof.gazeX * thinkSide;
    const gy = g.y + prof.gazeY;
    yaw += gx * 3.0; // the head trails a big gaze shift a little
    pitch += gy * 1.5;
    const blink = blinkAt(t);

    // neural over procedural
    w = clamp(w + (signal.motion ? dt : -dt) / NEURAL_FADE_S, 0, 1);
    const k = smooth(w);
    const pYaw = yaw * motionScale * act;
    const pPitch = pitch * motionScale * act;
    const pRoll = roll * motionScale * act;
    pose.yaw = pYaw + (neural.yaw * neuralScale - pYaw) * k;
    pose.pitch = pPitch + (neural.pitch * neuralScale - pPitch) * k;
    pose.roll = pRoll + (neural.roll * neuralScale - pRoll) * k;
    wLid = clamp(wLid + (signal.motion && signal.motion.blink !== null ? dt : -dt) / NEURAL_FADE_S, 0, 1);
    const b = blink + (clamp(neural.blink, 0, 1) - blink) * smooth(wLid);
    pose.blinkL = b;
    pose.blinkR = b;
    pose.gazeX = gx * act + (clamp(neural.gazeX, -1, 1) - gx * act) * k;
    pose.gazeY = gy * act + (clamp(neural.gazeY, -1, 1) - gy * act) * k;

    // speech
    const level = clamp(signal.level, 0, 1.2);
    const mouth = speechTarget(signal);
    pose.open = approach(pose.open, mouth, dt, mouth < pose.open ? CLOSE_TAU_MS / 1000 : OPEN_TAU_S);
    pose.voice = approach(pose.voice, level, dt, level > pose.voice ? 0.03 : 0.14);
    histAcc += dt;
    while (histAcc >= 0.025) {
      histAcc -= 0.025;
      pose.history.copyWithin(1, 0, 47);
      pose.history[0] = level;
    }
    pose.history[0] = level;

    pose.pulse = prof.pulse * (0.5 - 0.5 * Math.cos((2 * Math.PI * pulseClock) / 2.2));
    pose.activity = act;
    pose.t = t;

    // settle: snap the last crumbs so a still frame is exactly at rest
    if (isSettled()) {
      pose.open = 0;
      pose.voice = 0;
      pose.pulse = 0;
      pose.history.fill(0);
    }
    return pose;
  }

  function currentGaze() {
    if (saccAt < 0) return { x: saccTo.x, y: saccTo.y };
    const k = smooth((t - saccAt) / 0.045);
    return { x: saccFrom.x + (saccTo.x - saccFrom.x) * k, y: saccFrom.y + (saccTo.y - saccFrom.y) * k };
  }

  function isSettled(): boolean {
    return (
      linger === 0 &&
      awake === 0 &&
      w === 0 &&
      wLid === 0 &&
      blinks.length === 0 &&
      nods.length === 0 &&
      pose.open < 1e-3 &&
      pose.voice < 1e-3 &&
      prof.pulse < 1e-3 &&
      resting()
    );
  }

  function rest(): Pose {
    pose.yaw = pose.pitch = pose.roll = 0;
    pose.blinkL = pose.blinkR = 0;
    pose.gazeX = pose.gazeY = 0;
    pose.open = pose.voice = pose.activity = pose.pulse = 0;
    pose.history.fill(0);
    return pose;
  }

  return {
    setSignal,
    step,
    rest,
    get pose() {
      return pose;
    },
    get settled() {
      return isSettled();
    },
  };
}
