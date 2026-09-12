/**
 * The Panel module's view-model — README section 3.2 (how a turn flows) and 3.4 (three tiers).
 *
 * This is the home module: the conversation with Athena, the page's own surface beside it, and
 * the gate in the middle of both. Everything on it is a reading of four store slices — the run
 * loop's state, the focused tab, that page's bridge answer, and the origin's stored trust — and
 * the selector below is the whole of the mapping.
 *
 * Three rules the shape keeps:
 *
 * - **The gate is the policy.** `declaredCls`, `overrideCls` and `effectiveCls` arrive from the
 *   run store, which got them from the daemon. Nothing here derives a class; `@/lib/classes` only
 *   says which *overrides a user may offer to pin*, which is a different question (ADR 0018).
 * - **Everything a page or a model produced is untrusted text.** A transcript line, a tool's
 *   description, a decision's parameters and a capture's pixels are displayed — as text, as an
 *   `<img>` — and never as markup and never as an instruction (README invariant, CLAUDE.md
 *   "untrusted fences").
 * - **A decision is read off the record, not remembered.** A card's state is derived from the
 *   transcript item that carries it and from `pendingDecision`, so a resolved card cannot
 *   disagree with the line that resolved it.
 */
import { CLASS_WORD, allowedOverrides, whyNoOverride } from "@/lib/classes";
import type { ToolClass } from "@/lib/store";
import type { Decision, RunStatus, ToolRow, TranscriptItem } from "@/stores/run";

// -- the model -------------------------------------------------------------------------------

/** The page the turn is about, as the shell last reported it. */
export interface PanelPage {
  tabId: number;
  title: string;
  url: string;
  host: string;
  origin: string;
}

/** What the relay got back from that page (README section 3.4, tier 1). */
export interface PanelBridge {
  /** `webmcp-native`, `webmcp-polyfill`, or null when nothing answered. */
  transport: string | null;
  /** The relay's own word when the page could not be read. `timeout` means "no bridge here". */
  problem: string | null;
  /** A `bridge_list` is in flight; an empty list is not yet an answer. */
  asking: boolean;
}

/** The origin's standing trust. `known` is false on a first sight, which is a fact of its own. */
export interface PanelTrust {
  origin: string;
  enabled: boolean;
  known: boolean;
  overrides: Readonly<Record<string, ToolClass>>;
}

/** One row of the tool list: what it is, what the gate will do, and where it came from. */
export interface PanelTool {
  name: string;
  description: string;
  tier: 1 | 2 | 3;
  declaredCls: ToolClass;
  overrideCls: ToolClass | null;
  effectiveCls: ToolClass;
  transport: string;
  /** The user pinned this class rather than the manifest declaring it. */
  overridden: boolean;
  /** The classes the user may pin this at. Tighten-only, so often empty (ADR 0018). */
  allowed: readonly ToolClass[];
  /** Why `allowed` is empty, or null when it is not. Shown, never implied. */
  lockedReason: string | null;
  /**
   * `GATED` because this origin has never been seen before. README section 3.3: *generic hands
   * are `GATED` on first sight for every new origin* — the row is marked so the first launch
   * reads as a policy rather than as nine coincidences.
   */
  firstSight: boolean;
}

/** One line of the record, already sorted into how it should be read. */
export interface PanelLine {
  id: string;
  kind: TranscriptItem["kind"];
  text: string;
  at: number;
  /** Present on a `decision` line: the card that line is about. */
  card: DecisionCard | null;
}

/** One parameter of a proposed call, rendered legibly rather than dumped. */
export interface ParamRow {
  key: string;
  /** The value as text. A structure is JSON; a string is itself. */
  text: string;
  kind: "string" | "number" | "boolean" | "null" | "json";
  /** `text` cut to the row budget, with `(showing N of M)` when it was cut. */
  short: string;
  truncated: boolean;
}

/**
 * The decision card, in one of the three states a card can be in.
 *
 * `pending` is the one the user can answer; it is pinned above the composer as well as sitting in
 * the record, because a card that scrolls away is a turn that has silently stopped. `resolved`
 * collapses to the one line that says what was chosen. `stale` is a card the record carries that
 * nothing is waiting on any more — a previous run's, or one another surface answered — and it
 * says so rather than offering buttons that would be refused.
 */
export interface DecisionCard {
  id: string;
  state: "pending" | "resolved" | "stale";
  action: string;
  params: readonly ParamRow[];
  summary: string;
  options: readonly string[];
  /** The `captures` row id, or null. Null means *no picture*, not "a picture is loading". */
  captureId: string | null;
  /** The PNG once the store has answered, as a data URL. Untrusted pixels: an `<img>`. */
  captureUrl: string | null;
  origin: string;
  surface: string;
  createdAt: number;
  /** The option the user took, once they have. */
  choice: string | null;
}

