/**
 * The audio arithmetic and the socket framing, on their own (lib/voice.ts).
 *
 * A wrong sample rate is a backend that hears chipmunks, and a frame split one byte off is a
 * player that plays a generation number as a click. Neither is caught by a run that "works".
 */
import { describe, expect, it } from "vitest";

import {
  LEVEL_CEIL_DB,
  LEVEL_FLOOR_DB,
  PROTOCOL_PREFIX,
  VoiceSocket,
  currentLevel,
  downsample,
  int16ToBytes,
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
    const client = new VoiceSocket(fake.factory, {
      onEvent: () => {},
      onAudio: () => {},
      onClose: () => {},
    });
    await client.connect("http://d", "t");
    expect(() => fake.socket()?.onmessage?.({ data: JSON.stringify({ kind: "voice.invented" }) })).toThrow(
      /unknown channel event kind/,
    );
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
