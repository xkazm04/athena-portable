/**
 * The halo's one producer — ADR 0027 (Athena is ambient), README section 3.1.
 *
 * The `athena` window owns the voice and the run (ADR 0026), so it is the only place that knows
 * what the edges of the screen should show. This file reduces those two stores, and an optional
 * *override* (the development rehearsal, `lib/halo-rehearsal.ts`), to one `HaloSignal` and hands
 * it to Rust with `athena_halo`. It renders nothing and the overlays hold nothing: the signal is
 * the whole conversation.
 *
 * Two kinds of frame, one wire:
 *
 * - **a change** — the phase, the cards waiting or the caption — is sent the moment a store says
 *   so, because a halo that lags the key by a frame reads as a halo that did not hear;
 * - **a level frame** is polled from `lib/voice.ts`'s `currentLevel` at most 30 times a second,
 *   and only while she is listening or speaking. The loop stops the moment she is not, so rest
 *   costs no timer at all.
 *
 * Every frame identical to the last one sent is dropped, so a silent microphone sends nothing.
 * The level never goes into a store: 30 re-renders a second of a window that shows nothing of it
 * would be the cost of putting it there.
 */
import { create } from "zustand";

import {
  HALO_COMMAND,
  haloPhase,
  type HaloCaption,
  type HaloPhase,
  type HaloSignal,
} from "@/lib/halo-signal";
import { call, hasShell, type Wire } from "@/lib/ipc";
import { currentLevel } from "@/lib/voice";
import { useRun, type RunPhase } from "@/stores/run";
import { useVoice, type VoicePhase } from "@/stores/voice";

/** The level frame period: 34 ms is 29.4 frames a second, under ADR 0027's cap of 30. */
export const LEVEL_FRAME_MS = 34;

/** What the producer reads from the stores. Everything but the level. */
export interface HaloInputs {
  voice: VoicePhase;
  run: RunPhase;
  cards: number;
  /** The live partial transcript while the key is held. */
  partial: string;
  /** The line she is speaking. */
  speakingText: string;
  /** The last final transcript, until she answers. */
  heard: string;
}

/**
 * Another source of phase, level and caption that wins over the stores while it is set — the
 * rehearsal. The cards still come from the run store: a decision is never hidden by a rehearsal.
 */
export interface HaloOverride {
  phase: Exclude<HaloPhase, "gate">;
  caption: HaloCaption | null;
  /** The level to poll; omitted, `currentLevel` (the real microphone or player). */
  level?: () => number;
}

/** The one override slot. Not rendered by anything; a store only so the producer can subscribe. */
export const useHaloOverride = create<{ override: HaloOverride | null }>(() => ({ override: null }));

export function setHaloOverride(override: HaloOverride | null): void {
  useHaloOverride.setState({ override });
}

/** Does this phase carry a level, and so a level loop? */
export function levelled(phase: HaloPhase): boolean {
  return phase === "listening" || phase === "speaking";
}

/**
 * The caption, from the stores. Listening shows what she has heard so far, speaking shows what she
 * says, and the pause after a final transcript keeps the person's own words up until she answers.
 */
export function captionOf(phase: HaloPhase, inputs: HaloInputs): HaloCaption | null {
  if (phase === "listening") return inputs.partial.trim() ? { who: "you", text: inputs.partial } : null;
  if (phase === "speaking") return inputs.speakingText ? { who: "athena", text: inputs.speakingText } : null;
  // `voice` thinking is the pause after a release; a typed turn's thinking has no words to show.
  if (phase === "thinking" && inputs.voice === "thinking" && inputs.heard) return { who: "you", text: inputs.heard };
  return null;
}

