/**
 * The run loop — plan c22, README section 3.2. The only place a turn is driven.
 *
 * One turn is not one exchange, and that is the whole reason this store exists. README §3.2 step 5
 * says a host tool has no executor in the lane: the gate allows it, the lane emits `tool.call`,
 * *the surface* runs it on the focused page through the relay, and the answer rides the next
 * request's frame. So a turn that called two of the page's tools finishes with two answers the
 * model has not seen, and something has to carry them back.
 *
 * The same is true one step later. A `GATED` call becomes a card; when the user approves it, the
 * daemon replays the gate and hands back an `execute` instruction rather than a result. That runs
 * on the page too, and its answer feeds the next turn.
 *
 * Both continuations are bounded by {@link MAX_CONTINUATIONS}. Two tools that keep proposing each
 * other would otherwise spend a subscription overnight, and a loop whose only limit is the model's
 * judgement is not a limit.
 *
 * Nothing here decides policy. Whether a tool is gated, whether a card is needed and whether an
 * approval covers a call are the gate's answers; this file carries results and renders what it is
 * told. The one thing it refuses on its own is running an `execute` on a page whose origin it does
 * not belong to — a grant is for one origin, and the focused tab may have moved since the card was
 * filed.
 */
import { create } from "zustand";

import { ApiError, DaemonApi, type ExecuteRow, type ToolRow } from "@/lib/api";
import { callOnPage } from "@/lib/hands";
import type { Wire } from "@/lib/ipc";
import { catalogIdOf, derivedIdOf, manifestBodyOf } from "@/lib/manifest";
import { reasonOf, refusalSentence, switchedOffSentence } from "@/companion/plain";
import { isTerminal, type ChannelEvent, type DecisionRequested, type TurnSummary } from "@/lib/events";
import { hasShell, type StorePage, type Tab } from "@/lib/ipc";
import { storeList, storeSet, type ActivityRow, type OriginRow } from "@/lib/store";
import { endpoint, useDaemon } from "@/stores/daemon";
import { useOrigins, type OriginsState } from "@/stores/origins";
import { useTabs } from "@/stores/tabs";
import { useTools, type TabTools } from "@/stores/tools";

/** How many times the loop may continue one exchange on its own before it stops and says so. */
export const MAX_CONTINUATIONS = 8;

export type RunPhase = "idle" | "running" | "acting" | "error";

export interface TranscriptEntry {
  id: string;
  kind: "user" | "assistant" | "tool";
  text: string;
  /** Set on a tool entry: the tier it ran at, so the panel can say where it happened. */
  tier?: number;
  ok?: boolean;
  /** When it was written, as a UTC stamp (`lib/time.ts` reads it). Set on tool entries. */
  at?: string;
}

/** How the user's answer to one card ended. `refused` means the daemon did not take it. */
export type AnswerResult = "approved" | "user_denied" | "refused";

/** One answer given in this window, newest first in `answered`. */
export interface AnsweredDecision {
  id: string;
  action: string;
  /** The catalog origin the card was about (`host:ledgerbox`). */
  origin: string;
  result: AnswerResult;
  /** The closed-set reason: `user_denied`, or what the daemon refused with. `null` when approved. */
  reason: string | null;
  at: string;
}

/** One row for the shell's `activity` table. `approval_id` is the card, `tool` its action. */
export interface ActivityWrite {
  ts: string;
  origin: string;
  tool: string;
  tier: number;
  class: string;
  outcome: string;
  ms: number;
  reason: string | null;
  approval_id: string;
}

/** What was kept on this computer from earlier windows, as the store answered. */
export interface EarlierRecord {
  rows: readonly ActivityRow[];
  showing: number;
  total: number;
  problem: string | null;
}

/** What `answer` tells its caller the moment the daemon has (or has not) taken the answer. */
export interface Settled {
  ok: boolean;
  /** One plain sentence for a refusal; empty when ok. */
  sentence: string;
}

/** How often the cards are checked against the daemon while any is on screen (ms). */
export const RECONCILE_MS = 30_000;

export interface RunFailure {
  reason: string;
  detail: string;
}

