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

/** Carry an action out against the model's own actions. Returns whether anything was done. */
export function perform(model: VoiceModel, act: Exclude<KeyAction, null>): boolean {
  const { actions } = model;
  switch (act) {
    case "choose_engine":
      actions.studio({ t: "choose_engine" });
      return true;
    case "back":
      if (!model.dock.canBack) return false;
      actions.studio({ t: "back" });
      return true;
    case "skip":
      actions.studio({ t: "skip" });
      return true;
    case "primary":
      primary(model)();
      return true;
    case "toggle_preview":
      if (!model.voice || model.kokoro?.state !== "ready") return false;
      actions.togglePreview(model.voice.id);
      return true;
    case "record_start":
      // As the Hold button: with no listener ready a take would be recorded and thrown away.
      if (model.hear.recording || !model.columns.some((c) => c.ready)) return false;
      actions.recordStart();
      return true;
    case "record_stop":
      if (!model.hear.recording) return false;
      actions.recordStop();
      return true;
    case "pick_stt_1":
    case "pick_stt_2": {
      const col = model.columns[act === "pick_stt_1" ? 0 : 1];
      if (!col?.ready) return false;
      actions.studio({ t: "pick_stt", engine: col.id });
      return true;
    }
  }
}
