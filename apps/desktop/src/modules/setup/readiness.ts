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
import { engineLabel, probeOf, usable, type EngineProbe } from "@/lib/engines";
import type { Tone } from "@/components/StatusDot";

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
export const STANDING_TONE: Record<Standing, Tone> = {
  done: "success",
  todo: "neutral",
  missing: "warning",
  unknown: "pending",
};

export function engineFact(model: SetupModel): Fact {
  const base = { key: "engine" as const };
  if (model.probes === null) {
    return {
      ...base,
      standing: "unknown",
      summary: model.problem
        ? `the probe could not be read — ${model.problem}`
        : "the probe has not answered yet",
    };
  }
  const chosen: EngineProbe | null = probeOf(model.probes, model.engine);
  if (chosen?.state === "found") {
    return { ...base, standing: "done", summary: `${engineLabel(chosen.id)} answered` };
  }
  const found = usable(model.probes);
  if (chosen && chosen.state === "not_logged_in") {
    return {
      ...base,
      standing: "missing",
      summary: `${engineLabel(chosen.id)} is installed and signed out`,
    };
  }
  if (found.length > 0) {
    return {
      ...base,
      standing: "todo",
      summary: `${found.length} of ${model.probes.length} answered, another is chosen`,
    };
  }
  return {
    ...base,
    standing: "missing",
    summary:
      model.probes.length === 0
        ? "the probe named no engines at all"
        : `none of the ${model.probes.length} answered`,
  };
}

export function pageFact(model: SetupModel): Fact {
  const base = { key: "page" as const };
  if (model.tabs.length === 0) {
    return { ...base, standing: "todo", summary: "none open yet" };
  }
  const first = model.tabs[0].host;
  return {
    ...base,
    standing: "done",
    summary: model.tabs.length === 1 ? `open on ${first}` : `${model.tabs.length} open`,
  };
}

export function brainFact(model: SetupModel): Fact {
  const base = { key: "brain" as const };
  if (model.brainPath.trim().length > 0) {
    return { ...base, standing: "done", summary: "a directory of its own" };
  }
  // Not `missing`: the daemon has a default and it works. It is `todo` because a person who
  // cares where their episodes are written has not yet said.
  return { ...base, standing: "todo", summary: "the daemon's default directory" };
}

/** Never required: a machine with no microphone runs every act but the spoken one. */
export function micFact(model: SetupModel): Fact {
  const base = { key: "mic" as const };
  switch (model.mic) {
    case "granted":
      return { ...base, standing: "done", summary: model.micDetail || "granted" };
    case "denied":
      return { ...base, standing: "missing", summary: model.micDetail || "refused by the webview" };
    case "unsupported":
      return { ...base, standing: "missing", summary: model.micDetail || "none on this machine" };
    default:
      return { ...base, standing: "unknown", summary: "not asked yet" };
  }
}

export function voiceFact(model: SetupModel): Fact {
  const base = { key: "voice" as const };
  if (model.voiceAvailable) {
    return { ...base, standing: "done", summary: "the daemon listens on /voice" };
  }
  return {
    ...base,
    standing: model.daemonHealth === "ready" ? "missing" : "unknown",
    summary: model.voiceReason || "the daemon has not said yet",
  };
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
  const page = pageFact(model);
  if (engine.standing !== "done" && page.standing !== "done") {
    return "Choose an engine that answered and open a page first.";
  }
  if (engine.standing === "unknown") return "The engine probe has not answered yet.";
  if (engine.standing !== "done") return `The engine cannot run a turn yet: ${engine.summary}.`;
  if (page.standing !== "done") return "Open a page first — Athena works inside one.";
  return "";
}

/**
 * The engine passage's opening sentence, composed from the figures.
 *
 * It lives here rather than in the view because it is a *claim about the machine* and it has to
 * be exactly as strong as the probe is: "answered its version flag" is all a probe proves, and
 * the sentence never says more.
 */
export function engineLead(found: number, total: number): string {
  if (total === 0) return "The probe answered and named no engines at all.";
  if (found === 0) {
    return total === 1
      ? "The one engine did not answer its version flag."
      : `None of the ${total} answered their version flags.`;
  }
  if (found === total) {
    return total === 1
      ? "The one engine answered its version flag."
      : `All ${total} answered their version flags.`;
  }
  return found === 1
    ? `1 of the ${total} answered its version flag.`
    : `${found} of the ${total} answered their version flags.`;
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
    title: `${label} is stored. The daemon is still on ${engineLabel(model.daemonEngine)}.`,
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
    body: "The daemon is local, on an engine you already pay for. No key is typed here.",
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
