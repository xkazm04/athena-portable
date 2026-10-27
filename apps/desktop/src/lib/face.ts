/**
 * The face signal across windows (ADR on Athena's face; ADR 0026, 0027, 0092).
 *
 * The athena window owns her voice, so it produces the `FaceSignal` (`lib/face-signal.ts`) and
 * calls `athenaFace` (the Rust command `athena_face`, at most 40 times a second while she listens
 * or speaks, once on every phase change otherwise); Rust re-emits it to Main as the `athena:face`
 * event. Main surfaces read it through `mainFaceSource()`. Her own window reads the producer
 * directly through `localFaceSource()`, every frame, without the cap. A preview played inside
 * Main (the voice studio, Adopt) drives a face of its own through `previewFaceSource(player)`.
 *
 * Every source hands a new subscriber the last signal it has, so a face mounted mid-sentence does
 * not wait for the next frame to stop looking at rest.
 */
import { VISEMES, type FacePhase, type FaceSignal, type FaceSource } from "@/avatar/types";
import { call, hasShell, on, type Wire } from "@/lib/ipc";
import { frames } from "@/lib/motion";

/** The Tauri event Main receives. */
export const FACE_EVENT = "athena:face";

/**
 * The most frames the athena window mirrors in any second (ADR 0027, amended 2026-10-25: the face
 * mirror's own cap, above the halo's 30 Hz, so every mouth shape change can go at once).
 */
export const FACE_MIRROR_HZ = 40;

/** The Rust command behind `athenaFace`. */
export const FACE_COMMAND = "athena_face";

// -- the shape ---------------------------------------------------------------------------------

const PHASES: readonly FacePhase[] = ["idle", "listening", "thinking", "speaking", "gate"];
const VISEME_SET = new Set<string>(VISEMES);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const MOTION_KEYS = ["yaw", "pitch", "roll", "blink", "gazeX", "gazeY"] as const;

/** Is `value` a whole `FaceSignal`? What Main checks before handing an event to a face. */
export function isFaceSignal(value: unknown): value is FaceSignal {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.phase !== "string" || !PHASES.includes(v.phase as FacePhase)) return false;
  if (!finite(v.level) || !finite(v.open)) return false;
  if (!(v.viseme === null || (typeof v.viseme === "string" && VISEME_SET.has(v.viseme)))) return false;
  if (!finite(v.generation) || !Number.isInteger(v.generation)) return false;
  if (v.motion === null) return true;
  if (typeof v.motion !== "object" || v.motion === undefined) return false;
  const m = v.motion as Record<string, unknown>;
  // Every channel present: a number, or `null` for one the track does not drive (no say).
  return MOTION_KEYS.every((k) => m[k] === null || finite(m[k]));
}

/** The signal spelled as `Wire`: every key present, `null` for nothing (`lib/ipc.ts`, rule 1). */
export function wireOfFace(signal: FaceSignal): Wire {
  const { motion } = signal;
  return {
    phase: signal.phase,
    level: signal.level,
    viseme: signal.viseme,
    open: signal.open,
    motion: motion
      ? {
          yaw: motion.yaw,
          pitch: motion.pitch,
          roll: motion.roll,
          blink: motion.blink,
          gazeX: motion.gazeX,
          gazeY: motion.gazeY,
        }
      : null,
    generation: signal.generation,
  };
}

// -- a fan-out ---------------------------------------------------------------------------------

/** Listeners and the last signal, so a late subscriber starts from it. Shared with `lib/face-preview.ts`. */
export function hub() {
  const listeners = new Set<(signal: FaceSignal) => void>();
  let last: FaceSignal | null = null;
  return {
    listeners,
    publish(signal: FaceSignal) {
      last = signal;
      for (const f of [...listeners]) f(signal);
    },
    add(f: (signal: FaceSignal) => void) {
      listeners.add(f);
      if (last) f(last);
      return () => void listeners.delete(f);
    },
    reset() {
      listeners.clear();
      last = null;
    },
  };
}

// -- the athena window -------------------------------------------------------------------------