export interface PanelActions {
  send: (message: string) => void;
  answer: (approvalId: string, choice: string) => void;
  setOverride: (origin: string, tool: string, cls: ToolClass | null) => void;
  clear: () => void;
  /** Ask the shell to bring the daemon back up. The only act the offline state offers. */
  reconnect: () => void;
}

export interface PanelModel {
  status: RunStatus;
  page: PanelPage | null;
  bridge: PanelBridge | null;
  trust: PanelTrust | null;
  tools: readonly PanelTool[];
  lines: readonly PanelLine[];
  /** The card to pin above the composer, or null. Always also present in `lines`. */
  pending: DecisionCard | null;
  conversationId: string | null;
  /** The run loop's own failure, verbatim, or null. */
  error: { reason: string; detail: string } | null;
  daemonReady: boolean;
  /** Why the daemon is not answering, in its own words. Null when it is. */
  daemonProblem: string | null;
  /** Null when a turn can be asked for; otherwise the reason, as the control's own label. */
  blocked: string | null;
  actions: PanelActions;
}

// -- the selector ----------------------------------------------------------------------------

export interface PanelSources {
  status: RunStatus;
  transcript: readonly TranscriptItem[];
  pendingDecision: Decision | null;
  lastError: { reason: string; detail: string } | null;
  conversationId: string | null;
  tools: readonly ToolRow[];
  page: PanelPage | null;
  bridge: PanelBridge | null;
  trust: PanelTrust | null;
  daemonReady: boolean;
  daemonProblem: string | null;
  /** Capture id to data URL, for the captures this surface has already read back. */
  captures: Readonly<Record<string, string>>;
  actions: PanelActions;
}

/**
 * The store snapshot in, the view-model out, and nothing else in the world.
 *
 * The one join worth naming: a transcript `decision` line and `pendingDecision` are two views of
 * the same approval, and the line wins for the *content* while the pending slot decides the
 * *state*. That is the direction that cannot go stale — the record is append-only and the pending
 * slot empties the moment the daemon answers.
 */
export function selectPanel(source: PanelSources): PanelModel {
  const pendingId = source.pendingDecision?.id ?? null;
  const answers = answeredIn(source.transcript);
  const lines = source.transcript.map((item) => line(item, pendingId, answers, source.captures));

  const pending = source.pendingDecision
    ? (lines.find((l) => l.card?.id === pendingId)?.card ??
      cardOf(source.pendingDecision, "pending", null, source.captures))
    : null;

  return {
    status: source.status,
    page: source.page,
    bridge: source.bridge,
    trust: source.trust,
    tools: source.tools.map((tool) => toolRow(tool, source.trust)),
    lines,
    pending,
    conversationId: source.conversationId,
    error: source.lastError,
    daemonReady: source.daemonReady,
    daemonProblem: source.daemonProblem,
    blocked: blockedReason(source),
    actions: source.actions,
  };
}

/**
 * Why the composer is closed, in the words it will wear as its own label — house style §2.2: a
 * disabled control whose reason is stated nowhere is a dead end.
 */
function blockedReason(source: PanelSources): string | null {
  if (!source.daemonReady) return "Athena is offline";
  if (source.status === "streaming") return "Athena is working";
  if (source.status === "awaiting_decision") return "answer the card first";
  if (!source.page) return "open a page first";
  return null;
}

function toolRow(tool: ToolRow, trust: PanelTrust | null): PanelTool {
  const overridden = tool.overrideCls !== null;
  return {
    name: tool.name,
    description: tool.description,
    tier: tool.tier,
    declaredCls: tool.declaredCls,
    overrideCls: tool.overrideCls,
    effectiveCls: tool.effectiveCls,
    transport: tool.transport,
    allowed: allowedOverrides(tool.declaredCls),
    lockedReason: whyNoOverride(tool.declaredCls),
    overridden,
    // Not "is it gated" but "is it gated *because nobody has ruled on this page yet*". An origin
    // with a stored row has been seen; one without is a first sight and the gate says so.
    firstSight: tool.effectiveCls === "GATED" && !overridden && !(trust?.known ?? false),
  };
}

function line(
  item: TranscriptItem,
  pendingId: string | null,
  answers: ReadonlyMap<string, string>,
  captures: Readonly<Record<string, string>>,
): PanelLine {
  return {
    id: item.id,
    kind: item.kind,
    text: item.text,
    at: item.at,
    card:
      item.kind === "decision" ? decisionFromItem(item, pendingId, answers, captures) : null,
  };
}

/**
 * Which approval each answer in the record resolved, and to what.
 *
 * A card is two lines, not one: the turn raises it and the user's answer lands later, and only
 * the second carries a choice. Without this join the first would read *not answered here* with
 * the answer to it one line below — which is a record contradicting itself on the demo path.
 */
