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
 * filed — or one bound to a tab that closed, reloaded or navigated since (ADR 0103).
 */
import { create } from "zustand";

import { ApiError, DaemonApi, type ExecuteRow, type ToolRow } from "@/lib/api";
import { onLate, type BridgeTool, type LateAnswer } from "@/lib/bridge";
import { driftOf, type ContractDrift, type ContractTable } from "@/lib/contract";
import {
  clearUnsureForTests,
  forgetUnsure,
  heldBefore,
  rememberUnsure,
  settleHostCall,
  withUnsure,
  type PageAnswer,
} from "@/lib/execute";
import {
  TABS_READ,
  callOnPage,
  describeRefs,
  refsOf,
  takeCapture,
  tierOf,
  type Taken,
  type Target,
} from "@/lib/hands";
import type { CardTargets } from "@/companion/model";
import type { Wire } from "@/lib/ipc";
import { catalogIdOf, derivedIdOf, manifestBodyOf } from "@/lib/manifest";
import { boundTabSentence, reasonOf, refusalSentence, switchedOffSentence } from "@/companion/plain";
import { isTerminal, type ChannelEvent, type DecisionRequested, type TurnSummary } from "@/lib/events";
import { hasShell, type StorePage, type Tab } from "@/lib/ipc";
import { storeList, storeSet, type ActivityRow, type OriginRow } from "@/lib/store";
import { endpoint, useDaemon } from "@/stores/daemon";
import { useOrigins, type OriginsState } from "@/stores/origins";
import { useTabs } from "@/stores/tabs";
import { useTools, type TabTools } from "@/stores/tools";
import { sheetOf, slotFor, type SheetSlot } from "@/lib/sheet";

export { SHEET_CAP, sheetKeyOf, sheetOf, slotFor, type SheetOf, type SheetSlot } from "@/lib/sheet";
// The host-call rules of ADR 0101 are the window's and live in `lib/execute.ts`, which the voice
// store drives too. Their old names stay importable from here.
export {
  UNSURE_CAP,
  isReadCall,
  readTimeout as timeoutReasonOf,
  unsureTools,
  withUnsure,
  type PageAnswer,
  type Unsure,
} from "@/lib/execute";

/** How many times the loop may continue one exchange on its own before it stops and says so. */
export const MAX_CONTINUATIONS = 8;

/** The line a continuation carries: the user said nothing new, so no words are put in her mouth. */
const CONTINUE = "(the tools you called have answered; continue)";

/** What a host call the person stopped her before is told as, with the next message (ADR 0115). */
const NOT_RUN_STOPPED = "cancelled: the person stopped her before this ran";

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
  focused: () => TabRef | null;
  /**
   * One open tab by id, read now: where an approved call bound to that tab runs (ADR 0103).
   * Optional: without it only the focused tab can be found, so a call bound to another tab is
   * refused rather than run somewhere else.
   */
  tab?: (tabId: number) => TabRef | null;
  hostState: () => Record<string, unknown>;
  /** Run one of the page's own tools on a tab, through the relay. */
  call: (
    tabId: number,
    name: string,
    input: Record<string, unknown>,
    /** The tool list the exchange's snapshot holds for this tab (ADR 0067); live when omitted. */
    tools?: readonly BridgeTool[],
  ) => Promise<PageAnswer>;
  /**
   * Everything one exchange reads about the focused tab, read once (ADR 0067). Optional: without
   * it the loop reads `focused`, `manifest`, `disabledOrigins` and `gated` once, at the start of
   * the exchange, which is the same single read.
   */
  snapshot?: () => Snapshot;
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
  /**
   * Take the capture of the focused tab, once, just before a request (README 3.5, ADR 0066). Never
   * rejects: a capture that failed answers with no id and the reason. Optional so a test about
   * something else may omit it, which sends no capture.
   */
  capture?: (tabId: number, origin: string) => Promise<Taken>;
  /**
   * What each ref still names on a tab (`hands_describe`, ADR 0099), for a card's target line.
   * Rejects with the reason when the page could not be asked. Optional: without it a card shows
   * its refs raw, as before.
   */
  describe?: (tabId: number, refs: readonly string[]) => Promise<Record<string, Target>>;
  /**
   * An approved call of this page tool ran and succeeded: its current contract becomes the accepted
   * one for the web origin (ADR 0100). Optional: without it nothing is accepted, which only
   * tightens.
   */
  accept?: (origin: string, tool: BridgeTool) => Promise<void>;
  /**
   * The open tab at a url, read now, with whether its web origin is an enabled row of the origins
   * table: where a `tabs_read` reads, and whether it may (ADR 0105). Optional: without it no other
   * tab can be found, so every `tabs_read` is refused `unknown_ref` and nothing is read.
   */
  openTab?: (url: string) => OpenTab | null;
  /** Keep one answered decision on this computer (the `activity` table). */
  record?: (row: ActivityWrite) => Promise<void>;
  /** Read back what earlier windows kept. */
  earlier?: () => Promise<StorePage<ActivityRow>>;
  now?: () => Date;
}

/** An open tab a `tabs_read` names, as the panel sees it (ADR 0105). */
export interface OpenTab {
  tabId: number;
  url: string;
  title: string;
  /** Its web origin, the key of the origins table and the name a card shows. */
  origin: string;
  /** The catalog id its page claimed or derives, so the record can group the text under it. */
  appId: string | null;
  /** An enabled row of the origins table. First sight and switched off are both `false`. */
  trusted: boolean;
}

/**
 * The open tab at `url`, or `null` (ADR 0105). Matched as the shell matches it: the url as
 * `tabs_list` reports it, a trailing slash ignored. Trusted only when the web origin has an
 * enabled row in a table that loaded: an unread table trusts nothing, which fails closed.
 */
export function openTabOf(
  url: string,
  tabs: readonly Tab[],
  byTab: Readonly<Record<number, TabTools>>,
  origins: TrustTable,
): OpenTab | null {
  const bare = (u: string) => u.trim().replace(/\/+$/, "");
  const wanted = bare(url);
  const tab = tabs.find((t) => bare(t.url) === wanted);
  if (!tab) return null;
  const origin = originOf(tab.url);
  const trusted =
    origin !== "" &&
    origins.loaded &&
    origins.problem === null &&
    origins.known.includes(origin) &&
    origins.records[origin]?.enabled === true;
  return {
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    origin,
    appId: catalogIdOf(origin, byTab[tab.id]?.appId ?? null),
    trusted,
  };
}

