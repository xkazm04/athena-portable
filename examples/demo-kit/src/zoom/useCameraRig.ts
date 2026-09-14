"use client";

/**
 * The camera rig: pointer, wheel, keys and `flyTo`, over the arithmetic in `./camera.ts`.
 * `docs/kit-camera-contract.md` §2.
 *
 * WHAT IS UNUSUAL ABOUT THIS HOOK, and why. It does not re-render its host. A camera moves on
 * every frame of a drag and on every wheel tick; a `useState` behind that is sixty renders a
 * second of a tree that has not changed, and round 1's motion-cost axis is the score that pays
 * for it. The pose therefore lives in a ref, and the surface reads it two ways:
 *
 *   · a DOM scene subscribes and writes `poseToTransform(pose)` onto one element's `style`;
 *   · a WebGL scene calls `rig.get()` inside its own `useFrame` and moves its camera itself.
 *
 * Both are the consumer's. The kit has no renderer and imports neither `three` nor `motion`.
 *
 * `moving` is a GETTER on the returned object for the same reason: a boolean copied out at
 * render time would be stale for the whole of the move it describes. `rig.moving` is always the
 * truth at the moment it is read, and `subscribe` is how a surface learns it changed.
 *
 * THE FOUR INPUTS, and the one decision each:
 *
 *   · POINTER. One pointer orbits (or pans, per `drag`); shift makes it pan while orbiting. Two
 *     pointers pinch, which is zoom and pan at once — the midpoint is the zoom anchor AND the
 *     pan handle, because a pinch that only zooms slides the scene out from under the fingers.
 *     Pointer capture is taken on down, so a drag that leaves the element keeps working.
 *   · WHEEL. Anchored at the pointer (`zoomAt`) using the element's own bounding box as the
 *     frame. It is a NATIVE listener, not the `onWheel` in `bind`: React registers `wheel` on
 *     its root as passive, so `preventDefault` from a React handler cannot stop the page
 *     scrolling behind the scene. `bind.ref` attaches it; `bind.onWheel` is the fallback for a
 *     surface that overrode the ref, and it hands over as soon as it has seen the element once.
 *   · KEYBOARD. Arrows orbit (pan with shift, or when `drag` is `"pan"`), `+`/`-` zoom about the
 *     centre, `Home` resets. `tabIndex: 0` is in `bind` because a camera nobody can reach from
 *     the keyboard is a camera half the readers do not have.
 *   · `flyTo`. The tool path and the click path. Duration from `flyToken` off the cascade (rule
 *     4: JS reads tokens and never types a millisecond), ease from `easeToken` through
 *     `cssEase`, both with the kit's documented defaults. Returns its own cancel, and a second
 *     `flyTo` cancels the first — a move in flight is abortable (rule 6).
 *
 * REDUCED MOTION is `"user"` by default: `flyTo` lands on the final state at frame zero and
 * inertia never starts. Not a faster animation — rule 8, in the one place that could have been
 * tempted to write `duration * 0.1`.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";

import {
  FLY_EASE,
  FLY_MS,
  ORBIT_SENSITIVITY,
  REST_POSE,
  ZERO_VELOCITY,
  clampPose,
  easeFromCss,
  isNegligible,
  lerpPose,
  mergePose,
  nearestSnap,
  orbitDelta,
  panDelta,
  samePose,
  stepInertia,
  zoomAt,
  type CameraBounds,
  type CameraPose,
  type CameraVelocity,
} from "./camera";
import { cssEase, cssMs } from "./tokens";

export interface CameraRigOptions {
  /** Where the camera starts. Default `REST_POSE`. Read once, at mount. */
  initial?: CameraPose;
  bounds: CameraBounds;
  /** What one pointer does. Default `"orbit"`; shift+drag pans while `drag` is `"orbit"`. */
  drag?: "orbit" | "pan" | "none";
  /** What the wheel does. Default `"zoom"`, anchored at the pointer. */
  wheel?: "zoom" | "pan" | "none";
  /** Fraction of the velocity retained per frame after a drag. Default `0.9`; `0` is none. */
  inertia?: number;
  /** Where the camera settles when the reader stops. A list, a function, or nothing. */
  snap?: readonly CameraPose[] | ((pose: CameraPose) => CameraPose) | null;
  /** Arrows orbit/pan, `+`/`-` zoom, `Home` resets. Default `true`. */
  keyboard?: boolean;
  /** `"user"` (the default) honours `prefers-reduced-motion`; `"never"` always animates. */
  reducedMotion?: "user" | "never";
  /** A `--*` duration token for `flyTo`, e.g. `"--tc-dur-5"`. Default `FLY_MS` (420 ms). */
  flyToken?: string;
  /**
   * A `--*` easing token for `flyTo`. Default `FLY_EASE`.
   *
   * NOT IN THE CONTRACT — added because the contract asks for "an ease from `cssEase` or a
   * default" and gives no token to read it from, and a surface whose fly used a different curve
   * from its CSS would break rule 4 in the one hook written to keep it.
   */
  easeToken?: string;
  /** Radians per pixel of drag. Default `ORBIT_SENSITIVITY` (0.005). */
  sensitivity?: number;
}

