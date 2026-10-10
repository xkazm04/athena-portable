/**
 * Push-to-talk — plan c32, README section 3.1; ADR 0019 and 0020.
 *
 * The key goes down: the socket is told `start` with the focused page's origin, the microphone
 * opens and its PCM16 streams. The key comes up: the microphone closes and the socket is told
 * `stop`. Everything after that is the daemon's — the transcript, the ordinary browser-lane turn,
 * the spoken line — and it arrives here as the same channel events the panel's run loop reads,
 * which is why a spoken turn lands **in the panel's transcript and cards** rather than in a
 * second chat: this store writes into `stores/run.ts`'s state and renders nothing of its own.
 *
 * Two things this store does that the run loop also does, and does the same way:
 *
 * - a host tool's `tool.call` with no `tool.result` behind it in the same turn is the page's to
 *   run. It runs through the relay and the answer goes back as `tool_result`, so the daemon can
 *   continue the turn. A call the daemon already settled — a gated one, refused pending approval
 *   — is not run, and the one refusal this store makes on its own is a call whose origin is not
 *   the focused page's;
 * - a decision card lands in the run store's `cards`, so the panel's button answers it over HTTP
 *   as it answers any other, and a spoken "approve" answers it on the socket. One table, two
 *   ways to say yes.
 *
 * **Barge-in is the daemon's decision and the player's job.** Pressing the key over a reply sends
 * `start`, which the gateway treats as a barge-in; the player drops the generation the moment
 * `voice.stopped` says `barge_in`, and drops it locally on the press too, because a second of
 * stale audio between the two is the difference between "she stopped" and "she talked over me".
 *
 * Every browser API is an argument (`VoiceDeps`), swapped wholesale in `voice.test.ts`.
 */
import { create } from "zustand";

import { DaemonApi, type ExecuteRow } from "@/lib/api";
import { VoiceSetupApi, availabilityOf, refusalText } from "@/lib/voice-setup";
import { callOnPage, takeCapture, type Taken } from "@/lib/hands";
import type { ChannelEvent, DecisionRequested, ToolCall } from "@/lib/events";
import { catalogIdOf, manifestBodyOf } from "@/lib/manifest";
import {
  Player,
  VoiceSocket,
  openMicrophone,
  type AudioFrame,
  type MicrophoneSession,
  type SocketFactory,
  type SocketLike,
} from "@/lib/voice";
import { endpoint, useDaemon } from "@/stores/daemon";
import { useOrigins } from "@/stores/origins";
import {
  NOTHING_GATED,
  captureOf,
  disabledOriginsOf,
  gatedListsOf,
  useRun,
  withCaptureWhy,
  type GatedLists,
} from "@/stores/run";
import { useTabs } from "@/stores/tabs";
import { useTools } from "@/stores/tools";

export type VoicePhase = "off" | "idle" | "listening" | "thinking" | "speaking" | "error";

export interface VoiceDeps {
  endpoint: () => { url: string; token: string } | null;
  /**
   * `GET /voice/config`, for `ready` and `reason`: can the chosen engines speak and hear? ADR 0028
   * replaced the `/health` socket list — `/voice` is always registered now, so its presence says
   * nothing about whether a turn can be spoken.
   */
  config: () => Promise<{ ready: boolean; reason: string | null }>;
  socket: SocketFactory;
  /** Open the microphone; `null` where the webview offers none. */
  openMic: ((onChunk: (pcm: Int16Array) => void) => Promise<MicrophoneSession>) | null;
  /** The player, or `null` where there is no audio output (the headless test). */
  player: () => Player | null;
  /** The focused tab, its web origin, and the app id the page declared, if it has yet. */
  focused: () => { tabId: number; origin: string; appId: string | null } | null;
  hostState: () => Record<string, unknown>;
  /** The catalog origins the user switched off, sent on every frame (the shell says it; the daemon keeps none). */
  disabledOrigins?: () => string[];
  /** The first-sight apps and the `GATED` pins, sent on every turn frame the same way (ADR 0063). */
  gated?: () => GatedLists;
  /** Take the capture of the focused tab before a frame that starts a turn (ADR 0066). */
  capture?: (tabId: number, origin: string) => Promise<Taken>;
  call: (
    tabId: number,
    name: string,
    input: Record<string, unknown>,
  ) => Promise<{ ok: boolean; output: string; error?: string | null; tier?: number }>;
  /**
   * The focused page's manifest body, or `null` when there is nothing to register.
   *
   * The gateway refuses an origin it has no session for exactly as `POST /run` does —
   * `foreign_origin: '<origin>' has sent no manifest; open the page first` — so a spoken turn
   * needs the same first step a typed one does (`lib/manifest.ts`, README section 3.3). Act 2 of
   * the demo is a spoken turn, and without this it could never have started.
   */
  manifest?: () => Record<string, unknown> | null;
}