/**
 * Why a `tabs_read` may not read, in the closed vocabulary, or `null` (ADR 0105). Checked by the
 * panel before the shell is asked anything, so an untrusted tab's text is never read at all; the
 * shell checks the same again before its relay is touched. No url, or the tab the turn is on, is
 * `validator_failed`; a url no tab is at is `unknown_ref`; a tab whose origin is not an enabled
 * row - first sight or switched off - is `foreign_origin`.
 */
export function tabReadRefusal(
  params: Readonly<Record<string, unknown>>,
  focused: TabRef | null,
  open: OpenTab | null,
): { reason: "validator_failed" | "unknown_ref" | "foreign_origin"; detail: string } | null {
  const url = typeof params.url === "string" ? params.url.trim() : "";
  if (!url) return { reason: "validator_failed", detail: "tabs_read needs the url of an open tab" };
  if (!open) return { reason: "unknown_ref", detail: `no open tab is at ${url}; the open tabs are listed in host state` };
  if (focused && open.tabId === focused.tabId) {
    return { reason: "validator_failed", detail: "that is the tab this turn is on; read it with page_read" };
  }
  if (!open.trusted) {
    return {
      reason: "foreign_origin",
      detail: `${open.origin || url} is not a site the person trusts, so its text is not read; ask them to switch to that tab`,
    };
  }
  return null;
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
  /**
   * Why the capture of the request that filed a card is missing, by card id. A card that has a
   * capture has no entry, and a card the daemon reported on its own (reconcile) has none either.
   */
  captureWhy: Record<string, string>;
  /** Why the latest request went without a capture; `null` when it had one (ADR 0066). */
  captureNow: string | null;
  /** What the page said each card's refs name, by card id (ADR 0099). A card not yet asked has none. */
  targets: Record<string, CardTargets>;
  /** Ask the focused page what a card's refs name, once per card. A card with no ref asks nothing. */
  describe: (card: DecisionRequested) => Promise<void>;
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
   * Stop her (ADR 0115): the request in flight is aborted, the daemon is asked to end the turn,
   * and the exchange continues no further. A page result she has not read yet is kept and goes
   * with the person's next message, so a write that already ran is never unrecorded. Cards are
   * untouched. Does nothing unless she is working.
   */
  stop: () => Promise<void>;
  /**
   * Answer a card. The card stays until the daemon says it took the answer; `settled` is called the
   * moment it has (or has not), before any continuation turn, so the slip stamps on success only.
   */
  answer: (id: string, choice: string, settled?: (result: Settled) => void) => Promise<void>;
  /** Where each card that arrived on the stream belongs: its request, app and tab (ADR 0104). */
  slots: Record<string, SheetSlot>;
  /** Sheet rows the user unticked: an approval of the sheet declines them. */
  unticked: Record<string, true>;
  /** What the last press of a sheet came to, by sheet key: `ran 3 of 10: <reason>`. */
  ran: Record<string, string>;
  /** Tick or untick one row of a sheet. A card that is not a row is left alone. */
  tick: (id: string) => void;
  /**
   * Answer the sheet a card is a row of, in one press (ADR 0104); a card that is no row is answered
   * on its own, exactly as {@link RunState.answer}. Approve declines the unticked rows, then walks
   * the ticked ones in order through the same per-card route, each spending its own grant, and
   * stops at the first that does not come back ok. The model continues once, after the walk.
   * Decline declines every row.
   */
  answerSheet: (id: string, choice: string, settled?: (result: Settled) => void) => Promise<void>;
  /** Make the cards the union of the stream and what the daemon says is pending. */
  reconcile: () => Promise<void>;
  /**
   * A call that timed out finished after all (`bridge:late`, ADR 0101): a follow-up result rides
   * the next request, and the call's row in the record says how it ended.
   */
  late: (answer: LateAnswer) => void;
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
  captureWhy: {} as Record<string, string>,
  captureNow: null as string | null,
  targets: {} as Record<string, CardTargets>,
  answered: [] as AnsweredDecision[],
  earlier: null as EarlierRecord | null,
  project: null as ActivePlaybook | null,
  slots: {} as Record<string, SheetSlot>,
  unticked: {} as Record<string, true>,
  ran: {} as Record<string, string>,
};

/** The production wiring: the daemon store for the endpoint, the tabs store for the page. */
const LIVE: RunDeps = {
  api: () => {
    const found = endpoint(useDaemon.getState());
    return found ? new DaemonApi(found) : null;
  },
  focused: () => {
    const tab = focusedTab();
    return tab ? tabRefOf(tab, useTools.getState().byTab) : null;
  },
  tab: (tabId) => {
    const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
    return tab ? tabRefOf(tab, useTools.getState().byTab) : null;
  },
  capture: takeCapture,
  describe: describeRefs,
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
  call: (tabId, name, input, tools) =>
    callOnPage(tabId, name, input, tools ?? useTools.getState().byTab[tabId]?.tools ?? []),
  snapshot: () =>
    snapshotOf(useOrigins.getState(), useTabs.getState().tabs, useTools.getState().byTab, useTabs.getState().recent),
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
  accept: (origin, tool) => useOrigins.getState().acceptContracts(origin, [tool]),
  openTab: (url) => openTabOf(url, useTabs.getState().tabs, useTools.getState().byTab, useOrigins.getState()),
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
  /**
   * Registry names (`host.<app_id>.<tool>`) the user pinned `GATED` on an enabled row, and every
   * tool of an enabled row whose contract is not the one the user accepted (ADR 0100).
   */
  gated_tools: string[];
}

/**
 * One tab as the loop addresses it: its id, its web origin, the app id its page claimed, and its
 * document generation (`nav`, ADR 0103) when the shell reports one.
 */
export interface TabRef {
  tabId: number;
  origin: string;
  appId: string | null;
  nav?: number;
}

/** A shell tab as a {@link TabRef}. */
export function tabRefOf(tab: Tab, byTab: Readonly<Record<number, TabTools>>): TabRef {
  const origin = originOf(tab.url);
  const ref: TabRef = { tabId: tab.id, origin, appId: catalogIdOf(origin, byTab[tab.id]?.appId ?? null) };
  return tab.nav === undefined ? ref : { ...ref, nav: tab.nav };
}

/** What a card or an execute row says about the tab it was proposed on (ADR 0103). */
export interface TabBinding {
  tab_id?: number | null;
  tab_nav?: number | null;
}

/** Why a bound call may not run on what is open now, in the closed vocabulary, or `null`. */
export interface BindingRefusal {
  reason: "unknown_ref";
  /** `closed`: the tab is gone. `moved`: it reloaded or navigated since the card was filed. */
  why: "closed" | "moved";
  detail: string;
}

/**
 * Does the tab a call was bound to still hold the document the card was filed on (ADR 0103)?
 *
 * `null` when it does, or when the row is unbound (an old card, a connector's, core's): those run
 * where they always did. A bound tab that is gone, or whose navigation count moved, refuses with
 * `unknown_ref` - what the card's refs and parameters pointed into no longer exists. A tab that
 * reports no count cannot prove it is the same document, so a row that carries one is refused.
 */
