/**
 * ADR 0028 (Athena's voice is set up in a studio), README section 3.1 — the Voice fixtures.
 *
 * View-models, no store, no daemon, no audio. The four the contract asks for, then one per studio
 * moment so `preview.html?module=voice&fixture=<id>` shows each card:
 *
 * - `empty` — the daemon is starting; nothing has answered.
 * - `typical` — settings on a machine where both halves work.
 * - `heavy` — settings with every row saying something awkward: a Whisper model downloading with
 *   no known total, OpenAI broken with a long reason, a refused key, a long engine home.
 * - `degraded` — the daemon is not running, so nothing about voice is known.
 * - `loading` — the daemon is up and the config has not answered.
 * - `engine`, `installing`, `failed`, `manual`, `pick`, `stt-compare`, `ready` — the studio.
 */
import type { InstallState, VoiceConfig, VoiceEngine } from "@/lib/voice-setup";

import {
  HEAR_IDLE,
  INERT_ACTIONS,
  PREVIEW_IDLE,
  SILENT_METERS,
  STUDIO_START,
  selectVoice,
  type StudioState,
  type VoiceModel,
  type VoiceSources,
} from "./model";

/** A fixed morning, so the greeting a fixture shows does not depend on when it is opened. */
const MORNING = new Date(2026, 9, 7, 9, 30);

const HEART = {
  id: "af_heart",
  name: "Heart",
  language: "en-US",
  gender: "female",
  grade: "A",
  blurb: "Warm and clear; the voice Athena was written for.",
};

function kokoro(over: Partial<VoiceEngine> = {}): VoiceEngine {
  return {
    id: "kokoro",
    direction: "tts",
    kind: "local",
    state: "ready",
    reason: null,
    size_mb: 400,
    voices: [HEART],
    models: [],
    ...over,
  };
}

function whisper(over: Partial<VoiceEngine> = {}): VoiceEngine {
  return {
    id: "whisper",
    direction: "stt",
    kind: "local",
    state: "ready",
    reason: null,
    size_mb: null,
    voices: [],
    models: [
      { id: "tiny.en", size_mb: 75, installed: false },
      { id: "base.en", size_mb: 142, installed: true },
      { id: "small.en", size_mb: 466, installed: false },
    ],
    ...over,
  };
}

function openai(over: Partial<VoiceEngine> = {}): VoiceEngine {
  return {
    id: "openai",
    direction: "stt",
    kind: "cloud",
    state: "ready",
    reason: null,
    size_mb: null,
    voices: [],
    models: [],
    ...over,
  };
}

function config(over: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    tts: { engine: "kokoro", voice: "af_heart" },
    stt: { engine: "whisper", model: "base.en" },
    engines: [kokoro(), whisper(), openai()],
    ready: true,
    reason: null,
    home: "~/.personas/companion-tts",
    ...over,
  };
}

const install = (over: Partial<InstallState>): InstallState => ({
  component: "kokoro",
  state: "idle",
  received_bytes: 0,
  total_bytes: null,
  error: null,
  ...over,
});

function model(over: Partial<VoiceSources>): VoiceModel {
  return selectVoice({
    daemon: "ready",
    config: config(),
    problem: null,
    loading: false,
    studioDone: true,
    reopened: false,
    studio: STUDIO_START,
    install: null,
    installError: null,
    preview: PREVIEW_IDLE,
    hear: HEAR_IDLE,
    keyBusy: false,
    saveError: null,
    now: MORNING,
    actions: INERT_ACTIONS,
    meters: SILENT_METERS,
    ...over,
  });
}

const studio = (over: Partial<StudioState>): StudioState => ({ ...STUDIO_START, ...over });

/** A machine with nothing installed: Kokoro absent, Whisper absent, no key. */
const BARE = config({
  engines: [
    kokoro({ state: "absent", reason: "Kokoro is not installed." }),
    whisper({
      state: "absent",
      reason: "Whisper base.en is not installed.",
      models: [
        { id: "tiny.en", size_mb: 75, installed: false },
        { id: "base.en", size_mb: 142, installed: false },
        { id: "small.en", size_mb: 466, installed: false },
      ],
    }),
    openai({ state: "absent", reason: "No OpenAI key is stored." }),
  ],
  ready: false,
  reason: "Kokoro is not installed.",
});