export interface VoiceState {
  phase: VoicePhase;
  /** The daemon's voice config says `ready`. False until `GET /voice/config` says so. */
  available: boolean;
  /** Why the key does nothing, or what last went wrong. Empty when all is well. */
  reason: string;
  /** The live partial transcript while the key is held. */
  partial: string;
  /** The generation playing, if any. */
  generation: number | null;
  /**
   * The line she is speaking (`voice.speaking.text`), for the halo's caption (ADR 0027). Empty
   * when she is not. The audio *level* is deliberately not state: it changes 30 times a second and
   * nothing should re-render on it, so `lib/halo.ts` polls `currentLevel` instead.
   */
  speakingText: string;
  /** The last final transcript of this turn — what she heard — until she answers or a new press. */
  heard: string;
  press: () => Promise<void>;
  release: () => void;
  /** The typed path of the same channel, for a test or a keyboard fallback. */
  say: (text: string) => Promise<void>;
  close: () => void;
}

const EMPTY = {
  phase: "off" as VoicePhase,
  available: false,
  reason: "",
  partial: "",
  generation: null as number | null,
  speakingText: "",
  heard: "",
};

/** The production wiring: the daemon store, the relay, the browser's own audio. */
const LIVE: VoiceDeps = {
  endpoint: () => endpoint(useDaemon.getState()),
  config: async () => {
    const found = endpoint(useDaemon.getState());
    if (!found) throw new Error("the daemon is not ready");
    const out = await new VoiceSetupApi(found).config();
    if (!out.ok) throw new Error(refusalText(out));
    return out.value;
  },
  // The DOM's `WebSocket` is the shape `SocketLike` names, with `this`-typed handlers TypeScript
  // will not unify; the cast is the one place the two meet.
  socket: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
  openMic:
    typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia
      ? (onChunk) =>
          openMicrophone(
            {
              getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
              audioContext: () => new AudioContext(),
            },
            onChunk,
          )
      : null,
  player: () => (typeof AudioContext === "undefined" ? null : new Player(() => new AudioContext())),
  focused: () => {
    const { tabs } = useTabs.getState();
    const tab = tabs.find((t) => t.focused) ?? tabs[0];
    if (!tab) return null;
    const { byTab } = useTools.getState();
    const origin = originOf(tab.url);
    return { tabId: tab.id, origin, appId: catalogIdOf(origin, byTab[tab.id]?.appId ?? null) };
  },
  hostState: () => {
    const { tabs } = useTabs.getState();
    const focused = tabs.find((t) => t.focused) ?? tabs[0];
    return {
      tabs: tabs.slice(0, 12).map((t) => ({ url: t.url, title: t.title })),
      page_url: focused?.url ?? "",
      page_title: focused?.title ?? "",
    };
  },
  disabledOrigins: () =>
    disabledOriginsOf(useOrigins.getState().records, useTabs.getState().tabs, useTools.getState().byTab),
  gated: () => gatedListsOf(useOrigins.getState(), useTabs.getState().tabs, useTools.getState().byTab),
  capture: takeCapture,
  // A hand the page did not register goes to the shell's `hands_call`; the rest to the page.
  call: (tabId, name, input) =>
    callOnPage(tabId, name, input, useTools.getState().byTab[tabId]?.tools ?? []),
  manifest: () => {
    const { tabs } = useTabs.getState();
    const tab = tabs.find((t) => t.focused) ?? tabs[0];
    if (!tab) return null;
    const found = useTools.getState().byTab[tab.id];
    return manifestBodyOf({
      origin: originOf(tab.url),
      appId: found?.appId ?? null,
      appVersion: found?.appVersion ?? null,
      transport: found?.transport ?? null,
      tools: found?.tools ?? [],
    });
  },
};

