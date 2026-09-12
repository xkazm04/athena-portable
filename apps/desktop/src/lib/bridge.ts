/**
 * The relay, in TypeScript — README section 3.4, tier 1: *the page's own WebMCP tools, through
 * `inject.js` and the relay*.
 *
 * Three wrappers and the types the page answers with. Everything goes through `lib/ipc.ts`, so
 * the two rules of that file hold here too: `undefined` never reaches the wire, and a command
 * called without a shell rejects with a sentence rather than an undefined property.
 *
 * **The shapes below are the page's, not ours.** `packages/athena-bridge/protocol.md` is the
 * contract and `src-tauri/src/bridge.rs` carries it across; this file re-declares it in
 * TypeScript and adds nothing. In particular `tools` is what some page said about itself: a
 * claim, never a permission. Which of them is `AUTO` and which is `GATED` is decided by `gate.js`
 * and the catalog behind it (README section 3.3), and no field here participates in that.
 */
import { call, on, type Args } from "@/lib/ipc";

/** One tool, as the page describes it (`protocol.md`, "tools"). */
export interface BridgeTool {
  name: string;
  title: string | null;
  description: string;
  /** JSON Schema, as the page wrote it. Rendered, never trusted. */
  inputSchema: unknown;
  /** The standard WebMCP hints: `readOnlyHint`, `consequentialHint`. */
  annotations: unknown;
  /** The non-standard README section 3.3 block: `{ reversible, side_effects }`. */
  athena: unknown;
}

/** The page's own account of itself, from its `athena:app` meta tags (`protocol.md`, "page"). */
export interface BridgePage {
  origin: string;
  href: string;
  title: string;
  /** `athena:app` — the slug the catalog namespaces this page's tools under. */
  app_id: string | null;
  app_name: string | null;
  app_version: string | null;
  manifest: unknown;
  /** `webmcp-native` when the browser had `document.modelContext`, else `webmcp-polyfill`. */
  transport: string;
  deprecated_navigator: boolean;
}

/**
 * What `bridge_list` answers. The failure arm covers both halves of the protocol's two timers and
 * the page that has no bridge at all: a page that froze its globals never answers, so the relay's
 * own timer resolves the call `{ ok: false, error: "timeout" }` and the surface shows a page with
 * zero tools rather than an error (ADR 0008).
 */
export type ListReply =
  | { ok: true; page: BridgePage; tools: BridgeTool[] }
  | { ok: false; error: string };

/**
 * What `bridge_call` answers. `output` is always a string — a WebMCP content array flattened to
 * its text parts, anything else as JSON. `reason` is present when the page minted one; the only
 * one it mints itself is `timeout`.
 */
export type CallReply =
  | { ok: true; output: string }
  | { ok: false; error: string; reason?: string };

/** What the page registered, and what it says it is. */
export const bridgeList = (tabId: number) => call<ListReply>("bridge_list", { tab_id: tabId });

/**
 * Run one of the page's own tools.
 *
 * `timeoutMs` may *shorten* the page's own 30 s deadline and can never extend it — `inject.js`
 * clamps it into `1 … 30000` — and the relay's 35 s timer is unaffected either way, so a page
 * that ignores its abort still cannot hold this promise open.
 */
export const bridgeCall = (
  tabId: number,
  name: string,
  params: Args = {},
  timeoutMs: number | null = null,
) => call<CallReply>("bridge_call", { tab_id: tabId, name, params, timeout_ms: timeoutMs });

/**
 * The page's registry moved. It carries no payload beyond the tab, by design: the surface re-runs
 * `list` and rebuilds, because a diff of a tool list is a bug surface nobody needs.
 */
export const onToolChange = (f: (tabId: number) => void) =>
  on<{ tab_id: number }>("bridge:toolchange", (payload) => f(payload.tab_id));