/** What the surface has to be able to do for the loop. Swapped wholesale in the headless test. */
export interface RunDeps {
  api: () => DaemonApi | null;
  /**
   * The focused tab: its id, its web origin, and the `app_id` the page claimed if it claimed one.
   *
   * The two origins are different things and are not interchangeable. `origin` is the web origin
   * the browser observed and is what the daemon keys a session by; `appId` is the slug the *page*
   * published, and it is what the catalog namespaces its tools under as `host:<app_id>`. A check
   * that compared one against the other would refuse every call.
   */
  focused: () => { tabId: number; origin: string; appId: string | null } | null;
  hostState: () => Record<string, unknown>;
  /** Run one of the page's own tools on a tab, through the relay. */
  call: (
    tabId: number,
    name: string,
    input: Record<string, unknown>,
  ) => Promise<{ ok: boolean; output: string; error?: string | null; tier?: number }>;
  /**
   * The focused page's manifest body, or `null` when there is nothing to register.
   *
   * README §3.3: a page's tools enter the catalog through a manifest, and `POST /run` refuses an
   * origin it has no session for — so this is not an optimisation, it is the step without which
   * no turn can start. Optional only so a test that is about something else may leave it out.
   */
  manifest?: () => Record<string, unknown> | null;
  /**
   * Catalog origins (`host:<app_id>`) the user has switched off, sent with every `POST /run` so the
   * gate refuses a call on them (UAT backlog B2). Optional so a test about something else may omit it.
   */
  disabledOrigins?: () => string[];
  /**
   * What the gate tightens this turn (ADR 0063): the apps of open tabs the user never registered,
   * and the tools the user pinned `GATED`. Sent with every `POST /run`. Optional so a test about
   * something else may omit it; the shell always wires it.
   */
  gated?: () => GatedLists;
  /** Keep one answered decision on this computer (the `activity` table). */
  record?: (row: ActivityWrite) => Promise<void>;
  /** Read back what earlier windows kept. */
  earlier?: () => Promise<StorePage<ActivityRow>>;
  now?: () => Date;
}

/** A playbook the person handed over: her active project on every turn until cleared (ADR 0044). */
export interface ActivePlaybook {
  id: string;
  title: string;
  /** The playbook's command, which is the goal every tab's turn works toward. */
  goal: string;
}

export interface RunState {
  phase: RunPhase;
  transcript: TranscriptEntry[];
  cards: DecisionRequested[];
  summary: TurnSummary | null;
  error: RunFailure | null;
  continuations: number;
  /** What this origin offers, as the last turn's capability answer said. */
  tools: ToolRow[];
  /** Every tool call of this window. Unlike `transcript`, Clear does not touch it: it is the record. */
  calls: TranscriptEntry[];
  /** Cards whose answer is on its way to the daemon: id to the choice sent. */
  answering: Record<string, string>;
  /** Cards whose last answer was refused: id to the one sentence shown under the buttons. */
  refusals: Record<string, string>;
  /** Answers given in this window, newest first. */
  answered: AnsweredDecision[];
  /** What earlier windows kept, read once at start. `null` until the store has answered. */
  earlier: EarlierRecord | null;
  /** The playbook she is working on, sent as the active project with every turn (ADR 0044). */
  project: ActivePlaybook | null;
  /** Set or clear it. Clear (the transcript) does not touch it: it is the person's selection. */
  setProject: (project: ActivePlaybook | null) => void;
  send: (message: string) => Promise<void>;
  /**
   * Answer a card. The card stays until the daemon says it took the answer; `settled` is called the
   * moment it has (or has not), before any continuation turn, so the slip stamps on success only.
   */
  answer: (id: string, choice: string, settled?: (result: Settled) => void) => Promise<void>;
  /** Make the cards the union of the stream and what the daemon says is pending. */
  reconcile: () => Promise<void>;
  loadEarlier: () => Promise<void>;
  /** Clears the transcript. A card the daemon is still holding is not part of it. */
  clear: () => void;
}

