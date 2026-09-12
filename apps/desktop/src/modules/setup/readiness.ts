/**
 * What this machine's standing *is*, derived from `SetupModel` at render.
 *
 * The one place the four facts become words, so the letter and the rail cannot disagree about
 * whether an engine is "signed out" or "missing", and so that **no variant stores a verdict it
 * could have read**. Every function here is pure over the view-model; nothing is cached and
 * nothing is echoed back into the store.
 *
 * That is the point rather than a nicety. A wizard that writes `setup_complete = true` is a
 * wizard that says the machine is ready after the engine has been uninstalled. Here, a standing
 * that disagreed with the fields under it is not a state this module can reach.
 */
import { engineLabel, probeOf, usable, type EngineProbe } from "@/lib/engines";
import type { Tone } from "@/components/StatusDot";

import type { SetupModel, StepKey } from "./model";

/**
 * Four words, in the order a person wants them resolved. `unknown` is the one a boolean could
 * not say: the probe has not answered, which is not the same fact as nothing being installed.
 */
export type Standing = "done" | "todo" | "missing" | "unknown";

export interface Station {
  key: StepKey;
  /** The noun on the rail. */
  title: string;
  standing: Standing;
  /** One line, the fact in the machine's own words. Never truncated by a variant. */
  summary: string;
  /** `done` is the destination, not a requirement of itself. */
  required: boolean;
}

/** Which hue a standing takes. `unknown` is not a warning; it is early. */
export const STANDING_TONE: Record<Standing, Tone> = {
  done: "success",
  todo: "neutral",
  missing: "warning",
  unknown: "pending",
};

export function engineStation(model: SetupModel): Station {
  const base = { key: "engine" as const, title: "Engine", required: true };
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

export function brainStation(model: SetupModel): Station {
  const base = { key: "brain" as const, title: "Brain", required: true };
  if (model.brainPath.trim().length > 0) {
    return { ...base, standing: "done", summary: "a directory of its own" };
  }
  // Not `missing`: the daemon has a default and it works. It is `todo` because a person who
  // cares where their episodes are written has not yet said.
  return { ...base, standing: "todo", summary: "the daemon's default directory" };
}

export function pageStation(model: SetupModel): Station {
  const base = { key: "page" as const, title: "A page", required: true };
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

/**
 * Never required: a machine with no microphone runs every act but the spoken one. `unknown` is
 * "not asked yet", which is honest and is what a first launch shows.
 */
export function micStation(model: SetupModel): Station {
  const base = { key: "mic" as const, title: "Microphone", required: false };
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

export function doneStation(model: SetupModel): Station {
  const base = { key: "done" as const, title: "Done", required: false };
  const { done, required } = inPlace(model);
  if (done === required) {
    return { ...base, standing: "done", summary: "everything the first turn needs" };
  }
  return { ...base, standing: "todo", summary: `${required - done} still to answer` };
}

/** The five, in the order the machine has to satisfy them. */
export function stations(model: SetupModel): Station[] {
  return [
    engineStation(model),
    brainStation(model),
    pageStation(model),
    micStation(model),
    doneStation(model),
  ];
}

/** The headline figure: required stations in place, out of required stations. Derived. */
export function inPlace(model: SetupModel): { done: number; required: number } {
  const required = [engineStation(model), brainStation(model), pageStation(model)];
  return {
    done: required.filter((s) => s.standing === "done").length,
    required: required.length,
  };
}

/**
 * Is this machine ready for a turn? Derived at the call, never stored.
 *
 * The brain station is deliberately not part of it: the daemon has a default and it works, so a
 * person who has not chosen a directory is not blocked — they have simply not chosen.
 */
export function isReady(model: SetupModel): boolean {
  return engineStation(model).standing === "done" && pageStation(model).standing === "done";
}

/**
 * The engine passage's opening sentence, composed from the figures.
 *
 * It lives here rather than in the view because it is a *claim about the machine* and it has to
 * be exactly as strong as the probe is: "answered its version flag" is all a probe proves, and
 * the sentence never says more. The number agreement is here too — a surface that says "1 of the
 * 2 answered their version flag" reads as machine-written, and everything else on this page is
 * asking to be believed.
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
