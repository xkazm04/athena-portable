/**
 * The audio arithmetic and the socket framing, on their own (lib/voice.ts).
 *
 * A wrong sample rate is a backend that hears chipmunks, and a frame split one byte off is a
 * player that plays a generation number as a click. Neither is caught by a run that "works".
 */
import { describe, expect, it, vi } from "vitest";

import {
  LEVEL_CEIL_DB,
  LEVEL_FLOOR_DB,
  PROTOCOL_PREFIX,
  Player,
  VoiceSocket,
  currentLevel,
  downsample,
  playbackSample,
  playbackSounding,
  int16ToBytes,
  openMicrophone,
  pcm16ToFloat32,
  rms,
  splitAudioFrame,
  voiceUrl,
  type SocketLike,
} from "./voice";

describe("the resampler", () => {
  it("decimates 48 kHz to 16 kHz three to one and scales to 16-bit", () => {
    const input = new Float32Array([1, 0, 0, -1, 0, 0, 0.5, 0, 0]);
    const out = downsample(input, 48_000, 16_000);
    expect(Array.from(out)).toEqual([0x7fff, -0x8000, Math.round(0.5 * 0x7fff)]);
  });

  it("clamps what a hot microphone sends beyond full scale", () => {
    const out = downsample(new Float32Array([2, -3]), 16_000, 16_000);
    expect(Array.from(out)).toEqual([0x7fff, -0x8000]);
  });

  it("handles a rate that is not a whole multiple", () => {
    const out = downsample(new Float32Array(441), 44_100, 16_000);
    expect(out.length).toBe(160);
  });

  it("round-trips through the little-endian bytes the daemon reads", () => {
    const samples = new Int16Array([0, 1, -1, 0x7fff, -0x8000]);
    const bytes = int16ToBytes(samples);
    expect(bytes[2]).toBe(1);
    expect(bytes[3]).toBe(0);
    const back = pcm16ToFloat32(bytes);
    expect(back[0]).toBe(0);
    expect(back[3]).toBeCloseTo(1);
    expect(back[4]).toBeCloseTo(-1);
  });
});

describe("an audio frame", () => {
  it("is four bytes of big-endian generation and then the samples", () => {
    const frame = splitAudioFrame(new Uint8Array([0, 0, 1, 2, 9, 9]));
    expect(frame?.generation).toBe(258);
    expect(Array.from(frame?.pcm ?? [])).toEqual([9, 9]);
  });

  it("is nothing when shorter than its header", () => {
    expect(splitAudioFrame(new Uint8Array([0, 0, 1]))).toBeNull();
  });
});

describe("the socket", () => {
  function fakeSocket() {
    const sent: unknown[] = [];
    const opened: { url: string; protocols: string[] }[] = [];
    let live: SocketLike | null = null;
    const factory = (url: string, protocols: string[]) => {
      opened.push({ url, protocols });
      const socket: SocketLike = {
        binaryType: "blob",
        readyState: 1,
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        send: (data) => sent.push(data),
        close: () => {
          socket.readyState = 3;
          socket.onclose?.({ code: 1000, reason: "done" });
        },
      };
      live = socket;
      queueMicrotask(() => socket.onopen?.({}));
      return socket;
    };
    return { factory, sent, opened, socket: () => live as SocketLike | null };
  }

  it("carries the token in the subprotocol and speaks ws:// to the daemon's http:// url", async () => {
    const fake = fakeSocket();
    const client = new VoiceSocket(fake.factory, {
      onEvent: () => {},
      onAudio: () => {},
      onClose: () => {},
    });
    await client.connect("http://127.0.0.1:17490", "tok");
    expect(fake.opened[0].url).toBe("ws://127.0.0.1:17490/voice");
    expect(fake.opened[0].protocols).toEqual([`${PROTOCOL_PREFIX}tok`]);
    expect(fake.socket()?.binaryType).toBe("arraybuffer");
    expect(voiceUrl("http://127.0.0.1:1/")).toBe("ws://127.0.0.1:1/voice");
  });

  it("sends JSON for control frames and bytes for audio, and routes what comes back", async () => {
    const fake = fakeSocket();
    const events: string[] = [];
    const audio: number[] = [];
    let closed = "";
    const client = new VoiceSocket(fake.factory, {
      onEvent: (e) => events.push(e.kind),
      onAudio: (f) => audio.push(f.generation),
      onClose: (r) => (closed = r),
    });
    await client.connect("http://d", "t");
    client.send({ type: "stop" });
    client.sendAudio(new Int16Array([1, 2]));
    client.sendAudio(new Int16Array([]));
    expect(fake.sent).toEqual([JSON.stringify({ type: "stop" }), new Uint8Array([1, 0, 2, 0])]);

    const socket = fake.socket();
    socket?.onmessage?.({ data: JSON.stringify({ kind: "voice.transcript", text: "hi", final: true }) });
    socket?.onmessage?.({ data: new Uint8Array([0, 0, 0, 7, 1, 0]).buffer });
    expect(events).toEqual(["voice.transcript"]);
    expect(audio).toEqual([7]);

    client.close();
    expect(closed).toBe("done");
    expect(client.open).toBe(false);
  });

  it("refuses an unknown event kind rather than skipping it", async () => {
    const fake = fakeSocket();
    const events: string[] = [];
    const reasons: string[] = [];
    const client = new VoiceSocket(fake.factory, {
      onEvent: (event) => events.push(event.kind),
      onAudio: () => {},
      onClose: (reason) => reasons.push(reason),
    });
    await client.connect("http://d", "t");
    expect(() =>
      fake.socket()?.onmessage?.({ data: JSON.stringify({ kind: "voice.invented" }) }),
    ).not.toThrow();
    expect(reasons[0]).toContain("voice.invented");
    expect(events).toEqual([]);
    expect(client.open).toBe(false);
  });
});

