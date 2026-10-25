/**
 * What the Adopt studio is handed — ADR 0097, README section 3.5.
 *
 * The Chores view is a pure function of its props, so the studio does not reach a store: the
 * running app (`live.tsx`) hands it a client over the daemon and a dictation built from the voice
 * routes (`live-deps.ts`), the preview harness hands it a scripted one (`fixtures.ts`), and a test
 * hands it spies. Without any, the studio says it needs the daemon.
 */
import type { AdoptClient } from "@/lib/adopt-client";
import type { ChoresClient } from "@/lib/chores-client";
import type { IntakeClient } from "@/lib/intake-client";

/** Hold-to-talk into the answer box, and her questions read aloud. */
export interface Dictation {
  /** `null` when a take can be heard; otherwise why not, in a sentence. */
  check(): Promise<string | null>;
  start(): Promise<void>;
  /** The take, transcribed: untrusted text the person reads before it is sent (voice-io). */
  stop(): Promise<{ ok: true; text: string } | { ok: false; reason: string }>;
  /** `null` when her questions can be spoken; otherwise why not. */
  canSpeak(): Promise<string | null>;
  speak(text: string): Promise<void>;
}

export interface AdoptDeps {
  client: AdoptClient;
  /** The Chores front door's client (ADR 0098); absent, "New chore" says it needs the daemon. */
  intake?: IntakeClient;
  /** When a case comes due (ADR 0131); absent, the topic page draws no cadence. */
  chores?: ChoresClient;
  dictation: Dictation | null;
  /** The reconnect's pause; resolves early when the signal aborts. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The clock a parked conversation is aged by (ADR 0179); `Date.now` when absent. */
  now?: () => number;
}

export const realWait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
