/**
 * ADR 0028 (Athena's voice is set up in a studio), README section 3.1 — the Voice view-model.
 *
 * One module, two moods, as Setup has. Until the person finishes it once, the module is the
 * **studio**: three stages — her voice, your voice, ready — walked one card at a time, every
 * answered step folding into a receipt that reopens it. After that it is **settings**: the same
 * facts as two columns, Output and Input, with "Run the studio again" as the way back in.
 *
 * Everything here is pure. The step machine is a reducer (`studioReduce`) over a small state and a
 * context of facts the daemon owns (is Kokoro on disk?), so "install is skipped when it is not
 * needed" and "the first preview selects the voice" are tested without a window. What the daemon
 * says is never restated as studio state: whether an engine is ready is read from the config at
 * render, and the studio only remembers what the *person* decided.
 *
 * The audio meters are functions on the model, like the actions: the view reads them on its own
 * animation frame and writes a CSS variable, so nothing re-renders thirty times a second.
 */
import {
  ACTIVE_INSTALL,
  availabilityOf,
  type InstallState,
  type SttEngineId,
  type SttModel,
  type VoiceConfig,
  type VoiceEngine,
  type VoiceOption,
} from "@/lib/voice-setup";

// -- the studio's steps --------------------------------------------------------------------------

export const STEP_ORDER = ["engine", "install", "pick", "hear", "ready"] as const;
export type StepId = (typeof STEP_ORDER)[number];

export type StageId = "her" | "yours" | "ready";

/** The three stages of the rail, and the steps each one opens into (Personas' table beats). */
export const STAGES: readonly { id: StageId; label: string; steps: readonly StepId[] }[] = [
  { id: "her", label: "Her voice", steps: ["engine", "install", "pick"] },
  { id: "yours", label: "Your voice", steps: ["hear"] },
  { id: "ready", label: "Ready", steps: ["ready"] },
];

export const STEP_LABEL: Record<StepId, string> = {
  engine: "Engine",
  install: "Install",
  pick: "Pick her voice",
  hear: "How she hears you",
  ready: "Ready",
};

export type StepStatus = "done" | "skipped" | "current" | "todo";

/** What the person has decided. Nothing the daemon could have said lives here. */
export interface StudioState {
  step: StepId;
  done: readonly StepId[];
  skipped: readonly StepId[];
  /** The engine card was answered (there is one engine; answering it is still a decision). */
  engineChosen: boolean;
  /** A preview has played once: her first words have been said. */
  wokeUp: boolean;
  /** The voice the person chose, or `null` until they did. */
  voice: string | null;
  /** The listener the person picked in the comparison, or `null`. */
  stt: SttEngineId | null;
}

export const STUDIO_START: StudioState = {
  step: "engine",
  done: [],
  skipped: [],
  engineChosen: false,
  wokeUp: false,
  voice: null,
  stt: null,
};

/** The daemon's facts the machine needs to move. */
export interface StudioContext {
  /** Kokoro is on disk and answered its probe. */
  kokoroReady: boolean;
}

export type StudioEvent =
  | { t: "choose_engine" }
  | { t: "next" }
  | { t: "skip" }
  | { t: "back" }
  | { t: "go"; step: StepId }
  | { t: "previewed"; voice: string }
  | { t: "choose_voice"; voice: string }
  | { t: "pick_stt"; engine: SttEngineId }
  | { t: "use_stt" }
  | { t: "restart" };

const indexOf = (step: StepId) => STEP_ORDER.indexOf(step);

/** A step the studio walks over without stopping. Only one: install, when nothing needs one. */
export function autoDone(step: StepId, ctx: StudioContext): boolean {
  return step === "install" && ctx.kokoroReady;
}

function with_(list: readonly StepId[], step: StepId): StepId[] {
  return list.includes(step) ? [...list] : [...list, step];
}

function without(list: readonly StepId[], step: StepId): StepId[] {
  return list.filter((s) => s !== step);
}