export function bindingRefusal(bound: TabBinding, tab: TabRef | null): BindingRefusal | null {
  if (bound.tab_id === undefined || bound.tab_id === null) return null;
  if (!tab || tab.tabId !== bound.tab_id) {
    return { reason: "unknown_ref", why: "closed", detail: `the tab this was proposed on (tab ${bound.tab_id}) is closed` };
  }
  if (bound.tab_nav !== undefined && bound.tab_nav !== null && tab.nav !== bound.tab_nav) {
    return {
      reason: "unknown_ref",
      why: "moved",
      detail: `the tab this was proposed on (tab ${bound.tab_id}) reloaded or moved to another page since the card was filed`,
    };
  }
  return null;
}

/**
 * Everything one exchange reads about the focused tab, taken at one moment (ADR 0067).
 *
 * The manifest, the gate's lists and the routing of a released call all come from here, so a
 * refresh of the tab's tool list between them cannot make the daemon's session and the request
 * disagree about which app is first sight (robustness-1), nor change which executor runs a call
 * the gate classified (robustness-5).
 */
export interface Snapshot {
  focused: TabRef | null;
  manifest: Record<string, unknown> | null;
  disabledOrigins: string[];
  gated: GatedLists;
  /** The tab's tool list the manifest was built from; `null` where the source cannot say. */
  tools: readonly BridgeTool[] | null;
  /**
   * Other open tabs whose app the user trusts, one per app, published beside the focused tab so a
   * turn may propose their tools - every such call is a card bound to that tab (ADR 0106). Absent
   * or empty: the turn is pinned to the focused app alone, as before.
   */
  others?: readonly OtherTab[];
}

/** Another open tab a turn may propose on (ADR 0106): where it is, what it publishes, its tools. */
export interface OtherTab {
  tab: TabRef;
  /** Its catalog id, the `host:<app>` its tools are namespaced under. */
  appId: string;
  manifest: Record<string, unknown>;
  tools: readonly BridgeTool[];
}

/** How many other apps one turn is offered. Host state lists 12 tabs; the focused one is one. */
export const OTHER_APPS_CAP = 11;

/**
 * The catalog id of a tab whose origin is an enabled row of the origins table, or `null` (ADR
 * 0106). The same rule the accepted contracts use (ADR 0100): the web origin's row, or the
 * catalog-form row of the tab's own derived id, enabled; any row present and switched off refuses.
 * An unread table trusts nothing.
 */
export function trustedAppOf(
  origins: TrustTable,
  tab: Tab,
  byTab: Readonly<Record<number, TabTools>>,
): string | null {
  if (!origins.loaded || origins.problem !== null) return null;
  const origin = originOf(tab.url);
  const app = catalogIdOf(origin, byTab[tab.id]?.appId ?? null);
  if (!app) return null;
  const row = (key: string) => (origins.known.includes(key) ? origins.records[key] : undefined);
  const keys = [origin, ...(app === derivedIdOf(origin) ? [`host:${app}`] : [])];
  if ([origin, `host:${app}`].some((k) => row(k)?.enabled === false)) return null;
  return keys.some((k) => row(k)?.enabled === true) ? app : null;
}

/**
 * The other tabs a turn on `focused` may propose on (ADR 0106): open, trusted, of an app that is
 * not the focused one, and - when an app has several tabs - only the one focused most recently
 * (`recent`, else the first in strip order). A tab whose app is first sight or switched off is
 * never listed, so its tools are never published. Pure.
 */
export function otherTabsOf(
  origins: TrustTable,
  tabs: readonly Tab[],
  byTab: Readonly<Record<number, TabTools>>,
  focused: Tab | undefined,
  recent: readonly number[] = [],
): OtherTab[] {
  const focusedApp = focused ? catalogIdOf(originOf(focused.url), byTab[focused.id]?.appId ?? null) : null;
  const rank = (t: Tab) => {
    const at = recent.indexOf(t.id);
    return at === -1 ? recent.length + tabs.indexOf(t) : at;
  };
  const byApp = new Map<string, Tab>();
  for (const tab of [...tabs].sort((a, b) => rank(a) - rank(b))) {
    if (tab.id === focused?.id) continue;
    const app = trustedAppOf(origins, tab, byTab);
    if (!app || app === focusedApp || byApp.has(app)) continue;
    byApp.set(app, tab);
  }
  const out: OtherTab[] = [];
  for (const [app, tab] of byApp) {
    if (out.length >= OTHER_APPS_CAP) break;
    const found = byTab[tab.id];
    const manifest = manifestBodyOf({
      origin: originOf(tab.url),
      appId: found?.appId ?? null,
      appVersion: found?.appVersion ?? null,
      transport: found?.transport ?? null,
      tools: found?.tools ?? [],
    });
    if (manifest === null) continue;
    out.push({ tab: tabRefOf(tab, byTab), appId: app, manifest, tools: found?.tools ?? [] });
  }
  return out;
}

/** The `open_apps` a request names: the other tabs whose manifests the daemon took (ADR 0106). */
export function openAppsOf(
  others: readonly OtherTab[],
): Array<{ app: string; origin: string; tab_id: number; tab_nav?: number }> {
  return others.map((o) => ({
    app: `host:${o.appId}`,
    origin: o.tab.origin,
    tab_id: o.tab.tabId,
    ...(o.tab.nav !== undefined ? { tab_nav: o.tab.nav } : {}),
  }));
}

/** The pure read behind {@link Snapshot}: the focused tab is the one flagged, else the first. */
export function snapshotOf(
  origins: TrustTable,
  tabs: readonly Tab[],
  byTab: Readonly<Record<number, TabTools>>,
  recent: readonly number[] = [],
): Snapshot {
  const tab = tabs.find((t) => t.focused) ?? tabs[0];
  const lists = {
    disabledOrigins: disabledOriginsOf(origins.records, tabs, byTab),
    gated: gatedListsOf(origins, tabs, byTab),
  };
  if (!tab) return { focused: null, manifest: null, tools: null, others: [], ...lists };
  const origin = originOf(tab.url);
  const found = byTab[tab.id];
  return {
    focused: tabRefOf(tab, byTab),
    manifest: manifestBodyOf({
      origin,
      appId: found?.appId ?? null,
      appVersion: found?.appVersion ?? null,
      transport: found?.transport ?? null,
      tools: found?.tools ?? [],
    }),
    tools: found?.tools ?? [],
    others: otherTabsOf(origins, tabs.slice(0, 12), byTab, tab, recent),
    ...lists,
  };
}

