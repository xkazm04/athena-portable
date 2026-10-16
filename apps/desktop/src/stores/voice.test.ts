/**
 * The headless push-to-talk test — plan c32.
 *
 * The real store against a fake socket, a fake microphone and a fake page. No window, no audio
 * device and no daemon: the fake socket is handed the same JSON frames the gateway writes, and
 * what the test asserts is what the shell would do with them — where the transcript lands, which
 * calls run on the page and which are refused, when the player drops a generation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DaemonApi } from "@/lib/api";
import type { BridgeTool } from "@/lib/bridge";
import { setHandsForTests } from "@/lib/hands";
import { derivedIdOf } from "@/lib/manifest";
import { Player as RealPlayer, type Player, type SocketLike } from "@/lib/voice";
import { resetRunForTests, setRunDeps, snapshotOf, unsureTools, useRun } from "@/stores/run";
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
    refuse: (code: number, reason: string) => {
      if (!live) return;
      live.readyState = 3;
      live.onclose?.({ code, reason });
    },
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
  // The run store holds the window's unsure tools (ADR 0101); a test starts with none.
  resetRunForTests();
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

// -- a spoken call that outlives its deadline (ADR 0101: the hold is the window's) ---------------

describe("a spoken host call that outlives its deadline", () => {
  const flagged = (name: string, athena: Record<string, unknown>): BridgeTool => ({
    name,
    title: name,
    description: `${name}.`,
    inputSchema: {},
    annotations: null,
    athena,
  });
  const PAY = flagged("pay", { reversible: false, side_effects: "external" });
  const LIST = flagged("list_overdue", { reversible: true, side_effects: "none" });
  const TIMED_OUT = { ok: false, output: "", error: "did not answer within 30000 ms", reason: "timeout" };
  const FOCUSED = { tabId: 1, origin: "https://ledgerbox.local", appId: "ledgerbox" };
  const NONE = { gated_origins: [] as string[], gated_tools: [] as string[] };
  const hostCall = (callId: string, name: string): Event => ({
    kind: "tool.call",
    call_id: callId,
    name,
    params: { invoice: "INV-118" },
    origin: "host:ledgerbox",
    tier: 1,
  });
  const PAY_CARD = {
    kind: "decision.requested",
    id: "apr_pay",
    decision_kind: "approve",
    action: "host.ledgerbox.pay",
    params: { invoice: "INV-118" },
    rationale: "",
    options: [
      { id: "approve", label: "approve" },
      { id: "decline", label: "decline" },
    ],
    expires_at: "",
    origin: "host:ledgerbox",
    surface: "panel",
    capture_id: null,
  };

  /** A voice store whose page answers `answers[bare]`, else ok; the snapshot lists pay and list_overdue. */
  function spoken(answers: Record<string, { ok: boolean; output: string; error?: string; reason?: string }> = {}) {
    const calls: Array<{ name: string }> = [];
    const harness = wire({
      snapshot: () => ({ focused: FOCUSED, manifest: null, disabledOrigins: [], gated: NONE, tools: [PAY, LIST] }),
      call: async (_tab, name) => {
        calls.push({ name });
        return answers[name] ?? { ok: true, output: `${name} ran` };
      },
    });
    return { ...harness, calls };
  }

  /** A panel turn whose `pay` times out, through the real run store against a scripted daemon. */
  async function panelLeavesPayUnsure(): Promise<void> {
    const frame = (e: Event) => `event: ${String(e.kind)}\ndata: ${JSON.stringify(e)}\n\n`;
    const runs: Event[][] = [[hostCall("p1", "host.ledgerbox.pay"), finished("")], [finished("")]];
    let turn = 0;
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const fetchImpl = async (url: string): Promise<Response> => {
      const path = url.replace("http://daemon", "");
      if (path === "/run") {
        const events = runs[turn++] ?? [finished("")];
        return new Response(events.map(frame).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      if (path === "/decisions") return json({ ok: true, pending: [], showing: 0, total: 0, footer: "" });
      if (path === "/decisions/apr_pay") {
        return json({ ok: true, id: "apr_pay", status: "declined", choice: "decline", conversation_id: "c", execute: [], output: "", events: [] });
      }
      return json({ ok: true });
    };
    setRunDeps({
      api: () => new DaemonApi({ url: "http://daemon", token: "t" }, fetchImpl),
      focused: () => FOCUSED,
      hostState: () => ({}),
      call: async () => TIMED_OUT,
      snapshot: () => ({ focused: FOCUSED, manifest: null, disabledOrigins: [], gated: NONE, tools: [PAY, LIST] }),
    });
    await useRun.getState().send("pay INV-118");
    expect(unsureTools().map((u) => u.tool)).toEqual(["host.ledgerbox.pay"]);
  }

  it("a timed-out spoken write answers outcome_unknown and leaves the tool unsure", async () => {
    const { socket, calls } = spoken({ pay: TIMED_OUT });
    await startVoice();
    await useVoice.getState().say("pay INV-118");
    await socket.emit(hostCall("c1", "host.ledgerbox.pay"), finished("Paying."));

    expect(calls.map((c) => c.name)).toEqual(["pay"]);
    const result = socket.frames().find((f) => f.type === "tool_result");
    expect(String(result?.error)).toMatch(/^outcome_unknown:/);
    expect(result?.ok).toBe(false);
    expect(unsureTools().map((u) => u.tool)).toEqual(["host.ledgerbox.pay"]);
    expect(useRun.getState().transcript.find((e) => e.id === "c1")?.text).toBe(
      "host.ledgerbox.pay → may have completed: no answer before the deadline",
    );
  });

  it("a timed-out spoken read answers a plain timeout and holds nothing", async () => {
    const { socket } = spoken({ list_overdue: TIMED_OUT });
    await startVoice();
    await useVoice.getState().say("what is overdue");
    await socket.emit(hostCall("c1", "host.ledgerbox.list_overdue"), finished("Reading."));

    const result = socket.frames().find((f) => f.type === "tool_result");
    expect(String(result?.error)).toMatch(/^timeout:/);
    expect(unsureTools()).toEqual([]);
  });

  it("a tool a panel turn left unsure rides gated_tools on the next start and text frames", async () => {
    await panelLeavesPayUnsure();
    const { socket } = spoken();
    await startVoice();

    await useVoice.getState().press();
    useVoice.getState().release();
    await useVoice.getState().say("pay it again");

    expect(socket.frames().find((f) => f.type === "start")?.gated_tools).toContain("host.ledgerbox.pay");
    expect(socket.frames().find((f) => f.type === "text")?.gated_tools).toContain("host.ledgerbox.pay");
  });

  it("a released call of an unsure tool is held: the page is never called", async () => {
    await panelLeavesPayUnsure();
    const { socket, calls } = spoken();
    await startVoice();
    await useVoice.getState().say("pay it again");
    await socket.emit(hostCall("c1", "host.ledgerbox.pay"), finished("Paying."));

    expect(calls).toEqual([]);
    const result = socket.frames().find((f) => f.type === "tool_result");
    expect(result?.ok).toBe(false);
    expect(String(result?.error)).toMatch(/^outcome_unknown:/);
    expect(useRun.getState().transcript.find((e) => e.id === "c1")?.text).toBe(
      "host.ledgerbox.pay → held: it may already have run",
    );
  });

  it("answering a card for the tool lifts the hold for the next spoken turn", async () => {
    await panelLeavesPayUnsure();
    const { socket } = spoken();
    await startVoice();
    await useVoice.getState().press();
    useVoice.getState().release();

    useRun.setState({ cards: [PAY_CARD as never] });
    await useRun.getState().answer("apr_pay", "decline");
    await useVoice.getState().press();

    const starts = socket.frames().filter((f) => f.type === "start");
    expect(starts.map((f) => f.gated_tools)).toEqual([["host.ledgerbox.pay"], []]);
  });

  it("a spoken answer to the tool's card lifts the hold too, so the approved call runs", async () => {
    await panelLeavesPayUnsure();
    const { socket, calls } = spoken();
    await startVoice();
    await useVoice.getState().say("pay it again");
    await socket.emit({ ...PAY_CARD, surface: "voice" }, finished("Card filed."));
    await socket.emit(
      { kind: "decision.resolved", id: "apr_pay", choice: "approve", by: "user", at: "" },
      hostCall("apr_pay_exec", "host.ledgerbox.pay"),
      finished("Paid."),
    );

    expect(unsureTools()).toEqual([]);
    expect(calls.map((c) => c.name)).toEqual(["pay"]);
  });

  it("guard: a host call that answers ok answers the daemon and the transcript as before", async () => {
    const { socket } = spoken();
    await startVoice();
    await useVoice.getState().say("pay INV-118");
    await socket.emit(hostCall("c1", "host.ledgerbox.pay"), finished("Paying."));

    expect(socket.frames().find((f) => f.type === "tool_result")).toEqual({
      type: "tool_result",
      call_id: "c1",
      name: "host.ledgerbox.pay",
      ok: true,
      output: "pay ran",
      error: null,
      tier: 1,
    });
    expect(useRun.getState().transcript.find((e) => e.id === "c1")?.text).toBe("host.ledgerbox.pay → pay ran");
    expect(unsureTools()).toEqual([]);
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

  it("a final transcript that says the utterance ended leaves thinking and says why; a message does not", async () => {
    const { socket } = wire();
    await startVoice();
    await useVoice.getState().press();
    useVoice.getState().release();
    expect(useVoice.getState().phase).toBe("thinking");
    await socket.emit({ kind: "voice.transcript", text: "", final: true, outcome: "silent", peak_dbfs: -70 });
    expect(useVoice.getState().phase).toBe("idle");
    expect(useVoice.getState().reason).toMatch(/microphone/);
    expect(useVoice.getState().reason).toContain("-70");

    await useVoice.getState().press();
    useVoice.getState().release();
    await socket.emit({ kind: "voice.transcript", text: "what is overdue", final: true, outcome: "message", peak_dbfs: -18 });
    expect(useVoice.getState().phase).toBe("thinking");
    expect(useVoice.getState().reason).toBe("");
  });

  it("each ended outcome has its own sentence, and a stop word is quiet", async () => {
    const { socket } = wire();
    await startVoice();
    const end = async (outcome: string) => {
      await useVoice.getState().press();
      useVoice.getState().release();
      await socket.emit({ kind: "voice.transcript", text: outcome === "stop" ? "stop" : "", final: true, outcome, peak_dbfs: -30 });
      return useVoice.getState();
    };
    expect(await end("too_short")).toMatchObject({ phase: "idle", reason: expect.stringMatching(/hold the key/) });
    expect(await end("no_words")).toMatchObject({ phase: "idle", reason: expect.stringMatching(/no words/) });
    expect(await end("stop")).toMatchObject({ phase: "idle", reason: "" });
    expect(await end("answer")).toMatchObject({ phase: "thinking" });
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

  it("a line the daemon began speaking as the key went down does not take the key: release still sends stop", async () => {
    // The gateway's speaker runs on its own thread, so a voice.speaking it sent just before it read
    // the start frame lands here while the person is already talking over it.
    const { socket, player, mic } = wire();
    await startVoice();
    await useVoice.getState().press();
    expect(useVoice.getState().phase).toBe("listening");
    await socket.emit({ kind: "voice.speaking", generation: 7, text: "Two are late.", truncated: false, sample_rate: 24000 });
    expect(useVoice.getState().phase).toBe("listening");
    expect(useVoice.getState().speakingText).toBe("");
    expect(player.dropped).toContain(7);
    expect(mic.opened()).toBe(true);
    useVoice.getState().release();
    expect(socket.frames().at(-1)?.type).toBe("stop");
    expect(useVoice.getState().phase).toBe("thinking");
    // Its barge_in stop leaves the turn the person started alone.
    await socket.emit({ kind: "voice.stopped", generation: 7, reason: "barge_in" });
    expect(useVoice.getState().phase).toBe("thinking");
  });

  describe("the player holds nothing of a generation once its voice.stopped is handled", () => {
    function realPlayer(): RealPlayer {
      const source = () => ({
        buffer: null as unknown,
        connect: () => {},
        start: () => {},
        stop: () => {},
        onended: null as unknown,
      });
      const context = {
        currentTime: 0,
        destination: {},
        createAnalyser: () => ({ fftSize: 0, connect: () => {} }),
        createBuffer: (_c: number, length: number) => ({
          duration: length / 16000,
          copyToChannel: () => {},
        }),
        createBufferSource: source,
      };
      return new RealPlayer(() => context as unknown as AudioContext);
    }

    async function speaking(generation: number) {
      const player = realPlayer();
      const { socket } = wire({ player: () => player });
      await startVoice();
      await useVoice.getState().say("hi");
      await socket.emit(finished("Hello."), {
        kind: "voice.speaking",
        generation,
        text: "Hello.",
        truncated: false,
        sample_rate: 16000,
      });
      return { player, socket };
    }

    it("on barge_in", async () => {
      const { player, socket } = await speaking(5);
      socket.emitAudio(5);
      expect(player.holds(5)).toBe(true);
      await socket.emit({ kind: "voice.stopped", generation: 5, reason: "barge_in" });
      expect(player.holds(5)).toBe(false);
    });

    it("after a local drop, a late chunk is ignored and voice.stopped done forgets it", async () => {
      const { player, socket } = await speaking(6);
      socket.emitAudio(6);
      await useVoice.getState().press();
      expect(player.holds(6)).toBe(true);
      socket.emitAudio(6); // before its voice.stopped: still ignored
      expect(player.playing(6)).toBe(false);
      await socket.emit({ kind: "voice.stopped", generation: 6, reason: "done" });
      expect(player.holds(6)).toBe(false);
    });
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

describe("the microphone closes whenever listening ends (council full r1 robustness-4)", () => {
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

  /** window and document stubs whose listeners the test fires by hand. */
  function stubKeyboard() {
    const listeners = new Map<string, () => void>();
    const target = { addEventListener: (type: string, fn: () => void) => listeners.set(type, fn) };
    const doc = { ...target, visibilityState: "visible" };
    vi.stubGlobal("window", target);
    vi.stubGlobal("document", doc);
    return { listeners, doc };
  }

  async function losingTheKeyboardDuringCapture(lose: (k: ReturnType<typeof stubKeyboard>) => void) {
    const keyboard = stubKeyboard();
    try {
      const slow = slowMic();
      let finish: (() => void) | null = null;
      const { socket } = wire({
        openMic: slow.open,
        capture: () => new Promise((done) => (finish = () => done({ id: null, why: "late" }) as never)),
      });
      await startVoice();
      const pressed = useVoice.getState().press();
      await vi.waitFor(() => expect(finish).not.toBeNull());

      lose(keyboard);
      finish!();
      await pressed;

      expect(slow.opens()).toBe(0);
      expect(socket.frames()).toEqual([]);
      expect(useVoice.getState().phase).not.toBe("listening");
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it("a blur during captureOf makes the press stale: no start, no microphone", async () => {
    await losingTheKeyboardDuringCapture((k) => k.listeners.get("blur")?.());
  });

  it("the window going hidden during captureOf makes the press stale", async () => {
    await losingTheKeyboardDuringCapture((k) => {
      k.doc.visibilityState = "hidden";
      k.listeners.get("visibilitychange")?.();
    });
  });

  it("a blur when idle sends no frame and leaves the phase and reason", async () => {
    const keyboard = stubKeyboard();
    try {
      const { socket } = wire();
      await startVoice();
      const before = useVoice.getState();
      keyboard.listeners.get("blur")?.();
      expect(socket.frames()).toEqual([]);
      expect(useVoice.getState().phase).toBe(before.phase);
      expect(useVoice.getState().reason).toBe(before.reason);
    } finally {
      vi.unstubAllGlobals();
    }
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

describe("a typed line whose socket closes while it waits", () => {
  const held = () => {
    let finish: (() => void) | null = null;
    const capture = () => new Promise((done) => (finish = () => done({ id: null, why: null }) as never));
    return { capture, release: () => finish!(), pending: () => finish !== null };
  };

  it("keeps the refusal's reason and sends nothing when a 1013 lands during the capture", async () => {
    const hold = held();
    const { socket } = wire({ capture: hold.capture as VoiceDeps["capture"] });
    await startVoice();
    const said = useVoice.getState().say("hi");
    await vi.waitFor(() => expect(hold.pending()).toBe(true));

    await socket.emit({
      kind: "turn.error",
      reason: "validator_failed",
      detail: "at most 2 voice sockets may be open at once; try again when one has closed",
    });
    socket.refuse(1013, "at most 2 voice sockets");
    hold.release();
    await said;

    expect(useVoice.getState().phase).not.toBe("thinking");
    expect(useVoice.getState().reason).toContain("at most 2 voice sockets");
    expect(socket.frames().filter((f) => f.type === "text")).toEqual([]);
  });

  it("sets no thinking phase and sends nothing when a plain close lands during the capture", async () => {
    const hold = held();
    const { socket } = wire({ capture: hold.capture as VoiceDeps["capture"] });
    await startVoice();
    const said = useVoice.getState().say("hi");
    await vi.waitFor(() => expect(hold.pending()).toBe(true));

    socket.drop();
    hold.release();
    await said;

    expect(useVoice.getState().phase).not.toBe("thinking");
    expect(socket.frames().filter((f) => f.type === "text")).toEqual([]);
  });
});
