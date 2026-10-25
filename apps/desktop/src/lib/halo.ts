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
 * Her phase is `createPresence`'s, the one reducer her face reads too: synthesis runs ahead of
 * playback, so `voice.stopped` can land while the end of her line is still sounding, and the edges
 * stay on `speaking`, following her real level, until the player has played its last sample.
 *
 * A turn the person started that ends without an answer (an utterance too short, silent or
 * wordless; a turn error; the voice socket closing; a run that fails) shows `trouble` for
 * `TROUBLE_MS`: a still amber edge with her plain reason as the caption, because with her window
 * put away the halo is the only surface on screen (ADR 0027, amendment 2026-10-25). The reason is
 * always a sentence of hers (`troubleLine`), never the raw detail, which can carry a URL or a key.
 *
 * Every frame identical to the last one sent is dropped, so a silent microphone sends nothing.
 * The level never goes into a store: 30 re-renders a second of a window that shows nothing of it
 * would be the cost of putting it there.
 */
import { create } from "zustand";

import { plainFailure } from "@/companion/plain";
import { engineLabel } from "@/lib/engines";
import {
  HALO_COMMAND,
  haloPhase,
  type HaloCaption,
  type HaloPhase,
  type HaloSignal,
  type StorePhase,
} from "@/lib/halo-signal";
import { call, hasShell, type Wire } from "@/lib/ipc";
import { currentLevel, playbackSounding } from "@/lib/voice";
import { useRun, type RunFailure, type RunPhase } from "@/stores/run";
import { useSettings } from "@/stores/settings";
import { useVoice, type VoicePhase } from "@/stores/voice";

/** The level frame period: 34 ms is 29.4 frames a second, under ADR 0027's cap of 30. */
export const LEVEL_FRAME_MS = 34;

/** How long a failed turn's amber edge and reason stay before the halo returns to the stores. */
export const TROUBLE_MS = 2500;

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
  /** The line playing, as the voice store says (`null` once its `voice.stopped` arrived). */
  generation?: number | null;
  /** The voice store's reason: an ended utterance's sentence, or why a turn failed. */
  voiceReason?: string;
  /** Why the last run stopped, or `null`. */
  runError?: RunFailure | null;
  /** The engine's name for a person ("Claude Code"), for `plainFailure`. */
  engine?: string;
}

/** What her presence reads: the store phases and the line the voice store says is playing. */
export type PresenceInputs = Pick<HaloInputs, "voice" | "run" | "cards" | "generation">;

export interface Presence {
  /** Her phase now: `haloPhase`, held on `speaking` while the last line seen playing sounds. */
  phase: (inputs: PresenceInputs) => StorePhase;
  /** The last line seen playing, or `null` before any. */
  spoken: () => number | null;
}

/**
 * Her phase, once, for every mirror of her (the halo here, her face in `lib/face-signal.ts`).
 * Synthesis runs ahead of playback, so the store lets a line go (`voice.stopped`) while its end
 * may still be sounding; until the player has played that line's last sample she is still
 * speaking. Listening and her own speaking win as they always do; a turn or a card that arrives in
 * the tail waits for it. It lives here, not beside `haloPhase`, because that module is in Main's
 * first frame and only the `athena` window reduces her voice.
 */
export function createPresence(deps: { sounding: (generation: number) => boolean }): Presence {
  let spoken: number | null = null;
  return {
    phase: (inputs) => {
      if (inputs.generation != null) spoken = inputs.generation;
      const phase = haloPhase(inputs.voice, inputs.run, inputs.cards);
      if (phase !== "listening" && phase !== "speaking" && spoken !== null && deps.sounding(spoken)) return "speaking";
      return phase;
    },
    spoken: () => spoken,
  };
}

const VOICE_TURN: readonly VoicePhase[] = ["listening", "thinking", "speaking"];
const RUN_TURN: readonly RunPhase[] = ["running", "acting"];

/** The fixed sentences for the voice store's own failures; anything unknown falls to the default. */
const VOICE_CLOSED = "Her voice connection dropped before she answered. Try again.";
const MIC_FAILED = "Athena could not open your microphone. Check the input in Voice settings.";
const VOICE_LOAD_FAILED = "Her voice could not load. Check Voice settings.";