/** The readers a surface wires; {@link snapshotFrom} calls each of them once. */
export interface SnapshotSource {
  snapshot?: () => Snapshot;
  focused: RunDeps["focused"];
  manifest?: () => Record<string, unknown> | null;
  disabledOrigins?: () => string[];
  gated?: () => GatedLists;
}

/**
 * The tools of trusted tabs whose contract is not the one the user accepted, by registry name
 * (`host.<app_id>.<tool>`), each with what a card shows of the old and the new (ADR 0100).
 *
 * Only a tab whose origin is enabled is read: a first-sight app is gated whole already and a
 * switched-off one is refused, so neither has a contract to drift from. A tool with no accepted
 * contract — one registered after the origin was trusted — counts as changed. Nothing here
 * loosens: the result is only ever added to `gated_tools`.
 */
export function contractDriftsOf(
  origins: TrustTable,
  tabs: readonly Tab[],
  byTab: Readonly<Record<number, TabTools>>,
): Record<string, ContractDrift> {
  const out: Record<string, ContractDrift> = {};
  if (!origins.loaded || origins.problem !== null) return out;
  const enabled = (key: string) => origins.known.includes(key) && origins.records[key]?.enabled === true;
  for (const tab of tabs) {
    const origin = originOf(tab.url);
    const found = byTab[tab.id];
    const app = catalogIdOf(origin, found?.appId ?? null);
    if (!app || !found) continue;
    const trusted = enabled(origin) || (app === derivedIdOf(origin) && enabled(`host:${app}`));
    // A row present and switched off refuses the app; no row is first sight. Either way, not here.
    const off = [origin, `host:${app}`].some((k) => origins.known.includes(k) && origins.records[k]?.enabled === false);
    if (!trusted || off) continue;
    const accepted = origins.contracts?.[origin] ?? {};
    for (const tool of found.tools) {
      const drift = driftOf(accepted[tool.name], tool);
      if (drift) out[`host.${app}.${tool.name}`] = drift;
    }
  }
  return out;
}

/** One snapshot from a surface: its own, or one read of each of its parts. */
export function snapshotFrom(source: SnapshotSource): Snapshot {
  if (source.snapshot) return source.snapshot();
  return {
    focused: source.focused(),
    manifest: source.manifest?.() ?? null,
    disabledOrigins: source.disabledOrigins?.() ?? [],
    gated: source.gated?.() ?? NOTHING_GATED,
    tools: null,
  };
}

/**
 * The tool list a released call is routed by: the snapshot's, when the call lands on the tab the
 * snapshot was taken of, or one of the other trusted tabs it published (ADR 0106). A tab the
 * snapshot did not publish was never classified, so it is read live.
 */
export function routingTools(
  snap: Pick<Snapshot, "focused" | "tools" | "others"> | null,
  tabId: number,
): readonly BridgeTool[] | undefined {
  if (snap?.tools && snap.focused?.tabId === tabId) return snap.tools;
  // Another tab the exchange published (ADR 0106): its card was proposed against this list.
  return snap?.others?.find((o) => o.tab.tabId === tabId)?.tools;
}

/**
 * The capture of a tab through `capture`, or none. A dependency that throws is a capture that
 * failed: the request goes either way (ADR 0066).
 */