export const EMPTY = {
  phase: "idle" as RunPhase,
  transcript: [] as TranscriptEntry[],
  cards: [] as DecisionRequested[],
  summary: null as TurnSummary | null,
  error: null as RunFailure | null,
  continuations: 0,
  tools: [] as ToolRow[],
  calls: [] as TranscriptEntry[],
  answering: {} as Record<string, string>,
  refusals: {} as Record<string, string>,
  answered: [] as AnsweredDecision[],
  earlier: null as EarlierRecord | null,
  project: null as ActivePlaybook | null,
};

/** The production wiring: the daemon store for the endpoint, the tabs store for the page. */
const LIVE: RunDeps = {
  api: () => {
    const found = endpoint(useDaemon.getState());
    return found ? new DaemonApi(found) : null;
  },
  focused: () => {
    const tab = focusedTab();
    if (!tab) return null;
    const { byTab } = useTools.getState();
    const origin = originOf(tab.url);
    return { tabId: tab.id, origin, appId: catalogIdOf(origin, byTab[tab.id]?.appId ?? null) };
  },
  hostState: () => {
    const { tabs } = useTabs.getState();
    const focused = focusedTab();
    return {
      // Capped, because host state is fenced into the prompt and a user with forty tabs open
      // should not spend the frame on them (plan c28 raises this to the same number).
      tabs: tabs.slice(0, 12).map((t) => ({ url: t.url, title: t.title })),
      page_url: focused?.url ?? "",
      page_title: focused?.title ?? "",
    };
  },
  // A hand the page did not register goes to the shell's `hands_call`; the rest to the page.
  call: (tabId, name, input) =>
    callOnPage(tabId, name, input, useTools.getState().byTab[tabId]?.tools ?? []),
  manifest: () => {
    const tab = focusedTab();
    if (!tab) return null;
    // A tab not yet read, or one that could not be, still has its hands (ADR 0065).
    const found = useTools.getState().byTab[tab.id];
    return manifestBodyOf({
      origin: originOf(tab.url),
      appId: found?.appId ?? null,
      appVersion: found?.appVersion ?? null,
      transport: found?.transport ?? null,
      tools: found?.tools ?? [],
    });
  },
  disabledOrigins: () =>
    disabledOriginsOf(useOrigins.getState().records, useTabs.getState().tabs, useTools.getState().byTab),
  gated: () => gatedListsOf(useOrigins.getState(), useTabs.getState().tabs, useTools.getState().byTab),
  record: async (row) => {
    if (hasShell()) await storeSet("activity", "", row as unknown as Wire);
  },
  earlier: async () => {
    if (!hasShell()) return { rows: [], showing: 0, total: 0 };
    return storeList<ActivityRow>("activity", { limit: EARLIER_LIMIT });
  },
};

/** How many earlier answers are read back at start. The list says when it cut them. */
export const EARLIER_LIMIT = 50;

/**
 * The catalog origins the user has switched off (UAT backlog B2).
 *
 * The `origins` table is keyed by the web origin the browser observed, and the catalog namespaces a
 * page's tools under the slug the page published (`host:<app_id>`). The two meet in the open tabs: a
 * disabled web origin is sent as the app id a tab on it published. A key already in catalog form is
 * sent as it is. An origin with no open tab and no catalog form cannot be named, and is not guessed.
 */
export function disabledOriginsOf(
  records: Readonly<Record<string, OriginRow>>,
  tabs: readonly Tab[],
  byTab: Readonly<Record<number, TabTools>>,
): string[] {
  const out = new Set<string>();
  for (const [key, record] of Object.entries(records)) {
    if (record.enabled) continue;
    if (key.startsWith("host:")) {
      out.add(key);
      continue;
    }
    // The derived id needs no tab: it is spelled from the origin alone (ADR 0065).
    const derived = derivedIdOf(key);
    if (derived) out.add(`host:${derived}`);
    for (const tab of tabs) {
      const origin = originOf(tab.url);
      const app = catalogIdOf(origin, byTab[tab.id]?.appId ?? null);
      if (app && origin === key) out.add(`host:${app}`);
    }
  }
  return [...out].sort();
}