/** Spread on the scene's root element. */
export interface CameraBind {
  /**
   * Attaches the non-passive `wheel` listener and remembers the element the tokens and the
   * bounding box are read from. NOT IN THE CONTRACT; see the note at the top of the file.
   * Spread `bind` AFTER your own `ref` if you need one, or the rig loses its element (it will
   * then recover from the first pointer or wheel event, one tick late).
   */
  ref: (el: HTMLElement | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onWheel: (event: ReactWheelEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  tabIndex: 0;
  style: { touchAction: "none" };
  "data-camera": "rig";
}

export interface CameraRig {
  /** The live pose. Does not render. */
  get(): CameraPose;
  /** Immediate and clamped. Cancels a fly in progress. */
  set(pose: Partial<CameraPose>): void;
  /** Animate there. Returns a cancel; a second `flyTo` cancels the first. */
  flyTo(pose: Partial<CameraPose>, opts?: { ms?: number; onDone?: () => void }): () => void;
  /** Fly back to `initial`. What `Home` does. */
  reset(): void;
  /**
   * Called on every pose change and on every change of `moving`, and ONCE immediately with the
   * current pose, so a DOM stage is one line:
   *
   *     useEffect(() => rig.subscribe((p) => { el.style.transform = poseToTransform(p); }), [rig]);
   */
  subscribe(cb: (pose: CameraPose, moving: boolean) => void): () => void;
  /** True during a drag, inertia or a fly. A getter: always current when read. */
  readonly moving: boolean;
  bind: CameraBind;
}

/** Zoom per pixel of wheel travel, through `exp` so up and down are exact inverses. */
export const WHEEL_SENSITIVITY = 0.0015;
/** Radians per arrow press. */
export const KEY_ORBIT = 0.08;
/** Screen pixels per arrow press when the arrows pan. */
export const KEY_PAN = 32;
/** Zoom per `+` / `-`. */
export const KEY_ZOOM = 1.15;
/**
 * How long after the last input the camera is considered idle, and therefore snaps.
 *
 * Not a level-change clock and deliberately not a token: it is the length of a PAUSE, the gap
 * between two flicks of a trackpad, and a surface that tuned it per design would have snaps
 * arriving at different moments on two pages of the same app.
 */
export const SNAP_IDLE_MS = 180;

/** Lines and pages of wheel delta, in pixels. */
const DELTA_SCALE = [1, 16, 400] as const;

const noop = () => {};

interface Pt {
  x: number;
  y: number;
}

export function useCameraRig(options: CameraRigOptions): CameraRig {
  /* Options are read from a ref at event time, never captured in a handler's closure: a surface
     whose bounds change with the level (which is most of them) must not have to re-bind. */
  const opts = useRef(options);
  opts.current = options;

  const initial = useRef<CameraPose>(clampPose(options.initial ?? REST_POSE, options.bounds));
  const pose = useRef<CameraPose>(initial.current);
  const velocity = useRef<CameraVelocity>(ZERO_VELOCITY);
  const moving = useRef(false);
  const subs = useRef(new Set<(pose: CameraPose, moving: boolean) => void>());

  const el = useRef<HTMLElement | null>(null);
  const wheelBound = useRef<HTMLElement | null>(null);

  const pointers = useRef(new Map<number, Pt>());
  const last = useRef<Pt>({ x: 0, y: 0 });
  const lastAt = useRef(0);
  const pinch = useRef<{ dist: number; mid: Pt } | null>(null);

  const raf = useRef(0);
  const fly = useRef<(() => void) | null>(null);
  const idle = useRef(0);

  /* ------------------------------------------------------------------ the pose and who hears it */

  const emit = useCallback(() => {
    for (const cb of subs.current) cb(pose.current, moving.current);
  }, []);

  const apply = useCallback(
    (next: CameraPose) => {
      const clamped = clampPose(next, opts.current.bounds);
      pose.current = clamped;
      emit();
    },
    [emit],
  );

  const setMoving = useCallback(
    (next: boolean) => {
      if (moving.current === next) return;
      moving.current = next;
      emit();
    },
    [emit],
  );

  const reduced = useCallback((): boolean => {
    if (opts.current.reducedMotion === "never") return false;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const frame = useCallback((): { w: number; h: number; left: number; top: number } => {
    const box = el.current?.getBoundingClientRect();
    return box
      ? { w: box.width, h: box.height, left: box.left, top: box.top }
      : { w: 0, h: 0, left: 0, top: 0 };
  }, []);

  /* --------------------------------------------------------------------------- inertia and snap */

  const stopInertia = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    velocity.current = ZERO_VELOCITY;
  }, []);

  const clearIdle = useCallback(() => {
    if (idle.current) window.clearTimeout(idle.current);
    idle.current = 0;
  }, []);

  /* `snap` is resolved, not called, until the camera is actually still: a snap that fires while
     the reader is still moving is the camera arguing with them. */
  const snapNow = useRef<() => void>(noop);

  const scheduleIdle = useCallback(() => {
    clearIdle();
    if (!opts.current.snap) return;
    idle.current = window.setTimeout(() => {
      idle.current = 0;
      snapNow.current();
    }, SNAP_IDLE_MS);
  }, [clearIdle]);

  const coast = useCallback(() => {
    const retain = opts.current.inertia ?? 0.9;
    if (retain <= 0 || reduced() || isNegligible(velocity.current)) {
      stopInertia();
      setMoving(false);
      scheduleIdle();
      return;
    }
    let previous = typeof performance === "undefined" ? Date.now() : performance.now();
    setMoving(true);
    const tick = (now: number) => {
      const dt = Math.min(64, now - previous);
      previous = now;
      const stepped = stepInertia(pose.current, velocity.current, opts.current.inertia ?? 0.9, dt);
      velocity.current = stepped.velocity;
      const before = pose.current;
      apply(stepped.pose);
      // A pose that did not move because it is against a bound has nothing left to coast on.
      if (isNegligible(velocity.current) || samePose(before, pose.current)) {
        stopInertia();
        setMoving(false);
        scheduleIdle();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [apply, reduced, scheduleIdle, setMoving, stopInertia]);

  /* ------------------------------------------------------------------------------------- flyTo */

  const flyTo = useCallback(
    (patch: Partial<CameraPose>, o?: { ms?: number; onDone?: () => void }): (() => void) => {
      fly.current?.();
      stopInertia();
      clearIdle();

      const from = pose.current;
      const to = clampPose(mergePose(from, patch), opts.current.bounds);
      const { flyToken, easeToken } = opts.current;
      const ms = o?.ms ?? (flyToken ? cssMs(flyToken, el.current, FLY_MS) : FLY_MS);

      if (reduced() || ms <= 0 || samePose(from, to)) {
        apply(to);
        setMoving(false);
        o?.onDone?.();
        return noop;
      }

      const ease = easeFromCss(easeToken ? cssEase(easeToken, el.current, FLY_EASE) : FLY_EASE);
      const start = typeof performance === "undefined" ? Date.now() : performance.now();
      let id = 0;
      let done = false;

      const cancel = () => {
        if (done) return;
        done = true;
        if (id) cancelAnimationFrame(id);
        if (fly.current === cancel) fly.current = null;
        setMoving(false);
      };

      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        apply(lerpPose(from, to, ease(t)));
        if (t < 1) {
          id = requestAnimationFrame(tick);
          return;
        }
        done = true;
        if (fly.current === cancel) fly.current = null;
        setMoving(false);
        o?.onDone?.();
      };

      fly.current = cancel;
      setMoving(true);
      id = requestAnimationFrame(tick);
      return cancel;
    },
    [apply, clearIdle, reduced, setMoving, stopInertia],
  );

  /* The snap, now that `flyTo` exists. A ref because the idle timer is scheduled from handlers
     that must not be re-created every time the options change. */
  snapNow.current = () => {
    const { snap } = opts.current;
    if (!snap) return;
    const target = typeof snap === "function" ? snap(pose.current) : nearestSnap(pose.current, snap);
    if (!target || samePose(pose.current, target)) return;
    flyTo(target);
  };

  /* ------------------------------------------------------------------------------------- input */

  const zoomBy = useCallback(
    (factor: number, anchor: Pt) => {
      const box = frame();
      apply(zoomAt(pose.current, factor, { x: anchor.x - box.left, y: anchor.y - box.top }, box));
    },
    [apply, frame],
  );

  const dragBy = useCallback(
    (dx: number, dy: number, pan: boolean, dt: number) => {
      const s = opts.current.sensitivity ?? ORBIT_SENSITIVITY;
      if (pan) {
        const d = panDelta(dx, dy, pose.current.zoom);
        apply({ ...pose.current, pan: { x: pose.current.pan.x + d.x, y: pose.current.pan.y + d.y } });
        const per = dt > 0 ? dt : 1;
        velocity.current = { ...ZERO_VELOCITY, pan: { x: d.x / per, y: d.y / per } };
        return;
      }
      const d = orbitDelta(dx, dy, s);
      apply({ ...pose.current, yaw: pose.current.yaw + d.yaw, pitch: pose.current.pitch + d.pitch });
      const per = dt > 0 ? dt : 1;
      velocity.current = { ...ZERO_VELOCITY, yaw: d.yaw / per, pitch: d.pitch / per };
    },
    [apply],
  );

  const onWheelDelta = useCallback(
    (deltaX: number, deltaY: number, deltaMode: number, at: Pt) => {
      const mode = opts.current.wheel ?? "zoom";
      if (mode === "none") return;
      const scale = DELTA_SCALE[deltaMode] ?? 1;
      stopInertia();
      fly.current?.();
      if (mode === "pan") {
        const d = panDelta(-deltaX * scale, -deltaY * scale, pose.current.zoom);
        apply({ ...pose.current, pan: { x: pose.current.pan.x + d.x, y: pose.current.pan.y + d.y } });
      } else {
        zoomBy(Math.exp(-deltaY * scale * WHEEL_SENSITIVITY), at);
      }
      scheduleIdle();
    },
    [apply, scheduleIdle, stopInertia, zoomBy],
  );

  /* The non-passive listener. React's own `wheel` is registered passive on its root, so a
     `preventDefault` from `bind.onWheel` cannot stop the page scrolling behind the scene. */
  const nativeWheel = useRef((event: WheelEvent) => {
    event.preventDefault();
    wheelDelta.current(event.deltaX, event.deltaY, event.deltaMode, {
      x: event.clientX,
      y: event.clientY,
    });
  });
  const wheelDelta = useRef(onWheelDelta);
  wheelDelta.current = onWheelDelta;

  const attach = useCallback((node: HTMLElement | null) => {
    if (wheelBound.current === node) return;
    if (wheelBound.current) wheelBound.current.removeEventListener("wheel", nativeWheel.current);
    wheelBound.current = node;
    if (node) node.addEventListener("wheel", nativeWheel.current, { passive: false });
  }, []);

  const see = useCallback(
    (node: HTMLElement | null) => {
      el.current = node;
      attach(node);
    },
    [attach],
  );

  useEffect(() => () => {
    if (wheelBound.current) wheelBound.current.removeEventListener("wheel", nativeWheel.current);
    if (raf.current) cancelAnimationFrame(raf.current);
    if (idle.current) window.clearTimeout(idle.current);
    fly.current?.();
  }, []);

  const bind = useMemo<CameraBind>(() => {
    const two = (): [Pt, Pt] | null => {
      const all = [...pointers.current.values()];
      return all.length >= 2 && all[0] && all[1] ? [all[0], all[1]] : null;
    };
    const measure = (pair: [Pt, Pt]) => ({
      dist: Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y),
      mid: { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 },
    });

    return {
      ref: see,
      tabIndex: 0,
      style: { touchAction: "none" },
      "data-camera": "rig",

      onPointerDown: (event) => {
        see(event.currentTarget);
        if ((opts.current.drag ?? "orbit") === "none" && pointers.current.size === 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        stopInertia();
        fly.current?.();
        clearIdle();
        last.current = { x: event.clientX, y: event.clientY };
        lastAt.current = event.timeStamp;
        const pair = two();
        pinch.current = pair ? measure(pair) : null;
        setMoving(true);
      },

      onPointerMove: (event) => {
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        const pair = two();
        if (pair) {
          /* Two pointers: zoom AND pan, from the same midpoint. A pinch that only zoomed would
             slide the scene out from under the fingers holding it. */
          const now = measure(pair);
          const base = pinch.current ?? now;
          if (base.dist > 0 && now.dist > 0) zoomBy(now.dist / base.dist, now.mid);
          const d = panDelta(now.mid.x - base.mid.x, now.mid.y - base.mid.y, pose.current.zoom);
          apply({
            ...pose.current,
            pan: { x: pose.current.pan.x + d.x, y: pose.current.pan.y + d.y },
          });
          pinch.current = now;
          velocity.current = ZERO_VELOCITY;
          last.current = { ...now.mid };
          lastAt.current = event.timeStamp;
          return;
        }

        const mode = opts.current.drag ?? "orbit";
        if (mode === "none") return;
        const dx = event.clientX - last.current.x;
        const dy = event.clientY - last.current.y;
        const dt = event.timeStamp - lastAt.current;
        last.current = { x: event.clientX, y: event.clientY };
        lastAt.current = event.timeStamp;
        dragBy(dx, dy, mode === "pan" || event.shiftKey, dt);
      },

      onPointerUp: (event) => {
        if (!pointers.current.has(event.pointerId)) return;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        pointers.current.delete(event.pointerId);
        const rest = [...pointers.current.values()][0];
        if (rest) {
          /* One finger lifted out of a pinch: the other one keeps dragging, from where it is —
             not from where the midpoint was, which would jump the scene. */
          pinch.current = null;
          last.current = { ...rest };
          lastAt.current = event.timeStamp;
          velocity.current = ZERO_VELOCITY;
          return;
        }
        pinch.current = null;
        coast();
      },

      onPointerCancel: (event) => {
        pointers.current.delete(event.pointerId);
        if (pointers.current.size === 0) {
          pinch.current = null;
          velocity.current = ZERO_VELOCITY;
          setMoving(false);
          scheduleIdle();
        }
      },

      onWheel: (event) => {
        // The native listener already handled this one; see the note above `nativeWheel`.
        if (wheelBound.current) return;
        see(event.currentTarget);
        wheelDelta.current(event.deltaX, event.deltaY, event.deltaMode, {
          x: event.clientX,
          y: event.clientY,
        });
      },

      onKeyDown: (event) => {
        if (opts.current.keyboard === false) return;
        see(event.currentTarget);
        const box = frame();
        const centre = { x: box.left + box.w / 2, y: box.top + box.h / 2 };
        const panning = (opts.current.drag ?? "orbit") === "pan" || event.shiftKey;
        const step = (dx: number, dy: number) => {
          stopInertia();
          fly.current?.();
          if (panning) {
            const d = panDelta(dx * KEY_PAN, dy * KEY_PAN, pose.current.zoom);
            apply({
              ...pose.current,
              pan: { x: pose.current.pan.x + d.x, y: pose.current.pan.y + d.y },
            });
          } else {
            /* One press is `KEY_ORBIT` radians, whatever the drag sensitivity is: a key is a
               fixed step and a drag is a ratio, and tying the two makes a surface that orbits
               slowly under the mouse unreachable from the keyboard. */
            const d = orbitDelta(dx, dy, KEY_ORBIT);
            apply({
              ...pose.current,
              yaw: pose.current.yaw + d.yaw,
              pitch: pose.current.pitch + d.pitch,
            });
          }
          scheduleIdle();
        };

        switch (event.key) {
          case "ArrowLeft":
            step(-1, 0);
            break;
          case "ArrowRight":
            step(1, 0);
            break;
          case "ArrowUp":
            step(0, -1);
            break;
          case "ArrowDown":
            step(0, 1);
            break;
          case "+":
          case "=":
            stopInertia();
            zoomBy(KEY_ZOOM, centre);
            scheduleIdle();
            break;
          case "-":
          case "_":
            stopInertia();
            zoomBy(1 / KEY_ZOOM, centre);
            scheduleIdle();
            break;
          case "Home":
            flyTo(initial.current);
            break;
          default:
            return;
        }
        event.preventDefault();
      },
    };
  }, [apply, clearIdle, coast, dragBy, flyTo, frame, scheduleIdle, see, setMoving, stopInertia, zoomBy]);

  return useMemo<CameraRig>(() => {
    const rig: CameraRig = {
      get: () => pose.current,
      set: (patch) => {
        fly.current?.();
        stopInertia();
        apply(mergePose(pose.current, patch));
      },
      flyTo,
      reset: () => {
        flyTo(initial.current);
      },
      subscribe: (cb) => {
        subs.current.add(cb);
        cb(pose.current, moving.current);
        return () => {
          subs.current.delete(cb);
        };
      },
      get moving() {
        return moving.current;
      },
      bind,
    };
    return rig;
  }, [apply, bind, flyTo, stopInertia]);
}