/** A store sentence as a caption: first letter up, one full stop. */
function sentence(text: string): string {
  const t = text.trim();
  const up = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(up) ? up : `${up}.`;
}

/**
 * Her plain reason for a turn that just ended without an answer, or `null` when nothing failed.
 * Only an edge counts: a turn the person started (`prev` active) that is over now with a reason.
 * A reason set with no turn before it (the daemon still starting) never lights the halo. The raw
 * detail never reaches the screen: a run's reason and a turn error's code go through
 * `plainFailure`, and every other voice failure is one fixed sentence.
 */
export function troubleLine(prev: HaloInputs, next: HaloInputs): string | null {
  const engine = next.engine ?? "the engine";
  if (RUN_TURN.includes(prev.run) && !RUN_TURN.includes(next.run) && next.run === "error" && next.runError) {
    return plainFailure(next.runError.reason, engine);
  }
  const reason = next.voiceReason?.trim() ?? "";
  if (!VOICE_TURN.includes(prev.voice) || !reason) return null;
  if (next.voice === "idle") {
    // An utterance's own ending (ADR 0110), already a sentence for a person; or the socket closed.
    return reason.startsWith("voice closed") ? VOICE_CLOSED : sentence(reason);
  }
  if (next.voice !== "error") return null;
  if (reason.startsWith("microphone")) return MIC_FAILED;
  if (reason.startsWith("her voice could not load")) return VOICE_LOAD_FAILED;
  if (reason.startsWith("open a page first")) return plainFailure("no_page", engine);
  // A daemon `turn.error` is "code: detail": the code alone picks the sentence.
  return plainFailure(/^[a-z_]+(?=:)/.exec(reason)?.[0] ?? "", engine);
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

/**
 * One frame, pure: the stores, the override and a level in; the signal out. `phase` is her
 * presence's when the producer has one; omitted, the stores' own.
 */
export function signalOf(
  inputs: HaloInputs,
  override: HaloOverride | null,
  level: number,
  phase: HaloPhase = override?.phase ?? haloPhase(inputs.voice, inputs.run, inputs.cards),
): HaloSignal {
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
  /** Is `generation` still sounding? Omitted, nothing ever is (no tail). */
  sounding?: (generation: number) => boolean;
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
        generation: voice.generation,
        voiceReason: voice.reason,
        runError: run.error,
        engine: engineLabel(useSettings.getState().engine),
      };
    },
    override: () => useHaloOverride.getState().override,
    subscribe: (onChange) => {
      const off = [useVoice.subscribe(onChange), useRun.subscribe(onChange), useHaloOverride.subscribe(onChange)];
      return () => off.forEach((f) => f());
    },
    level: currentLevel,
    sounding: playbackSounding,
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
  const presence = createPresence({ sounding: deps.sounding ?? (() => false) });
  let prev: HaloInputs | null = null;
  let trouble: string | null = null;
  let stopTrouble: (() => void) | null = null;
  const clearTrouble = () => {
    stopTrouble?.();
    stopTrouble = null;
    trouble = null;
  };

  const emit = () => {
    const override = deps.override();
    const inputs = deps.inputs();
    // Read on every frame, override or not, so the line playing is remembered for its tail.
    const own = presence.phase(inputs);
    const failed = prev === null ? null : troubleLine(prev, inputs);
    prev = inputs;
    if (failed !== null) {
      clearTrouble();
      trouble = failed;
      stopTrouble = deps.every(TROUBLE_MS, () => {
        clearTrouble();
        emit();
      });
    } else if (trouble !== null && own !== "gate" && own !== "idle") {
      // Any newer turn wins over the amber moment, and its timer must not land over it later.
      clearTrouble();
    }
    const phase = override?.phase ?? (trouble !== null ? "trouble" : own);
    const level = levelled(phase) ? (override?.level ?? deps.level)() : 0;
    const signal = signalOf(inputs, override, level, phase);
    if (!override && phase === "trouble" && trouble !== null) signal.caption = { who: "athena", text: trouble };
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
          // Not sent, so not remembered: the next change sends it again. A refused idle frame
          // kept as `last` would leave the edges on the phase before it until the phase changed.
          if (last === key) last = "";
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
    clearTrouble();
    if (stopActive === stop) stopActive = null;
  };
  stopActive = stop;
  return stop;
}
