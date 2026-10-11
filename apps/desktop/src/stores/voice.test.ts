/**
 * The headless push-to-talk test — plan c32.
 *
 * The real store against a fake socket, a fake microphone and a fake page. No window, no audio
 * device and no daemon: the fake socket is handed the same JSON frames the gateway writes, and
 * what the test asserts is what the shell would do with them — where the transcript lands, which
 * calls run on the page and which are refused, when the player drops a generation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BridgeTool } from "@/lib/bridge";
import { setHandsForTests } from "@/lib/hands";
import { derivedIdOf } from "@/lib/manifest";
import type { Player, SocketLike } from "@/lib/voice";
import { snapshotOf, useRun } from "@/stores/run";
import type { TabTools } from "@/stores/tools";

import {
  applyVoiceConfig,
  resetVoiceForTests,
  setVoiceDeps,
  startVoice,
  useVoice,
  type VoiceDeps,
} from "./voice";

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

/** A microphone that opens only when the test says so, to put a release inside the open. */
function slowMic() {
  let resolve: (() => void) | null = null;
  let chunk: ((pcm: Int16Array) => void) | null = null;
  let stopped = 0;
  let opens = 0;
  return {
    opens: () => opens,
    stops: () => stopped,
    speak: (pcm: Int16Array) => chunk?.(pcm),
    pending: () => resolve !== null,
    resolve: () => resolve?.(),
    open: (onChunk: (pcm: Int16Array) => void) => {
      opens += 1;
      chunk = onChunk;
      return new Promise<{ stop: () => void }>((done) => {
        resolve = () => done({ stop: () => (stopped += 1) });
      });
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
    config: async () => ({ ready: true, reason: null }),
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
  it("stays dark while the voice config is not ready, and says the config's own reason", async () => {
    wire({ config: async () => ({ ready: false, reason: "Kokoro is not installed." }) });
    await startVoice();
    expect(useVoice.getState().available).toBe(false);
    expect(useVoice.getState().phase).toBe("off");
    expect(useVoice.getState().reason).toBe("Kokoro is not installed.");
  });

  it("a config that is not ready and gives no reason still says why", async () => {
    wire({ config: async () => ({ ready: false, reason: null }) });
    await startVoice();
    expect(useVoice.getState().reason).toBe("voice is not set up yet");
  });

  it("a config that could not be read leaves the key dark with the error", async () => {
    wire({
      config: async () => {
        throw new Error("the daemon did not answer");
      },
    });
    await startVoice();
    expect(useVoice.getState().available).toBe(false);
    expect(useVoice.getState().reason).toBe("the daemon did not answer");
  });

  it("with no daemon at all the key is dark and says so", async () => {
    wire({ endpoint: () => null });
    await startVoice();
    expect(useVoice.getState().available).toBe(false);
    expect(useVoice.getState().reason).toMatch(/not running/);
  });

  it("lights up the moment the Voice module applies a ready config", async () => {
    wire({ config: async () => ({ ready: false, reason: "Whisper base.en is not installed." }) });
    await startVoice();
    expect(useVoice.getState().available).toBe(false);
    applyVoiceConfig({ ready: true, reason: null });
    expect(useVoice.getState().available).toBe(true);
    expect(useVoice.getState().phase).toBe("idle");
    expect(useVoice.getState().reason).toBe("");
  });

  it("a press on a dark key asks the config once more before giving up", async () => {
    let ready = false;
    const { mic } = wire({ config: async () => ({ ready, reason: ready ? null : "not yet" }) });
    await startVoice();
    expect(useVoice.getState().available).toBe(false);
    ready = true; // the studio finished in the other window
    await useVoice.getState().press();
    expect(useVoice.getState().available).toBe(true);
    expect(useVoice.getState().phase).toBe("listening");
    expect(mic.opened()).toBe(true);
  });

  it("sends start with the page, streams the microphone, and sends stop on release", async () => {
    const { socket, mic } = wire({
      disabledOrigins: () => ["host:other"],
      gated: () => ({ gated_origins: ["host:ledgerbox"], gated_tools: ["host.inbox.send"] }),
    });
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
      disabled_origins: ["host:other"],
      gated_origins: ["host:ledgerbox"],
      gated_tools: ["host.inbox.send"],
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
  it("carries the switched-off list on a typed utterance too", async () => {
    const { socket } = wire({ disabledOrigins: () => ["host:ledgerbox"] });
    await startVoice();
    await useVoice.getState().say("hi");
    expect(socket.frames().find((f) => f.type === "text")).toMatchObject({
      disabled_origins: ["host:ledgerbox"],
    });
  });

  it("carries the first-sight apps and the GATED pins on a typed utterance too (ADR 0063)", async () => {
    const { socket } = wire({
      gated: () => ({ gated_origins: ["host:ledgerbox"], gated_tools: ["host.inbox.send"] }),
    });
    await startVoice();
    await useVoice.getState().say("hi");
    expect(socket.frames().find((f) => f.type === "text")).toMatchObject({
      gated_origins: ["host:ledgerbox"],
      gated_tools: ["host.inbox.send"],
    });
  });

  it("sends both lists empty, not absent, when nothing is wired to tighten", async () => {
    const { socket } = wire();
    await startVoice();
    await useVoice.getState().say("hi");
    expect(socket.frames().find((f) => f.type === "text")).toMatchObject({
      gated_origins: [],
      gated_tools: [],
    });
  });

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

  it("answers the daemon with a hand's result at tier 2", async () => {
    const { socket } = wire({ call: async () => ({ ok: true, output: "the page", tier: 2 }) });
    await startVoice();
    await useVoice.getState().say("read it");
    await socket.emit(
      { kind: "tool.call", call_id: "c1", name: "host.ledgerbox.page_read", params: {}, origin: "host:ledgerbox", tier: 1 },
      finished("Reading."),
    );
    const result = socket.frames().find((f) => f.type === "tool_result");
    expect(result).toMatchObject({ call_id: "c1", ok: true, output: "the page", tier: 2 });
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

  it("keeps what she heard and what she says for the halo's caption, and lets go of both", async () => {
    const { socket } = wire();
    await startVoice();
    await useVoice.getState().press();
    useVoice.getState().release();
    await socket.emit({ kind: "voice.transcript", text: "what is overdue", final: true });
    expect(useVoice.getState().heard).toBe("what is overdue");
    expect(useVoice.getState().phase).toBe("thinking");
    await socket.emit(finished("Two are late."));
    expect(useVoice.getState().heard).toBe("");
    await socket.emit({ kind: "voice.speaking", generation: 2, text: "Two are late.", truncated: false, sample_rate: 24000 });
    expect(useVoice.getState().speakingText).toBe("Two are late.");
    await socket.emit({ kind: "voice.stopped", generation: 2, reason: "done" });
    expect(useVoice.getState().speakingText).toBe("");
    expect(useVoice.getState().phase).toBe("idle");
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

describe("the capture (ADR 0066)", () => {
  const taken = { id: "cap_0123456789ab", why: null };

  it("is taken before the start frame and before a text frame, and rides both", async () => {
    const { socket } = wire({ capture: async () => taken });
    await startVoice();

    await useVoice.getState().press();
    useVoice.getState().release();
    await useVoice.getState().say("hi");

    const frames = socket.frames();
    expect(frames.find((f) => f.type === "start")).toMatchObject({ capture_id: taken.id });
    expect(frames.find((f) => f.type === "text")).toMatchObject({ capture_id: taken.id });
  });

  it("that failed sends none, the frame still goes, and the reason is kept", async () => {
    const { socket } = wire({ capture: async () => ({ id: null, why: "no screenshot hand" }) });
    await startVoice();

    await useVoice.getState().say("hi");

    const frame = socket.frames().find((f) => f.type === "text");
    expect(frame).toBeDefined();
    expect(frame).not.toHaveProperty("capture_id");
    expect(useRun.getState().captureNow).toBe("no screenshot hand");
  });

  it("is not asked for when nothing is wired (no shell)", async () => {
    const { socket } = wire();
    await startVoice();

    await useVoice.getState().say("hi");

    expect(socket.frames().find((f) => f.type === "text")).not.toHaveProperty("capture_id");
  });
});

describe("one snapshot per turn (ADR 0067)", () => {
  const ORIGIN = "https://sx.dtest";
  const DERIVED = derivedIdOf(ORIGIN) as string;
  const tool = (name: string): BridgeTool => ({
    name,
    title: name,
    description: `${name}.`,
    inputSchema: {},
    annotations: null,
    athena: { reversible: true, side_effects: "none" },
  });
  const entry = (appId: string | null, tools: BridgeTool[]): TabTools => ({
    tabId: 1,
    url: `${ORIGIN}/`,
    tools,
    transport: tools.length ? "webmcp-native" : null,
    appId,
    appVersion: null,
    problem: null,
    asking: false,
  });
  const NO_ROWS = { records: {}, known: [] as string[], loaded: true, problem: null };
  const tabs = [{ id: 1, label: "page-1", url: `${ORIGIN}/`, title: "", loading: false, focused: true }] as never;
  const manifests: Array<{ app_id: string }> = [];

  beforeEach(() => {
    manifests.length = 0;
    setHandsForTests([tool("page_read")]);
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if (String(url).endsWith("/manifest")) manifests.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
  });
  afterEach(() => {
    setHandsForTests([]);
    vi.unstubAllGlobals();
  });

  const nothing = { id: null, why: null };

  /** The tab as the store would read it; `refresh` is what lands between the manifest and the frame. */
  function world(initial: Record<number, TabTools>, refresh?: (state: { byTab: Record<number, TabTools> }) => void) {
    const state = { byTab: initial };
    const routed: Array<readonly BridgeTool[] | undefined> = [];
    const harness = wire({
      snapshot: () => snapshotOf(NO_ROWS, tabs, state.byTab),
      capture: async () => (refresh?.(state), nothing),
      call: async (_tab, _name, _params, tools) => {
        routed.push(tools);
        return { ok: true, output: "ran" };
      },
    });
    return { ...harness, state, routed };
  }

  it("say: a refresh that blanks the entry after the manifest leaves the frame naming the manifest's app", async () => {
    const w = world({ 1: entry("ledger", [tool("list")]) }, (s) => void (s.byTab = { 1: entry(null, []) }));
    await startVoice();

    await useVoice.getState().say("hi");

    expect(manifests[0].app_id).toBe("ledger");
    expect(w.socket.frames().find((f) => f.type === "text")).toMatchObject({ gated_origins: ["host:ledger"] });
  });

  it("press: a tab unread at the manifest whose list arrives before the frame stays the derived app", async () => {
    const w = world({}, (s) => void (s.byTab = { 1: entry("ledger", [tool("list")]) }));
    await startVoice();

    await useVoice.getState().press();

    expect(manifests[0].app_id).toBe(DERIVED);
    expect(w.socket.frames().find((f) => f.type === "start")).toMatchObject({ gated_origins: [`host:${DERIVED}`] });
  });

  it("a later frame carries no lists, and the next utterance takes a new snapshot", async () => {
    const w = world({ 1: entry("ledger", [tool("list")]) });
    await startVoice();
    await useVoice.getState().say("one");
    await w.socket.emit(
      { kind: "tool.call", call_id: "c1", name: "host.ledger.list", params: {}, origin: "host:ledgerbox", tier: 1 },
      finished("Reading."),
    );
    expect(w.socket.frames().find((f) => f.type === "tool_result")).not.toHaveProperty("gated_origins");

    w.state.byTab = { 1: entry("other", [tool("list")]) };
    await useVoice.getState().say("two");

    const texts = w.socket.frames().filter((f) => f.type === "text");
    expect(texts.map((f) => f.gated_origins)).toEqual([["host:ledger"], ["host:other"]]);
    expect(manifests.map((m) => m.app_id)).toEqual(["ledger", "other"]);
  });

  it("routes a released call by the list the gate classified, not the live one (robustness-5)", async () => {
    const own = tool("page_click");
    const w = world({ 1: entry("ledger", [own]) });
    await startVoice();
    await useVoice.getState().say("click it");
    w.state.byTab = { 1: entry(null, []) };

    await w.socket.emit(
      { kind: "tool.call", call_id: "c1", name: "host.ledgerbox.page_click", params: {}, origin: "host:ledgerbox", tier: 1 },
      finished("Clicking."),
    );

    expect(w.routed).toEqual([[own]]);
  });
});

describe("the microphone closes whenever listening ends (council full r1 robustness-6)", () => {
  it("a release during a pending openMic stops the mic that resolves and sends no PCM after it", async () => {
    const slow = slowMic();
    const { socket } = wire({ openMic: slow.open });
    await startVoice();
    const pressed = useVoice.getState().press();
    await vi.waitFor(() => expect(slow.pending()).toBe(true));
    expect(useVoice.getState().phase).toBe("listening");

    useVoice.getState().release();
    slow.resolve();
    await pressed;

    expect(slow.stops()).toBe(1);
    slow.speak(new Int16Array([1, 2]));
    expect(socket.audio()).toEqual([]);
    expect(socket.frames().map((f) => f.type)).toEqual(["start", "stop"]);
    expect(useVoice.getState().phase).not.toBe("listening");
  });

  it("a release during captureOf never opens the microphone and never sends start", async () => {
    const slow = slowMic();
    let finish: (() => void) | null = null;
    const { socket } = wire({
      openMic: slow.open,
      capture: () => new Promise((done) => (finish = () => done({ id: null, why: "late" }) as never)),
    });
    await startVoice();
    const pressed = useVoice.getState().press();
    await vi.waitFor(() => expect(finish).not.toBeNull());

    useVoice.getState().release();
    finish!();
    await pressed;

    expect(slow.opens()).toBe(0);
    expect(socket.frames()).toEqual([]);
    expect(useVoice.getState().phase).toBe("idle");
  });

  it("the socket closing while listening stops the microphone", async () => {
    const { socket, mic } = wire();
    await startVoice();
    await useVoice.getState().press();
    expect(mic.opened()).toBe(true);
    socket.drop();
    expect(mic.stops()).toBe(1);
    expect(mic.opened()).toBe(false);
  });

  it("a turn.error while listening stops the microphone", async () => {
    const { socket, mic } = wire();
    await startVoice();
    await useVoice.getState().press();
    await socket.emit({ kind: "turn.error", reason: "validator_failed", detail: "too long" });
    expect(mic.stops()).toBe(1);
    expect(useVoice.getState().phase).toBe("error");
  });

  it("a blur while listening acts as the key coming up", async () => {
    const listeners = new Map<string, () => void>();
    const target = { addEventListener: (type: string, fn: () => void) => listeners.set(type, fn) };
    vi.stubGlobal("window", target);
    vi.stubGlobal("document", { ...target, visibilityState: "visible" });
    try {
      const { socket, mic } = wire();
      await startVoice();
      await useVoice.getState().press();
      expect(useVoice.getState().phase).toBe("listening");
      listeners.get("blur")?.();
      expect(mic.stops()).toBe(1);
      expect(socket.frames().map((f) => f.type)).toEqual(["start", "stop"]);
      expect(useVoice.getState().phase).toBe("thinking");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