/** What the gate tightens for one turn, in the request body's own words (ADR 0063). */
export interface GatedLists {
  /** Catalog origins (`host:<app_id>`) of open tabs the origins table has no row for. */
  gated_origins: string[];
  /** Registry names (`host.<app_id>.<tool>`) the user pinned `GATED` on an enabled row. */
  gated_tools: string[];
}

export const NOTHING_GATED: GatedLists = { gated_origins: [], gated_tools: [] };

/**
 * The first-sight apps and the user's `GATED` pins, for the daemon's gate (README section 3.3,
 * ADR 0063).
 *
 * An origin has three states in the table. A row with `enabled: true` is one the user registered
 * or trusted: its classes come from its manifest's flags, tightened by its `GATED` pins. A row
 * with `enabled: false` is switched off, and {@link disabledOriginsOf} says so. No row is first
 * sight: every tool of that app files a card, whatever its flags say. Web origins meet catalog
 * origins in the open tabs by the same rule `disabledOriginsOf` uses, and a key already in
 * catalog form is read as it is.
 *
 * Fails closed: a table that has not loaded, or could not be read, counts every open tab's app as
 * first sight. A pin of `AUTO` or `READ` is never sent, because a pin only tightens.
 */
export function gatedListsOf(
  origins: Pick<OriginsState, "records" | "known" | "loaded" | "problem">,
  tabs: readonly Tab[],
  byTab: Readonly<Record<number, TabTools>>,
): GatedLists {
  const firstSight = new Set<string>();
  const pinned = new Set<string>();
  const trusted = !origins.loaded || origins.problem !== null ? null : origins;
  const rowOf = (key: string): OriginRow | undefined =>
    trusted !== null && trusted.known.includes(key) ? trusted.records[key] : undefined;
  const pin = (app: string, row: OriginRow) => {
    if (!row.enabled) return;
    for (const [tool, cls] of Object.entries(row.overrides ?? {})) {
      if (cls === "GATED") pinned.add(`host.${app}.${tool}`);
    }
  };

  for (const tab of tabs) {
    const origin = originOf(tab.url);
    const app = catalogIdOf(origin, byTab[tab.id]?.appId ?? null);
    if (!app) continue;
    // A catalog-form row applies to a tab only when the app is the tab's own derived id: a page
    // that claims a slug inherits nothing from that slug's row (ADR 0065, robustness-3). The web
    // origin's own row always applies.
    const rows = [rowOf(origin), app === derivedIdOf(origin) ? rowOf(`host:${app}`) : undefined].filter(
      (row): row is OriginRow => row !== undefined,
    );
    if (rows.length === 0) firstSight.add(`host:${app}`);
    for (const row of rows) pin(app, row);
  }
  // A row kept in catalog form names its app without a tab, so its pins can be sent as they are.
  for (const key of trusted?.known ?? []) {
    const row = rowOf(key);
    if (key.startsWith("host:") && row) pin(key.slice("host:".length), row);
  }
  return { gated_origins: [...firstSight].sort(), gated_tools: [...pinned].sort() };
}

/** `2026-10-01 10:08:07`, UTC, the way the store writes a stamp. */
/** The turn body's `active_project` for a playbook, or nothing when none is active (ADR 0044). */
export function activeProject(
  project: ActivePlaybook | null,
): { active_project?: Record<string, string> } {
  return project
    ? { active_project: { kind: "playbook", id: project.id, title: project.title, goal: project.goal } }
    : {};
}

export function stampOf(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * A card from a `GET /decisions` row. A pending row may lack what the stream carried (the rationale,
 * the capture), so the card is built from what the row has: its action and parameters at minimum.
 */
export function cardFromRow(row: Record<string, unknown>): DecisionRequested | null {
  if (typeof row.id !== "string" || row.id === "") return null;
  const options = Array.isArray(row.options)
    ? row.options.flatMap((o: unknown) => {
        if (typeof o === "string") return [{ id: o, label: o }];
        if (typeof o === "object" && o !== null && typeof (o as { id?: unknown }).id === "string") {
          const { id, label } = o as { id: string; label?: unknown };
          return [{ id, label: typeof label === "string" ? label : id }];
        }
        return [];
      })
    : [];
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    kind: "decision.requested",
    id: row.id,
    decision_kind: text(row.decision_kind) || "approve",
    action: text(row.action) || "a request from an app",
    params:
      typeof row.params === "object" && row.params !== null && !Array.isArray(row.params)
        ? (row.params as Record<string, unknown>)
        : {},
    rationale: text(row.rationale) || text(row.summary),
    options: options.length
      ? options
      : [
          { id: "approve", label: "approve" },
          { id: "decline", label: "decline" },
        ],
    expires_at: text(row.expires_at),
    origin: text(row.origin),
    surface: text(row.surface),
    capture_id: typeof row.capture_id === "string" ? row.capture_id : null,
  };
}