/** One frame, pure: the stores, the override and a level in; the signal out. */
export function signalOf(inputs: HaloInputs, override: HaloOverride | null, level: number): HaloSignal {
  const phase = override?.phase ?? haloPhase(inputs.voice, inputs.run, inputs.cards);
  const caption = override ? override.caption : captionOf(phase, inputs);
  // Two decimals: the edge cannot show a finer step, and a coarser number dedupes more frames.
  const clamped = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  return {
    phase,
    level: levelled(phase) ? Math.round(clamped * 100) / 100 : 0,
    cards: inputs.cards,
    caption,
  };
}

/** The signal spelled as `Wire`: every key present, `null` for nothing (`lib/ipc.ts`, rule 1). */
export function wireOf(signal: HaloSignal): Wire {
  const { caption } = signal;
  return {
    phase: signal.phase,
    level: signal.level,
    cards: signal.cards,
    caption: caption ? { who: caption.who, text: caption.text } : null,
  };
}

export interface HaloDeps {
  /** Is there a shell to send to? Without one the producer does nothing at all. */
  shell: () => boolean;
  /** The command; resolves or rejects as `call` does. */
  invoke: (signal: HaloSignal) => Promise<unknown>;
  inputs: () => HaloInputs;
  override: () => HaloOverride | null;
  /** Called on every store change that might change a frame. Returns its unsubscribe. */
  subscribe: (onChange: () => void) => () => void;
  level: () => number;
  /** A repeating timer. Returns its cancel. */
  every: (ms: number, f: () => void) => () => void;
}

/** The production wiring: the voice and run stores, the override slot and `lib/ipc.ts`. */
export function liveHaloDeps(): HaloDeps {
  return {
    shell: hasShell,
    invoke: (signal) => call<void>(HALO_COMMAND, { signal: wireOf(signal) }),
    inputs: () => {
      const voice = useVoice.getState();
      const run = useRun.getState();
      return {
        voice: voice.phase,
        run: run.phase,
        cards: run.cards.length,
        partial: voice.partial,
        speakingText: voice.speakingText,
        heard: voice.heard,
      };
    },
    override: () => useHaloOverride.getState().override,
    subscribe: (onChange) => {
      const off = [useVoice.subscribe(onChange), useRun.subscribe(onChange), useHaloOverride.subscribe(onChange)];
      return () => off.forEach((f) => f());
    },
    level: currentLevel,
    every: (ms, f) => {
      const timer = setInterval(f, ms);
      return () => clearInterval(timer);
    },
  };
}

let stopActive: (() => void) | null = null;

/**
 * Started by the `athena` window's root and nothing else (ADR 0026, "Who runs which store").
 * Idempotent while running; returns the stop, which the root's cleanup calls.
 */
export function startHalo(deps: HaloDeps = liveHaloDeps()): () => void {
  if (stopActive) return stopActive;
  if (!deps.shell()) return () => {};

  let last = "";
  let failing = false;
  let stopLoop: (() => void) | null = null;

  const emit = () => {
    const override = deps.override();
    const inputs = deps.inputs();
    const phase = override?.phase ?? haloPhase(inputs.voice, inputs.run, inputs.cards);
    const level = levelled(phase) ? (override?.level ?? deps.level)() : 0;
    const signal = signalOf(inputs, override, level);
    const key = JSON.stringify(signal);
    if (key !== last) {
      last = key;
      deps.invoke(signal).then(
        () => {
          failing = false;
        },
        (error: unknown) => {
          // Once per run of failures: a refused command at 30 Hz would bury every other line.
          if (!failing) console.error(`[athena] ${HALO_COMMAND}: ${String(error)}`);
          failing = true;
        },
      );
    }
    if (levelled(signal.phase) && stopLoop === null) {
      stopLoop = deps.every(LEVEL_FRAME_MS, emit);
    } else if (!levelled(signal.phase) && stopLoop !== null) {
      stopLoop();
      stopLoop = null;
    }
  };

  const unsubscribe = deps.subscribe(emit);
  emit();

  const stop = () => {
    unsubscribe();
    stopLoop?.();
    stopLoop = null;
    if (stopActive === stop) stopActive = null;
  };
  stopActive = stop;
  return stop;
}