let mirrorFailures = 0;
let mirrorFailing = false;

/**
 * Mirror one signal to Main (athena window only). Never throws: a refusal is counted and said once
 * per run of failures, because a shell from before the command refuses every frame at 40 Hz.
 * Without a shell there is no Main to mirror to and nothing is called.
 */
export async function athenaFace(signal: FaceSignal): Promise<void> {
  if (!hasShell()) return;
  try {
    await call<void>(FACE_COMMAND, { signal: wireOfFace(signal) });
    mirrorFailing = false;
  } catch (error) {
    mirrorFailures += 1;
    if (!mirrorFailing) console.error(`[athena] ${FACE_COMMAND}: ${String(error)}`);
    mirrorFailing = true;
  }
}

/** How many mirrored frames the shell refused since the window started. */
export function faceMirrorFailures(): number {
  return mirrorFailures;
}

const local = hub();

/** The producer's way in to `localFaceSource` (`lib/face-signal.ts` alone calls it). */
export function publishLocalFace(signal: FaceSignal): void {
  local.publish(signal);
}

/**
 * The athena window's own view of her face: the producer's signals, every frame, without the
 * 40 Hz cap (her companion window draws from this, not from the mirror).
 */
export function localFaceSource(): FaceSource {
  return { subscribe: (listener) => local.add(listener) };
}

// -- Main --------------------------------------------------------------------------------------

/** How Main listens: `on(FACE_EVENT)` in the shell. Returns its unlisten. */
export type FaceListen = (f: (payload: unknown) => void) => Promise<() => void>;

/**
 * A source fed by `listen`, listening only while someone subscribes. A payload that is not a whole
 * `FaceSignal` is dropped and never reaches a face: the event is a cross-window wire, and a face
 * that drew a malformed frame would be drawing a guess.
 */
export function createMainFaceSource(listen: FaceListen): FaceSource {
  const fan = hub();
  let unlisten: Promise<() => void> | null = null;
  const receive = (payload: unknown) => {
    if (isFaceSignal(payload)) fan.publish(payload);
  };
  return {
    subscribe(listener) {
      const off = fan.add(listener);
      unlisten ??= listen(receive).catch((error: unknown) => {
        console.error(`[athena] ${FACE_EVENT}: ${String(error)}`);
        return () => {};
      });
      return () => {
        off();
        if (fan.listeners.size === 0 && unlisten) {
          void unlisten.then((f) => f());
          unlisten = null;
        }
      };
    },
  };
}

let main: FaceSource | null = null;

/** Main's view of her face, fed by `athena:face`. One listener for every face in the window. */
export function mainFaceSource(): FaceSource {
  main ??= createMainFaceSource((f) => (hasShell() ? on<unknown>(FACE_EVENT, f) : Promise.resolve(() => {})));
  return main;
}

// -- a preview in Main -------------------------------------------------------------------------

/**
 * A face driven by a preview played inside Main (the voice studio, Adopt): `level` is polled from
 * the preview player's analyser while it plays, the phase is `speaking` while it plays and `idle`
 * otherwise. No visemes or motion in v1.
 */
export function previewFaceSource(player: { level(): number; playing(): boolean }): FaceSource {
  // The implementation is its own chunk: only the voice studio and Adopt play a preview, and Main's
  // first paint should not carry it (docs/redesign/fathom.md section 5).
  let made: Promise<FaceSource> | null = null;
  return {
    subscribe(listener) {
      made ??= import("@/lib/face-preview").then((preview) =>
        preview.createPreviewFaceSource(player, (fn) => frames().subscribe(fn)),
      );
      let off: (() => void) | null = null;
      let gone = false;
      void made.then((source) => {
        if (!gone) off = source.subscribe(listener);
      });
      return () => {
        gone = true;
        off?.();
      };
    },
  };
}

/** Test seam: forget the local fan-out, Main's listener and the failure count. */
export function resetFaceForTests(): void {
  local.reset();
  main = null;
  mirrorFailures = 0;
  mirrorFailing = false;
}