/**
 * Leave the current step forward, marking it `as`. The next stop is the first step after it that
 * is neither answered nor auto-done — so a person who reopened one receipt with "change" returns
 * to where they were rather than re-walking every card behind it.
 */
function advance(state: StudioState, as: "done" | "skipped", ctx: StudioContext): StudioState {
  let done = as === "done" ? with_(state.done, state.step) : without(state.done, state.step);
  const skipped = as === "skipped" ? with_(state.skipped, state.step) : without(state.skipped, state.step);
  for (let i = indexOf(state.step) + 1; i < STEP_ORDER.length; i += 1) {
    const step = STEP_ORDER[i];
    if (autoDone(step, ctx)) {
      done = with_(done, step);
      continue;
    }
    if (done.includes(step) || skipped.includes(step)) {
      if (step === "ready") return { ...state, done, skipped, step };
      continue;
    }
    return { ...state, done, skipped, step };
  }
  return { ...state, done, skipped, step: "ready" };
}

export function studioReduce(state: StudioState, event: StudioEvent, ctx: StudioContext): StudioState {
  switch (event.t) {
    case "choose_engine":
      if (state.step !== "engine") return state;
      return advance({ ...state, engineChosen: true }, "done", ctx);
    case "next":
      if (!canContinue(state, ctx)) return state;
      return advance(state, "done", ctx);
    case "skip":
      if (state.step === "ready") return state;
      return advance(state, "skipped", ctx);
    case "back": {
      for (let i = indexOf(state.step) - 1; i >= 0; i -= 1) {
        const step = STEP_ORDER[i];
        if (!autoDone(step, ctx)) return { ...state, step };
      }
      return state;
    }
    case "go":
      // Only back to something answered: a receipt's "change", never a jump ahead.
      if (!state.done.includes(event.step) && !state.skipped.includes(event.step)) return state;
      return { ...state, step: event.step };
    case "previewed":
      // The first preview that plays is her first word, and it chooses her: a voice heard and
      // liked has been picked, and asking again would be asking twice.
      if (state.wokeUp) return state;
      return { ...state, wokeUp: true, voice: event.voice };
    case "choose_voice":
      if (state.step !== "pick") return { ...state, voice: event.voice };
      return advance({ ...state, voice: event.voice }, "done", ctx);
    case "pick_stt":
      return { ...state, stt: event.engine };
    case "use_stt":
      if (state.step !== "hear" || state.stt === null) return state;
      return advance(state, "done", ctx);
    case "restart":
      return { ...STUDIO_START };
  }
}

/** Whether Enter may move on from the current step without a decision the card asks for. */
export function canContinue(state: StudioState, ctx: StudioContext): boolean {
  switch (state.step) {
    case "engine":
      return state.engineChosen;
    case "install":
      return ctx.kokoroReady;
    case "pick":
      return state.voice !== null;
    case "hear":
      return state.stt !== null;
    case "ready":
      return false;
  }
}

export function stepStatus(state: StudioState, step: StepId): StepStatus {
  if (step === state.step) return "current";
  if (state.done.includes(step)) return "done";
  if (state.skipped.includes(step)) return "skipped";
  return "todo";
}

export interface StageView {
  id: StageId;
  label: string;
  status: "done" | "now" | "todo";
  steps: readonly { id: StepId; label: string; status: StepStatus }[];
}

export function stagesOf(state: StudioState): StageView[] {
  return STAGES.map((stage) => {
    const steps = stage.steps.map((id) => ({ id, label: STEP_LABEL[id], status: stepStatus(state, id) }));
    const status = steps.some((s) => s.status === "current")
      ? "now"
      : steps.every((s) => s.status === "done" || s.status === "skipped")
        ? "done"
        : "todo";
    return { id: stage.id, label: stage.label, status, steps };
  });
}

/** Share of the path behind the person, 0..1, for the rail's filled line. */
export function pathProgress(stages: readonly StageView[]): number {
  const now = stages.findIndex((s) => s.status === "now");
  if (now < 0) return stages.every((s) => s.status === "done") ? 1 : 0;
  return stages.length > 1 ? now / (stages.length - 1) : 0;
}

