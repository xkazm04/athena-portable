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
 *
 * While the vault carries a `records_notice` (its connections file could not be read), no row may
 * read as connected: what the records say cannot be confirmed, so a row the record calls
 * connected reads "unconfirmed" and points at the notice, and a row it calls not connected says
 * why it is shown so instead of asserting that nothing is stored.
 */
import type { ConnectorToolView, ConnectorView, FlowView } from "@/lib/api";
import type { Tone } from "@/components/StatusDot";
import { parseStamp } from "@/lib/time";

export type Standing = "not-connected" | "connected" | "needs-reauth" | "off" | "broken" | "unconfirmed";

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
  /** How the credential rests and what that guards against, or "" when nothing is stored. */
  seal: string;
  /** Whether anything can be sealed on this machine at all. */
  sealAvailable: boolean;
  /** The record's own fact, unaffected by a records notice: the daemon has it as connected. */
  connected: boolean;
  /**
   * The connector's health detail while it is connected and not broken, else "" — after a
   * connect, the daemon's word on it (e.g. that writes were turned off for another account). A
   * later probe overwrites it on the record. Information, never an error.
   */
  healthNote: string;
  /** Why the writes switch and the allow-list cannot be changed now, or "" when they can. */
  disabledReason: string;
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
  /** Why the list could not be read, or null. */
  problem: ConnectorProblem | null;
  /** The vault's notice that its connections file could not be read, verbatim, or "". */
  recordsNotice: string;
  actions: ConnectorActions;
}

export function isWrite(tool: ConnectorToolView): boolean {
  return tool.reversible === false || tool.side_effects === "external";
}

/** "3 min ago" from an ISO stamp, or the raw string when it cannot be read. */
export function ageOf(iso: string, now: number = Date.now()): string {
  if (!iso) return "";
  // A stamp without a zone is UTC, not the viewer's local time (lib/time.ts).
  const at = parseStamp(iso);
  if (at === null) return iso;
  const s = Math.max(0, Math.round((now - at.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/**
 * How the credential rests, and what that does and does not protect against — completing "The
 * credential is …". Each rung says its own limit: only the keystore and DPAPI encrypt, and the
 * file rung is said plainly not to.
 */
export function sealSentence(seal: ConnectorView["connection"]["seal"]): string {
  switch (seal) {
    case "keyring":
      return "kept in the operating system's keystore rather than in a file of Athena's; another program must ask the keystore for it, and the operating system decides whether to hand it over";
    case "dpapi":
      return "encrypted by Windows DPAPI with your Windows sign-in, and readable by any program running as you; another Windows user or another machine cannot read it";
    case "file":
      return "kept in a file only your user account may open; it is not encrypted, so any program running as you can read it";
    default:
      return "";
  }
}

export function standingOf(
  view: ConnectorView,
  now: number = Date.now(),
  recordsNotice: string = "",
): { standing: Standing; word: string; sentence: string; tone: Tone } {
  const c = view.connection;
  if (recordsNotice) {
    // The records could not be read: a row the record calls connected (on, off or broken alike)
    // cannot be confirmed, and one it calls not connected is shown so for that reason, not as fact.
    if (c.status === "connected") {
      return {
        standing: "unconfirmed",
        word: "unconfirmed",
        sentence: `The record says connected${c.identity ? ` as ${c.identity}` : ""}, but that cannot be confirmed while the notice above stands.`,
        tone: "warning",
      };
    }
    if (c.status !== "needs_reauth") {
      return {
        standing: "not-connected",
        word: "not connected",
        sentence: "Shown as not connected because the connections file could not be read; see the notice above.",
        tone: "warning",
      };
    }
  }
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
      sentence: `Nothing is stored for ${view.label}.`,
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
  recordsNotice: string = "",
): ConnectorRow {
  const { standing, word, sentence, tone } = standingOf(view, now, recordsNotice);
  const c = view.connection;
  const connected = c.status === "connected";
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
    connected,
    healthNote: connected && c.health !== "broken" ? c.health_detail : "",
    disabledReason: connected
      ? ""
      : `Connect ${view.label} first; the switches apply to the account you connect.`,
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

/**
 * Why the list could not be read, and WHO is saying so.
 *
 * The note used to assert "The daemon refused the list; the reason above is its own" for every
 * failure, including the ones where the request never left this shell — which is how a
 * `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`, a bug in
 * `lib/api.ts`'s own default, was reported to a person as the vault refusing them. "The vault said
 * no" and "we never asked" are different facts and a surface that conflates them sends the reader
 * to debug the wrong machine.
 */
export interface ConnectorProblem {
  /** The reason, verbatim. Never paraphrased. */
  reason: string;
  /** `daemon` when it answered and refused; `client` when the request never reached it. */
  from: "daemon" | "client";
}

/** The store snapshots in, the view-model out. Pure; `now` is an argument for the tests. */
export function selectConnectors(
  items: readonly ConnectorView[],
  loaded: boolean,
  problem: ConnectorProblem | null,
  daemonReady: boolean,
  busy: Readonly<Record<string, string>>,
  errors: Readonly<Record<string, string>>,
  actions: ConnectorActions,
  now: number = Date.now(),
  recordsNotice: string = "",
): ConnectorsModel {
  return {
    rows: items.map((view) => rowOf(view, busy, errors, now, recordsNotice)),
    ready: daemonReady,
    loaded,
    problem,
    recordsNotice,
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
