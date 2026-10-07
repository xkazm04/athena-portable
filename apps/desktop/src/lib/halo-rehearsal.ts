/**
 * The halo's rehearsal — ADR 0027 (Athena is ambient), README section 3.1; decision 6.
 *
 * A development build with no voice backend still has a halo to tune. Holding the summon chord
 * runs the real microphone (its level, through `lib/voice.ts`, exactly as a real turn would) and,
 * on release, a scripted reply: thinking for {@link THINK_MS}, then speaking for
 * {@link SPEAK_MS} with a speech-shaped level and a caption that says what this is, then rest.
 *
 * It is not a second halo. It drives the one producer (`lib/halo.ts`) through its override slot,
 * so what is tuned here is what a real turn shows. Production never builds one: there, a held
 * chord with no backend shows her window instead (`lib/companion.ts`, `pttHandler`).
 */
import type { HaloOverride } from "@/lib/halo";
import type { MicrophoneSession } from "@/lib/voice";

export const THINK_MS = 1200;
export const SPEAK_MS = 3500;

export const REHEARSAL_CAPTION = "Rehearsal — no voice backend is connected, so this is the halo on its own.";

/**
 * A speech-like level at `t` ms into a line of `duration` ms, 0..1. Pure.
 *
 * Syllables at about 4.5 Hz, a slow phrase swell, a breath of silence every 1.1 s, and a 120 ms
 * fade at each end so the bloom neither snaps on nor off. It only has to read as a voice to the
 * eye; it is never heard.
 */
export function speechEnvelope(t: number, duration: number = SPEAK_MS): number {
  if (!(t > 0) || t >= duration) return 0;
  const s = t / 1000;
  // A breath: the last 180 ms of every 1.1 s phrase is quiet.
  if (t % 1100 > 920) return 0;
  const syllable = 0.5 * (1 - Math.cos(2 * Math.PI * 4.5 * s));
  const swell = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.35 * s + 1);
  const fade = Math.min(1, t / 120, (duration - t) / 120);
  const level = (0.15 + 0.85 * syllable) * swell * fade;
  return Math.max(0, Math.min(1, level));
}

export interface RehearsalDeps {
  /** The override slot of the one producer. */
  drive: (override: HaloOverride | null) => void;
  /** Open the microphone for its level only; `null` where the webview offers none. */
  openMic: (() => Promise<MicrophoneSession>) | null;
  now: () => number;
  setTimeout: (f: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface Rehearsal {
  down: () => void;
  up: () => void;
  /** Stop everything and give the halo back to the stores. */
  dispose: () => void;
}

export function createRehearsal(deps: RehearsalDeps): Rehearsal {
  let mic: MicrophoneSession | null = null;
  /** Bumped by every press, so a microphone that opens after its release is closed at once. */
  let press = 0;
  let held = false;
  let timers: unknown[] = [];

  const cancel = () => {
    timers.forEach((t) => deps.clearTimeout(t));
    timers = [];
  };
  const closeMic = () => {
    mic?.stop();
    mic = null;
  };
  const at = (ms: number, f: () => void) => timers.push(deps.setTimeout(f, ms));

  return {
    down() {
      if (held) return;
      held = true;
      cancel();
      closeMic();
      const mine = ++press;
      deps.drive({ phase: "listening", caption: null });
      if (deps.openMic === null) return;
      deps.openMic().then(
        (session) => {
          if (mine === press && held) mic = session;
          else session.stop();
        },
        (error: unknown) => console.error(`[athena] rehearsal microphone: ${String(error)}`),
      );
    },
    up() {
      if (!held) return;
      held = false;
      closeMic();
      deps.drive({ phase: "thinking", caption: null });
      at(THINK_MS, () => {
        const from = deps.now();
        deps.drive({
          phase: "speaking",
          caption: { who: "athena", text: REHEARSAL_CAPTION },
          level: () => speechEnvelope(deps.now() - from),
        });
        at(SPEAK_MS, () => {
          timers = [];
          deps.drive(null);
        });
      });
    },
    dispose() {
      held = false;
      press += 1;
      cancel();
      closeMic();
      deps.drive(null);
    },
  };
}