/**
 * The union of the stream's cards and the daemon's pending rows. A card the stream gave is kept
 * as it is, with only its empty fields filled from the row; a pending row with no card gets one,
 * unless `skip` says it has already been answered or is being answered.
 */
export function mergeCards(
  current: readonly DecisionRequested[],
  pending: ReadonlyArray<Record<string, unknown>>,
  skip: (id: string) => boolean,
): DecisionRequested[] {
  const rows = new Map<string, DecisionRequested>();
  for (const row of pending) {
    const card = cardFromRow(row);
    if (card) rows.set(card.id, card);
  }
  const have = new Set(current.map((c) => c.id));
  const kept = current.map((card) => {
    const row = rows.get(card.id);
    if (!row) return card;
    return {
      ...card,
      rationale: card.rationale || row.rationale,
      origin: card.origin || row.origin,
      surface: card.surface || row.surface,
      expires_at: card.expires_at || row.expires_at,
      params: Object.keys(card.params).length ? card.params : row.params,
    };
  });
  const added = [...rows.values()].filter((card) => !have.has(card.id) && !skip(card.id));
  return added.length ? [...kept, ...added] : kept;
}

let deps: RunDeps = LIVE;

/** Swap the surface the loop runs against. The headless test's whole entry point. */
export function setRunDeps(next: RunDeps): void {
  deps = next;
}

export function resetRunForTests(): void {
  deps = LIVE;
  useRun.setState({ ...EMPTY });
}

