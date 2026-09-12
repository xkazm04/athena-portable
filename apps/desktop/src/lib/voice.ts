/**
 * The voice channel, as the shell speaks it — plan c32, README section 3.1; ADR 0019 and 0020.
 *
 * Three small things and nothing else: **the socket** to `/voice` with the token where a browser
 * can put it, **the microphone** as PCM16 at 16 kHz, and **the player** that schedules PCM16 back
 * out and can drop a generation the moment the daemon says `barge_in`. What an utterance means,
 * which turn it belongs to and what runs on the page are the store's questions (`stores/voice.ts`),
 * exactly as `lib/api.ts` carries frames and `stores/run.ts` decides what to do with them.
 *
 * **Every browser API is an argument.** `WebSocket`, `getUserMedia` and `AudioContext` are handed
 * in by the caller, so the store's headless test drives the real framing and the real resampling
 * with fakes, and a plain `vitest` run never needs a window. The pure functions at the top — the
 * resampler, the PCM conversions, the audio frame split — are what a wrong sample rate would break,
 * and they are tested on their own.
 */
import type { ChannelEvent } from "@/lib/events";
import { eventFromJson } from "@/lib/events";

/** What the daemon expects on the wire: 16 kHz, 16-bit, mono (`backends.INPUT_SAMPLE_RATE`). */
export const INPUT_SAMPLE_RATE = 16_000;

/** The subprotocol that carries the token, as `channels/voice/ws.py` spells it. */
export const PROTOCOL_PREFIX = "athena-token.";

export const VOICE_PATH = "/voice";

// -- pure --------------------------------------------------------------------------------------

/**
 * Float samples at `from` Hz to 16-bit integers at `to` Hz, by nearest-sample decimation.
 *
 * Nearest rather than filtered: a speech model is trained on far worse than the aliasing of a
 * 3:1 decimation of a voice band, and a filter is a dependency and a latency. A rate that is not
 * a whole multiple is still handled — the step is fractional and the index truncates.
 */
export function downsample(
  samples: Float32Array,
  from: number,
  to: number,
): Int16Array<ArrayBuffer> {
  if (from <= 0 || to <= 0) throw new Error("a sample rate must be positive");
  const step = from / to;
  const count = Math.floor(samples.length / step);
  const out = new Int16Array(count);
  for (let i = 0; i < count; i += 1) {
    const sample = samples[Math.floor(i * step)] ?? 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
  }
  return out;
}

/** PCM16 little-endian bytes to float samples in [-1, 1], for an `AudioBuffer`. */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const sample = view.getInt16(i * 2, true);
    out[i] = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
  }
  return out;
}

/** An `Int16Array` as the little-endian bytes the daemon reads, whatever the host's byte order. */
export function int16ToBytes(samples: Int16Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i += 1) view.setInt16(i * 2, samples[i], true);
  return out;
}

export interface AudioFrame {
  generation: number;
  pcm: Uint8Array;
}

/** A binary frame from the daemon: four bytes of big-endian generation, then PCM16. */
export function splitAudioFrame(data: Uint8Array): AudioFrame | null {
  if (data.byteLength < 4) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { generation: view.getUint32(0, false), pcm: data.subarray(4) };
}

// -- the socket --------------------------------------------------------------------------------

/** The subset of `WebSocket` the client uses, so a test can hand in a fake. */
export interface SocketLike {
  binaryType: string;
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string, protocols: string[]) => SocketLike;

/** What the client sends, as `channels/voice/gateway.py` reads it. */
export type ClientFrame =
  | { type: "start"; origin: string; host_state: Record<string, unknown>; project_id?: string }
  | { type: "stop" }
  | { type: "text"; text: string; origin: string; host_state: Record<string, unknown> }
  | {
      type: "tool_result";
      call_id: string;
      name: string;
      ok: boolean;
      output: string;
      error: string | null;
      tier: number;
    };

export interface VoiceHandlers {
  onEvent: (event: ChannelEvent) => void;
  onAudio: (frame: AudioFrame) => void;
  onClose: (reason: string) => void;
}

/** `ws://127.0.0.1:port/voice` from the daemon's `http://` URL. */
export function voiceUrl(daemonUrl: string): string {
  return daemonUrl.replace(/^http/, "ws").replace(/\/$/, "") + VOICE_PATH;
}

/**
 * One connection to `/voice`. Text frames are channel events, binary frames are audio; a frame
 * that decodes as neither is reported as a close reason, not swallowed.
 */
export class VoiceSocket {
  private socket: SocketLike | null = null;

  constructor(
    private readonly factory: SocketFactory,
    private readonly handlers: VoiceHandlers,
  ) {}

  get open(): boolean {
    return this.socket !== null && this.socket.readyState === 1;
  }