const empty = model({ daemon: "starting", config: null, loading: true, studioDone: false });

const typical = model({});

const heavy = model({
  config: config({
    stt: { engine: "whisper", model: "small.en" },
    engines: [
      kokoro(),
      whisper({
        state: "absent",
        reason: "Whisper small.en is not installed; base.en is, and works if you choose it again.",
        models: [
          { id: "tiny.en", size_mb: 75, installed: true },
          { id: "base.en", size_mb: 142, installed: true },
          { id: "small.en", size_mb: 466, installed: false },
          { id: "tiny", size_mb: 75, installed: false },
          { id: "base", size_mb: 142, installed: false },
          { id: "small", size_mb: 466, installed: false },
        ],
      }),
      openai({
        state: "broken",
        reason:
          "OpenAI refused the stored key (401 invalid_api_key) — replace it, or remove it and listen locally with Whisper instead",
      }),
    ],
    ready: false,
    reason: "Whisper small.en is not installed.",
    home: "C:\\Users\\a-long-account-name\\AppData\\Local\\personas-data\\companion-tts\\with\\a\\deep\\path",
  }),
  install: install({ component: "whisper:small.en", state: "downloading_model", received_bytes: 187 * 1024 * 1024 }),
  saveError: "validator_failed: the key does not look like an OpenAI key",
});

const degraded = model({ daemon: "offline", config: null, problem: "daemon_offline", studioDone: false });

const loading = model({ config: null, loading: true });

// -- the studio --------------------------------------------------------------------------------

const engine = model({ studioDone: false, config: BARE, studio: studio({}) });

const installing = model({
  studioDone: false,
  config: BARE,
  studio: studio({ step: "install", done: ["engine"], engineChosen: true }),
  install: install({
    state: "downloading_model",
    received_bytes: 212 * 1024 * 1024,
    total_bytes: 330 * 1024 * 1024,
  }),
});

const failed = model({
  studioDone: false,
  config: BARE,
  studio: studio({ step: "install", done: ["engine"], engineChosen: true }),
  install: install({
    state: "failed",
    received_bytes: 98 * 1024 * 1024,
    total_bytes: 330 * 1024 * 1024,
    error: "the download stopped at 98 MB: connection reset by github.com",
  }),
});

const manual = model({
  studioDone: false,
  config: BARE,
  studio: studio({ step: "install", done: ["engine"], engineChosen: true }),
  install: install({
    state: "manual",
    error: "this machine blocks downloads from github.com; place the files by hand",
  }),
});

const pick = model({
  studioDone: false,
  config: config({ ready: false, reason: "Whisper base.en is not installed." }),
  studio: studio({ step: "pick", done: ["engine", "install"], engineChosen: true }),
});

const sttCompare = model({
  studioDone: false,
  studio: studio({
    step: "hear",
    done: ["engine", "install", "pick"],
    engineChosen: true,
    wokeUp: true,
    voice: "af_heart",
    stt: "whisper",
  }),
  hear: {
    recording: false,
    micError: null,
    takes: {
      whisper: { state: "done", text: "Book the meeting room for Thursday at ten.", ms: 412, error: null },
      openai: { state: "done", text: "Book the meeting room for Thursday at 10.", ms: 968, error: null },
    },
  },
});

const ready = model({
  studioDone: false,
  studio: studio({
    step: "ready",
    done: ["engine", "install", "pick", "hear"],
    engineChosen: true,
    wokeUp: true,
    voice: "af_heart",
    stt: "whisper",
  }),
});

export const fixtures: Record<string, VoiceModel> = {
  empty,
  typical,
  heavy,
  degraded,
  loading,
  engine,
  installing,
  failed,
  manual,
  pick,
  "stt-compare": sttCompare,
  ready,
};

export const fixtureIds = [
  "empty",
  "typical",
  "heavy",
  "degraded",
  "loading",
  "engine",
  "installing",
  "failed",
  "manual",
  "pick",
  "stt-compare",
  "ready",
] as const;
