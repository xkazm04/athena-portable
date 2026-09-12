/**
 * What an engine probe is, and what a person should do about each answer — README section 3.1
 * (harness: "CLI harness in two dialects, engine probes").
 *
 * The daemon runs the probe: it knows whether `claude` and `codex` are on the PATH, what version
 * each answered with, and whether the CLI says it is signed in. The shell only *renders* that,
 * so this file is a shape and a vocabulary and holds no probing of its own.
 *
 * It is deliberately a small type of the panel's own rather than an import from the sidecar's
 * store: the sidecar lands in c20 beside this commit, its `daemon:status` will feed these values
 * in, and the Setup wizard must be renderable in the preview harness with no daemon at all. A
 * fixture is an `EngineProbe[]`; the live wiring is one line in the module's `Live`.
 *
 * **Three states and a fourth that is not a state.** `found`, `not_found` and `not_logged_in`
 * are answers; `unknown` is the probe not having answered *yet*, which is a different fact from
 * "nothing is installed" and the surface owes the user the difference. And `null` in place of the
 * whole list means the same thing one floor up: the daemon has not answered at all.
 */

/** The two dialects this build carries. `api` is a non-goal (README section 8). */
export const ENGINE_IDS = ["claude_code", "codex"] as const;

export type EngineId = (typeof ENGINE_IDS)[number];

export type EngineState = "found" | "not_found" | "not_logged_in" | "unknown";

export interface EngineProbe {
  /** `claude_code` or `codex`; typed loosely so a daemon that grows a third is still rendered. */
  id: string;
  state: EngineState;
  /**
   * The probe's own words — a version string, or the reason it could not be used. Rendered
   * verbatim; a reason we cannot explain is still a reason.
   */
  detail: string;
}

/** What a person calls it. An id the daemon invented is shown as itself rather than guessed at. */
export const ENGINE_LABELS: Readonly<Record<string, string>> = {
  claude_code: "Claude Code",
  codex: "Codex",
};

export function engineLabel(id: string): string {
  return ENGINE_LABELS[id] ?? id;
}

export function isEngineId(id: string | null): id is EngineId {
  return id !== null && (ENGINE_IDS as readonly string[]).includes(id);
}

/** The engine the app comes up on before anything has been chosen. */
export const DEFAULT_ENGINE: EngineId = "claude_code";

/**
 * The one sentence that says what to do about this answer.
 *
 * It is a *remediation*, not an explanation: every one of these ends in something the person can
 * go and do. "Found" is the only state with nothing to do, and it says so rather than being
 * left blank — a blank cell reads as a missing fact.
 */
export function remedyFor(probe: EngineProbe): string {
  switch (probe.state) {
    case "found":
      return "Nothing to do. Choosing this engine starts the daemon on it.";
    case "not_logged_in":
      return `Sign in once in a terminal — \`${cliOf(probe.id)}\` — and probe again. Athena never asks for a key.`;
    case "not_found":
      return `Install it, or put \`${cliOf(probe.id)}\` on the PATH, and probe again.`;
    case "unknown":
      return "The probe has not answered yet. Nothing is known about this engine.";
  }
}

/** The binary behind an engine id, which is what a remediation sentence has to name. */
export function cliOf(id: string): string {
  return id === "codex" ? "codex" : "claude";
}

/** Probes whose binary answered *and* that are usable. The only ones worth choosing. */
export function usable(probes: readonly EngineProbe[]): EngineProbe[] {
  return probes.filter((p) => p.state === "found");
}

/** One probe by id, or `null`. Used to say what the chosen engine's own standing is. */
export function probeOf(probes: readonly EngineProbe[] | null, id: string): EngineProbe | null {
  return probes?.find((p) => p.id === id) ?? null;
}
