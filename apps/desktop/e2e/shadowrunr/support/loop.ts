/**
 * The shell's run loop (`src/stores/run.ts`) wired to a real Athena daemon and to the console in
 * a real Chromium, with a recorder on the wire.
 *
 * Exactly the parts the surface owns are supplied here, and each is the real thing or the
 * shell's own code:
 *
 *  - `api` is the shipped `DaemonApi` against the real socket;
 *  - `call` is the page relay's `call` (postMessage through `inject.js`), so the tool that runs
 *    is the console's own, against the Shadowrunr daemon;
 *  - `manifest` is the shell's `manifestBodyOf` over what the page's `list` answered;
 *  - `gated` is the shell's `gatedListsOf` over an origins table in which the console's origin
 *    is a registered, enabled row whose current contracts are the accepted ones. That is ADR
 *    0063's "register the origin" step: the app is not first sight, so its READ and AUTO tools
 *    run without a card, and its GATED tools still file one;
 *  - `hostState` is the page's real URL and title; `focused` is its origin and app id.
 *
 * The recorder sees every request and response without changing a byte: the `/run` bodies (what
 * the panel carried back), the SSE frames of every turn (teed, so the store still reads its own
 * stream), and the JSON reply of every `POST /decisions/<id>`.
 */
import type { BridgeTool } from "@/lib/bridge";
import { contractOf } from "@/lib/contract";
import { DaemonApi, sseFrames, type FetchLike } from "@/lib/api";
import type { Tab } from "@/lib/ipc";
import type { OriginRow } from "@/lib/store";
import { manifestBodyOf } from "@/lib/manifest";
import { gatedListsOf, setRunDeps, type GatedLists, type RunDeps, type TrustTable } from "@/stores/run";
import type { TabTools } from "@/stores/tools";

import type { ConsolePage, ListAnswer } from "./browser";

export const APP_ID = "shadowrunr";
export const TAB_ID = 1;

export interface Sent {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  status: number;
  /** The parsed JSON reply, kept for `/decisions/<id>` only. */
  reply?: Record<string, unknown>;
}

export interface Frame {
  /** Which `/run` request (0-based) the frame came off. */
  run: number;
  event: Record<string, unknown>;
}

export interface PageCall {
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  output: string;
  error: string | null;
  hashAfter: string;
}

export interface Wire {
  sent: Sent[];
  frames: Frame[];
  to: (path: string) => Sent[];
  fetchImpl: FetchLike;
}

