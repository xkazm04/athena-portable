/**
 * The halo's one signal, typed once — ADR 0027 ("Athena is ambient"), README section 3.1.
 *
 * The `athena` window owns the voice and the run (ADR 0026), so it is the only producer: it
 * reduces its stores to one `HaloSignal` and hands it to Rust with `athena_halo`, and Rust fans it
 * out as `halo:signal` to every `halo-*` overlay. The overlays hold no socket and no store; this
 * shape is everything they know. The Rust mirror is `src-tauri/src/halo.rs`.
 */
import type { RunPhase } from "@/stores/run";
import type { VoicePhase } from "@/stores/voice";

/** What the edges show, in precedence order (see `haloPhase`). */
export const HALO_PHASES = ["idle", "listening", "thinking", "speaking", "gate"] as const;

export type HaloPhase = (typeof HALO_PHASES)[number];

export function isHaloPhase(value: unknown): value is HaloPhase {
  return typeof value === "string" && (HALO_PHASES as readonly string[]).includes(value);
}

export interface HaloCaption {
  who: "you" | "athena";
  text: string;
}

/**
 * One frame of the halo. Absent values are spelled, never omitted: `caption` is `null` when there
 * is nothing to say, and `level` is `0` outside `listening` and `speaking`.
 */
export interface HaloSignal {
  phase: HaloPhase;
  /** Audio level, 0..1: the microphone while listening, her voice while speaking. */
  level: number;
  /** Cards waiting on the person; the halo stays up while any do. */
  cards: number;
  caption: HaloCaption | null;
}

export const HALO_COMMAND = "athena_halo";
export const HALO_EVENT = "halo:signal";
export const PTT_EVENT = "athena:ptt";

/** The payload of `athena:ptt`: the held summon chord went down or came up. */
export interface PttPayload {
  down: boolean;
}

/**
 * The edges' phase from the stores. Listening wins (the person is talking and must see it), then
 * her voice, then any work in flight, then a waiting card; a card under a turn shows again the
 * moment the turn ends.
 */
export function haloPhase(voice: VoicePhase, run: RunPhase, cards: number): HaloPhase {
  if (voice === "listening") return "listening";
  if (voice === "speaking") return "speaking";
  if (voice === "thinking" || run === "running" || run === "acting") return "thinking";
  if (cards > 0) return "gate";
  return "idle";
}

export const IDLE_SIGNAL: HaloSignal = { phase: "idle", level: 0, cards: 0, caption: null };
