/**
 * The halo's arithmetic — ADR 0027 (Athena is ambient), README section 3.1.
 *
 * Pure, so it is tested without a window: how the drawn level chases the signalled one, and when
 * the caption is on screen. `main.ts` owns the clock and the DOM and decides nothing; every rule
 * about what the edges and the caption show is here.
 */
import { isHaloPhase, type HaloCaption, type HaloPhase, type HaloSignal } from "@/lib/halo-signal";

// -- the level ---------------------------------------------------------------------------------

/** Rising follows a syllable; falling lingers, so the bloom breathes rather than flickers. */
export const ATTACK_MS = 60;
export const RELEASE_MS = 250;

/** Below this the eye cannot tell the drawn level from the target, and the loop may stop. */
export const SETTLED = 0.002;

/**
 * One step of the drawn level towards the target: exponential, with the attack constant when
 * rising and the release constant when falling. `dtMs` of zero is no step; a negative one is none.
 */
export function smooth(prev: number, target: number, dtMs: number): number {
  if (dtMs <= 0) return prev;
  const tau = target > prev ? ATTACK_MS : RELEASE_MS;
  const next = prev + (target - prev) * (1 - Math.exp(-dtMs / tau));
  return Math.abs(target - next) < SETTLED ? target : next;
}

export function settled(prev: number, target: number): boolean {
  return Math.abs(target - prev) < SETTLED;
}

// -- the wire ----------------------------------------------------------------------------------

/**
 * The payload of `halo:signal`, checked. Rust forwards what the `athena` window sent, so this is
 * a typed shape from our own producer; it is still checked, because a malformed frame should
 * leave the last good one on screen rather than paint `NaN` into a transform.
 */
export function parseSignal(raw: unknown): HaloSignal | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isHaloPhase(r.phase)) return null;
  const level = typeof r.level === "number" && Number.isFinite(r.level) ? r.level : 0;
  const cards = typeof r.cards === "number" && Number.isFinite(r.cards) ? r.cards : 0;
  let caption: HaloCaption | null = null;
  const c = r.caption as Record<string, unknown> | null | undefined;
  if (c && (c.who === "you" || c.who === "athena") && typeof c.text === "string" && c.text) {
    caption = { who: c.who, text: c.text };
  }
  return { phase: r.phase, level: Math.min(1, Math.max(0, level)), cards, caption };
}

// -- the caption -------------------------------------------------------------------------------

/** How long the last words stay up once the conversation has moved off them. */
export const CAPTION_LINGER_MS = 4000;

/** The phases a caption belongs to: someone is talking, or she is answering what was said. */
const HOLDS: readonly HaloPhase[] = ["listening", "thinking", "speaking"];

export interface CaptionState {
  caption: HaloCaption | null;
  phase: HaloPhase;
  /** The last moment the caption was held: a holding phase, the moment one ended, or a new line. */
  heldAt: number;
}

export interface CaptionView {
  who: HaloCaption["who"] | null;
  text: string;
  visible: boolean;
}

export const CAPTION_START: CaptionState = { caption: null, phase: "idle", heldAt: 0 };

function sameCaption(a: HaloCaption | null, b: HaloCaption | null): boolean {
  return a?.who === b?.who && a?.text === b?.text;
}

/**
 * Fold one signal into the caption. A new line replaces the old one and is shown at once. A
 * `null` caption erases nothing: the words stay until the timer takes them. The timer is
 * `CAPTION_LINGER_MS` from the moment the phase leaves listening, thinking or speaking (in
 * practice: from the end of her reply).
 */
export function stepCaption(state: CaptionState, signal: HaloSignal, now: number): CaptionState {
  const changed = signal.caption !== null && !sameCaption(state.caption, signal.caption);
  const caption = changed ? signal.caption : state.caption;
  const held = changed || HOLDS.includes(signal.phase) || HOLDS.includes(state.phase);
  return { caption, phase: signal.phase, heldAt: held ? now : state.heldAt };
}

/** When the caption goes away by itself, or `null` while it is held or already gone. */
export function captionHideAt(state: CaptionState): number | null {
  if (!state.caption || HOLDS.includes(state.phase)) return null;
  return state.heldAt + CAPTION_LINGER_MS;
}

export function captionView(state: CaptionState, now: number): CaptionView {
  const hideAt = captionHideAt(state);
  const visible = state.caption !== null && (hideAt === null || now < hideAt);
  return { who: state.caption?.who ?? null, text: state.caption?.text ?? "", visible };
}
