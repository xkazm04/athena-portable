/**
 * What this machine's standing *is*, derived from `SetupModel` at render.
 *
 * The one place the facts become words, so the onboarding letter and the settings list cannot
 * disagree about whether an engine is "signed out" or "missing", and so that **no variant stores
 * a verdict it could have read**. Every function here is pure over the view-model; nothing is
 * cached and nothing is echoed back into the store.
 *
 * That is the point rather than a nicety. A wizard that writes `setup_complete = true` is a wizard
 * that says the machine is ready after the engine has been uninstalled. Here, a standing that
 * disagreed with the fields under it is not a state this module can reach.
 */
import { engineLabel } from "@/lib/engines";
import type { Tone } from "@/components/StatusDot";

import { engineStateOf } from "./engine-state";
import type { SetupModel } from "./model";

/**
 * Four words, in the order a person wants them resolved. `unknown` is the one a boolean could
 * not say: the probe has not answered, which is not the same fact as nothing being installed.
 */
export type Standing = "done" | "todo" | "missing" | "unknown";

export interface Fact {
  key: "engine" | "page" | "brain" | "mic" | "voice";
  standing: Standing;
  /** One line, the fact in the machine's own words. Never truncated by a variant. */
  summary: string;
}

/** Which hue a standing takes. `unknown` is not a warning; it is early. */
const fact = (key: Fact["key"], standing: Standing, summary: string): Fact => ({ key, standing, summary });

export const STANDING_TONE: Record<Standing, Tone> = {
  done: "success",
  todo: "neutral",
  missing: "warning",
  unknown: "pending",
};

/** The engine's fact is its state's words (`engine-state.ts`), decided once with the state's move. */
export function engineFact(model: SetupModel): Fact {
  const { standing, summary } = engineStateOf(model);
  return fact("engine", standing, summary);
}

export function pageFact(model: SetupModel): Fact {
  const n = model.tabs.length;
  if (n === 0) return fact("page", "todo", "none open yet");
  return fact("page", "done", n === 1 ? `open on ${model.tabs[0].host}` : `${n} open`);
}

export function brainFact(model: SetupModel): Fact {
  // Not `missing` when empty: the daemon has a default and it works. It is `todo` because a person
  // who cares where their episodes are written has not yet said.
  return model.brainPath.trim().length > 0
    ? fact("brain", "done", "a directory of its own")
    : fact("brain", "todo", "the daemon's default directory");
}

/** Never required: a machine with no microphone runs every act but the spoken one. */
export function micFact(model: SetupModel): Fact {
  switch (model.mic) {
    case "granted":
      return fact("mic", "done", model.micDetail || "granted");
    case "denied":
      return fact("mic", "missing", model.micRemedy || model.micDetail || "refused by the webview");
    case "unsupported":
      return fact("mic", "missing", model.micDetail || "none on this machine");
    default:
      return fact("mic", "unknown", "not asked yet");
  }
}

export function voiceFact(model: SetupModel): Fact {
  if (model.voiceAvailable) return fact("voice", "done", "ready to listen");
  return fact("voice", model.daemonHealth === "ready" ? "missing" : "unknown", model.voiceReason || "not known yet");
}

/**
 * Is this machine ready for a turn? Derived at the call, never stored.
 *
 * The brain and the microphone are deliberately not part of it: the daemon has a default brain
 * and it works, and a machine with no microphone types its turns.
 */
export function isReady(model: SetupModel): boolean {
  return engineFact(model).standing === "done" && pageFact(model).standing === "done";
}

/** Why the machine is not ready, as the sentence on the disabled button. Empty when it is. */
export function notReadyBecause(model: SetupModel): string {
  const engine = engineFact(model);
  const page = pageFact(model).standing === "done";
  if (engine.standing !== "done" && !page) return "Get an engine ready and open a page first.";
  if (engine.standing === "unknown") {
    // "Still checking" only while a check runs: a check that failed, or one nobody has answered,
    // would leave the person waiting on a button nothing is going to enable.
    const kind = engineStateOf(model).kind;
    if (kind === "checking") return "Athena is still checking the engine.";
    if (kind === "check-failed") return "Athena could not check the engine. Check again under Mind.";
    return `${engine.summary}.`;
  }
  if (engine.standing !== "done") return `The engine cannot run a turn yet: ${engine.summary}.`;
  return page ? "" : "Open a page first — Athena works inside one.";
}

/** The engine passage's opening sentence, composed from the figures. */
export function engineLead(found: number, total: number): string {
  if (total === 0) return "Athena was told of no engines at all.";
  if (found === 0) {
    return total === 1 ? "The one engine is not ready." : `None of the ${total} engines is ready.`;
  }
  if (found === total) {
    return total === 1 ? "The one engine is ready." : `All ${total} engines are ready.`;
  }
  return found === 1 ? `1 of the ${total} engines is ready.` : `${found} of the ${total} engines are ready.`;
}

/**
 * What the settings list says about an engine change that has not reached the daemon. Derived
 * at render from `pendingEngine`, never stored: a surface that kept a "needs restart" boolean is
 * a surface that can disagree with the row it describes.
 */
export interface RestartNotice {
  title: string;
  detail: string;
  actionLabel: string;
}

export function restartNotice(model: SetupModel): RestartNotice | null {
  if (!model.pendingEngine) return null;
  const label = engineLabel(model.pendingEngine);
  return {
    // The engine fact's words for the same two facts, since both are on screen together: what is
    // chosen and what she is running on; never "stored" or "the daemon".
    title: `${label} is chosen. Athena is still running on ${engineLabel(model.daemonEngine)}.`,
    detail: "A restart drops nothing: conversations are on disk and resume on the new engine.",
    actionLabel: `Restart on ${label}`,
  };
}

/**
 * The app's one chance to say what it is. Three claims, one sentence each, on the first run only
 * — a returning user is not made to read them again.
 */
export const WHAT_ATHENA_IS: readonly { title: string; body: string }[] = [
  {
    title: "It runs on this machine",
    body: "Athena runs on this computer, on an engine you already pay for. No key is typed here.",
  },
  {
    title: "Each site is trusted, or not",
    body: "A page may offer tools; whether Athena uses them is your call, per origin.",
  },
  {
    title: "It asks before anything irreversible",
    body: "Reads and reversible edits run. Money and people wait for a card you answer.",
  },
];
