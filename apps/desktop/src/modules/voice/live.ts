/**
 * ADR 0028 (Athena's voice is set up in a studio), README section 3.1 — the Voice module's wiring.
 *
 * The one file in this directory that talks to the daemon, the settings row and the audio
 * devices. It is a small store of this visit's facts — the config as the daemon last answered it,
 * the studio's decisions, the install being polled, the preview playing, the takes — and the
 * module's `Live` builds the view-model from it with `selectVoice`. Nothing here is a second
 * source of truth: the config is re-read after every act that could change it, and "is voice
 * ready" is the config's `ready`.
 *
 * Three rules it keeps:
 *
 * - **Previews never overlap.** A play stops the clip before it; a reply that arrives after a
 *   newer play (or a stop) is dropped by its token; leaving the pick step stops playback.
 * - **The first preview that plays chooses her voice** (`previewed`, then `PUT /voice/config`),
 *   and says a greeting for the hour; every later one says the test line.
 * - **An install is polled every 250 ms while it runs**, and only while it runs. The poll ends on
 *   any settled phase and the config is read again, so "installed" is the daemon's word.
 *
 * Every outside thing is an argument (`VoiceSetupDeps`), swapped wholesale in `live.test.ts`.
 */
import { create } from "zustand";

import type { Endpoint } from "@/lib/api";
import { hasShell } from "@/lib/ipc";
import { SETTING_KEYS, settingRead, settingWrite } from "@/lib/store";
import { currentLevel } from "@/lib/voice";
import {
  ACTIVE_INSTALL,
  VoiceSetupApi,
  refusalText,
  type InstallState,
  type SttEngineId,
  type VoiceChoice,
  type VoiceConfig,
} from "@/lib/voice-setup";
import { applyVoiceConfig } from "@/stores/voice";

import { PreviewPlayer, TakeRecorder } from "./audio";
import {
  HEAR_IDLE,
  PREVIEW_IDLE,
  STUDIO_START,
  engineOf,
  previewText,
  readySttEngines,
  studioReduce,
  type HearState,
  type PreviewState,
  type StudioEvent,
  type StudioState,
  type Take,
  type VoiceActions,
  type VoiceMeters,
} from "./model";

/** How often a running install is asked where it stands. */
export const INSTALL_POLL_MS = 250;

export interface VoiceSetupDeps {
  api: (at: Endpoint) => VoiceSetupApi;
  /** The stored "studio done" row; `null` where there is no shell to ask. */
  readDone: () => Promise<boolean | null>;
  writeDone: (done: boolean) => Promise<void>;
  player: () => PreviewPlayer | null;
  recorder: () => TakeRecorder;
  wait: (ms: number) => Promise<void>;
  now: () => Date;
  /** Tell the voice store in this window what the config now says. */
  publish: (config: VoiceConfig) => void;
}

const LIVE: VoiceSetupDeps = {
  api: (at) => new VoiceSetupApi(at),
  readDone: async () => (hasShell() ? ((await settingRead<boolean>(SETTING_KEYS.voiceStudioDone)) ?? false) : null),
  writeDone: async (done) => {
    if (hasShell()) await settingWrite(SETTING_KEYS.voiceStudioDone, done);
  },
  player: () => (typeof AudioContext === "undefined" ? null : new PreviewPlayer(() => new AudioContext())),
  recorder: () =>
    new TakeRecorder(() =>
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof AudioContext !== "undefined"
        ? { getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c), audioContext: () => new AudioContext() }
        : null,
    ),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
  publish: (config) => applyVoiceConfig(config),
};

let deps: VoiceSetupDeps = LIVE;

export function setVoiceSetupDeps(next: Partial<VoiceSetupDeps>): void {
  deps = { ...LIVE, ...next };
}

export interface VoiceSetupState {
  config: VoiceConfig | null;
  problem: string | null;
  /** `null` until the row has been read; `true` once the studio was finished. */
  studioDone: boolean | null;
  reopened: boolean;
  studio: StudioState;
  install: InstallState | null;
  installError: string | null;
  preview: PreviewState;
  hear: HearState;
  keyBusy: boolean;
  saveError: string | null;
  /** Point the module at a daemon (or at none). Reads the config and any running install. */
  connect: (at: Endpoint | null) => Promise<void>;
  actions: VoiceActions;
  meters: VoiceMeters;
}

