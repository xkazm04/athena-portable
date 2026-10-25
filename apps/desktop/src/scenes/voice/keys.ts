/**
 * The studio's keys in the scene — README section 3.1, ADR 0028 and 0087.
 *
 * The module's table (`keyAction`) says what a key means on a step; this file says what happens
 * and when the studio may take it. Pure, so the dock's chips and the keyboard cannot disagree and a
 * test can press every key without a DOM. The scene listens on the document (the stage focuses its
 * own layer when a move ends, so a handler on a child element would never see a key), and gives way
 * to anything that owns the key: a text field keeps every key, a button keeps its own Enter and
 * Space, and the stage keeps Escape (it rises a level).
 */
import { keyAction, type KeyAction, type VoiceModel } from "@/modules/voice/model";
import { primary } from "@/modules/voice/pieces";

interface Target {
  closest?: (selector: string) => unknown;
}

/** Interactive targets keep their own Enter and Space; the studio's keys are for everything else. */
export function ownsKey(target: unknown, key: string): boolean {
  const t = target as Target | null;
  if (!t || typeof t.closest !== "function") return false;
  if (t.closest("input, textarea, select")) return true;
  return (key === "Enter" || key === " ") && Boolean(t.closest("button, a, [role='radio']"));
}

export interface KeyLike {
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: unknown;
}

/** What a key means right now, or `null` when the studio does not take it. */
export function studioKey(model: VoiceModel, e: KeyLike, phase: "down" | "up"): KeyAction {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || ownsKey(e.target, e.key)) return null;
  // Escape is the stage's, and the scene never answers it.
  if (e.key === "Escape") return null;
  return keyAction(model.studio.step, e.key, phase);
}

export type Act = Exclude<KeyAction, null>;

/** Whether an act may run now, and when it may not, the one sentence every surface says for it. */
export interface ActState {
  enabled: boolean;
  reason?: string;
}

const ok: ActState = { enabled: true };
const refused = (reason: string): ActState => ({ enabled: false, reason });

/** The listener sentence the Hold button, Space and the hero all say when no take could be heard. */
const NO_LISTENER = "No listener is ready yet — install a Whisper model or add a key below.";

/**
 * Every act's availability, derived once from the model's own facts (the dock, the listeners'
 * readiness, Kokoro, the take). The key handler, the dock's chips, the cards' buttons, the hero's
 * quiet line and settings' Play all read this table, so a key and the control it mirrors cannot
 * disagree and one fact has one sentence (wizard-flows: validity is a predicate, not a flag).
 */
export function acts(model: VoiceModel): Record<Act, ActState> {
  const { dock, hear, columns, voice, kokoro } = model;
  const pick = (i: number): ActState => {
    const col = columns[i];
    if (!col) return refused("There is no listener in this place.");
    return col.ready ? ok : refused(col.reason ?? "Not ready.");
  };
  return {
    choose_engine: ok,
    back: dock.canBack ? ok : refused("This is the first step; there is nothing to go back to."),
    skip: dock.canSkip ? ok : refused("This is the last step; there is nothing to skip."),
    primary: dock.primaryDisabledReason ? refused(dock.primaryDisabledReason) : ok,
    toggle_preview: !voice
      ? refused("Kokoro lists no voices until it is installed.")
      : kokoro?.state === "ready"
        ? ok
        : refused("Her voice is not installed yet. Install Kokoro first."),
    // With no listener ready a take would be recorded and thrown away (live.ts recordStop).
    record_start: hear.recording
      ? refused("A take is already recording.")
      : columns.some((c) => c.ready)
        ? ok
        : refused(NO_LISTENER),
    record_stop: hear.recording ? ok : refused("No take is recording."),
    pick_stt_1: pick(0),
    pick_stt_2: pick(1),
  };
}

/** The act the Hold button stands for right now: it starts a take, and while one records it ends it. */
export function holdAct(model: VoiceModel): "record_start" | "record_stop" {
  return model.hear.recording ? "record_stop" : "record_start";
}

/**
 * Carry an action out against the model's own actions, only when the act table allows it. Returns
 * whether anything was done, so a refused key is neither swallowed nor silent.
 */
export function perform(model: VoiceModel, act: Act): boolean {
  if (!acts(model)[act].enabled) return false;
  const { actions } = model;
  switch (act) {
    case "choose_engine":
      actions.studio({ t: "choose_engine" });
      return true;
    case "back":
      actions.studio({ t: "back" });
      return true;
    case "skip":
      actions.studio({ t: "skip" });
      return true;
    case "primary":
      primary(model)();
      return true;
    case "toggle_preview":
      if (model.voice) actions.togglePreview(model.voice.id);
      return true;
    case "record_start":
      actions.recordStart();
      return true;
    case "record_stop":
      actions.recordStop();
      return true;
    case "pick_stt_1":
    case "pick_stt_2": {
      const col = model.columns[act === "pick_stt_1" ? 0 : 1];
      if (col) actions.studio({ t: "pick_stt", engine: col.id });
      return true;
    }
  }
}
