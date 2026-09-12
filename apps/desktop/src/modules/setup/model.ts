/**
 * The setup module: is Athena usable here, and if not, what do I do (README act 1).
 *
 * Readiness is three-valued because "not healthy" is two situations
 * (`src/athena/daemon/ready.py`): a thing known to be wrong, and a thing nobody has asked about
 * yet. A setup screen that rendered them the same way would tell a user to install a CLI they
 * already have.
 *
 * The headline of act 1 is that no key is typed. The engine check reports a *subscription* the
 * user already has, so this module has no field for a credential and never will.
 */

export type CheckState = "healthy" | "broken" | "unknown";

export interface CheckView {
  name: string;
  state: CheckState;
  detail: string;
  remediation: string;
}

export interface SetupModel {
  ready: boolean;
  summary: string;
  checks: CheckView[];
  /** Set while the daemon is being asked again. */
  probing: boolean;
  /** The daemon's own address, so a user reporting a problem can name it. */
  daemon: string | null;
}

export interface SetupActions {
  probe(): void;
}

export const fixtures: Readonly<Record<string, SetupModel>> = Object.freeze({
  empty: { ready: false, summary: "waiting for the daemon", checks: [], probing: false, daemon: null },

  "first launch, everything found": {
    ready: true,
    summary: "ready",
    checks: [
      { name: "brain", state: "healthy", detail: "open at ~/.athena/brain", remediation: "" },
      { name: "constitution", state: "healthy", detail: "loaded: identity, law", remediation: "" },
      { name: "engine", state: "healthy", detail: "available: claude_code", remediation: "" },
    ],
    probing: false,
    daemon: "http://127.0.0.1:51423",
  },

  "no engine on this machine": {
    ready: false,
    summary: "install the Claude or Codex CLI and sign in; no API key is needed",
    checks: [
      { name: "brain", state: "healthy", detail: "open at ~/.athena/brain", remediation: "" },
      { name: "constitution", state: "healthy", detail: "loaded: identity, law", remediation: "" },
      {
        name: "engine",
        state: "broken",
        detail: "claude_code: claude is not on PATH; codex: codex is not on PATH",
        remediation: "install the Claude or Codex CLI and sign in; no API key is needed",
      },
    ],
    probing: false,
    daemon: "http://127.0.0.1:51423",
  },

  "not probed yet": {
    ready: false,
    summary: "run the engine probe",
    checks: [
      { name: "brain", state: "healthy", detail: "open at ~/.athena/brain", remediation: "" },
      { name: "constitution", state: "healthy", detail: "loaded: identity, law", remediation: "" },
      {
        name: "engine",
        state: "unknown",
        detail: "no engine has been probed yet",
        remediation: "run the engine probe",
      },
    ],
    probing: true,
    daemon: "http://127.0.0.1:51423",
  },
});
