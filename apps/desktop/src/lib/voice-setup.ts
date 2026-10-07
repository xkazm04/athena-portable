/**
 * ADR 0028 (Athena's voice is set up in a studio), README section 3.1 — the voice-setup routes.
 *
 * `lib/voice.ts` carries the live channel: the socket, the microphone, the player. This file is the
 * other half of voice: the daemon's **configuration** routes, typed field for field from the wire
 * contract, with the same seams `lib/api.ts` uses — an `Endpoint`, the token header, an injected
 * `fetch` — so the module's tests drive it against a fake and production takes the global.
 *
 * **Every answer is an `Outcome`, never a throw.** A route that answers 503 ("that engine is not
 * ready") or 409 ("an install is already running") is a *state* the studio renders, not an
 * exception it has to remember to catch; a network failure is the state `offline`. The one thing a
 * caller does with a refusal is show it, so a refusal is a value.
 *
 * The absent-value convention is the wire's: `null`, never omitted. Nothing here fills a field the
 * daemon left out, so a daemon that broke the contract shows up as a type error in the view and not
 * as a silently invented default.
 *
 * Download URLs are the daemon's constants. Nothing here sends one, and `install` takes only a
 * component name.
 */
import type { Endpoint, FetchLike } from "@/lib/api";
import { int16ToBytes } from "@/lib/voice";

// -- the wire ------------------------------------------------------------------------------------

export type EngineId = "kokoro" | "whisper" | "openai";
export type SttEngineId = "whisper" | "openai";
export type EngineState = "ready" | "absent" | "broken";

export interface VoiceOption {
  id: string;
  name: string;
  language: string;
  gender: string;
  grade: string;
  blurb: string;
}

export interface SttModel {
  id: string;
  size_mb: number;
  installed: boolean;
}

export interface VoiceEngine {
  id: EngineId;
  direction: "tts" | "stt";
  kind: "local" | "cloud";
  state: EngineState;
  reason: string | null;
  size_mb: number | null;
  /** Kokoro only; `[]` for every other engine. */
  voices: VoiceOption[];
  /** Whisper only; `[]` for every other engine. */
  models: SttModel[];
}

export interface VoiceChoice {
  tts: { engine: "kokoro"; voice: string };
  stt: { engine: SttEngineId; model: string | null };
}

export interface VoiceConfig extends VoiceChoice {
  engines: VoiceEngine[];
  /** The chosen speaker and the chosen listener are both ready (whisper: its model too). */
  ready: boolean;
  /** The first sentence of why not, or `null` when ready. */
  reason: string | null;
  /** The engine home the daemon installs into. Shown, never sent back. */
  home: string;
}

export type InstallPhase =
  | "idle"
  | "not_needed"
  | "downloading_engine"
  | "downloading_model"
  | "extracting"
  | "completed"
  | "failed"
  | "manual";

export interface InstallState {
  component: string | null;
  state: InstallPhase;
  received_bytes: number;
  total_bytes: number | null;
  error: string | null;
}

export interface Transcript {
  engine: SttEngineId;
  text: string;
  elapsed_ms: number;
}

/** A spoken preview: the raw PCM16LE body and what its headers said about it. */
export interface PreviewClip {
  pcm: Uint8Array;
  sampleRate: number;
  provider: string | null;
  voice: string | null;
  elapsedMs: number | null;
}

/** The three phases that mean "an install is running": poll while one of these holds. */
export const ACTIVE_INSTALL: ReadonlySet<InstallPhase> = new Set([
  "downloading_engine",
  "downloading_model",
  "extracting",
]);

/** What the preview route accepts, in characters (the contract's `1..1200`). */
export const PREVIEW_MAX_CHARS = 1200;

/** The default sample rate when a preview's content type names none: Kokoro's own. */
export const DEFAULT_PREVIEW_RATE = 24_000;

// -- outcomes ------------------------------------------------------------------------------------

/**
 * Why a call came back without its value, as a word a view can switch on.
 *
 * - `not_ready` — 503: the engine the call needs is not ready (preview, transcribe).
 * - `busy` — 409: an install is already running.
 * - `invalid` — 400: the daemon refused the body (`validator_failed`).
 * - `refused` — any other status the daemon answered with.
 * - `offline` — no answer at all: the fetch itself failed.
 */
export type Refusal = "not_ready" | "busy" | "invalid" | "refused" | "offline";

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; refusal: Refusal; status: number; reason: string; detail: string };

function refusalOf(status: number): Refusal {
  if (status === 503) return "not_ready";
  if (status === 409) return "busy";
  if (status === 400) return "invalid";
  return "refused";
}

/** The sentence a view prints for a refusal: the daemon's words when it gave any. */
export function refusalText(outcome: Extract<Outcome<unknown>, { ok: false }>): string {
  if (outcome.detail) return outcome.detail;
  if (outcome.reason && outcome.reason !== "unknown") return outcome.reason;
  switch (outcome.refusal) {
    case "not_ready":
      return "that engine is not ready yet";
    case "busy":
      return "another install is already running";
    case "invalid":
      return "the daemon refused that choice";
    case "offline":
      return "the daemon did not answer";
    default:
      return `the daemon answered ${outcome.status}`;
  }
}