export const useRun = create<RunState>((set, get) => {
  /** Host answers produced since the last request, waiting to ride the next frame. */
  let outstanding: Array<Record<string, unknown>> = [];

  const now = () => stampOf(deps.now?.() ?? new Date());

  /** A tool row also goes in `calls`, which Clear does not touch; `record: false` keeps it out. */
  const push = (entry: TranscriptEntry, record = true) => {
    const stamped = entry.kind === "tool" ? { ...entry, at: now() } : entry;
    set((s) => ({
      transcript: [...s.transcript, stamped],
      calls: entry.kind === "tool" && record ? [...s.calls, stamped] : s.calls,
    }));
  };

  const fail = (error: unknown) =>
    set({
      phase: "error",
      error: {
        reason: error instanceof ApiError ? error.reason : "unknown",
        detail: error instanceof Error ? error.message : String(error),
      },
    });

  /**
   * Run one `tool.call` or `execute` row on the page.
   *
   * Refused rather than run when the focused tab's origin is not the row's: an approval is granted
   * for one origin, and the user may have moved tabs between the card and the answer.
   */
  async function onPage(row: ExecuteRow): Promise<void> {
    const focused = deps.focused();
    if (!focused) {
      outstanding.push(resultRow(row, false, "", "unknown_ref: no page is open"));
      return;
    }
    // Defence in depth, and only where the surface actually knows the answer. The daemon pinned
    // the session and `POST /decisions/<id>` refuses a stated origin that is not the row's; this
    // catches the same mistake one step earlier, when the page has told us what it calls itself.
    if (focused.appId && row.origin.startsWith("host:") && row.origin !== `host:${focused.appId}`) {
      outstanding.push(
        resultRow(row, false, "", `foreign_origin: ${row.origin} is not the focused page`),
      );
      return;
    }
    set({ phase: "acting" });
    let answer: { ok: boolean; output: string; error?: string | null; tier?: number };
    try {
      answer = await deps.call(focused.tabId, bareName(row.name), row.params);
    } catch (error) {
      answer = { ok: false, output: "", error: error instanceof Error ? error.message : String(error) };
    }
    outstanding.push(resultRow(row, answer.ok, answer.output, answer.error ?? null, answer.tier));
    push({
      id: row.call_id,
      kind: "tool",
      text: `${row.name} → ${answer.ok ? answer.output : (answer.error ?? "failed")}`,
      tier: answer.tier ?? row.tier ?? 1,
      ok: answer.ok,
    });
    set({ phase: "running" });
  }

  /**
   * Host calls of the turn in progress that the daemon has not answered itself.
   *
   * A `tool.call` is not yet an instruction. The harness emits one for *every* proposal, and a
   * gated one is followed in the same turn by a `tool.result` refusing it `pending_approval` and
   * by the card. Running a host call the moment it arrives would run the gated action on the
   * page before the user has answered — which is the one thing this whole system exists to
   * prevent. So a call is held here, a result for its id releases it, and what is still held at
   * `turn.finished` is what the page runs (ADR 0010).
   */
  let proposed = new Map<string, ExecuteRow>();

  async function apply(event: ChannelEvent): Promise<void> {
    switch (event.kind) {
      case "text.delta":
        push({ id: `t${Date.now()}${Math.random()}`, kind: "assistant", text: event.text });
        break;
      case "tool.call":
        // Tier 0 has an executor in the daemon and its result arrives as `tool.result`; only a
        // host tool reaches the surface, and only once the turn has ended without the daemon
        // answering it.
        if (event.origin !== "core") proposed.set(event.call_id, event as ExecuteRow);
        break;
      case "tool.result":
        proposed.delete(event.call_id);
        push({
          id: event.call_id,
          kind: "tool",
          text: `${event.name} → ${event.ok ? event.output : (event.error ?? "refused")}`,
          tier: event.tier,
          ok: event.ok,
        });
        break;
      case "decision.requested":
        set((s) => ({
          cards: s.cards.some((c) => c.id === event.id)
            ? s.cards.map((c) => (c.id === event.id ? event : c))
            : [...s.cards, event],
        }));
        break;
      case "decision.resolved":
        set((s) => ({ cards: s.cards.filter((c) => c.id !== event.id) }));
        break;
      case "turn.summary":
        set({ summary: event });
        break;
      case "turn.error":
        proposed = new Map();
        set({ phase: "error", error: { reason: event.reason, detail: event.detail } });
        break;
      case "turn.finished": {
        const calls = [...proposed.values()];
        proposed = new Map();
        for (const call of calls) await onPage(call);
        break;
      }
    }
  }

  /** Stream one turn. Returns `false` when the request itself was refused. */
  async function consume(message: string): Promise<boolean> {
    const api = deps.api();
    const focused = deps.focused();
    if (!api || !focused) {
      fail(
        !api
          ? new ApiError(0, "not_ready", "the daemon is not ready")
          : new ApiError(0, "no_page", "no page is open"),
      );
      return false;
    }
    const carried = outstanding;
    outstanding = [];
    try {
      for await (const event of api.run({
        origin: focused.origin,
        message,
        surface: "panel",
        host_state: deps.hostState(),
        tool_results: carried,
        disabled_origins: deps.disabledOrigins?.() ?? [],
        ...(deps.gated?.() ?? NOTHING_GATED),
        ...activeProject(get().project),
      })) {
        await apply(event);
        if (isTerminal(event)) break;
      }
    } catch (error) {
      fail(error);
      return false;
    }
    return true;
  }

  /**
   * One request, plus however many the page's answers make necessary.
   *
   * The continuation carries a fixed line rather than the user's message repeated: the user has
   * not said anything new, and putting words in their transcript that they did not write is worse
   * than a sentence the model can read as a prompt to continue.
   */
  /**
   * Register the focused page with the daemon before asking it anything about that page.
   *
   * README §3.3 step one: a page's tools enter the catalog through a manifest, and `POST /run`
   * refuses an origin it has no session for with `foreign_origin`. It is published once per
   * exchange rather than once per process: `merge_manifest` replaces the origin's entries and
   * refreshes the session, so a daemon that restarted between two messages is registered again
   * by the next one instead of refusing every turn until the window is reopened.
   *
   * A page with nothing to register — no `athena:app` id, or no tools — is not an error here.
   * The turn goes out and the daemon says what it thinks of it, in its own words.
   */
  async function publish(): Promise<boolean> {
    const body = deps.manifest?.() ?? null;
    if (body === null) return true;
    const api = deps.api();
    if (!api) {
      fail(new ApiError(0, "not_ready", "the daemon is not ready"));
      return false;
    }
    try {
      await api.manifest(body);
    } catch (error) {
      fail(error);
      return false;
    }
    return true;
  }

  async function exchange(first: string): Promise<void> {
    if (!(await publish())) return;
    let message = first;
    for (let step = 0; step <= MAX_CONTINUATIONS; step += 1) {
      if (!(await consume(message))) return;
      if (outstanding.length === 0) {
        set({ phase: "idle" });
        return;
      }
      if (step === MAX_CONTINUATIONS) {
        set({
          phase: "error",
          error: {
            reason: "budget_exhausted",
            detail: `the page answered ${MAX_CONTINUATIONS} times without the turn settling`,
          },
        });
        return;
      }
      set({ continuations: step + 1 });
      message = "(the tools you called have answered; continue)";
    }
  }

  return {
    ...EMPTY,

    async send(message: string) {
      push({ id: `u${Date.now()}`, kind: "user", text: message });
      set({ phase: "running", error: null, summary: null, continuations: 0 });
      await exchange(message);
    },

    async answer(id, choice, settled) {
      const before = get();
      // A second press is a second answer to a decision that is already on its way or already made.
      if (before.answering[id] !== undefined) return;
      if (before.answered.some((a) => a.id === id && a.result !== "refused")) return;
      const card = before.cards.find((c) => c.id === id);
      set((s) => ({ answering: { ...s.answering, [id]: choice }, refusals: without(s.refusals, id) }));

      const note = (result: AnswerResult, reason: string | null) => {
        const row: AnsweredDecision = {
          id,
          action: card?.action ?? id,
          origin: card?.origin ?? "",
          result,
          reason,
          at: now(),
        };
        set((s) => ({ answered: [row, ...s.answered] }));
        void deps
          .record?.({
            ts: row.at,
            origin: row.origin,
            tool: row.action,
            tier: 1,
            class: "GATED",
            outcome: result === "approved" ? "approved" : result === "user_denied" ? "declined" : "refused",
            ms: 0,
            reason,
            approval_id: id,
          })
          .catch((error: unknown) => console.error(`[athena] activity: ${String(error)}`));
      };

      // The card stays. A refusal says so in plain words, under the buttons, and the daemon is asked
      // again what it holds, because a refused answer leaves the decision pending there.
      const refuse = async (reason: string) => {
        // A card for an app the user switched off cannot be helped by focusing it.
        const off = reason === "foreign_origin" && card !== undefined && (deps.disabledOrigins?.() ?? []).includes(card.origin);
        const sentence = off ? switchedOffSentence() : refusalSentence(reason);
        set((s) => ({
          answering: without(s.answering, id),
          refusals: { ...s.refusals, [id]: sentence },
          // The daemon says no such decision is waiting: nothing is left to answer.
          cards: reason === "unknown_ref" ? s.cards.filter((c) => c.id !== id) : s.cards,
        }));
        note("refused", reason);
        settled?.({ ok: false, sentence });
        await get().reconcile();
      };

      const api = deps.api();
      if (!api) {
        await refuse("not_ready");
        return;
      }
      // A decision restored from a previous daemon process has no session behind it until the page
      // has been registered (UAT r2: it was refused as "a different app" on the right tab). Register
      // the focused page first, exactly as a turn does; a failure here is the answer's to report.
      const body = deps.manifest?.() ?? null;
      if (body !== null) await api.manifest(body).catch(() => undefined);
      let resolution;
      try {
        resolution = await api.resolve(
          id,
          choice,
          deps.focused()?.origin,
          undefined,
          deps.disabledOrigins?.() ?? [],
        );
      } catch (error) {
        await refuse(reasonOf(error));
        return;
      }
      const result: AnswerResult = resolution.status === "declined" ? "user_denied" : "approved";
      set((s) => ({
        cards: s.cards.filter((c) => c.id !== id),
        answering: without(s.answering, id),
        refusals: without(s.refusals, id),
      }));
      note(result, result === "user_denied" ? "user_denied" : null);
      settled?.({ ok: true, sentence: "" });
      await get().reconcile();
      if (resolution.status === "declined") {
        push({ id, kind: "tool", text: `declined: ${card?.action ?? id}`, ok: false }, false);
        return;
      }
      for (const row of resolution.execute) await onPage(row);
      if (outstanding.length) {
        set({ phase: "running" });
        await exchange("(the tools you called have answered; continue)");
      }
    },

    async reconcile() {
      const api = deps.api();
      if (!api) return;
      let page;
      try {
        page = await api.decisions();
      } catch {
        // The daemon did not answer; the cards on screen are all there is to go on.
        return;
      }
      set((s) => ({
        cards: mergeCards(
          s.cards,
          page.pending ?? [],
          (id) =>
            s.answering[id] !== undefined || s.answered.some((a) => a.id === id && a.result !== "refused"),
        ),
      }));
    },

    async loadEarlier() {
      if (!deps.earlier || get().earlier?.problem === null) return;
      try {
        const page = await deps.earlier();
        set({ earlier: { rows: page.rows, showing: page.showing, total: page.total, problem: null } });
      } catch (error) {
        set({
          earlier: {
            rows: [],
            showing: 0,
            total: 0,
            problem: error instanceof Error ? error.message : String(error),
          },
        });
      }
    },

    setProject(project) {
      set({ project });
    },

    clear() {
      outstanding = [];
      proposed = new Map();
      // The transcript goes. What the daemon is still holding for the user does not: a card is a
      // decision waiting, not a line of conversation, and the Record keeps what was done.
      const keep = get();
      set({
        ...EMPTY,
        cards: keep.cards,
        calls: keep.calls,
        answering: keep.answering,
        refusals: keep.refusals,
        answered: keep.answered,
        earlier: keep.earlier,
        project: keep.project,
      });
    },
  };
});