  connect(daemonUrl: string, token: string): Promise<void> {
    const socket = this.factory(voiceUrl(daemonUrl), [`${PROTOCOL_PREFIX}${token}`]);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    return new Promise((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("the voice socket could not be opened"));
      socket.onclose = (ev) => {
        this.socket = null;
        this.handlers.onClose(ev.reason || (ev.code ? `closed (${ev.code})` : "closed"));
      };
      socket.onmessage = (ev) => this.receive(ev.data);
    });
  }

  send(frame: ClientFrame): void {
    this.socket?.send(JSON.stringify(frame));
  }

  sendAudio(pcm: Int16Array): void {
    if (pcm.length === 0) return;
    this.socket?.send(int16ToBytes(pcm));
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "done");
  }

  private receive(data: unknown): void {
    if (typeof data === "string") {
      this.handlers.onEvent(eventFromJson(data));
      return;
    }
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data instanceof Uint8Array
          ? data
          : null;
    if (bytes === null) {
      this.handlers.onClose("a frame that was neither text nor bytes");
      this.close();
      return;
    }
    const frame = splitAudioFrame(bytes);
    if (frame) this.handlers.onAudio(frame);
  }
}

// -- the microphone ----------------------------------------------------------------------------

/** The two browser globals the microphone needs, as arguments so the store can be tested. */
export interface MicrophoneApis {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  audioContext: () => AudioContext;
}

export interface MicrophoneSession {
  /** Stop the tracks and disconnect the graph. Idempotent. */
  stop: () => void;
}

/**
 * Capture the microphone and hand PCM16 at 16 kHz to `onChunk` until stopped.
 *
 * `ScriptProcessorNode` rather than an `AudioWorklet`: the worklet needs a module URL, which the
 * shell's `tauri://` asset protocol and a `data:` blob both make awkward, and a 4096-sample
 * buffer at 48 kHz is 85 ms of latency on a push-to-talk key nobody notices. It is deprecated and
 * it is everywhere; the day it goes, this function is the one place to change.
 */
export async function openMicrophone(
  apis: MicrophoneApis,
  onChunk: (pcm: Int16Array) => void,
): Promise<MicrophoneSession> {
  const stream = await apis.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  const context = apis.audioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (ev) => {
    const input = ev.inputBuffer.getChannelData(0);
    onChunk(downsample(input, context.sampleRate, INPUT_SAMPLE_RATE));
  };
  source.connect(processor);
  // A processor with no destination is never pulled by some engines; the gain of zero keeps the
  // microphone from feeding back to the speakers while the graph still runs.
  const silence = context.createGain();
  silence.gain.value = 0;
  processor.connect(silence);
  silence.connect(context.destination);
  let stopped = false;
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      processor.disconnect();
      source.disconnect();
      silence.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
}

export type MicStanding = "unknown" | "granted" | "denied" | "unsupported";

/**
 * The Setup wizard's mic check: ask once, release at once, report in the browser's own words.
 * Granting here is what makes the permission prompt land in the setup act rather than mid-demo.
 */
export async function checkMicrophone(
  getUserMedia: MicrophoneApis["getUserMedia"] | undefined,
): Promise<{ standing: MicStanding; detail: string }> {
  if (!getUserMedia) return { standing: "unsupported", detail: "this webview offers no microphone" };
  try {
    const stream = await getUserMedia({ audio: true, video: false });
    const label = stream.getAudioTracks()[0]?.label || "a microphone";
    for (const track of stream.getTracks()) track.stop();
    return { standing: "granted", detail: label };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const detail = error instanceof Error ? error.message : String(error);
    return {
      standing: name === "NotFoundError" ? "unsupported" : "denied",
      detail: detail || name || "the microphone was refused",
    };
  }
}

// -- the player --------------------------------------------------------------------------------

/**
 * Schedules PCM16 back to back and drops a generation on demand.
 *
 * Every chunk becomes one `AudioBuffer` started at the end of the previous one, so playback is
 * gapless and starts on the first chunk rather than the last. `drop` stops every source of a
 * generation and forgets it, which is what `voice.stopped` with `barge_in` asks for; a chunk of
 * a dropped generation that arrives late is ignored.
 */
export class Player {
  private context: AudioContext | null = null;
  private sources = new Map<number, AudioBufferSourceNode[]>();
  private ends = new Map<number, number>();
  private dropped = new Set<number>();

  constructor(private readonly audioContext: () => AudioContext) {}

  play(generation: number, pcm: Uint8Array, sampleRate: number): void {
    if (this.dropped.has(generation) || pcm.byteLength < 2) return;
    const context = (this.context ??= this.audioContext());
    const samples = pcm16ToFloat32(pcm);
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const at = Math.max(context.currentTime, this.ends.get(generation) ?? 0);
    source.start(at);
    this.ends.set(generation, at + buffer.duration);
    const list = this.sources.get(generation) ?? [];
    list.push(source);
    this.sources.set(generation, list);
    source.onended = () => {
      const remaining = this.sources.get(generation)?.filter((s) => s !== source) ?? [];
      if (remaining.length) this.sources.set(generation, remaining);
      else this.sources.delete(generation);
    };
  }

  /** Whether anything of `generation` is still scheduled. */
  playing(generation: number): boolean {
    return (this.sources.get(generation)?.length ?? 0) > 0;
  }

  drop(generation: number): void {
    this.dropped.add(generation);
    for (const source of this.sources.get(generation) ?? []) {
      try {
        source.stop();
      } catch {
        // Already ended; nothing to stop.
      }
    }
    this.sources.delete(generation);
    this.ends.delete(generation);
  }

  /** Forget a generation that played out, so the set of dropped ones does not grow forever. */
  finished(generation: number): void {
    this.sources.delete(generation);
    this.ends.delete(generation);
  }
}
