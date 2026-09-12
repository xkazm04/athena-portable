/**
 * The Connectors module's view-model — README section 4; ADR 0021.
 *
 * A connector is a service Athena may use from any page, behind its own switch. This surface
 * shows each one's standing, what it yields, and the two things a person decides: whether writes
 * may run at all, and to whom or where. Everything derived here is derived from the daemon's
 * record at render — the standing word, the seal sentence, the age of the last probe — and
 * nothing is stored: a row that said "connected" after the grant went would be a surface lying.
 *
 * The class of a tool is not decided here. A write is what the spec's own flags make a write
 * (`reversible === false`, or `side_effects === "external"`), which is exactly the derivation the
 * catalog makes; the view shows the word GATED on those and nothing on the reads.
 */
import type { ConnectorToolView, ConnectorView, FlowView } from "@/lib/api";
import type { Tone } from "@/components/StatusDot";

export type Standing = "not-connected" | "connected" | "needs-reauth" | "off" | "broken";

export interface ConnectorActions {
  connect: (id: string, body: Record<string, unknown>) => void;
  disconnect: (id: string) => void;
  probe: (id: string) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  setWrites: (id: string, enabled: boolean) => void;
  setAllowlist: (id: string, entries: readonly string[]) => void;
}

export interface ConnectorRow {
  id: string;
  label: string;
  description: string;
  auth: "token" | "oauth";
  guide: string;
  standing: Standing;
  /** One word for the badge. */
  word: string;
  /** One sentence: who it is connected as, or why it is not. */
  sentence: string;
  tone: Tone;
  /** How the credential rests, or "" when nothing is sealed. */
  seal: string;
  /** Whether anything can be sealed on this machine at all. */
  sealAvailable: boolean;
  reads: readonly ConnectorToolView[];
  writes: readonly ConnectorToolView[];
  /** What the allow-list is a list of, or null when the connector has no writes. */
  egress: "recipients" | "resources" | null;
  writesEnabled: boolean;
  allowlist: readonly string[];
  enabled: boolean;
  flow: FlowView | null;
  /** What is in flight, or "". */
  busy: string;
  /** The last refusal, in the daemon's words, or "". */
  error: string;
}

export interface ConnectorsModel {
  rows: readonly ConnectorRow[];
  /** False until the daemon answers `/health`; nothing here can be asked before that. */
  ready: boolean;
  /** True once `/connectors` has answered; before that an empty list means nobody asked. */
  loaded: boolean;
  /** Why the list could not be read, verbatim, or null. */
  problem: string | null;
  actions: ConnectorActions;
}

export function isWrite(tool: ConnectorToolView): boolean {
  return tool.reversible === false || tool.side_effects === "external";
}

/** "3 min ago" from an ISO stamp, or the raw string when it cannot be read. */
export function ageOf(iso: string, now: number = Date.now()): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function sealSentence(seal: ConnectorView["connection"]["seal"]): string {
  switch (seal) {
    case "keyring":
      return "sealed by the OS keystore";
    case "dpapi":
      return "sealed by Windows DPAPI";
    case "file":
      return "kept in an owner-only file";
    default:
      return "";
  }
}

export function standingOf(
  view: ConnectorView,
  now: number = Date.now(),
): { standing: Standing; word: string; sentence: string; tone: Tone } {
  const c = view.connection;
  if (c.status === "needs_reauth") {
    return {
      standing: "needs-reauth",
      word: "needs reconnecting",
      sentence: `${view.label} let the grant go; connect again to continue.`,
      tone: "warning",
    };
  }
  if (c.status !== "connected") {
    return {
      standing: "not-connected",
      word: "not connected",
      sentence: `Nothing is sealed for ${view.label}.`,
      tone: "neutral",
    };
  }
  if (!c.enabled) {
    return {
      standing: "off",
      word: "switched off",
      sentence: `Connected${c.identity ? ` as ${c.identity}` : ""}, and switched off: nothing runs.`,
      tone: "neutral",
    };
  }
  if (c.health === "broken") {
    const age = ageOf(c.health_at, now);
    return {
      standing: "broken",
      word: age ? `broken (${age})` : "broken",
      sentence: c.health_detail || `${view.label} did not answer the last probe.`,
      tone: "error",
    };
  }
  return {
    standing: "connected",
    word: "connected",
    sentence: c.identity ? `Connected as ${c.identity}.` : "Connected.",
    tone: "success",
  };
}

export function rowOf(
  view: ConnectorView,
  busy: Readonly<Record<string, string>>,
  errors: Readonly<Record<string, string>>,
  now: number = Date.now(),
): ConnectorRow {
  const { standing, word, sentence, tone } = standingOf(view, now);
  const c = view.connection;
  return {
    id: view.id,
    label: view.label,
    description: view.description,
    auth: view.auth,
    guide: view.guide,
    standing,
    word,
    sentence,
    tone,
    seal: c.status === "connected" || c.status === "needs_reauth" ? sealSentence(c.seal) : "",
    sealAvailable: view.seal_available,
    reads: view.tools.filter((t) => !isWrite(t)),
    writes: view.tools.filter(isWrite),
    egress: view.egress === "none" ? null : view.egress,
    writesEnabled: c.writes_enabled,
    allowlist: c.allowlist,
    enabled: c.enabled,
    flow: view.flow,
    busy: busy[view.id] ?? "",
    error: errors[view.id] ?? "",
  };
}

/** The store snapshots in, the view-model out. Pure; `now` is an argument for the tests. */
export function selectConnectors(
  items: readonly ConnectorView[],
  loaded: boolean,
  problem: string | null,
  daemonReady: boolean,
  busy: Readonly<Record<string, string>>,
  errors: Readonly<Record<string, string>>,
  actions: ConnectorActions,
  now: number = Date.now(),
): ConnectorsModel {
  return {
    rows: items.map((view) => rowOf(view, busy, errors, now)),
    ready: daemonReady,
    loaded,
    problem,
    actions,
  };
}

/** The guide as paragraphs: split on blank lines, URLs left as text a person can copy. */
export function paragraphsOf(guide: string): string[] {
  return guide
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

export const INERT_ACTIONS: ConnectorActions = {
  connect: () => {},
  disconnect: () => {},
  probe: () => {},
  setEnabled: () => {},
  setWrites: () => {},
  setAllowlist: () => {},
};
