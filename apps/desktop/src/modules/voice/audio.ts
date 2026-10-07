/**
 * ADR 0028 (Athena's voice is set up in a studio), README section 3.1 — the preview player and the
 * one-take recorder.
 *
 * Two small things the studio needs that the live channel does not: a player for **one clip at a
 * time** whose `AnalyserNode` the waveform reads (previews never overlap — `play` stops whatever
 * was playing first), and a recorder that gathers a held take into one PCM16 buffer at 16 kHz.
 * Both take their browser APIs as arguments, as `lib/voice.ts` does, and both are idempotent to
 * stop.
 */
import { openMicrophone, pcm16ToFloat32, rms, type MicrophoneApis, type MicrophoneSession } from "@/lib/voice";

export class PreviewPlayer {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private bins: Uint8Array<ArrayBuffer> | null = null;
  private scratch: Float32Array<ArrayBuffer> | null = null;
  private settle: (() => void) | null = null;

  constructor(private readonly audioContext: () => AudioContext) {}

  /** Play one clip; resolves when it ends or is stopped. Stops the clip before it. */
  play(pcm: Uint8Array, sampleRate: number): Promise<void> {
    this.stop();
    const context = (this.context ??= this.audioContext());
    if (this.analyser === null) {
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.6;
      this.analyser.connect(context.destination);
    }
    const samples = pcm16ToFloat32(pcm);
    if (samples.length === 0) return Promise.resolve();
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    this.source = source;
    // A context created outside a gesture starts suspended in some engines; resuming is harmless.
    void context.resume?.();
    return new Promise((resolve) => {
      this.settle = resolve;
      source.onended = () => {
        if (this.source === source) this.source = null;
        this.finish();
      };
      source.start();
    });
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    if (source) {
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    }
    this.finish();
  }

  /** Byte frequency bins while a clip plays, else `null`. */
  spectrum(): Uint8Array | null {
    if (!this.analyser || !this.source) return null;
    this.bins ??= new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(this.bins);
    return this.bins;
  }

  /** How loud the clip is this instant, 0..1. */
  level(): number {
    if (!this.analyser || !this.source) return 0;
    this.scratch ??= new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(this.scratch);
    return rms(this.scratch);
  }

  close(): void {
    this.stop();
    void this.context?.close();
    this.context = null;
    this.analyser = null;
  }

  private finish(): void {
    const settle = this.settle;
    this.settle = null;
    settle?.();
  }
}

/** Everything gathered from a microphone between `start` and `stop`, as one 16 kHz buffer. */
export function concatPcm(chunks: readonly Int16Array[]): Int16Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Int16Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * One held take. `start` opens the microphone; `stop` closes it and hands back the take — and a
 * `stop` that lands before the microphone finished opening still waits for it, so a quick tap
 * never leaves a microphone open.
 */
export class TakeRecorder {
  private chunks: Int16Array[] = [];
  private opening: Promise<MicrophoneSession | null> | null = null;

  constructor(private readonly apis: () => MicrophoneApis | null) {}

  start(): Promise<void> {
    this.chunks = [];
    const apis = this.apis();
    if (!apis) return Promise.reject(new Error("this webview offers no microphone"));
    const opening = openMicrophone(apis, (pcm) => this.chunks.push(pcm));
    this.opening = opening.catch(() => null);
    return opening.then(() => undefined);
  }

  async stop(): Promise<Int16Array> {
    const opening = this.opening;
    this.opening = null;
    const session = opening ? await opening : null;
    session?.stop();
    const take = concatPcm(this.chunks);
    this.chunks = [];
    return take;
  }
}