let deps: VoiceDeps = LIVE;

export function setVoiceDeps(next: VoiceDeps): void {
  deps = next;
}

export function resetVoiceForTests(): void {
  useVoice.getState().close();
  deps = LIVE;
  started = false;
  useVoice.setState({ ...EMPTY });
}

export const useVoice = create<VoiceState>((set, get) => {
  let socket: VoiceSocket | null = null;
  let mic: MicrophoneSession | null = null;
  let player: Player | null = null;
  /** Host calls of the current turn with no result yet, in the order they were proposed. */
  let proposed = new Map<string, ToolCall>();
  let sampleRate = 16_000;

  const runPush = (entry: { id: string; kind: "user" | "assistant" | "tool"; text: string }) =>
    useRun.setState((s) => ({ transcript: [...s.transcript, entry] }));

  const fail = (reason: string) => set({ phase: "error", reason });

  function onAudio(frame: AudioFrame): void {
    player?.play(frame.generation, frame.pcm, sampleRate);
  }

  async function onEvent(event: ChannelEvent): Promise<void> {
    switch (event.kind) {
      case "voice.transcript":
        if (event.final) {
          set({ partial: "", heard: event.text.trim() || get().heard });
          if (event.text.trim()) runPush({ id: `v${Date.now()}`, kind: "user", text: event.text });
        } else {
          set({ partial: event.text });
        }
        break;
      case "text.delta":
        runPush({ id: `t${Date.now()}${Math.random()}`, kind: "assistant", text: event.text });
        break;
      case "tool.call":
        if (event.origin !== "core") proposed.set(event.call_id, event);
        break;
      case "tool.result":
        // The daemon answered it itself — a core tool, or a gated call refused pending approval.
        // Not the page's to run, and the row says what happened.
        proposed.delete(event.call_id);
        runPush({
          id: event.call_id,
          kind: "tool",
          text: `${event.name} → ${event.ok ? event.output : (event.error ?? "refused")}`,
        });
        break;
      case "decision.requested":
        useRun.setState((s) => ({
          cards: [...s.cards, event as DecisionRequested],
          captureWhy: withCaptureWhy(s.captureWhy, event as DecisionRequested, s.captureNow),
        }));
        break;
      case "decision.resolved":
        useRun.setState((s) => ({ cards: s.cards.filter((c) => c.id !== event.id) }));
        break;
      case "turn.summary":
        useRun.setState({ summary: event });
        break;
      case "turn.error":
        proposed = new Map();
        fail(`${event.reason}: ${event.detail}`);
        break;
      case "turn.finished": {
        const calls = [...proposed.values()];
        proposed = new Map();
        if (get().phase === "thinking") set({ phase: "idle" });
        set({ heard: "" });
        for (const call of calls) await onPage(call);
        break;
      }
      case "voice.speaking":
        sampleRate = event.sample_rate;
        set({ phase: "speaking", generation: event.generation, speakingText: event.text, heard: "" });
        break;
      case "voice.stopped":
        if (event.reason === "barge_in") player?.drop(event.generation);
        else player?.finished(event.generation);
        if (get().generation === event.generation) {
          set({
            generation: null,
            speakingText: "",
            phase: get().phase === "speaking" ? "idle" : get().phase,
          });
        }
        break;
    }
  }

  /** Run one host call on the focused page and answer the daemon, as the run loop does. */
  async function onPage(call: ToolCall): Promise<void> {
    const focused = deps.focused();
    const row = call as unknown as ExecuteRow;
    let answer: { ok: boolean; output: string; error?: string | null; tier?: number };
    if (!focused) {
      answer = { ok: false, output: "", error: "unknown_ref: no page is open" };
    } else if (
      // The same defence the run loop makes, one step before the daemon's: the page has said what
      // it calls itself, and a call for another app does not run here.
      focused.appId &&
      row.origin.startsWith("host:") &&
      row.origin !== `host:${focused.appId}`
    ) {
      answer = { ok: false, output: "", error: `foreign_origin: ${row.origin} is not the focused page` };
    } else {
      try {
        answer = await deps.call(focused.tabId, bareName(row.name), row.params);
      } catch (error) {
        answer = { ok: false, output: "", error: error instanceof Error ? error.message : String(error) };
      }
    }
    runPush({
      id: row.call_id,
      kind: "tool",
      text: `${row.name} → ${answer.ok ? answer.output : (answer.error ?? "failed")}`,
    });
    socket?.send({
      type: "tool_result",
      call_id: row.call_id,
      name: row.name,
      ok: answer.ok,
      output: answer.output,
      error: answer.error ?? null,
      tier: answer.tier ?? row.tier ?? 1,
    });
    if (get().phase === "idle") set({ phase: "thinking" });
  }

  /**
   * Register the focused page before speaking about it, for the reason `stores/run.ts` gives.
   *
   * It goes over HTTP and not over the socket: `POST /manifest` is the one route that merges a
   * manifest, and a second way to register a page would be a second place the catalog is
   * written. A refusal is reported and the utterance is not sent — an unregistered page cannot
   * answer anything, and a spoken sentence that vanishes is worse than one that says why.
   */
  async function publish(): Promise<boolean> {
    const body = deps.manifest?.() ?? null;
    if (body === null) return true;
    const found = deps.endpoint();
    if (!found) {
      fail("the daemon is not ready");
      return false;
    }
    try {
      await new DaemonApi(found).manifest(body);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      return false;
    }
    return true;
  }

  async function ensureSocket(): Promise<VoiceSocket | null> {
    if (socket?.open) return socket;
    const found = deps.endpoint();
    if (!found) {
      fail("the daemon is not ready");
      return null;
    }
    player ??= deps.player();
    const next = new VoiceSocket(deps.socket, {
      onEvent: (event) => void onEvent(event),
      onAudio,
      onClose: (reason) => {
        socket = null;
        proposed = new Map();
        set((s) => ({
          generation: null,
          speakingText: "",
          phase: s.phase === "off" ? "off" : "idle",
          reason: s.phase === "listening" || s.phase === "thinking" ? `voice closed: ${reason}` : s.reason,
        }));
      },
    });
    try {
      await next.connect(found.url, found.token);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      return null;
    }
    socket = next;
    return socket;
  }

  return {
    ...EMPTY,

    async press() {
      // The config may have changed in another window since the last check (the Voice module
      // runs in Main; this store lives in hers), so a press on an unavailable key asks once more
      // before it gives up.
      if (!get().available) await checkConfig();
      const state = get();
      if (!state.available || state.phase === "listening") return;
      const focused = deps.focused();
      if (!focused) {
        fail("open a page first — Athena works inside the app you are looking at");
        return;
      }
      if (!(await publish())) return;
      const live = await ensureSocket();
      if (!live) return;
      if (state.generation !== null) player?.drop(state.generation);
      const taken = await captureOf(deps.capture, focused.tabId, focused.origin);
      useRun.setState({ captureNow: taken.why });
      set({ phase: "listening", reason: "", partial: "", generation: null, speakingText: "", heard: "" });
      live.send({
        type: "start",
        origin: focused.origin,
        ...(taken.id ? { capture_id: taken.id } : {}),
        host_state: deps.hostState(),
        disabled_origins: deps.disabledOrigins?.() ?? [],
        ...(deps.gated?.() ?? NOTHING_GATED),
      });
      if (deps.openMic === null) {
        fail("this webview offers no microphone");
        return;
      }
      try {
        mic = await deps.openMic((pcm) => live.sendAudio(pcm));
      } catch (error) {
        fail(`microphone: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    release() {
      mic?.stop();
      mic = null;
      if (get().phase !== "listening") return;
      socket?.send({ type: "stop" });
      set({ phase: "thinking" });
    },

    async say(text) {
      if (!get().available) return;
      const focused = deps.focused();
      if (!focused) {
        fail("open a page first — Athena works inside the app you are looking at");
        return;
      }
      if (!(await publish())) return;
      const live = await ensureSocket();
      if (!live) return;
      if (get().generation !== null) player?.drop(get().generation as number);
      const taken = await captureOf(deps.capture, focused.tabId, focused.origin);
      useRun.setState({ captureNow: taken.why });
      set({ phase: "thinking", reason: "", generation: null, speakingText: "", heard: "" });
      live.send({
        type: "text",
        text,
        origin: focused.origin,
        ...(taken.id ? { capture_id: taken.id } : {}),
        host_state: deps.hostState(),
        disabled_origins: deps.disabledOrigins?.() ?? [],
        ...(deps.gated?.() ?? NOTHING_GATED),
      });
    },

    close() {
      mic?.stop();
      mic = null;
      socket?.close();
      socket = null;
      player = null;
      proposed = new Map();
    },
  };
});

let started = false;

/**
 * Publish a config's availability. The Voice module calls this with every config it receives, so
 * the key in the same window lights up the moment the studio makes voice ready, without waiting
 * for the daemon's health to change.
 */
export function applyVoiceConfig(config: { ready: boolean; reason: string | null }): void {
  const { available, reason } = availabilityOf(config);
  useVoice.setState((s) => ({
    available,
    reason,
    phase: available ? (s.phase === "off" ? "idle" : s.phase) : "off",
  }));
}

/** Ask the daemon's voice config whether the key can light up, and say why when it cannot. */
export async function checkConfig(): Promise<void> {
  const found = deps.endpoint();
  if (!found) {
    useVoice.setState({ available: false, phase: "off", reason: "the daemon is not running yet" });
    return;
  }
  try {
    applyVoiceConfig(await deps.config());
  } catch (error) {
    useVoice.setState({
      available: false,
      phase: "off",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Started by the app root and nothing else. Watches the daemon: when it is ready, `GET
 * /voice/config` says whether the chosen engines are ready, and the key lights up or explains
 * itself in the config's own sentence. A hotkey — `Ctrl+Space`, held — mirrors the bar's control
 * for as long as the chrome webview has the keyboard.
 */
export async function startVoice(): Promise<void> {
  if (started) return;
  started = true;
  useDaemon.subscribe((state, previous) => {
    if (state.health !== previous.health || state.url !== previous.url) void checkConfig();
  });
  await checkConfig();
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", (ev) => {
      if (ev.code === "Space" && ev.ctrlKey && !ev.repeat) {
        ev.preventDefault();
        void useVoice.getState().press();
      }
    });
    window.addEventListener("keyup", (ev) => {
      if (ev.code === "Space") useVoice.getState().release();
    });
  }
}

/** `host.<app_id>.<tool>` is the catalog's name; the page registered the last segment. */
function bareName(name: string): string {
  const parts = name.split(".");
  return parts.length > 2 ? parts.slice(2).join(".") : name;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}