/** `audio/L16;rate=24000` → 24000. Anything unreadable falls back to Kokoro's rate. */
export function rateOf(contentType: string | null): number {
  const match = /rate\s*=\s*(\d+)/i.exec(contentType ?? "");
  const rate = match ? Number(match[1]) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_PREVIEW_RATE;
}

/**
 * Whether the voice key can light up, from the config alone — the one rule `stores/voice.ts` and
 * the module share. A config that is ready has no reason; one that is not always has a sentence,
 * even when the daemon sent none.
 */
export function availabilityOf(config: Pick<VoiceConfig, "ready" | "reason">): {
  available: boolean;
  reason: string;
} {
  if (config.ready) return { available: true, reason: "" };
  return { available: false, reason: config.reason || "voice is not set up yet" };
}

/** The same global `fetch`, called with its own receiver, for the reason `lib/api.ts` gives. */
const globalFetch: FetchLike = (input, init) => fetch(input, init);

// -- the client ----------------------------------------------------------------------------------

export class VoiceSetupApi {
  constructor(
    private readonly endpoint: Endpoint,
    private readonly fetchImpl: FetchLike = globalFetch,
  ) {}

  config(): Promise<Outcome<VoiceConfig>> {
    return this.json("GET", "/voice/config");
  }

  /** Choose the speaker and the listener. Applied live by the daemon and persisted there. */
  choose(choice: VoiceChoice): Promise<Outcome<VoiceConfig>> {
    return this.json("PUT", "/voice/config", choice);
  }

  /** Speak `text` in `voice`. 503 while the speaking engine is not ready. */
  async preview(text: string, voice: string): Promise<Outcome<PreviewClip>> {
    const response = await this.send("POST", "/voice/preview", {
      body: JSON.stringify({ text: text.slice(0, PREVIEW_MAX_CHARS), voice }),
      contentType: "application/json",
    });
    if (!response.ok) return response;
    const res = response.value;
    const elapsed = Number(res.headers.get("X-Tts-Elapsed-Ms"));
    return {
      ok: true,
      value: {
        pcm: new Uint8Array(await res.arrayBuffer()),
        sampleRate: rateOf(res.headers.get("Content-Type")),
        provider: res.headers.get("X-Tts-Provider"),
        voice: res.headers.get("X-Tts-Voice"),
        elapsedMs: Number.isFinite(elapsed) && res.headers.has("X-Tts-Elapsed-Ms") ? elapsed : null,
      },
    };
  }

  /** One take, PCM16 mono at 16 kHz, through one engine. 503 while that engine is not ready. */
  async transcribe(engine: SttEngineId, pcm: Int16Array): Promise<Outcome<Transcript>> {
    const response = await this.send("POST", `/voice/transcribe?engine=${encodeURIComponent(engine)}`, {
      body: int16ToBytes(pcm),
      contentType: "application/octet-stream",
    });
    if (!response.ok) return response;
    return { ok: true, value: (await response.value.json()) as Transcript };
  }

  /** Start an install. 202 with the state; 409 while another one runs. */
  install(component: string): Promise<Outcome<InstallState>> {
    return this.json("POST", "/voice/install", { component });
  }

  installState(): Promise<Outcome<InstallState>> {
    return this.json("GET", "/voice/install");
  }

  /** Seal a key. The daemon never echoes it; neither does anything that calls this. */
  async putKey(provider: "openai", key: string): Promise<Outcome<null>> {
    const response = await this.send("PUT", "/voice/key", {
      body: JSON.stringify({ provider, key }),
      contentType: "application/json",
    });
    return response.ok ? { ok: true, value: null } : response;
  }

  async deleteKey(provider: "openai"): Promise<Outcome<null>> {
    const response = await this.send("DELETE", `/voice/key?provider=${encodeURIComponent(provider)}`, {});
    return response.ok ? { ok: true, value: null } : response;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<Outcome<T>> {
    const response = await this.send(method, path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      contentType: "application/json",
    });
    if (!response.ok) return response;
    return { ok: true, value: (await response.value.json()) as T };
  }

  private async send(
    method: string,
    path: string,
    { body, contentType }: { body?: BodyInit; contentType?: string },
  ): Promise<Outcome<Response>> {
    const headers: Record<string, string> = { "X-Athena-Token": this.endpoint.token };
    if (contentType && body !== undefined) headers["Content-Type"] = contentType;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.endpoint.url}${path}`, { method, headers, body });
    } catch (error) {
      return {
        ok: false,
        refusal: "offline",
        status: 0,
        reason: "daemon_offline",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    if (response.ok) return { ok: true, value: response };
    let reason = "unknown";
    let detail = "";
    try {
      const payload = (await response.json()) as { reason?: string | null; detail?: string | null };
      reason = payload.reason ?? reason;
      detail = payload.detail ?? "";
    } catch {
      // A refusal that is not JSON is still a refusal; the status says which.
    }
    return { ok: false, refusal: refusalOf(response.status), status: response.status, reason, detail };
  }
}