// -- what she says --------------------------------------------------------------------------------

/** The line every preview after the first one speaks, so takes compare like for like. */
export const TEST_LINE = "Hello, I am Athena, your personal assistant.";

/** Her first words, by the hour they are said in. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour <= 11) return "Good morning — I'm Athena.";
  if (hour >= 12 && hour <= 17) return "Good afternoon — I'm Athena.";
  if (hour >= 18 && hour <= 22) return "Good evening — I'm Athena.";
  return "It's late — I'm Athena. I'll keep my voice down.";
}

/** What a preview says: the greeting the first time she speaks, the test line after it. */
export function previewText(wokeUp: boolean, now: Date): string {
  return wokeUp ? TEST_LINE : greetingFor(now.getHours());
}

// -- install ------------------------------------------------------------------------------------

export interface InstallView {
  phase: InstallState["state"];
  /** What is happening, in a few words. */
  label: string;
  /** 0..100 when the total is known, else `null` (the bar pulses instead). */
  percent: number | null;
  /** Megabytes received, for a download whose total is unknown. */
  mb: number;
  /** The figure printed beside the label: "42%" or "18 MB" or "". */
  figure: string;
  busy: boolean;
  /** 0..1 for the orb's ring: real progress, or full once installed. */
  ring: number;
  error: string | null;
}

const PHASE_LABEL: Record<InstallState["state"], string> = {
  idle: "Not installed",
  not_needed: "Already installed",
  downloading_engine: "Downloading the engine",
  downloading_model: "Downloading the voice model",
  extracting: "Unpacking",
  completed: "Installed",
  failed: "The install did not finish",
  manual: "Needs a hand to install",
};

export function installView(state: InstallState | null): InstallView {
  const s: InstallState = state ?? {
    component: null,
    state: "idle",
    received_bytes: 0,
    total_bytes: null,
    error: null,
  };
  const busy = ACTIVE_INSTALL.has(s.state);
  const percent =
    s.total_bytes && s.total_bytes > 0
      ? Math.min(100, Math.round((s.received_bytes / s.total_bytes) * 100))
      : null;
  const mb = Math.round(s.received_bytes / (1024 * 1024));
  const finished = s.state === "completed" || s.state === "not_needed";
  return {
    phase: s.state,
    label: PHASE_LABEL[s.state],
    percent: busy ? percent : finished ? 100 : null,
    mb,
    figure: busy ? (percent !== null ? `${percent}%` : `${mb} MB`) : "",
    busy,
    ring: finished ? 1 : busy && percent !== null ? percent / 100 : 0,
    error: s.state === "failed" ? s.error || "the daemon gave no reason" : null,
  };
}

/** The engine's own release pages, shown on a manual install. The daemon downloads; this links. */
export const MANUAL_LINKS: readonly { label: string; href: string }[] = [
  { label: "sherpa-onnx v1.13.4 (the engine)", href: "https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.4" },
  {
    label: "kokoro-multi-lang-v1_0 (the voice model)",
    href: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2",
  },
];

// -- the takes ------------------------------------------------------------------------------------

export type PreviewPhase = "idle" | "synth" | "playing" | "error";

export interface PreviewState {
  phase: PreviewPhase;
  /** The voice being previewed, or `null`. */
  voice: string | null;
  error: string | null;
}

export const PREVIEW_IDLE: PreviewState = { phase: "idle", voice: null, error: null };

export type TakeState = "idle" | "pending" | "done" | "failed";

export interface Take {
  state: TakeState;
  text: string;
  ms: number | null;
  error: string | null;
}

export const NO_TAKE: Take = { state: "idle", text: "", ms: null, error: null };

export interface HearState {
  /** The hold-to-talk button (or Space) is down. */
  recording: boolean;
  /** The microphone's refusal, verbatim, or `null`. */
  micError: string | null;
  takes: Partial<Record<SttEngineId, Take>>;
}

