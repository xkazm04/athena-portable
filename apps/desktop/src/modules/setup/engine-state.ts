/**
 * The engine's standing as one union — ADR 0214.
 *
 * Eight inputs decide whether a turn can run: what the probe said, whether a check is in flight
 * or failed, whether the daemon has reported, the stored engine, the engine the daemon is on and
 * its health. They used to be read by four parallel if-chains (the start failure,
 * the pending engine, the engine fact, the not-ready sentence), each over a different subset in a
 * different order, and two of the combinations they missed were dead ends: a daemon that failed
 * on the engine it was still running on after the person chose another read as running, with no
 * button; and a daemon that failed before naming an engine read as "still starting up".
 *
 * Here the combination is decided once, and every state that is not `running` names its move:
 * the one act that gets the person out of it. `wait` is a move only while something is genuinely
 * in flight (a check, a start, the first daemon reading). `readiness.ts`'s engine fact, the
 * view-model's `startFailure` and `pendingEngine` are projections of this.
 */
import type { DaemonHealth } from "@/lib/daemon";
import { engineLabel, isEngineId, probeOf, usable, type EngineProbe } from "@/lib/engines";

import type { Standing } from "./readiness";

/** The one act a state asks for. `null` only for `running`, which asks for nothing. */
export type EngineMove = "check" | "restart" | "choose" | "sign-in" | "install" | "wait" | null;

export type EngineStateKind =
  | "unchecked"
  | "checking"
  | "check-failed"
  | "not-installed"
  | "signed-out"
  | "other-chosen"
  | "awaiting-daemon"
  | "starting"
  | "pending-switch"
  | "down-on-other"
  | "failed"
  | "stopped"
  | "running";

/**
 * One state, its move, and the engine fact's words for it. The words sit at the leaf that decides
 * the state, so a state cannot be reached without its sentence, and the first frame carries one
 * decision tree rather than a tree and a switch over it.
 */
export interface EngineState {
  kind: EngineStateKind;
  move: EngineMove;
  standing: Standing;
  summary: string;
}

/** What the decision reads. `SetupModel` is one; so is a store snapshot. */
export interface EngineInputs {
  probes: readonly EngineProbe[] | null;
  checking?: boolean;
  problem: string | null;
  /** The daemon has reported once; before that its fields are placeholders. */
  loaded: boolean;
  engine: string;
  daemonEngine: string;
  daemonHealth: DaemonHealth;
}

export function engineStateOf(m: EngineInputs): EngineState {
  const { engine, daemonEngine: running, daemonHealth: health, loaded } = m;
  // The daemon reports every engine its harness offers; the count is of the ones this desktop can start.
  const probes = m.probes?.filter((p) => isEngineId(p.id)) ?? null;
  const at = (kind: EngineStateKind, move: EngineMove, standing: Standing, summary: string): EngineState => ({
    kind,
    move,
    standing,
    summary,
  });
  const label = engineLabel(engine);
  const chosen = `${label} is chosen, `;
  const failed = health === "failed";
  const down = failed || health === "stopped";
  // The daemon names an engine and it is not the chosen one.
  const other = running && running !== engine;
  const pending = loaded && health === "ready" && other;
  const choice = probeOf(probes, engine);
  if (probes && choice?.state !== "found") {
    // The choice itself is the problem: the words are the probe's, whatever the daemon is doing.
    const found = usable(probes).length;
    const state =
      choice?.state === "not_logged_in"
        ? at("signed-out", "sign-in", "missing", `${label} is installed but not signed in`)
        : found > 0
          ? at("other-chosen", "choose", "todo", `${found} of ${probes.length} ready, but another is chosen`)
          : at(
              "not-installed",
              "install",
              "missing",
              probes.length === 0 ? "Athena was told of no engines at all" : `none of the ${probes.length} can be used yet`,
            );
    // A running daemon on another engine is the restart notice, whatever the probe says of the choice.
    return pending ? { ...state, kind: "pending-switch", move: "restart" } : state;
  }
  if (pending) return at("pending-switch", "restart", "todo", `${chosen}but Athena is still running on ${engineLabel(running)}`);
  if (!probes) {
    // A start that failed on the chosen engine outranks the look it prevented.
    return loaded && down && running === engine
      ? at(health, "restart", "missing", `Athena ${failed ? "could not start" : "is not running"} on ${label}`)
      : m.checking
        ? at("checking", "wait", "unknown", "checking the engine…")
        : m.problem
          ? at("check-failed", "check", "unknown", `Athena could not check the engine (${m.problem})`)
          : at("unchecked", loaded && health !== "starting" ? "check" : "wait", "unknown", "Athena has not heard back about the engine yet");
  }
  // Found is the probe's word; running is the daemon's. A turn goes to the engine the daemon is on,
  // so the fact is done only when both name the chosen one.
  if (!loaded) return at("awaiting-daemon", "wait", "unknown", `${chosen}but Athena has not yet said which engine she is on`);
  if (down) {
    // Failed or stopped on the chosen engine, on the one she was still on after another was chosen,
    // or before she named one: a stop, never "still running" or "starting up". The restart is on
    // the chosen engine.
    return at(
      other ? "down-on-other" : health,
      "restart",
      failed ? "missing" : "todo",
      `${chosen}but Athena ${failed ? (other ? `stopped on ${engineLabel(running)}` : `could not start${running ? " on it" : ""}`) : "is not running"}`,
    );
  }
  if (health === "starting") {
    return at("starting", "wait", "todo", `${chosen}and Athena is still starting up on ${other ? engineLabel(running) : "it"}`);
  }
  // Ready: on the chosen engine, or ready without naming one — a start nobody will finish.
  return running ? at("running", null, "done", `${label} is ready`) : at("starting", "restart", "todo", `${chosen}and Athena is still starting up on it`);
}
