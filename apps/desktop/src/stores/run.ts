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
import { bridgeCall } from "@/lib/bridge";
import type { Args } from "@/lib/ipc";
import { manifestBodyOf } from "@/lib/manifest";
import { endpoint, useDaemon } from "@/stores/daemon";
import { isTerminal, type ChannelEvent, type DecisionRequested, type TurnSummary } from "@/lib/events";
import { useTabs } from "@/stores/tabs";
import { useTools } from "@/stores/tools";

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
}

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
  ) => Promise<{ ok: boolean; output: string; error?: string | null }>;
  /**
   * The focused page's manifest body, or `null` when there is nothing to register.
   *
   * README §3.3: a page's tools enter the catalog through a manifest, and `POST /run` refuses an
   * origin it has no session for — so this is not an optimisation, it is the step without which
   * no turn can start. Optional only so a test that is about something else may leave it out.
   */
  manifest?: () => Record<string, unknown> | null;
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
  send: (message: string) => Promise<void>;
  answer: (id: string, choice: string) => Promise<void>;
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
    return { tabId: tab.id, origin: originOf(tab.url), appId: byTab[tab.id]?.appId ?? null };
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
  call: async (tabId, name, input) => {
    // The gate already allowed this call, so the parameters are the row's. `Args` is the
    // IPC's own wire type and the cast is the one place a gate-approved object meets it.
    const reply = await bridgeCall(tabId, name, input as Args);
    return reply as { ok: boolean; output: string; error?: string | null };
  },
  manifest: () => {
    const tab = focusedTab();
    if (!tab) return null;
    const found = useTools.getState().byTab[tab.id];
    if (!found) return null;
    return manifestBodyOf({
      origin: originOf(tab.url),
      appId: found.appId,
      appVersion: found.appVersion,
      transport: found.transport,
      tools: found.tools,
    });
  },
};

let deps: RunDeps = LIVE;

/** Swap the surface the loop runs against. The headless test's whole entry point. */
export function setRunDeps(next: RunDeps): void {
  deps = next;
}

export function resetRunForTests(): void {
  deps = LIVE;
  useRun.setState({ ...EMPTY });
}

export const useRun = create<RunState>((set) => {
  /** Host answers produced since the last request, waiting to ride the next frame. */
  let outstanding: Array<Record<string, unknown>> = [];

  const push = (entry: TranscriptEntry) =>
    set((s) => ({ transcript: [...s.transcript, entry] }));

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
    let answer: { ok: boolean; output: string; error?: string | null };
    try {
      answer = await deps.call(focused.tabId, bareName(row.name), row.params);
    } catch (error) {
      answer = { ok: false, output: "", error: error instanceof Error ? error.message : String(error) };
    }
    outstanding.push(resultRow(row, answer.ok, answer.output, answer.error ?? null));
    push({
      id: row.call_id,
      kind: "tool",
      text: `${row.name} → ${answer.ok ? answer.output : (answer.error ?? "failed")}`,
      tier: row.tier ?? 1,
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
        set((s) => ({ cards: [...s.cards, event] }));
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
      fail(new ApiError(0, "unknown_ref", "the daemon is not ready"));
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
      fail(new ApiError(0, "unknown_ref", "the daemon is not ready"));
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

    async answer(id: string, choice: string) {
      // Removed before the daemon replies, so a slow resolve cannot be pressed twice — and a
      // second press is a second answer to a decision already made.
      set((s) => ({ cards: s.cards.filter((c) => c.id !== id) }));
      const api = deps.api();
      if (!api) {
        fail(new ApiError(0, "unknown_ref", "the daemon is not ready"));
        return;
      }
      let resolution;
      try {
        resolution = await api.resolve(id, choice, deps.focused()?.origin);
      } catch (error) {
        fail(error);
        return;
      }
      if (resolution.status === "declined") {
        push({ id, kind: "tool", text: `declined: ${id}`, ok: false });
        return;
      }
      for (const row of resolution.execute) await onPage(row);
      if (outstanding.length) {
        set({ phase: "running" });
        await exchange("(the tools you called have answered; continue)");
      }
    },

    clear() {
      outstanding = [];
      proposed = new Map();
      set({ ...EMPTY });
    },
  };
});

function resultRow(
  row: ExecuteRow,
  ok: boolean,
  output: string,
  error: string | null,
): Record<string, unknown> {
  return {
    call_id: row.call_id,
    name: row.name,
    ok,
    output,
    error,
    tier: row.tier ?? 1,
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