export const HEAR_IDLE: HearState = { recording: false, micError: null, takes: {} };

export interface SttColumn {
  id: SttEngineId;
  name: string;
  /** "local" or "cloud", said beside the name — cloud is never a silent default. */
  where: string;
  ready: boolean;
  /** Why it cannot take a take, in the daemon's words, or `null`. */
  reason: string | null;
  take: Take;
  /** The body of the column: what was heard, or what would make it hear. */
  body: string;
  picked: boolean;
}

const STT_NAME: Record<SttEngineId, string> = { whisper: "Whisper", openai: "OpenAI" };

export function sttName(engine: SttEngineId, model: string | null): string {
  return engine === "whisper" && model ? `Whisper ${model}` : STT_NAME[engine];
}

export function sttColumns(
  config: VoiceConfig | null,
  hear: HearState,
  picked: SttEngineId | null,
): SttColumn[] {
  if (!config) return [];
  return (["whisper", "openai"] as const).flatMap((id) => {
    const engine = engineOf(config, id);
    if (!engine) return [];
    const take = hear.takes[id] ?? NO_TAKE;
    const ready = engine.state === "ready";
    const reason = ready ? null : engine.reason || (engine.state === "broken" ? "it failed its check" : "not set up yet");
    const body =
      take.state === "done"
        ? take.text || "(heard nothing)"
        : take.state === "failed"
          ? (take.error ?? "the take failed")
          : take.state === "pending"
            ? "Writing it down..."
            : !ready
              ? (reason ?? "")
              : hear.recording
                ? "Listening..."
                : "Hold to talk, then let go.";
    return [
      {
        id,
        name: sttName(id, id === "whisper" ? config.stt.model : null),
        where: engine.kind === "cloud" ? "cloud" : "local",
        ready,
        reason,
        take,
        body,
        picked: picked === id,
      },
    ];
  });
}

/** The engines a take goes to: every one that is ready. Whisper's "ready" already means its model. */
export function readySttEngines(config: VoiceConfig | null): SttEngineId[] {
  if (!config) return [];
  return config.engines
    .filter((e): e is VoiceEngine & { id: SttEngineId } => e.direction === "stt" && e.state === "ready")
    .map((e) => e.id);
}

// -- keys --------------------------------------------------------------------------------------

export type KeyAction =
  | "choose_engine"
  | "back"
  | "skip"
  | "primary"
  | "toggle_preview"
  | "record_start"
  | "record_stop"
  | "pick_stt_1"
  | "pick_stt_2"
  | null;

/**
 * What a key means on a step. Pure, so the dock's chips and the keyboard cannot disagree, and the
 * whole map is one table in a test.
 */
export function keyAction(step: StepId, key: string, phase: "down" | "up"): KeyAction {
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (phase === "up") return step === "hear" && k === " " ? "record_stop" : null;
  if (k === "Enter") return "primary";
  if (k === "b") return step === "engine" ? null : "back";
  if (k === "s") return step === "ready" ? null : "skip";
  if (k === "1" && step === "engine") return "choose_engine";
  if (k === " " && step === "pick") return "toggle_preview";
  if (k === " " && step === "hear") return "record_start";
  if (k === "1" && step === "hear") return "pick_stt_1";
  if (k === "2" && step === "hear") return "pick_stt_2";
  return null;
}

// -- the view-model ----------------------------------------------------------------------------

export type DaemonStanding = "ready" | "starting" | "offline";

export interface VoiceActions {
  /** Ask the daemon for the config again. */
  refresh: () => void;
  /** Move the studio. Effects (a PUT, a preview) are the live wiring's, around the move. */
  studio: (event: StudioEvent) => void;
  install: (component: string) => void;
  /** Play `voice`, or stop it when it is the one playing. Previews never overlap. */
  togglePreview: (voice: string) => void;
  stopPreview: () => void;
  /** Hold-to-talk in the studio: every ready engine takes the same take. */
  recordStart: () => void;
  recordStop: () => void;
  /** Settings: choose the listener (and Whisper's model) and apply it live. */
  chooseStt: (engine: SttEngineId, model: string | null) => void;
  saveKey: (key: string) => void;
  removeKey: () => void;
  /** Mark the studio done and open settings. */
  finish: () => void;
  reopenStudio: () => void;
}

