/**
 * The headless push-to-talk test — plan c32.
 *
 * The real store against a fake socket, a fake microphone and a fake page. No window, no audio
 * device and no daemon: the fake socket is handed the same JSON frames the gateway writes, and
 * what the test asserts is what the shell would do with them — where the transcript lands, which
 * calls run on the page and which are refused, when the player drops a generation.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { Player, SocketLike } from "@/lib/voice";
import { useRun } from "@/stores/run";

import { resetVoiceForTests, setVoiceDeps, startVoice, useVoice, type VoiceDeps } from "./voice";

type Event = Record<string, unknown>;

function fakeSocket() {
  const sent: unknown[] = [];
  let live: SocketLike | null = null;
  const factory = () => {
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
  return {
    factory,
    sent,
    frames: () => sent.filter((s): s is string => typeof s === "string").map((s) => JSON.parse(s) as Event),
    audio: () => sent.filter((s) => s instanceof Uint8Array) as Uint8Array[],
    emit: async (...events: Event[]) => {
      for (const event of events) live?.onmessage?.({ data: JSON.stringify(event) });
      await new Promise((r) => setTimeout(r, 0));
    },
    emitAudio: (generation: number) => {
      live?.onmessage?.({ data: new Uint8Array([0, 0, 0, generation, 1, 0, 2, 0]).buffer });
    },
    drop: () => live?.close(),
  };
}

function fakeMic() {
  let chunk: ((pcm: Int16Array) => void) | null = null;
  let stopped = 0;
  return {
    opened: () => chunk !== null,
    stops: () => stopped,
    speak: (pcm: Int16Array) => chunk?.(pcm),
    open: async (onChunk: (pcm: Int16Array) => void) => {
      chunk = onChunk;
      return {
        stop: () => {
          stopped += 1;
          chunk = null;
        },
      };
    },
  };
}

function fakePlayer() {
  const played: number[] = [];
  const dropped: number[] = [];
  return {
    played,
    dropped,
    player: {
      play: (generation: number) => played.push(generation),
      drop: (generation: number) => dropped.push(generation),
      finished: () => {},
      playing: () => false,
    },
  };
}

function wire(over: Partial<VoiceDeps> = {}) {
  const socket = fakeSocket();
  const mic = fakeMic();
  const player = fakePlayer();
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const deps: VoiceDeps = {
    endpoint: () => ({ url: "http://daemon", token: "t" }),
    health: async () => ({ sockets: ["/voice"] }),
    socket: socket.factory,
    openMic: mic.open,
    player: () => player.player as unknown as Player,
    focused: () => ({ tabId: 1, origin: "https://ledgerbox.local", appId: "ledgerbox" }),
    hostState: () => ({ page_url: "https://ledgerbox.local/invoices" }),
    call: async (_tab, name, params) => {
      calls.push({ name, params });
      return { ok: true, output: `${name} ran` };
    },
    ...over,
  };
  setVoiceDeps(deps);
  return { socket, mic, player, calls };
}

const finished = (text: string, tts: string | null = null): Event => ({
  kind: "turn.finished",
  text,
  tts,
});

beforeEach(() => {
  resetVoiceForTests();
  useRun.setState({ transcript: [], cards: [], summary: null });
});

describe("the key", () => {
  it("lights up only when the daemon lists /voice", async () => {
    wire({ health: async () => ({ sockets: [] }) });
    await startVoice();
    expect(useVoice.getState().available).toBe(false);
    expect(useVoice.getState().reason).toMatch(/without a voice backend/);
  });

  it("sends start with the page, streams the microphone, and sends stop on release", async () => {
    const { socket, mic } = wire();
    await startVoice();
    expect(useVoice.getState().available).toBe(true);

    await useVoice.getState().press();
    expect(useVoice.getState().phase).toBe("listening");
    expect(mic.opened()).toBe(true);
    mic.speak(new Int16Array([5, 6]));
    useVoice.getState().release();

    const frames = socket.frames();
    expect(frames[0]).toEqual({
      type: "start",
      origin: "https://ledgerbox.local",
      host_state: { page_url: "https://ledgerbox.local/invoices" },
    });
    expect(frames[1]).toEqual({ type: "stop" });
    expect(socket.audio()).toEqual([new Uint8Array([5, 0, 6, 0])]);
    expect(mic.stops()).toBe(1);
    expect(useVoice.getState().phase).toBe("thinking");
  });

  it("does nothing with no page open, and says so", async () => {
    const { socket } = wire({ focused: () => null });
    await startVoice();
    await useVoice.getState().press();
    expect(useVoice.getState().phase).toBe("error");
    expect(useVoice.getState().reason).toMatch(/open a page/);
    expect(socket.frames()).toEqual([]);
  });
});

describe("a spoken turn", () => {
  it("lands in the panel's transcript as the same turn", async () => {
    const { socket } = wire();
    await startVoice();
    await useVoice.getState().press();
    await socket.emit({ kind: "voice.transcript", text: "what is", final: false });
    expect(useVoice.getState().partial).toBe("what is");
    useVoice.getState().release();
    await socket.emit(
      { kind: "voice.transcript", text: "what is overdue", final: true },
      { kind: "text.delta", text: "Two are late." },
      { kind: "turn.summary", model: "m", engine: "e", input_tokens: 1, output_tokens: 1, cost_usd: 0, cost_estimated: false, duration_ms: 1, rounds: 1 },
      finished("Two are late.", "Two are late."),
    );
    const run = useRun.getState();
    expect(run.transcript.map((e) => [e.kind, e.text])).toEqual([
      ["user", "what is overdue"],
      ["assistant", "Two are late."],
    ]);
    expect(run.summary?.rounds).toBe(1);
    expect(useVoice.getState().phase).toBe("idle");
    expect(useVoice.getState().partial).toBe("");
  });

  it("runs an unsettled host call on the page and answers the daemon; a settled one it does not", async () => {
    const { socket, calls } = wire();
    await startVoice();
    await useVoice.getState().say("chase invoice 3");
    await socket.emit(
      { kind: "tool.call", call_id: "c1", name: "host.ledgerbox.chase", params: { invoice: "3" }, origin: "host:ledgerbox", tier: 1 },
      { kind: "tool.call", call_id: "c2", name: "host.ledgerbox.pay", params: { invoice: "3" }, origin: "host:ledgerbox", tier: 1 },
      { kind: "tool.result", call_id: "c2", name: "host.ledgerbox.pay", ok: false, output: "", truncated: false, error: "pending_approval", tier: 1, ms: 0 },
      { kind: "decision.requested", id: "apr_1", decision_kind: "approve", action: "host.ledgerbox.pay", params: { invoice: "3" }, rationale: "", options: [{ id: "approve", label: "approve" }, { id: "decline", label: "decline" }], expires_at: "", origin: "host:ledgerbox", surface: "voice", capture_id: null },
      finished("Reading."),
    );
    expect(calls).toEqual([{ name: "chase", params: { invoice: "3" } }]);
    const result = socket.frames().find((f) => f.type === "tool_result");
    expect(result).toEqual({
      type: "tool_result",
      call_id: "c1",
      name: "host.ledgerbox.chase",
      ok: true,
      output: "chase ran",
      error: null,
      tier: 1,
    });
    expect(useRun.getState().cards.map((c) => c.id)).toEqual(["apr_1"]);
    expect(useVoice.getState().phase).toBe("thinking");
    await socket.emit({ kind: "decision.resolved", id: "apr_1", choice: "decline", by: "user", at: "" });
    expect(useRun.getState().cards).toEqual([]);
  });

  it("refuses a call for a page that is not the focused one", async () => {
    const { socket, calls } = wire();
    await startVoice();
    await useVoice.getState().say("hi");
    await socket.emit(
      { kind: "tool.call", call_id: "c1", name: "host.crm.merge", params: {}, origin: "host:crm", tier: 1 },
      finished("Merging."),
    );
    expect(calls).toEqual([]);
    const result = socket.frames().find((f) => f.type === "tool_result");
    expect(result?.ok).toBe(false);
    expect(String(result?.error)).toMatch(/foreign_origin/);
  });

  it("reports a turn.error and stops", async () => {
    const { socket } = wire();
    await startVoice();
    await useVoice.getState().say("hi");
    await socket.emit({ kind: "turn.error", reason: "engine_error", detail: "no engine" });
    expect(useVoice.getState().phase).toBe("error");
    expect(useVoice.getState().reason).toBe("engine_error: no engine");
  });
});

describe("playback and barge-in", () => {
  it("plays the generation it is told and drops it on barge_in", async () => {
    const { socket, player } = wire();
    await startVoice();
    await useVoice.getState().say("hi");
    await socket.emit(
      finished("Hello."),
      { kind: "voice.speaking", generation: 1, text: "Hello.", truncated: false, sample_rate: 24000 },
    );
    expect(useVoice.getState().phase).toBe("speaking");
    socket.emitAudio(1);
    socket.emitAudio(1);
    expect(player.played).toEqual([1, 1]);
    await socket.emit({ kind: "voice.stopped", generation: 1, reason: "barge_in" });
    expect(player.dropped).toEqual([1]);
    expect(useVoice.getState().phase).toBe("idle");
    expect(useVoice.getState().generation).toBeNull();
  });

  it("pressing the key over a reply drops it locally and sends start, which the daemon reads as a barge-in", async () => {
    const { socket, player } = wire();
    await startVoice();
    await useVoice.getState().say("hi");
    await socket.emit(
      finished("Hello."),
      { kind: "voice.speaking", generation: 3, text: "Hello.", truncated: false, sample_rate: 16000 },
    );
    await useVoice.getState().press();
    expect(player.dropped).toEqual([3]);
    expect(useVoice.getState().phase).toBe("listening");
    expect(socket.frames().at(-1)?.type).toBe("start");
  });

  it("a socket that closes mid-turn leaves the key usable and says what happened", async () => {
    const { socket } = wire();
    await startVoice();
    await useVoice.getState().say("hi");
    socket.drop();
    expect(useVoice.getState().phase).toBe("idle");
    expect(useVoice.getState().reason).toMatch(/voice closed/);
  });
});