let stopRun: (() => void) | null = null;

/**
 * Keep the cards true to the daemon: at start, when it becomes ready, and every
 * {@link RECONCILE_MS} while any card is on screen. Returns what to undo. Idempotent.
 */
export function startRun(): () => void {
  if (stopRun) return stopRun;
  const run = () => {
    void useRun.getState().reconcile();
    void useRun.getState().loadEarlier();
  };
  run();
  let timer: ReturnType<typeof setInterval> | null = null;
  const offDaemon = useDaemon.subscribe((state, prev) => {
    if (endpoint(state) && !endpoint(prev)) run();
  });
  const watch = (cards: number) => {
    if (cards > 0 && timer === null) {
      timer = setInterval(() => void useRun.getState().reconcile(), RECONCILE_MS);
    }
    if (cards === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  watch(useRun.getState().cards.length);
  const offRun = useRun.subscribe((s, prev) => {
    if (s.cards.length !== prev.cards.length) watch(s.cards.length);
  });
  stopRun = () => {
    offDaemon();
    offRun();
    if (timer !== null) clearInterval(timer);
    stopRun = null;
  };
  return stopRun;
}

function without<T>(map: Record<string, T>, id: string): Record<string, T> {
  const next = { ...map };
  delete next[id];
  return next;
}

function resultRow(
  row: ExecuteRow,
  ok: boolean,
  output: string,
  error: string | null,
  tier?: number,
): Record<string, unknown> {
  return {
    call_id: row.call_id,
    name: row.name,
    ok,
    output,
    error,
    tier: tier ?? row.tier ?? 1,
    ms: 0,
  };
}

/** `host.<app_id>.<tool>` is the catalog's name; the page registered the last segment. */
function bareName(name: string): string {
  const parts = name.split(".");
  return parts.length > 2 ? parts.slice(2).join(".") : name;
}

function focusedTab() {
  const { tabs } = useTabs.getState();
  return tabs.find((tab) => tab.focused) ?? tabs[0];
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}