/** Read on the view's own animation frame; never through React state. */
export interface VoiceMeters {
  /** Her playback, as byte frequency bins (0..255), or `null` when nothing plays. */
  spectrum: () => Uint8Array | null;
  /** Her playback level, 0..1. */
  level: () => number;
  /** The microphone's level while a take records, 0..1. */
  mic: () => number;
}

export interface VoiceSources {
  daemon: DaemonStanding;
  /** `null` until the config has answered once. */
  config: VoiceConfig | null;
  /** Why the config could not be read, verbatim, or `null`. */
  problem: string | null;
  /** True while a config request is in flight. */
  loading: boolean;
  studioDone: boolean;
  /** "Run the studio again" was pressed this visit. */
  reopened: boolean;
  studio: StudioState;
  install: InstallState | null;
  /** A refusal of the last install request (409 and friends), or `null`. */
  installError: string | null;
  preview: PreviewState;
  hear: HearState;
  /** A key save or remove is in flight. */
  keyBusy: boolean;
  /** The last refusal of a save — a choice, a key — in the daemon's words, or `null`. */
  saveError: string | null;
  now: Date;
  actions: VoiceActions;
  meters: VoiceMeters;
}

export interface Receipt {
  step: StepId;
  status: "done" | "skipped";
  text: string;
}

export interface StyleLine {
  step: StepId;
  label: string;
  /** The decision in words, or `null` when it is "not yet". */
  value: string | null;
}

export interface Dock {
  canBack: boolean;
  canSkip: boolean;
  primaryLabel: string;
  /** Why Enter does nothing right now, or `undefined` when it does something. */
  primaryDisabledReason: string | undefined;
}

export interface VoiceModel {
  mode: "studio" | "settings";
  daemon: DaemonStanding;
  config: VoiceConfig | null;
  problem: string | null;
  loading: boolean;
  /** The config answered with no engines at all — an empty answer, not a failure. */
  empty: boolean;
  available: boolean;
  /** The config's sentence for why voice cannot run yet; empty when it can. */
  reason: string;
  kokoro: VoiceEngine | null;
  /** The voice tile the studio and settings offer (Heart), or `null` when Kokoro lists none. */
  voice: VoiceOption | null;
  whisper: VoiceEngine | null;
  openai: VoiceEngine | null;
  whisperModels: readonly SttModel[];
  studio: StudioState;
  stages: readonly StageView[];
  progress: number;
  receipts: readonly Receipt[];
  line: string;
  status: string;
  install: InstallView;
  /** A Whisper model's install, wherever the person started it. Idle when none is. */
  whisperInstall: InstallView;
  /** Which component the running (or last) install is for. */
  installComponent: string | null;
  installError: string | null;
  preview: PreviewState;
  previewLine: string;
  hear: HearState;
  columns: readonly SttColumn[];
  styleHer: readonly StyleLine[];
  styleHears: readonly StyleLine[];
  dock: Dock;
  keyBusy: boolean;
  saveError: string | null;
  actions: VoiceActions;
  meters: VoiceMeters;
}

export function engineOf(config: VoiceConfig | null, id: VoiceEngine["id"]): VoiceEngine | null {
  return config?.engines.find((e) => e.id === id) ?? null;
}

/** The voice tile: the configured voice when Kokoro lists it, else its first. */
function voiceOf(config: VoiceConfig | null, kokoro: VoiceEngine | null): VoiceOption | null {
  if (!kokoro) return null;
  return kokoro.voices.find((v) => v.id === config?.tts.voice) ?? kokoro.voices[0] ?? null;
}