describe("the level the halo reads", () => {
  /** A constant signal of amplitude `a` has an RMS of `a`, so its dBFS is exact. */
  const at = (db: number) => new Float32Array(480).fill(10 ** (db / 20));

  it("is 0 for silence, for an empty buffer and for a room's hiss below the floor", () => {
    expect(rms(new Float32Array(480))).toBe(0);
    expect(rms(new Float32Array(0))).toBe(0);
    expect(rms(at(LEVEL_FLOOR_DB - 10))).toBe(0);
  });

  it("is decibel-scaled: the floor is 0, the ceiling 1, halfway in dB is a half", () => {
    expect(rms(at(LEVEL_FLOOR_DB))).toBeCloseTo(0, 5);
    expect(rms(at(LEVEL_CEIL_DB))).toBeCloseTo(1, 5);
    expect(rms(at((LEVEL_FLOOR_DB + LEVEL_CEIL_DB) / 2))).toBeCloseTo(0.5, 5);
  });

  it("clamps a full-scale sine to 1 and climbs with loudness", () => {
    const sine = new Float32Array(480).map((_, i) => Math.sin((2 * Math.PI * i) / 48));
    expect(rms(sine)).toBe(1);
    const levels = [-50, -40, -30, -20].map((db) => rms(at(db)));
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    // A normal voice, -40 to -20 dB, spans the middle of the scale rather than its last sliver.
    expect(levels[1]).toBeGreaterThan(0.2);
    expect(levels[3]).toBeLessThan(0.9);
  });

  it("is 0 with no microphone capturing and nothing played", () => {
    expect(currentLevel()).toBe(0);
  });
});

