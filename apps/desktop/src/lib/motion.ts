/**
 * The one animation clock and the Calm switch — README section 3.1, ADR 0089.
 *
 * **One frame loop for the whole window.** Everything that moves per frame (the bell's tendrils,
 * the backdrop, a meter) subscribes here instead of calling `requestAnimationFrame` itself. The
 * loop runs while at least one subscriber is live and the document is visible, and costs nothing
 * otherwise: a settled scene has no callbacks pending, which is how "idle costs about nothing" is
 * kept. A subscriber returns `false` when it has settled and is dropped on the spot.
 *
 * **Calm is a choice, resolved once.** `system` follows the operating system's reduced-motion
 * preference, `calm` and `full` override it. The resolved value is written by `applyMotion` as
 * `data-motion` on the root and is the only thing the stylesheet reads, so a person's choice and
 * the OS's preference cannot disagree on screen. Under calm a move lands on its final state; it is
 * not played faster.
 */

export const MOTION_CHOICES = ["system", "calm", "full"] as const;

export type MotionChoice = (typeof MOTION_CHOICES)[number];

/** What the root attribute can say. `full` is the sheet's default and has no rule of its own. */
export type MotionMode = "calm" | "full";

export function isMotionChoice(value: unknown): value is MotionChoice {
  return typeof value === "string" && (MOTION_CHOICES as readonly string[]).includes(value);
}

/** The mode a choice resolves to, given what the OS prefers. Pure. */
export function resolveMotion(choice: MotionChoice, prefersReduced: boolean): MotionMode {
  if (choice === "calm") return "calm";
  if (choice === "full") return "full";
  return prefersReduced ? "calm" : "full";
}

/** True when the OS asks for less motion. `false` where there is no media query to ask. */
export function systemPrefersReduced(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The one writer of `data-motion`. */
export function applyMotion(mode: MotionMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-motion", mode);
}

/** Whether the page is being asked to hold still right now. Read by drivers that cannot use CSS. */
export function isCalm(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-motion") === "calm";
}

/** A subscriber: called once per frame with the frame time and the time since its last call. */
export type FrameFn = (time: number, delta: number) => boolean | void;

export interface Clock {
  /** Run `fn` every frame until it returns `false` or the returned function is called. */
  subscribe: (fn: FrameFn) => () => void;
  /** Live subscribers. A settled window reads 0. */
  readonly size: number;
  /** True while a frame callback is pending with the browser. */
  readonly running: boolean;
}

export interface ClockEnv {
  raf: (cb: (time: number) => void) => number;
  caf: (id: number) => void;
  hidden: () => boolean;
  /** Called when the page becomes visible again. */
  onVisible: (cb: () => void) => void;
}

/** The loop, with its environment injected so it can be driven by a test one frame at a time. */
export function createClock(env: ClockEnv): Clock {
  const subs = new Map<FrameFn, number>();
  let handle: number | null = null;

  const frame = (time: number) => {
    handle = null;
    if (env.hidden()) return; // resumes through onVisible; no work while nobody can see it
    for (const [fn, last] of [...subs]) {
      if (!subs.has(fn)) continue; // dropped by an earlier subscriber this frame
      const keep = fn(time, last < 0 ? 0 : time - last);
      if (keep === false) subs.delete(fn);
      else subs.set(fn, time);
    }
    if (subs.size > 0) schedule();
  };

  const schedule = () => {
    if (handle === null && !env.hidden()) handle = env.raf(frame);
  };

  env.onVisible(() => {
    // A long hidden gap must not read as one enormous delta, so every subscriber restarts its clock.
    for (const fn of subs.keys()) subs.set(fn, -1);
    schedule();
  });

  return {
    subscribe(fn) {
      subs.set(fn, -1);
      schedule();
      return () => {
        subs.delete(fn);
        if (subs.size === 0 && handle !== null) {
          env.caf(handle);
          handle = null;
        }
      };
    },
    get size() {
      return subs.size;
    },
    get running() {
      return handle !== null;
    },
  };
}

let shared: Clock | null = null;

/** The window's clock, made on first use so importing this module does not touch the document. */
export function frames(): Clock {
  shared ??= createClock({
    raf: (cb) => window.requestAnimationFrame(cb),
    caf: (id) => window.cancelAnimationFrame(id),
    hidden: () => document.hidden,
    onVisible: (cb) => document.addEventListener("visibilitychange", () => !document.hidden && cb()),
  });
  return shared;
}