export function voiceMeta(voice: VoiceOption): string {
  const lang = voice.language === "en-US" ? "English (US)" : voice.language === "en-GB" ? "English (UK)" : voice.language;
  return `${lang} · ${voice.gender} · ${voice.grade}`;
}

function lineFor(source: VoiceSources, install: InstallView): string {
  const { studio } = source;
  switch (studio.step) {
    case "engine":
      return "First, my voice. I speak through a local engine, so nothing I say to you leaves this machine.";
    case "install":
      if (install.phase === "manual") {
        return "I can't install this one by myself here. The links below put it in place — then check again.";
      }
      if (install.phase === "failed") return "That download did not finish. The reason is below; try again when you're ready.";
      if (install.busy) return "Fetching my voice. This takes a minute or two — it only happens once.";
      if (install.phase === "completed" || install.phase === "not_needed") return "All set. Let's hear what I sound like.";
      return "I need the engine and my voice on disk first — about 400 MB, once.";
    case "pick":
      return studio.wokeUp
        ? "There I am. Play it again if you like — then tell me this is my voice."
        : "Press play. The first thing you hear is the first thing I ever say out loud.";
    case "hear":
      return "Now let me hear you. Hold the button or Space, say anything, and every engine that's ready writes down what it heard.";
    case "ready":
      return source.config?.ready
        ? "That's me. Hold Ctrl+Shift+Space anywhere and talk; let go and I'll answer."
        : "That's the studio. Voice stays off until both engines are ready — Settings shows what's left.";
  }
}

function statusFor(source: VoiceSources, install: InstallView): string {
  if (source.preview.phase === "playing") return "Speaking";
  if (source.preview.phase === "synth") return "Finding the words";
  if (source.hear.recording) return "Listening";
  if (install.busy) return "Finding her voice";
  return "Here with you";
}

function receiptText(step: StepId, source: VoiceSources, voice: VoiceOption | null): string {
  const { studio, config } = source;
  switch (step) {
    case "engine":
      return "Kokoro speaks for her — local and private.";
    case "install":
      return "Her voice is on this machine.";
    case "pick":
      return `She speaks as ${voice?.id === studio.voice ? voice.name : (studio.voice ?? "—")}.`;
    case "hear":
      return studio.stt
        ? `${sttName(studio.stt, studio.stt === "whisper" ? (config?.stt.model ?? null) : null)} hears you${studio.stt === "openai" ? " (cloud)" : ""}.`
        : "How she hears you is not chosen yet.";
    case "ready":
      return "Ready.";
  }
}

function dockFor(source: VoiceSources, ctx: StudioContext, install: InstallView, kokoro: VoiceEngine | null): Dock {
  const { studio } = source;
  const canBack = STEP_ORDER.slice(0, indexOf(studio.step)).some((s) => !autoDone(s, ctx));
  const canSkip = studio.step !== "ready";
  const go = canContinue(studio, ctx);
  switch (studio.step) {
    case "engine":
      return { canBack, canSkip, primaryLabel: "Use Kokoro", primaryDisabledReason: undefined };
    case "install": {
      if (go) return { canBack, canSkip, primaryLabel: "Continue", primaryDisabledReason: undefined };
      if (install.busy) {
        return { canBack, canSkip, primaryLabel: "Installing...", primaryDisabledReason: "The install is running." };
      }
      const label = install.phase === "failed" ? "Try again" : install.phase === "manual" ? "Check again" : "Install now";
      return { canBack, canSkip, primaryLabel: label, primaryDisabledReason: undefined };
    }
    case "pick":
      return {
        canBack,
        canSkip,
        primaryLabel: "This is her voice",
        primaryDisabledReason:
          kokoro?.state === "ready" ? undefined : "Her voice is not installed yet — go back to Install, or skip.",
      };
    case "hear":
      return {
        canBack,
        canSkip,
        primaryLabel: studio.stt ? `Use ${STT_NAME[studio.stt]}` : "Pick one",
        primaryDisabledReason: studio.stt ? undefined : "Take one take, then pick the column that heard you best.",
      };
    case "ready":
      return { canBack, canSkip, primaryLabel: "Start talking", primaryDisabledReason: undefined };
  }
}

