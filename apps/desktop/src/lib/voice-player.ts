/**
 * Her voice's player (lib/voice.ts holds the microphone, the socket and the level the halo reads).
 *
 * It is its own module so Main's first frame does not carry it: the push-to-talk store imports it
 * with `import()` when it opens the voice socket, before any of her audio can arrive (ADR 0192).
 * It imports nothing at run time: what it needs of `lib/voice.ts` comes in as `PlayerKit`
 * (`PLAYER_KIT` there), because a lazy module that imported `lib/voice.ts` would make the bundler
 * split that module, and the first frame, into more chunks than it saves.
 */

/** What the player uses of `lib/voice.ts`, handed in rather than imported (see above). */
export interface PlayerKit {
  /** Make this the player the halo and the face follow. */
  follow: (player: Player) => void;
  pcm16ToFloat32: (bytes: Uint8Array) => Float32Array<ArrayBuffer>;
  rms: (samples: Float32Array) => number;
}

/** One chunk as the player scheduled it: when it starts, how long it plays, which samples it is. */
interface ScheduledChunk {
  /** Start, on the context's clock, in seconds. */
  at: number;
  duration: number;
  /** Its first sample's index in the line. */
  from: number;
  count: number;
}

/**
 * Schedules PCM16 back to back on one timeline for all her lines, and drops on demand.
 *
 * Every chunk becomes one `AudioBuffer` started at the end of the previous one, so playback is
 * gapless and starts on the first chunk rather than the last. The timeline is the player's, not
 * the line's: a line whose audio arrives while an earlier one is still sounding (synthesis runs
 * ahead of playback) is appended after it, so two of her lines are never heard at once (ADR
 * 0192). `drop` stops every source of a generation and forgets it, which is what `voice.stopped`
 * with `barge_in` asks for; `silence` does that to every line at once, which is what a press or
 * a typed line over her asks for. A chunk of a dropped generation that arrives late is ignored.
 * `onQuiet` fires when the last scheduled source of any line has stopped sounding.
 *
 * Every source plays through one `AnalyserNode` on its way to the speakers, so `level` can say
 * how loud she is right now for the halo (ADR 0027) without a second graph.
 */
export class Player {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private scratch: Float32Array<ArrayBuffer> | null = null;
  private sources = new Map<number, AudioBufferSourceNode[]>();
  private ends = new Map<number, number>();
  private dropped = new Set<number>();
  /** Every chunk of a generation as scheduled: its start on the context clock and its samples. */
  private chunks = new Map<number, ScheduledChunk[]>();
  /** Where the timeline ends, on the context clock: the next line's first chunk starts here. */
  private tail = 0;
  /** Called when nothing of any line is sounding any more: the last source ended, or a silence. */
  onQuiet: (() => void) | null = null;

  constructor(
    private readonly audioContext: () => AudioContext,
    private readonly kit: PlayerKit,
  ) {}

  play(generation: number, pcm: Uint8Array, sampleRate: number): void {
    if (this.dropped.has(generation) || pcm.byteLength < 2) return;
    const context = (this.context ??= this.audioContext());
    // A context made outside a gesture starts suspended in some engines — and her first chunk
    // arrives seconds after the key, through the shell's hotkey, never a click in this webview.
    // Resumed as the studio's preview player resumes; a refusal leaves her silent, and says so.
    if (context.state === "suspended") {
      context.resume?.().catch((error: unknown) => console.warn(`[voice] her voice could not start: ${String(error)}`));
    }
    if (this.analyser === null) {
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.connect(context.destination);
    }
    this.kit.follow(this);
    const samples = this.kit.pcm16ToFloat32(pcm);
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    const at = Math.max(context.currentTime, this.tail);
    source.start(at);
    this.tail = at + buffer.duration;
    this.ends.set(generation, this.tail);
    const scheduled = this.chunks.get(generation) ?? [];
    const last = scheduled[scheduled.length - 1];
    scheduled.push({ at, duration: buffer.duration, from: last ? last.from + last.count : 0, count: samples.length });
    this.chunks.set(generation, scheduled);
    const list = this.sources.get(generation) ?? [];
    list.push(source);
    this.sources.set(generation, list);
    source.onended = () => {
      const remaining = this.sources.get(generation)?.filter((s) => s !== source) ?? [];
      if (remaining.length) {
        this.sources.set(generation, remaining);
        return;
      }
      if (!this.sources.has(generation)) return;
      this.sources.delete(generation);
      // The last word of a line the daemon has finished: its schedule goes with it.
      if (!this.ends.has(generation)) this.chunks.delete(generation);
      if (this.sources.size === 0) this.onQuiet?.();
    };
  }