/** `base` with every request recorded and every turn's frames teed off. */
export function recordingFetch(base: FetchLike = (i, n) => fetch(i, n)): Wire {
  const sent: Sent[] = [];
  const frames: Frame[] = [];
  let runs = 0;
  const fetchImpl: FetchLike = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const raw = typeof init?.body === "string" ? init.body : null;
    const path = new URL(input).pathname;
    const entry: Sent = { method, path, body: raw === null ? null : (JSON.parse(raw) as Record<string, unknown>), status: 0 };
    sent.push(entry);
    const response = await base(input, init);
    entry.status = response.status;
    if (path.startsWith("/decisions/") && method === "POST") {
      try {
        entry.reply = (await response.clone().json()) as Record<string, unknown>;
      } catch {
        // Not JSON: the status says what happened.
      }
    }
    if (path === "/run" && response.body) {
      const index = runs;
      runs += 1;
      const [mine, theirs] = response.body.tee();
      void (async () => {
        try {
          for await (const frame of sseFrames(mine)) {
            try {
              frames.push({ run: index, event: JSON.parse(frame) as Record<string, unknown> });
            } catch {
              // A frame that is not JSON is the store's problem to report, not the recorder's.
            }
          }
        } catch {
          // The store aborted its read (stop): the recorder's copy ends with it.
        }
      })();
      return new Response(theirs, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    return response;
  };
  return { sent, frames, to: (p) => sent.filter((s) => s.path === p), fetchImpl };
}

/** The origins table of a person who registered the console and accepted its current tools. */
export function registeredTable(origin: string, tools: readonly BridgeTool[]): TrustTable {
  const now = new Date().toISOString();
  const row: OriginRow = { origin, enabled: true, overrides: {}, first_seen: now, last_seen: now };
  return {
    records: { [origin]: row },
    known: [origin],
    loaded: true,
    problem: null,
    contracts: { [origin]: Object.fromEntries(tools.map((t) => [t.name, contractOf(t)])) },
  } as unknown as TrustTable;
}

export function tabOf(url: string, title: string): Tab {
  return { id: TAB_ID, label: `page-${TAB_ID}`, url, title, focused: true };
}

export function tabToolsOf(url: string, listed: ListAnswer): TabTools {
  return {
    tabId: TAB_ID,
    url,
    tools: listed.tools,
    transport: listed.page.transport,
    appId: listed.page.app_id,
    appVersion: listed.page.app_version,
    problem: null,
    asking: false,
  } as TabTools;
}

/** The gate's lists for the one open tab, as the shell computes them. */
export function gatedFor(origin: string, url: string, title: string, listed: ListAnswer, registered = true): GatedLists {
  const table: TrustTable = registered
    ? registeredTable(origin, listed.tools)
    : ({ records: {}, known: [], loaded: true, problem: null, contracts: {} } as unknown as TrustTable);
  return gatedListsOf(table, [tabOf(url, title)], { [TAB_ID]: tabToolsOf(url, listed) });
}

export function manifestFor(origin: string, listed: ListAnswer): Record<string, unknown> | null {
  return manifestBodyOf({
    origin,
    appId: listed.page.app_id,
    appVersion: listed.page.app_version,
    transport: listed.page.transport,
    tools: listed.tools,
  });
}

export interface Wired {
  wire: Wire;
  calls: PageCall[];
  /** Every hash the page showed after a call, in order, starting with the one it opened on. */
  hashes: string[];
  listed: ListAnswer;
  api: () => DaemonApi;
}

/**
 * Wire the run loop to `daemon` and `cp`. The page is listed once, here: its tools are the
 * manifest's for every exchange, as the shell's tools store would hold them.
 */
export async function wireLoop(
  daemon: { url: string; token: string },
  cp: ConsolePage,
  base?: FetchLike,
): Promise<Wired> {
  const wire = recordingFetch(base);
  const listed = await cp.waitForTools();
  const origin = listed.page.origin;
  const calls: PageCall[] = [];
  const hashes: string[] = [await cp.hash()];
  let title = await cp.page.title();

  const deps: RunDeps = {
    api: () => new DaemonApi({ url: daemon.url, token: daemon.token }, wire.fetchImpl),
    focused: () => ({ tabId: TAB_ID, origin, appId: listed.page.app_id }),
    tab: (tabId) => (tabId === TAB_ID ? { tabId: TAB_ID, origin, appId: listed.page.app_id } : null),
    hostState: () => ({ page_url: cp.page.url(), page_title: title, tabs: [{ url: cp.page.url(), title }] }),
    call: async (_tabId, name, input) => {
      const answer = await cp.call(name, input);
      title = await cp.page.title();
      const hash = await cp.hash();
      if (hashes[hashes.length - 1] !== hash) hashes.push(hash);
      calls.push({
        name,
        input,
        ok: answer.ok,
        output: answer.output ?? "",
        error: answer.ok ? null : (answer.error ?? "error"),
        hashAfter: hash,
      });
      return answer.ok
        ? { ok: true, output: answer.output ?? "" }
        : { ok: false, output: "", error: answer.error ?? "error", reason: answer.reason ?? null };
    },
    manifest: () => manifestFor(origin, listed),
    disabledOrigins: () => [],
    gated: () => gatedFor(origin, cp.page.url(), title, listed),
  };
  setRunDeps(deps);
  return { wire, calls, hashes, listed, api: () => new DaemonApi({ url: daemon.url, token: daemon.token }) };
}

// ---- reading a turn back off the wire ------------------------------------------------------------

export interface ToolCallRecord {
  call_id: string;
  name: string;
  params: Record<string, unknown>;
  /** `true`/`false` once an answer is known; `null` when nothing ever answered it. */
  ok: boolean | null;
  error: string | null;
  /** Where the answer came from: the gate on the stream, or the page via the next `/run`. */
  answered_by: "gate" | "page" | null;
}

/**
 * Every tool call the daemon proposed, with how it ended: a refusal or a pending approval on the
 * stream (`tool.result`), or the page's answer carried back in a later `/run`'s `tool_results`.
 */
export function toolCallsOf(wire: Wire): ToolCallRecord[] {
  const byId = new Map<string, ToolCallRecord>();
  for (const { event } of wire.frames) {
    if (event.kind === "tool.call") {
      const id = String(event.call_id);
      byId.set(id, {
        call_id: id,
        name: String(event.name),
        params: (event.params ?? {}) as Record<string, unknown>,
        ok: null,
        error: null,
        answered_by: null,
      });
    } else if (event.kind === "tool.result") {
      const row = byId.get(String(event.call_id));
      if (row && row.answered_by !== "page") {
        row.ok = event.ok === true;
        row.error = event.ok === true ? null : String(event.error ?? event.output ?? "error");
        row.answered_by = "gate";
      }
    }
  }
  for (const run of wire.to("/run")) {
    for (const carried of (run.body?.tool_results ?? []) as Array<Record<string, unknown>>) {
      const row = byId.get(String(carried.call_id));
      if (!row) continue;
      row.ok = carried.ok === true;
      row.error = carried.ok === true ? null : String(carried.error ?? carried.output ?? "error");
      row.answered_by = "page";
    }
  }
  return [...byId.values()];
}