function answeredIn(transcript: readonly TranscriptItem[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of transcript) {
    if (item.kind !== "decision") continue;
    const id = str(item.meta?.id);
    const choice = str(item.meta?.choice);
    if (id && choice) out.set(id, choice);
  }
  return out;
}

// -- the decision card ------------------------------------------------------------------------

/** The row budget for one parameter value before it is cut and offered whole (house style §2.4). */
export const PARAM_BUDGET = 120;

/**
 * A `decision` transcript line as a card.
 *
 * `meta` is a loose bag on the wire, so every field is read with a guard and a line that carries
 * nothing usable produces `null` — which the view renders as the plain line it is. A surface that
 * threw here would lose the whole record to one malformed row.
 */
export function decisionFromItem(
  item: TranscriptItem,
  pendingId: string | null,
  answers: ReadonlyMap<string, string> = new Map(),
  captures: Readonly<Record<string, string>> = {},
): DecisionCard | null {
  const meta = item.meta ?? {};
  const action = str(meta.action);
  if (!action) return null;
  const id = str(meta.id) ?? item.id;
  // The line's own choice first, then the one a later line recorded for this approval. `stale` is
  // left for what it means: a card this panel never answered at all.
  const choice = str(meta.choice) ?? answers.get(id) ?? null;
  return {
    id,
    state: choice ? "resolved" : id === pendingId ? "pending" : "stale",
    action,
    params: paramRows(obj(meta.params)),
    summary: str(meta.summary) ?? item.text,
    options: strings(meta.options),
    captureId: str(meta.captureId),
    captureUrl: captureUrl(str(meta.captureId), captures),
    origin: str(meta.origin) ?? "",
    surface: str(meta.surface) ?? "",
    createdAt: typeof meta.createdAt === "number" ? meta.createdAt : item.at,
    choice,
  };
}

/** The pending approval as a card, for the run that has no transcript line for it yet. */
export function cardOf(
  decision: Decision,
  state: DecisionCard["state"],
  choice: string | null,
  captures: Readonly<Record<string, string>> = {},
): DecisionCard {
  return {
    id: decision.id,
    state,
    action: decision.action,
    params: paramRows(decision.params),
    summary: decision.summary,
    options: decision.options,
    captureId: decision.captureId,
    captureUrl: captureUrl(decision.captureId, captures),
    origin: decision.origin,
    surface: decision.surface,
    createdAt: decision.createdAt,
    choice,
  };
}

/**
 * The one line a resolved card collapses to. It names the choice and the call, and nothing else:
 * the card is in the record above it if the user wants the parameters back.
 */
export function collapsedLine(card: DecisionCard): string {
  if (card.state === "resolved") return `${card.choice} · ${card.action}`;
  if (card.state === "stale") return `not answered here · ${card.action}`;
  return `waiting on you · ${card.action}`;
}

/** Which option is the primary act. `approve` leads where the daemon offered it; else the first. */
export function primaryOption(options: readonly string[]): string | null {
  if (options.length === 0) return null;
  return options.find((o) => o.toLowerCase() === "approve") ?? options[0];
}

/**
 * A parameter map as rows: every value as text, long ones cut to the budget and announced.
 *
 * This is the field the whole card turns on — the user is approving *these arguments* — so it is
 * a key/value list in the card's own type tiers rather than `JSON.stringify(params, null, 2)` in
 * a scrolling well, which is what the first build's 380px column reduced it to.
 */
export function paramRows(params: Record<string, unknown>): ParamRow[] {
  return Object.entries(params).map(([key, value]) => {
    const { text, kind } = render(value);
    const truncated = text.length > PARAM_BUDGET;
    return {
      key,
      text,
      kind,
      short: truncated ? `${text.slice(0, PARAM_BUDGET)}… (showing ${PARAM_BUDGET} of ${text.length})` : text,
      truncated,
    };
  });
}

function render(value: unknown): { text: string; kind: ParamRow["kind"] } {
  if (value === null || value === undefined) return { text: "null", kind: "null" };
  if (typeof value === "string") return { text: value, kind: "string" };
  if (typeof value === "number") return { text: String(value), kind: "number" };
  if (typeof value === "boolean") return { text: value ? "true" : "false", kind: "boolean" };
  return { text: JSON.stringify(value), kind: "json" };
}

function captureUrl(id: string | null, captures: Readonly<Record<string, string>>): string | null {
  return id ? (captures[id] ?? null) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function obj(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The class words, re-exported so a view spends one vocabulary rather than writing a second. */
export { CLASS_WORD };

/** Fixtures and any variant that needs a set that does nothing. */
export const INERT_ACTIONS: PanelActions = {
  send: () => {},
  answer: () => {},
  setOverride: () => {},
  clear: () => {},
  reconnect: () => {},
};