describe("openMicrophone releases the microphone on failure (council voice full r2 robustness-5)", () => {
  function rig(failAt: "context" | "source" | "processor" | null) {
    const boom = new Error(`boom at ${failAt}`);
    const track = () => ({ stop: vi.fn() });
    const tracks = [track(), track()];
    const stream = { getTracks: () => tracks } as unknown as MediaStream;
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    const close = vi.fn(() => Promise.resolve());
    const context = {
      sampleRate: 48_000,
      destination: {},
      close,
      createMediaStreamSource: () => {
        if (failAt === "source") throw boom;
        return node();
      },
      createScriptProcessor: () => {
        if (failAt === "processor") throw boom;
        return { ...node(), onaudioprocess: null };
      },
      createGain: () => ({ ...node(), gain: { value: 1 } }),
    };
    const apis = {
      getUserMedia: () => Promise.resolve(stream),
      audioContext: () => {
        if (failAt === "context") throw boom;
        return context as unknown as AudioContext;
      },
    };
    return { apis, tracks, close, boom };
  }

  it.each([
    ["audioContext() throws", "context", false],
    ["createMediaStreamSource throws", "source", true],
    ["createScriptProcessor throws", "processor", true],
  ] as const)("%s: the original error, both tracks stopped once", async (_name, failAt, created) => {
    const { apis, tracks, close, boom } = rig(failAt);
    await expect(openMicrophone(apis, () => undefined)).rejects.toBe(boom);
    for (const t of tracks) expect(t.stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(created ? 1 : 0);
  });

  it("stop() stops both tracks and closes the context once; a second stop() does nothing", async () => {
    const { apis, tracks, close } = rig(null);
    const session = await openMicrophone(apis, () => undefined);
    session.stop();
    session.stop();
    for (const t of tracks) expect(t.stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("her reply plays into a context that is running", () => {
  /** A context the engine created suspended: one made after the gesture that started the turn. */
  function suspended() {
    const resume = vi.fn(async () => {});
    const started: number[] = [];
    const context = {
      state: "suspended",
      currentTime: 0,
      destination: {},
      resume,
      createAnalyser: () => ({ fftSize: 0, connect: () => {}, getFloatTimeDomainData: () => {} }),
      createBuffer: (_c: number, length: number) => ({ duration: length / 16000, copyToChannel: () => {} }),
      createBufferSource: () => ({
        buffer: null as unknown,
        connect: () => {},
        start: (at: number) => started.push(at),
        stop: () => {},
        onended: null as unknown,
      }),
    };
    return { context, resume, started };
  }

  it("resumes a suspended context before her first chunk, as the studio's preview player does", () => {
    const { context, resume, started } = suspended();
    const player = new Player(() => context as unknown as AudioContext);
    player.play(1, new Uint8Array([0, 1, 0, 2]), 16000);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(started).toHaveLength(1);
  });

  it("asks nothing of a context that is already running", () => {
    const { context, resume } = suspended();
    context.state = "running";
    const player = new Player(() => context as unknown as AudioContext);
    player.play(1, new Uint8Array([0, 1, 0, 2]), 16000);
    player.play(1, new Uint8Array([0, 1, 0, 2]), 16000);
    expect(resume).not.toHaveBeenCalled();
  });
});

describe("the player's clock, for her face", () => {
  /** A context whose clock the test moves, at 1000 Hz so one second is 1000 samples. */
  function clocked() {
    const sources: Array<{ at: number; onended: (() => void) | null }> = [];
    const context = {
      state: "running",
      currentTime: 0,
      destination: {},
      createAnalyser: () => ({ fftSize: 0, connect: () => {}, getFloatTimeDomainData: () => {} }),
      createBuffer: (_c: number, length: number, rate: number) => ({ duration: length / rate, copyToChannel: () => {} }),
      createBufferSource: () => {
        const source = {
          at: 0,
          buffer: null as unknown,
          connect: () => {},
          start: (at: number) => {
            source.at = at;
          },
          stop: () => {},
          onended: null as (() => void) | null,
        };
        sources.push(source);
        return source;
      },
    };
    const player = new Player(() => context as unknown as AudioContext);
    return { context, player, sources };
  }

  /** `n` samples of PCM16. */
  const pcm = (n: number) => new Uint8Array(n * 2);

  it("maps the context's clock onto the line's samples across back-to-back chunks", () => {
    const { context, player } = clocked();
    context.currentTime = 1;
    player.play(3, pcm(100), 1000); // 1.0 .. 1.1
    player.play(3, pcm(100), 1000); // 1.1 .. 1.2
    expect(player.position(3)).toBe(0);
    context.currentTime = 1.05;
    expect(player.position(3)).toBe(50);
    context.currentTime = 1.15;
    expect(player.position(3)).toBe(150);
    context.currentTime = 5;
    expect(player.position(3)).toBe(200);
    expect(player.position(4)).toBeNull();
  });

  it("holds at the end of what played through an underrun, then goes on from the late chunk", () => {
    const { context, player } = clocked();
    player.play(1, pcm(100), 1000); // 0 .. 0.1
    context.currentTime = 0.3; // the next chunk arrives late
    player.play(1, pcm(100), 1000); // 0.3 .. 0.4
    context.currentTime = 0.25;
    expect(player.position(1)).toBe(100);
    context.currentTime = 0.35;
    expect(player.position(1)).toBe(150);
  });

  it("subtracts the output latency the engine reports, so the mouth matches what is heard", () => {
    const { context, player } = clocked();
    player.play(1, pcm(1000), 1000);
    (context as unknown as { outputLatency: number }).outputLatency = 0.04;
    context.currentTime = 0.5;
    expect(player.position(1)).toBe(460);
  });

  it("keeps a finished line's clock through its tail and forgets it when the last source ends", () => {
    const { context, player, sources } = clocked();
    player.play(2, pcm(100), 1000);
    player.play(2, pcm(100), 1000);
    player.finished(2); // voice.stopped done, synthesis ahead of playback
    context.currentTime = 0.15;
    expect(playbackSample(2)).toBe(150);
    expect(playbackSounding(2)).toBe(true);
    sources[0].onended?.();
    expect(player.position(2)).toBe(150);
    sources[1].onended?.();
    expect(player.position(2)).toBeNull();
    expect(playbackSounding(2)).toBe(false);
  });

  it("a dropped line has no clock", () => {
    const { player } = clocked();
    player.play(2, pcm(100), 1000);
    player.drop(2);
    expect(player.position(2)).toBeNull();
    expect(player.holds(2)).toBe(true);
    player.finished(2);
    expect(player.holds(2)).toBe(false);
  });
});