const FRESH = {
  config: null as VoiceConfig | null,
  problem: null as string | null,
  studioDone: null as boolean | null,
  reopened: false,
  studio: STUDIO_START,
  install: null as InstallState | null,
  installError: null as string | null,
  preview: PREVIEW_IDLE,
  hear: HEAR_IDLE,
  keyBusy: false,
  saveError: null as string | null,
};

const report = (what: string) => (e: unknown) => console.error(`[voice] ${what}: ${String(e)}`);

/** What the store holds that is not state: the client, the devices, the preview token. */
interface Runtime {
  api: VoiceSetupApi | null;
  player: PreviewPlayer | null;
  recorder: TakeRecorder | null;
  recording: boolean;
  /** Bumped by every play and stop; a reply carrying an older one is dropped. */
  token: number;
  polling: boolean;
}

const freshRuntime = (): Runtime => ({
  api: null,
  player: null,
  recorder: null,
  recording: false,
  token: 0,
  polling: false,
});

let rt: Runtime = freshRuntime();

export const useVoiceSetup = create<VoiceSetupState>((set, get) => {

  function accept(config: VoiceConfig): void {
    set({ config, problem: null });
    // The key in this window lights up the moment the config is ready, not at the next health flip.
    deps.publish(config);
  }

  async function refresh(): Promise<void> {
    if (!rt.api) return;
    const out = await rt.api.config();
    if (out.ok) accept(out.value);
    else set({ problem: `${out.reason}: ${refusalText(out)}` });
  }

  async function poll(): Promise<void> {
    if (rt.polling) return;
    rt.polling = true;
    try {
      while (rt.api && ACTIVE_INSTALL.has(get().install?.state ?? "idle")) {
        await deps.wait(INSTALL_POLL_MS);
        if (!rt.api) break;
        const out = await rt.api.installState();
        if (!out.ok) {
          set({ installError: refusalText(out) });
          break;
        }
        set({ install: out.value });
      }
    } finally {
      rt.polling = false;
    }
    await refresh();
  }

  async function choose(patch: Partial<VoiceChoice>): Promise<boolean> {
    const current = get().config;
    if (!rt.api || !current) return false;
    const out = await rt.api.choose({ tts: { ...current.tts }, stt: { ...current.stt }, ...patch });
    if (!out.ok) {
      set({ saveError: `${out.reason}: ${refusalText(out)}` });
      return false;
    }
    set({ saveError: null });
    accept(out.value);
    return true;
  }

  function stopPreview(): void {
    rt.token += 1;
    rt.player?.stop();
    set({ preview: PREVIEW_IDLE });
  }

  function dispatch(event: StudioEvent): void {
    const ctx = { kokoroReady: engineOf(get().config, "kokoro")?.state === "ready" };
    const next = studioReduce(get().studio, event, ctx);
    set({ studio: next });
    // Leaving the pick step stops her mid-sentence: a voice playing over another card is noise.
    if (next.step !== "pick" && get().preview.phase !== "idle") stopPreview();
  }

  async function togglePreview(voice: string): Promise<void> {
    const now = get().preview;
    if (now.voice === voice && (now.phase === "playing" || now.phase === "synth")) {
      stopPreview();
      return;
    }
    if (!rt.api) return;
    rt.player?.stop();
    const mine = ++rt.token;
    const first = !get().studio.wokeUp;
    set({ preview: { phase: "synth", voice, error: null } });
    const out = await rt.api.preview(previewText(!first, deps.now()), voice);
    if (mine !== rt.token) return;
    if (!out.ok) {
      set({ preview: { phase: "error", voice, error: refusalText(out) } });
      return;
    }
    rt.player ??= deps.player();
    if (!rt.player) {
      set({ preview: { phase: "error", voice, error: "this webview has no audio output" } });
      return;
    }
    const ended = rt.player.play(out.value.pcm, out.value.sampleRate);
    set({ preview: { phase: "playing", voice, error: null } });
    if (first) {
      dispatch({ t: "previewed", voice });
      void choose({ tts: { engine: "kokoro", voice } });
    }
    await ended;
    if (mine === rt.token) set({ preview: PREVIEW_IDLE });
  }

  function recordStart(): void {
    if (rt.recording) return;
    rt.recording = true;
    rt.recorder ??= deps.recorder();
    set((s) => ({ hear: { ...s.hear, recording: true, micError: null } }));
    rt.recorder.start().catch((error: unknown) => {
      rt.recording = false;
      set((s) => ({
        hear: {
          ...s.hear,
          recording: false,
          micError: `The microphone did not open: ${error instanceof Error ? error.message : String(error)}`,
        },
      }));
    });
  }

  async function recordStop(): Promise<void> {
    if (!rt.recording || !rt.recorder) return;
    rt.recording = false;
    set((s) => ({ hear: { ...s.hear, recording: false } }));
    const { config, studioDone, reopened } = get();
    // The studio compares every listener that is ready; settings tests the chosen one.
    const ready = readySttEngines(config);
    const engines: SttEngineId[] =
      studioDone && !reopened ? (config && ready.includes(config.stt.engine) ? [config.stt.engine] : []) : ready;
    const pcm = await rt.recorder.stop();
    if (!rt.api || engines.length === 0) return;
    if (pcm.length === 0) {
      set((s) => ({ hear: { ...s.hear, micError: "The take was empty — hold a little longer." } }));
      return;
    }
    const pending: Take = { state: "pending", text: "", ms: null, error: null };
    set((s) => ({ hear: { ...s.hear, takes: Object.fromEntries(engines.map((e) => [e, pending])) } }));
    const at = rt.api;
    await Promise.all(
      engines.map(async (engine) => {
        const out = await at.transcribe(engine, pcm);
        const take: Take = out.ok
          ? { state: "done", text: out.value.text.trim(), ms: out.value.elapsed_ms, error: null }
          : { state: "failed", text: "", ms: null, error: refusalText(out) };
        set((s) => ({ hear: { ...s.hear, takes: { ...s.hear.takes, [engine]: take } } }));
      }),
    );
  }

  const actions: VoiceActions = {
    refresh: () => void refresh(),
    studio: (event) => {
      if (event.t === "choose_voice") {
        void choose({ tts: { engine: "kokoro", voice: event.voice } }).then((ok) => ok && dispatch(event));
        return;
      }
      if (event.t === "use_stt") {
        const engine = get().studio.stt;
        const current = get().config;
        if (!engine || !current) return;
        const model = engine === "whisper" ? (current.stt.model ?? "base.en") : null;
        void choose({ stt: { engine, model } }).then((ok) => ok && dispatch(event));
        return;
      }
      dispatch(event);
    },
    install: (component) => {
      if (!rt.api) return;
      set({ installError: null });
      void rt.api.install(component).then((out) => {
        if (!out.ok) {
          set({ installError: refusalText(out) });
          return;
        }
        set({ install: out.value });
        void poll();
      });
    },
    togglePreview: (voice) => void togglePreview(voice),
    stopPreview,
    recordStart,
    recordStop: () => void recordStop(),
    chooseStt: (engine, model) => void choose({ stt: { engine, model } }),
    saveKey: (key) => {
      if (!rt.api) return;
      set({ keyBusy: true });
      void rt.api.putKey("openai", key).then((out) => {
        set({ keyBusy: false, saveError: out.ok ? null : `${out.reason}: ${refusalText(out)}` });
        if (out.ok) void refresh();
      });
    },
    removeKey: () => {
      if (!rt.api) return;
      set({ keyBusy: true });
      void rt.api.deleteKey("openai").then((out) => {
        set({ keyBusy: false, saveError: out.ok ? null : `${out.reason}: ${refusalText(out)}` });
        if (out.ok) void refresh();
      });
    },
    finish: () => {
      stopPreview();
      set({ studioDone: true, reopened: false });
      void deps.writeDone(true).catch(report("studio done"));
    },
    reopenStudio: () => {
      stopPreview();
      set({ studio: STUDIO_START, hear: HEAR_IDLE, reopened: true });
    },
  };

  return {
    ...FRESH,

    async connect(at) {
      rt.api = at ? deps.api(at) : null;
      if (get().studioDone === null) {
        const done = await deps.readDone().catch(() => null);
        set({ studioDone: done ?? false });
      }
      if (!rt.api) return;
      await refresh();
      // Resume the poll of an install that was already running when the module opened.
      const out = await rt.api.installState();
      if (out.ok && out.value.state !== "idle") {
        set({ install: out.value });
        void poll();
      }
    },

    actions,

    meters: {
      spectrum: () => rt.player?.spectrum() ?? null,
      level: () => rt.player?.level() ?? 0,
      mic: () => (rt.recording ? currentLevel() : 0),
    },
  };
});

/** For tests: a fresh store and the live deps back. */
export function resetVoiceSetupForTests(): void {
  useVoiceSetup.getState().actions.stopPreview();
  rt = freshRuntime();
  deps = LIVE;
  useVoiceSetup.setState({ ...FRESH });
}