  /** How loud her voice is this instant, 0..1 (`rms`); 0 when nothing is scheduled. */
  level(): number {
    if (this.analyser === null || this.sources.size === 0) return 0;
    this.scratch ??= new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(this.scratch);
    return this.kit.rms(this.scratch);
  }

  /**
   * How far `generation`'s line has played, in samples of the line from its first sample: the
   * context's clock, less the output latency where the engine reports it, mapped onto the chunks
   * as they were scheduled back to back. Before the first chunk it is 0; in an underrun (a chunk
   * that started after the one before it ended) it holds at the end of the chunk that played;
   * after the last chunk it is the samples received so far. `null` with no schedule.
   */
  position(generation: number): number | null {
    const scheduled = this.chunks.get(generation);
    const context = this.context;
    if (!scheduled?.length || context === null) return null;
    const latency = (context as { outputLatency?: number }).outputLatency;
    const now = context.currentTime - (typeof latency === "number" && latency > 0 && latency < 1 ? latency : 0);
    // The last chunk that started by now: chunks are in start order, so a binary search finds it.
    let lo = 0;
    let hi = scheduled.length - 1;
    if (now < scheduled[0].at) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (scheduled[mid].at <= now) lo = mid;
      else hi = mid - 1;
    }
    const chunk = scheduled[lo];
    const played = chunk.duration > 0 ? Math.min(1, (now - chunk.at) / chunk.duration) : 1;
    return chunk.from + Math.round(chunk.count * played);
  }

  /** Whether anything of `generation` is still scheduled. */
  playing(generation: number): boolean {
    return (this.sources.get(generation)?.length ?? 0) > 0;
  }

  drop(generation: number): void {
    this.dropped.add(generation);
    const sounding = this.sources.size > 0;
    this.stopSources(generation);
    this.ends.delete(generation);
    this.chunks.delete(generation);
    // The timeline ends where the lines still scheduled end.
    this.tail = 0;
    for (const scheduled of this.chunks.values()) {
      const last = scheduled[scheduled.length - 1];
      if (last) this.tail = Math.max(this.tail, last.at + last.duration);
    }
    if (sounding && this.sources.size === 0) this.onQuiet?.();
  }

  /**
   * Stop every line she is sounding or has queued, finished or not: the person spoke over her.
   * A line still being synthesized is marked dropped, so its late chunks are ignored until its
   * `voice.stopped` (`finished`); a finished line gets no more chunks and is simply forgotten.
   */
  silence(): void {
    for (const generation of new Set([...this.sources.keys(), ...this.chunks.keys(), ...this.ends.keys()])) {
      if (this.ends.has(generation)) this.dropped.add(generation);
      this.stopSources(generation);
    }
    this.ends.clear();
    this.chunks.clear();
    this.tail = 0;
    this.onQuiet?.();
  }

  private stopSources(generation: number): void {
    for (const source of this.sources.get(generation) ?? []) {
      try {
        source.stop();
      } catch {
        // Already ended; nothing to stop.
      }
    }
    this.sources.delete(generation);
  }

  /**
   * Forget a generation once its `voice.stopped` has been handled, so the set of dropped ones does
   * not grow forever. The daemon sends `voice.stopped` after the generation's last chunk on the
   * same ordered socket, so no chunk of it can arrive after this.
   *
   * Synthesis runs ahead of playback, so a line that ended with `done` can still be sounding: its
   * sources and its schedule stay until the last of them ends, so `level`, `playing` and
   * `position` follow her voice to its last word (the face reads them; ADR on Athena's face). A
   * dropped line has no sources left and is forgotten at once.
   */
  finished(generation: number): void {
    this.ends.delete(generation);
    this.dropped.delete(generation);
    if (!this.sources.has(generation)) this.chunks.delete(generation);
  }

  /** Whether the player holds anything of `generation`: sources, a schedule or a drop mark. */
  holds(generation: number): boolean {
    return (
      this.sources.has(generation) || this.ends.has(generation) || this.dropped.has(generation)
    );
  }
}