export async function captureOf(
  capture: RunDeps["capture"],
  tabId: number,
  origin: string,
): Promise<Taken> {
  if (!capture) return { id: null, why: null };
  try {
    return await capture(tabId, origin);
  } catch (error) {
    return { id: null, why: `the screenshot failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The `captureWhy` map after a card arrived: a card with no capture remembers why, if known. */
export function withCaptureWhy(
  known: Record<string, string>,
  card: DecisionRequested,
  why: string | null,
): Record<string, string> {
  if (card.capture_id || !why) return known;
  return { ...known, [card.id]: why };
}

export const NOTHING_GATED: GatedLists = { gated_origins: [], gated_tools: [] };

/** Why a card proposed on another tab carries no screenshot (ADR 0106). */
export const OTHER_TAB_NO_PICTURE = "no picture: proposed on another tab";

/** Is this card's catalog origin an app other than the focused tab's (ADR 0106)? */
export function isOtherTab(origin: string, focused: TabRef | null): boolean {
  return origin.startsWith("host:") && !!focused?.appId && origin !== `host:${focused.appId}`;
}

/** What the gate's lists are read from: the origins table and, beside it, the accepted contracts. */
export type TrustTable = Pick<OriginsState, "records" | "known" | "loaded" | "problem"> & {
  /** Absent reads as nothing accepted: every tool of an enabled origin is a changed contract. */
  contracts?: ContractTable;
};

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
  origins: TrustTable,
  tabs: readonly Tab[],
  byTab: Readonly<Record<number, TabTools>>,
): GatedLists {
  const firstSight = new Set<string>();
  const pinned = new Set<string>(Object.keys(contractDriftsOf(origins, tabs, byTab)));
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
    tab_id: countOf(row.tab_id),
    tab_nav: countOf(row.tab_id) === null ? null : countOf(row.tab_nav),
  };
}

/** A tab id or a navigation count off a wire row: a non-negative integer, else `null`. */
function countOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
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
      // The binding is the row's: a card from the stream that lacks it takes the row's.
      tab_id: card.tab_id ?? row.tab_id,
      tab_nav: card.tab_id != null ? card.tab_nav : row.tab_nav,
    };
  });
  const added = [...rows.values()].filter((card) => !have.has(card.id) && !skip(card.id));
  return added.length ? [...kept, ...added] : kept;
}

/** What one released call came to on the page: `ok`, or the reason it did not run or failed. */
export interface Ran {
  ok: boolean;
  error: string | null;
}

/** How many timed-out calls are remembered for a `late` answer. */
const TIMED_OUT_CAP = 32;

let deps: RunDeps = LIVE;

/** Swap the surface the loop runs against. The headless test's whole entry point. */
export function setRunDeps(next: RunDeps): void {
  deps = next;
}

export function resetRunForTests(): void {
  deps = LIVE;
  clearUnsureForTests();
  useRun.setState({ ...EMPTY });
}

export const useRun = create<RunState>((set, get) => {
  /** Host answers produced since the last request, waiting to ride the next frame. */
  let outstanding: Array<Record<string, unknown>> = [];

  /** Calls that timed out, by `<tab>|<page tool name>`, so a `late` answer can find its row. */
  const timedOut = new Map<string, { row: ExecuteRow; tier: number }>();

  /**
   * Web origins of other tabs a `tabs_read` returned text from since the user's last message
   * (ADR 0105). Sent as `tainted_by` on every request until then, continuations started by an
   * answered card included, so the gate files a card for every call on the page meanwhile.
   * Emptied only by the user's next message: nothing else loosens it.
   */
  let tainted = new Set<string>();

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
   * An `execute` bound to a tab (ADR 0103) runs on that tab, focused or not, and only while it holds
   * the document the card was filed on; anything else runs on the focused tab, as before. Refused
   * rather than run when the target tab's app is not the row's: an approval is granted for one
   * origin, and the user may have moved tabs between the card and the answer.
   */
  async function onPage(row: ExecuteRow, approved = false, from: Snapshot | null = snap): Promise<Ran> {
    const mine = generation;
    const bound = row.tab_id !== undefined && row.tab_id !== null;
    const focused = deps.focused();
    const target = bound ? boundTab(row.tab_id as number, focused) : focused;
    const refused = bindingRefusal(row, target);
    if (refused) {
      // Before any dispatch: a call meant for a document that is gone runs nowhere.
      outstanding.push(resultRow(row, false, "", `${refused.reason}: ${refused.detail}`));
      push({ id: row.call_id, kind: "tool", text: `${row.name} → not run: ${refused.detail}`, tier: row.tier ?? 1, ok: false });
      return { ok: false, error: `${refused.reason}: ${refused.detail}` };
    }
    if (!target) {
      outstanding.push(resultRow(row, false, "", "unknown_ref: no page is open"));
      return { ok: false, error: "unknown_ref: no page is open" };
    }
    // Defence in depth, and only where the surface actually knows the answer. The daemon pinned
    // the session and `POST /decisions/<id>` refuses a stated origin that is not the row's; this
    // catches the same mistake one step earlier, when the page has told us what it calls itself.
    if (target.appId && row.origin.startsWith("host:") && row.origin !== `host:${target.appId}`) {
      const why = `foreign_origin: ${row.origin} is not the ${bound ? "bound" : "focused"} page`;
      outstanding.push(resultRow(row, false, "", why));
      return { ok: false, error: why };
    }
    // A call whose last run never answered waits for the user's answer before it runs again
    // (ADR 0101). The gate is told on every request; this is the same rule one step later, for a
    // call proposed before the gate heard.
    const held = heldBefore(row.name, approved);
    if (held) {
      outstanding.push(resultRow(row, false, "", held.error));
      push({ id: row.call_id, kind: "tool", text: `${row.name} → ${held.line}`, tier: row.tier ?? 1, ok: false });
      return { ok: false, error: held.error };
    }
    // A read of another tab is checked here before the shell is asked (ADR 0105): a refusal reads
    // nothing, and the tab it would have read is never addressed.
    const reading = bareName(row.name) === TABS_READ;
    let source: OpenTab | null = null;
    if (reading) {
      const opened = typeof row.params.url === "string" ? (deps.openTab?.(row.params.url) ?? null) : null;
      const refused = tabReadRefusal(row.params, target, opened);
      if (refused) {
        const why = `${refused.reason}: ${refused.detail}`;
        outstanding.push(resultRow(row, false, "", why, 2));
        push({ id: row.call_id, kind: "tool", text: `${row.name} → not read: ${refused.detail}`, tier: 2, ok: false });
        return { ok: false, error: why };
      }
      source = opened;
    }
    set({ phase: "acting" });
    let answer: PageAnswer;
    try {
      answer = await deps.call(
        target.tabId,
        bareName(row.name),
        row.params,
        routingTools(from, target.tabId),
      );
    } catch (error) {
      answer = { ok: false, output: "", error: error instanceof Error ? error.message : String(error) };
    }
    const listedTools = routingTools(from, target.tabId) ?? useTools.getState().byTab[target.tabId]?.tools ?? [];
    const { timeout, error, line } = settleHostCall(row.name, answer, listedTools);
    if (timeout !== null) {
      if (timedOut.size >= TIMED_OUT_CAP) {
        const oldest = timedOut.keys().next().value;
        if (oldest !== undefined) timedOut.delete(oldest);
      }
      timedOut.set(`${target.tabId}|${bareName(row.name)}`, { row, tier: answer.tier ?? row.tier ?? 1 });
    }
    if (timeout === "outcome_unknown") rememberUnsure({ origin: target.origin, tool: row.name, at: now() });
    // Text from another tab is in the turn now: every later request until the user speaks says so.
    // The source is the tab this panel resolved and checked, never a name the model gave.
    const sourced = reading && source !== null && answer.ok && answer.output !== "" ? source : null;
    if (sourced) tainted.add(sourced.origin);
    outstanding.push(
      resultRow(row, answer.ok, answer.output, error, answer.tier, sourced?.appId ? `host:${sourced.appId}` : undefined),
    );
    // The user approved this call and it ran: the contract it ran under is now the accepted one
    // (ADR 0100). A declined, refused or failed call leaves the old one in force.
    if (approved && answer.ok && deps.accept) {
      const listed = routingTools(from, target.tabId) ?? useTools.getState().byTab[target.tabId]?.tools ?? [];
      const tool = listed.find((t) => t.name === bareName(row.name));
      if (tool) {
        await deps
          .accept(target.origin, tool)
          .catch((error: unknown) => console.error(`[athena] contract: ${String(error)}`));
      }
    }
    push({
      id: row.call_id,
      kind: "tool",
      text: `${row.name} → ${line}`,
      tier: answer.tier ?? row.tier ?? 1,
      ok: answer.ok,
    });
    // Stopped while the page ran it: the result is kept above, and she stays stopped.
    if (mine === generation) set({ phase: "running" });
    return { ok: answer.ok, error: answer.ok ? null : (error ?? "failed") };
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

  /** The snapshot of the exchange in progress: what the daemon's gate was told (ADR 0067). */
  let snap: Snapshot | null = null;

  /** Counts `POST /run` requests: the cards one request files are the ones a sheet may group. */
  let request = 0;

  /** The other tabs this exchange registered with the daemon: its `open_apps` (ADR 0106). */
  let published: OtherTab[] = [];

  /** Counts Stop presses. Work that began before a press checks it and goes no further (ADR 0115). */
  let generation = 0;

  /** The request in flight: what Stop aborts, and the origin it asks the daemon to stop. */
  let inFlight: {
    origin: string;
    controller: AbortController;
    /** The page results this request carries: back to `outstanding` if the daemon never took them. */
    carried: Array<Record<string, unknown>>;
    /** The request has left: from here a Stop cannot tell whether the daemon took what it carried. */
    sent: boolean;
  } | null = null;

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
          // The capture is the focused tab's; a card proposed on another tab has none (ADR 0106).
          captureWhy: withCaptureWhy(
            s.captureWhy,
            event,
            isOtherTab(event.origin, snap?.focused ?? null) ? OTHER_TAB_NO_PICTURE : s.captureNow,
          ),
          // Cards of one request, one app and one tab form a sheet, in the order they arrive (ADR 0104).
          slots: s.slots[event.id] ? s.slots : { ...s.slots, [event.id]: slotFor(s.slots, request, event) },
        }));
        void get().describe(event);
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
        const mine = generation;
        for (const call of calls) {
          // Stopped between two calls: the rest never run, and the model is told so (ADR 0115).
          if (mine !== generation) outstanding.push(resultRow(call, false, "", NOT_RUN_STOPPED));
          else await onPage(call);
        }
        break;
      }
    }
  }

  /** Stream one turn. Returns `false` when the request itself was refused. */
  async function consume(message: string, taking: Snapshot): Promise<boolean> {
    const api = deps.api();
    const focused = taking.focused;
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
    request += 1;
    const mine = generation;
    const flight = { origin: focused.origin, controller: new AbortController(), carried, sent: false };
    inFlight = flight;
    // One capture of the focused tab per request. It never blocks the request and never fails it.
    const taken = await captureOf(deps.capture, focused.tabId, focused.origin);
    set({ captureNow: taken.why });
    // Stopped while the screenshot was taken: the request never left, so the page results it was
    // to carry are still unheard and go with the person's next message (ADR 0115).
    if (flight.controller.signal.aborted) {
      outstanding = [...carried, ...outstanding];
      if (inFlight === flight) inFlight = null;
      return false;
    }
    flight.sent = true;
    let opened = false;
    try {
      for await (const event of api.run({
        origin: focused.origin,
        message,
        surface: "panel",
        ...(taken.id ? { capture_id: taken.id } : {}),
        // The tab this request runs against, and its document: a card it files is bound to both,
        // so the approval runs there or not at all (ADR 0103). Set here, never by a model.
        tab_id: focused.tabId,
        ...(focused.nav !== undefined ? { tab_nav: focused.nav } : {}),
        host_state: deps.hostState(),
        tool_results: carried,
        disabled_origins: taking.disabledOrigins,
        // Read per request, not per exchange: a write that timed out in this exchange is gated
        // for the rest of it. Only ever tightens the snapshot's lists (ADR 0067, 0101).
        ...withUnsure(taking.gated),
        // Another tab's text was read since the user's last message: the gate holds every call on
        // the page to a card naming it (ADR 0105). Only ever tightens.
        ...(tainted.size ? { tainted_by: [...tainted].sort() } : {}),
        // The other trusted tabs registered this exchange, each with its tab and document: a call
        // of one may be proposed, and the gate files it as a card bound to that tab (ADR 0106).
        // Set here from the shell's tab list, never by a model.
        ...(published.length ? { open_apps: openAppsOf(published) } : {}),
        ...activeProject(get().project),
      }, flight.controller.signal)) {
        // The daemon's turn ends at its last frame; what follows is the page's, with nothing to abort.
        opened = true;
        if (isTerminal(event) && inFlight === flight) inFlight = null;
        await apply(event);
        if (isTerminal(event)) break;
      }
    } catch (error) {
      // A refusal is answered before any stream opens (`POST /run` refuses everything it can
      // before its headers), so the daemon took nothing this request carried: a write that ran on
      // the page is still unheard, and it goes with the next request (ADR 0115).
      if (!opened && error instanceof ApiError && error.status >= 400) outstanding = [...carried, ...outstanding];
      // Stopped: the abort is the person's, not a failure to show them (ADR 0115).
      if (mine !== generation) return false;
      fail(error);
      return false;
    } finally {
      if (inFlight === flight) inFlight = null;
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
  async function publish(taking: Snapshot): Promise<boolean> {
    published = [];
    const body = taking.manifest;
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
    published = await publishOthers(api, taking);
    return true;
  }

  /**
   * Register the other trusted tabs the snapshot lists (ADR 0106), and answer the ones the daemon
   * took. A refused one is left out of `open_apps`, so its tools stay `foreign_origin`: a failure
   * here only narrows the turn, it never fails it.
   */
  async function publishOthers(api: DaemonApi, taking: Snapshot): Promise<OtherTab[]> {
    const took: OtherTab[] = [];
    for (const other of taking.others ?? []) {
      try {
        await api.manifest(other.manifest);
        took.push(other);
      } catch (error) {
        console.error(`[athena] manifest of tab ${other.tab.tabId}: ${String(error)}`);
      }
    }
    return took;
  }

  /**
   * Exchanges in progress. An answer whose call ran while one is going does not start another
   * beside it: the running exchange carries what is outstanding on its own next request, so one
   * conversation never has two turns in flight and a result never rides two requests.
   */
  let exchanging = 0;

  /** Continue with what is outstanding, unless an exchange already in progress will carry it. */
  async function carryOn(): Promise<void> {
    if (outstanding.length === 0 || exchanging > 0) return;
    set({ phase: "running" });
    await exchange(CONTINUE);
  }

  async function exchange(first: string): Promise<void> {
    exchanging += 1;
    try {
      await exchangeOnce(first);
    } finally {
      exchanging -= 1;
    }
  }

  async function exchangeOnce(first: string): Promise<void> {
    // One read of the tab per exchange; the manifest, every request's lists and the routing of the
    // calls it releases all come from it (ADR 0067).
    const taking = snapshotFrom(deps);
    snap = taking;
    const mine = generation;
    if (!(await publish(taking))) return;
    let message = first;
    for (let step = 0; step <= MAX_CONTINUATIONS; step += 1) {
      if (mine !== generation) return;
      if (!(await consume(message, taking))) return;
      // Stopped while the page ran her calls: what it answered waits for the person's next
      // message, and no continuation starts on its own (ADR 0115).
      if (mine !== generation) return;
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
      message = CONTINUE;
    }
  }

  /** What one card's answer came to, for `answer` and a sheet's walk. */
  interface OneAnswer {
    /** The daemon took the answer. */
    taken: boolean;
    result: AnswerResult;
    reason: string | null;
    /** The plain sentence of a refusal; empty when taken. */
    sentence: string;
    /** What each released call came to on the page, in order. Empty for a decline or a refusal. */
    ran: Ran[];
  }

  /**
   * Answer one card through `POST /decisions/<id>` and run what the daemon releases. `null` when
   * the card is already being answered or already was. `quiet` is a sheet's walk: no `settled`, no
   * reconcile per row, and never a continuation here - the caller continues once (ADR 0104).
   */
  async function answerOne(
    id: string,
    choice: string,
    settled: ((result: Settled) => void) | undefined,
    quiet: boolean,
  ): Promise<OneAnswer | null> {
    const before = get();
    // A second press is a second answer to a decision that is already on its way or already made.
    if (before.answering[id] !== undefined) return null;
    if (before.answered.some((a) => a.id === id && a.result !== "refused")) return null;
    const card = before.cards.find((c) => c.id === id);
    set((s) => ({ answering: { ...s.answering, [id]: choice }, refusals: without(s.refusals, id) }));
    /** The tab as this answer read it; the exchange's snapshot until then. */
    let read: Snapshot | null = snap;

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
          // Where it would have run, as the card said it (ADR 0099): a hand is tier 2.
          tier: card ? tierOf(card.origin, card.action, [], read?.tools ?? []) : 1,
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
    const refuse = async (reason: string, local: string | null = null): Promise<OneAnswer> => {
      // A card for an app the user switched off cannot be helped by focusing it.
      const off = reason === "foreign_origin" && card !== undefined && (deps.disabledOrigins?.() ?? []).includes(card.origin);
      const sentence = local ?? (off ? switchedOffSentence() : refusalSentence(reason));
      set((s) => ({
        answering: without(s.answering, id),
        refusals: { ...s.refusals, [id]: sentence },
        // The daemon says no such decision is waiting: nothing is left to answer. A refusal the
        // panel made itself (`local`) never asked the daemon, so the card is still waiting there.
        cards: reason === "unknown_ref" && local === null ? s.cards.filter((c) => c.id !== id) : s.cards,
      }));
      note("refused", reason);
      if (!quiet) {
        settled?.({ ok: false, sentence });
        await get().reconcile();
      }
      return { taken: false, result: "refused", reason, sentence, ran: [] };
    };

    // A card bound to a tab (ADR 0103) is approved only while that tab holds the document it was
    // filed on. Checked before the daemon is asked, so the grant is not spent on a call that
    // would be refused on the page; a decline needs no tab and is never stopped here.
    if (card && choice === "approve") {
      const refused = bindingRefusal(card, card.tab_id != null ? boundTab(card.tab_id, deps.focused()) : null);
      if (refused) return refuse(refused.reason, boundTabSentence(refused.why));
    }
    const api = deps.api();
    if (!api) return refuse("not_ready");
    // A decision restored from a previous daemon process has no session behind it until the page
    // has been registered (UAT r2: it was refused as "a different app" on the right tab). Register
    // the focused page first, exactly as a turn does; a failure here is the answer's to report.
    // The republish, the resolve and the routing of the rows it releases read the tab once. That
    // read is the answer's own: a turn still streaming keeps the snapshot its gate was told (ADR 0067).
    const taking = snapshotFrom(deps);
    read = taking;
    if (taking.manifest !== null) {
      await api.manifest(taking.manifest).catch(() => undefined);
      await publishOthers(api, taking);
    }
    // The page that answers is the tab the card is bound to (ADR 0103, 0106): a card proposed on
    // another app's tab is answered in that app's name. A bound tab that is gone states nothing,
    // and the row's own origin decides - a decline still goes through.
    const stated = card?.tab_id != null ? boundTab(card.tab_id, taking.focused)?.origin : taking.focused?.origin;
    let resolution;
    try {
      resolution = await api.resolve(id, choice, stated, undefined, taking.disabledOrigins);
    } catch (error) {
      return refuse(reasonOf(error));
    }
    const result: AnswerResult = resolution.status === "declined" ? "user_denied" : "approved";
    // The user answered a card about this tool: the "may have run" hold has done its job.
    const action = card?.action ?? resolution.execute[0]?.name;
    if (action) forgetUnsure(action);
    set((s) => ({
      cards: s.cards.filter((c) => c.id !== id),
      answering: without(s.answering, id),
      refusals: without(s.refusals, id),
      unticked: without(s.unticked, id),
    }));
    note(result, result === "user_denied" ? "user_denied" : null);
    if (!quiet) {
      settled?.({ ok: true, sentence: "" });
      await get().reconcile();
    }
    if (resolution.status === "declined") {
      push({ id, kind: "tool", text: `declined: ${card?.action ?? id}`, ok: false }, false);
      return { taken: true, result, reason: "user_denied", sentence: "", ran: [] };
    }
    const ran: Ran[] = [];
    for (const row of resolution.execute) ran.push(await onPage(row, true, taking));
    return { taken: true, result, reason: null, sentence: "", ran };
  }

  return {
    ...EMPTY,

    async send(message: string) {
      // The user spoke: what she reads from here on is a new exchange's (ADR 0105).
      tainted = new Set();
      push({ id: `u${Date.now()}`, kind: "user", text: message });
      set({ phase: "running", error: null, summary: null, continuations: 0 });
      await exchange(message);
    },

    async stop() {
      const { phase } = get();
      if (phase !== "running" && phase !== "acting") return;
      generation += 1;
      const flight = inFlight;
      inFlight = null;
      flight?.controller.abort();
      // A call the turn proposed and never released was not run: the turn it belonged to ended.
      proposed = new Map();
      // A request still taking its screenshot has not left: what it carries is kept, too.
      const kept = outstanding.length > 0 || (flight !== null && !flight.sent && flight.carried.length > 0);
      set({ phase: "idle", error: null });
      push(
        {
          id: `stop${Date.now()}`,
          kind: "tool",
          text: kept
            ? "stopped: you stopped her. What the page already did goes with your next message."
            : "stopped: you stopped her. Nothing more runs until your next message.",
          ok: false,
        },
        false,
      );
      const api = deps.api();
      if (api && flight) {
        await api.stop(flight.origin).catch((error: unknown) => console.error(`[athena] stop: ${String(error)}`));
      }
    },

    async answer(id, choice, settled) {
      const mine = generation;
      const out = await answerOne(id, choice, settled, false);
      if (!out?.taken || out.result !== "approved") return;
      if (mine !== generation) {
        // Stopped while the approved call ran: its result rides the next message (ADR 0115).
        set({ phase: "idle" });
        return;
      }
      await carryOn();
    },

    tick(id) {
      const { cards, slots } = get();
      if (!sheetOf(cards, slots, id)) return;
      set((s) => (s.unticked[id] ? { unticked: without(s.unticked, id) } : { unticked: { ...s.unticked, [id]: true } }));
    },

    async answerSheet(id, choice, settled) {
      const before = get();
      const sheet = sheetOf(before.cards, before.slots, id);
      if (!sheet) {
        await get().answer(id, choice, settled);
        return;
      }
      // A press while any row is on its way is a second press of the same sheet.
      if (sheet.rows.some((row) => before.answering[row.id] !== undefined)) return;
      const rows = sheet.rows;
      const n = rows.length;
      const approving = choice === "approve";
      const mine = generation;
      const ticked = approving ? rows.filter((row) => !before.unticked[row.id]) : [];
      const declined = approving ? rows.filter((row) => before.unticked[row.id]) : rows;
      set((s) => ({ ran: without(s.ran, sheet.key) }));

      let answered = 0;
      let firstRefusal = "";
      const told = (out: OneAnswer | null) => {
        if (out?.taken) answered += 1;
        else if (out && !firstRefusal) firstRefusal = out.sentence;
      };
      // An unticked row is a "no" the user gave in so many words: it is declined first, whatever
      // the ticked rows come to. A decline needs no page and spends no grant (ADR 0104).
      for (const row of declined) told(await answerOne(row.id, optionOf(row, "decline"), undefined, true));

      // Each ticked row through the per-card route, in proposal order: the daemon replays the gate
      // and spends that row's grant, and its execute runs on the page before the next row is asked.
      let ran = 0;
      let stop: string | null = null;
      for (const row of ticked) {
        const out = await answerOne(row.id, optionOf(row, "approve"), undefined, true);
        told(out);
        if (!out) {
          stop = `${row.action} was already answered`;
          break;
        }
        if (!out.taken) {
          stop = `${row.action} was refused: ${out.reason ?? "unknown"}`;
          break;
        }
        const failed = out.ran.find((r) => !r.ok);
        if (failed) {
          stop = `${row.action} did not run: ${failed.error ?? "failed"}`;
          break;
        }
        ran += 1;
      }
      if (approving) {
        const k = ticked.length;
        const line =
          stop === null
            ? `ran ${ran} of ${k}`
            : `ran ${ran} of ${k}; stopped at row ${ran + 1}: ${stop}. The rows after it are still waiting.`;
        if (stop !== null) set((s) => ({ ran: { ...s.ran, [sheet.key]: line } }));
        push({ id: `sheet_${sheet.key}_${ran}`, kind: "tool", text: `sheet of ${n}: ${line}`, ok: stop === null }, false);
      }
      settled?.(answered > 0 ? { ok: true, sentence: "" } : { ok: false, sentence: firstRefusal || refusalSentence("unknown") });
      await get().reconcile();
      if (mine !== generation) {
        // Stopped during the walk: what ran rides the next message, and nothing continues.
        set({ phase: "idle" });
        return;
      }
      // One continuation for every row that ran, instead of one per row (ADR 0104).
      await carryOn();
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

    late(answer) {
      const key = `${answer.tab_id}|${answer.name}`;
      const found = timedOut.get(key);
      timedOut.delete(key);
      const seconds = Math.max(1, Math.round(answer.late_ms / 1000));
      const said = answer.ok ? answer.output : (answer.error ?? "failed");
      const line = `${answer.name} finished ${seconds} s late: ${said}`;
      const row: ExecuteRow = found?.row ?? { call_id: `late_${answer.tab_id}_${answer.name}`, name: answer.name, params: {}, origin: "" };
      outstanding.push({
        ...resultRow(row, answer.ok, line, answer.ok ? null : said, found?.tier),
        call_id: `${row.call_id}_late`,
      });
      // The call's row in the record says how it ended, where the person already looked.
      const amend = (entries: TranscriptEntry[]) =>
        entries.map((e) => (found && e.id === row.call_id && e.kind === "tool" ? { ...e, text: `${row.name} → ${line}`, ok: answer.ok } : e));
      set((s) => ({ transcript: amend(s.transcript), calls: amend(s.calls) }));
      if (!found) push({ id: `${row.call_id}_late`, kind: "tool", text: line, tier: 1, ok: answer.ok });
    },

    async describe(card) {
      const refs = refsOf(card.params);
      // A card's refs belong to the tab it was proposed on (ADR 0103), which need not be focused.
      const focused = card.tab_id != null ? boundTab(card.tab_id, deps.focused()) : deps.focused();
      if (!refs.length || !deps.describe || get().targets[card.id] !== undefined) return;
      let found: CardTargets;
      if (!focused) found = { ok: false, why: card.tab_id != null ? "the tab it was proposed on is closed" : "no page is open" };
      else {
        try {
          found = { ok: true, targets: await deps.describe(focused.tabId, refs) };
        } catch (error) {
          found = { ok: false, why: error instanceof Error ? error.message : String(error) };
        }
      }
      set((s) => ({ targets: { ...s.targets, [card.id]: found } }));
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
      // The transcript goes. What the daemon is still holding for the user does not: a card is a
      // decision waiting, not a line of conversation, and the Record keeps what was done.
      // Nor does the turn: a request still streaming keeps its phase, so the panel still says she
      // is working and Stop still reaches it, and the calls it proposed still run. A page result
      // waiting for the next message (`outstanding`) is a write that ran: it is never dropped
      // (ADR 0115), Clear or not.
      const keep = get();
      const working = keep.phase === "running" || keep.phase === "acting";
      set({
        ...EMPTY,
        ...(working ? { phase: keep.phase, continuations: keep.continuations, captureNow: keep.captureNow } : {}),
        cards: keep.cards,
        calls: keep.calls,
        answering: keep.answering,
        refusals: keep.refusals,
        captureWhy: keep.captureWhy,
        targets: keep.targets,
        answered: keep.answered,
        earlier: keep.earlier,
        project: keep.project,
        slots: keep.slots,
        unticked: keep.unticked,
        ran: keep.ran,
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
  // A call that timed out and then finished (ADR 0101). Only a shell's relay emits it.
  const offLate = hasShell()
    ? onLate((answer) => useRun.getState().late(answer)).catch(() => null)
    : Promise.resolve(null);
  stopRun = () => {
    offDaemon();
    offRun();
    void offLate.then((off) => off?.());
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
  source?: string,
): Record<string, unknown> {
  return {
    call_id: row.call_id,
    name: row.name,
    ok,
    output,
    error,
    tier: tier ?? row.tier ?? 1,
    ms: 0,
    // Where the text came from, when it was another tab (ADR 0105). Set by the surface only.
    ...(source ? { source } : {}),
  };
}

/** The option id the daemon knows a choice by; the card's own options are the authority. */
function optionOf(card: DecisionRequested, kind: "approve" | "decline"): string {
  return card.options.find((o) => o.id === kind)?.id ?? kind;
}

/** `host.<app_id>.<tool>` is the catalog's name; the page registered the last segment. */
function bareName(name: string): string {
  const parts = name.split(".");
  return parts.length > 2 ? parts.slice(2).join(".") : name;
}

/** The tab a bound row names, read now; the focused tab answers for itself without `deps.tab`. */
function boundTab(tabId: number, focused: TabRef | null): TabRef | null {
  const found = deps.tab?.(tabId);
  if (found !== undefined) return found;
  return focused?.tabId === tabId ? focused : null;
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