/** The store snapshot in, the view-model out. Pure. */
export function selectVoice(source: VoiceSources): VoiceModel {
  const { config, studio } = source;
  const kokoro = engineOf(config, "kokoro");
  const whisper = engineOf(config, "whisper");
  const openai = engineOf(config, "openai");
  const voice = voiceOf(config, kokoro);
  const ctx: StudioContext = { kokoroReady: kokoro?.state === "ready" };
  const kokoroInstall = source.install?.component === "kokoro" || source.install?.component === null ? source.install : null;
  // The studio's install card is Kokoro's: a Whisper model downloading does not fill her ring.
  const install = installView(
    ctx.kokoroReady && !ACTIVE_INSTALL.has(kokoroInstall?.state ?? "idle")
      ? { component: "kokoro", state: "not_needed", received_bytes: 0, total_bytes: null, error: null }
      : kokoroInstall,
  );
  const stages = stagesOf(studio);
  const receipts: Receipt[] = STEP_ORDER.flatMap((step): Receipt[] => {
    const status = stepStatus(studio, step);
    if (step === "ready" || (status !== "done" && status !== "skipped")) return [];
    if (status === "skipped") return [{ step, status, text: `${STEP_LABEL[step]} — skipped for now.` }];
    return [{ step, status, text: receiptText(step, source, voice) }];
  });
  const decided = (step: StepId) => studio.done.includes(step);
  const { available, reason } = config ? availabilityOf(config) : { available: false, reason: "" };
  return {
    mode: source.studioDone && !source.reopened ? "settings" : "studio",
    daemon: source.daemon,
    config,
    problem: source.problem,
    loading: source.loading && config === null,
    empty: config !== null && config.engines.length === 0,
    available,
    reason,
    kokoro,
    voice,
    whisper,
    openai,
    whisperModels: whisper?.models ?? [],
    studio,
    stages,
    progress: pathProgress(stages),
    receipts,
    line: lineFor(source, install),
    status: statusFor(source, install),
    install,
    whisperInstall: installView(source.install?.component?.startsWith("whisper:") ? source.install : null),
    installComponent: source.install?.component ?? null,
    installError: source.installError,
    preview: source.preview,
    previewLine: previewText(studio.wokeUp, source.now),
    hear: source.hear,
    columns: sttColumns(config, source.hear, studio.stt),
    styleHer: [
      { step: "engine", label: "Engine", value: decided("engine") ? "Kokoro, on this machine" : null },
      {
        step: "pick",
        label: "Voice",
        value: decided("pick") && voice ? `${voice.name} · ${voiceMeta(voice)}` : null,
      },
    ],
    styleHears: [
      {
        step: "hear",
        label: "Listener",
        value:
          decided("hear") && studio.stt
            ? `${sttName(studio.stt, studio.stt === "whisper" ? (config?.stt.model ?? null) : null)}, ${studio.stt === "openai" ? "in the cloud" : "on this machine"}`
            : null,
      },
    ],
    dock: dockFor(source, ctx, install, kokoro),
    keyBusy: source.keyBusy,
    saveError: source.saveError,
    actions: source.actions,
    meters: source.meters,
  };
}

/** Fixtures and any surface that needs a set that does nothing. */
export const INERT_ACTIONS: VoiceActions = {
  refresh: () => {},
  studio: () => {},
  install: () => {},
  togglePreview: () => {},
  stopPreview: () => {},
  recordStart: () => {},
  recordStop: () => {},
  chooseStt: () => {},
  saveKey: () => {},
  removeKey: () => {},
  finish: () => {},
  reopenStudio: () => {},
};

export const SILENT_METERS: VoiceMeters = {
  spectrum: () => null,
  level: () => 0,
  mic: () => 0,
};
