/**
 * The generic hands, in TypeScript — README section 3.4 tier 2, ADR 0065.
 *
 * Rust owns the nine hands (`src-tauri/src/hands.rs`); this file fetches their catalogue once,
 * offers it beside whatever a page registered, and sends a call to the right executor. Everything
 * goes through `lib/ipc.ts`, so outside the shell the list is empty and nothing here changes
 * anything: a plain browser, the preview harness and the headless tests behave as before.
 *
 * A hand is not a permission. Whether one runs unasked is the gate's answer from the manifest's
 * flags and the origin's first-sight state, exactly as for a page's own tool.
 */
import type { CallReply, BridgeTool } from "@/lib/bridge";
import { bridgeCall } from "@/lib/bridge";
import { call, capturesSweep, hasShell, type Args } from "@/lib/ipc";

/** What `hands_call` answers. Never an error: a refusal is a result the model can read. */
interface HandReply {
  ok: boolean;
  output: string;
  reason: string | null;
  error: string | null;
  tier: number;
  /** The `captures` row a `page_screenshot` filed; `null` for every other hand. */
  capture_id?: string | null;
}

/** How long a capture may take before the request goes without one (ADR 0066). */
export const CAPTURE_MS = 8000;

/** What taking a capture came to: its id, or the one sentence that says why there is none. */
export interface Taken {
  id: string | null;
  why: string | null;
}

let hands: readonly BridgeTool[] = [];

/**
 * The marker that makes a tool a hand the shell appended (README 3.4 tier 2, ADR 0066): the value
 * of `athena.runner` on the tool, and of `runner` on the manifest's tool. `HAND_RUNNER` in
 * `contracts/manifest.py` spells the same word. Only {@link withHands} puts it on, and it takes
 * it off every tool a page registered, so a page cannot dress its tool as a hand.
 */
export const HAND_RUNNER = "shell";

/** Is this tool one the shell appended? Reads the marker {@link withHands} set. */
export function isMarkedHand(tool: BridgeTool): boolean {
  const block = tool.athena;
  return typeof block === "object" && block !== null && (block as { runner?: unknown }).runner === HAND_RUNNER;
}

/** The tool as a page may have it: its `athena` block without a `runner`. */
function unmarked(tool: BridgeTool): BridgeTool {
  if (typeof tool.athena !== "object" || tool.athena === null || !("runner" in tool.athena)) return tool;
  const { runner: _runner, ...rest } = tool.athena as Record<string, unknown>;
  void _runner;
  return { ...tool, athena: rest };
}

function marked(tool: BridgeTool): BridgeTool {
  const block = typeof tool.athena === "object" && tool.athena !== null ? (tool.athena as object) : {};
  return { ...tool, athena: { ...block, runner: HAND_RUNNER } };
}

/** The hands, as the shell shaped them like a page's tools. Empty until {@link startHands} ran. */
export function handTools(): readonly BridgeTool[] {
  return hands;
}

/** Test seam: set the list without a shell, and forget that the startup sweep ran. */
export function setHandsForTests(next: readonly BridgeTool[]): void {
  hands = next;
  swept = false;
}

let swept = false;

/**
 * Hold the `captures` table to its declared cap (README 3.5, ADR 0066): the shell's own
 * `captures_sweep` at its default cap, which evicts the oldest-written rows first. Nothing waits
 * for it and nothing it does changes a capture's id or why, so a failure is only logged.
 */
function sweepCaptures(): void {
  try {
    void Promise.resolve(capturesSweep()).catch((error: unknown) =>
      console.error(`[athena] captures sweep: ${error instanceof Error ? error.message : String(error)}`),
    );
  } catch (error) {
    console.error(`[athena] captures sweep: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The capture of a tab, taken through the shell's `page_screenshot` hand just before a request
 * (README 3.5, ADR 0066). Never throws and never waits past {@link CAPTURE_MS}: a request must go
 * with or without a picture, and `why` is where the card reads what happened.
 */
export async function takeCapture(
  tabId: number,
  origin: string,
  limitMs: number = CAPTURE_MS,
): Promise<Taken> {
  if (!hasShell()) return { id: null, why: "this window has no shell to take one" };
  if (!/^https?:\/\//.test(origin)) return { id: null, why: "the focused tab is not a web page" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Taken>((resolve) => {
    timer = setTimeout(
      () => resolve({ id: null, why: `the screenshot took longer than ${limitMs / 1000} seconds` }),
      limitMs,
    );
  });
  const taken = (async (): Promise<Taken> => {
    try {
      const reply = await call<HandReply>("hands_call", { tab_id: tabId, name: SCREENSHOT, input: {} });
      if (reply.ok && reply.capture_id) {
        // A row was filed, so the table grew; a capture that came after the deadline filed one too.
        // A capture that failed, or never had a shell, filed none and sweeps nothing.
        sweepCaptures();
        return { id: reply.capture_id, why: null };
      }
      return { id: null, why: reply.error || reply.reason || "the screenshot hand answered with no capture" };
    } catch (error) {
      return { id: null, why: `the screenshot failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  })();
  try {
    return await Promise.race([taken, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The one hand the shell answers (`hands.rs` `SCREENSHOT`). */
const SCREENSHOT = "page_screenshot";

/** Fetch the list once. It is static, so a second call asks nothing. The first call also sweeps `captures`. A failure leaves it empty. */
export async function startHands(): Promise<void> {
  if (!hasShell()) return;
  // Once per window, so a table that is already over its cap is trimmed (README 3.5).
  if (!swept) {
    swept = true;
    sweepCaptures();
  }
  if (hands.length > 0) return;
  try {
    hands = await call<BridgeTool[]>("hands_list");
  } catch {
    hands = [];
  }
}

/**
 * A page's tools followed by the hands it did not register under the same name. A page tool that
 * shares a hand's name keeps the page's: it is the one the page's author meant (ADR 0065).
 */
export function withHands(pageTools: readonly BridgeTool[]): BridgeTool[] {
  const named = new Set(pageTools.map((t) => t.name));
  return [...pageTools.map(unmarked), ...hands.filter((h) => !named.has(h.name)).map(marked)];
}

/** Is this bare name a hand the page did not register itself? */
export function isHandCall(name: string, pageTools: readonly BridgeTool[]): boolean {
  return hands.some((h) => h.name === name) && !pageTools.some((t) => t.name === name);
}

/**
 * Run one call on a tab: a hand goes to the shell's `hands_call`, anything else to the page
 * through the relay. A hand's answer carries tier 2, which is where it happened.
 */
export async function callOnPage(
  tabId: number,
  name: string,
  input: Record<string, unknown>,
  pageTools: readonly BridgeTool[],
): Promise<{ ok: boolean; output: string; error?: string | null; tier?: number }> {
  if (isHandCall(name, pageTools)) {
    const reply = await call<HandReply>("hands_call", { tab_id: tabId, name, input: input as Args });
    return { ok: reply.ok, output: reply.output, error: reply.error, tier: 2 };
  }
  // The gate already allowed this call, so the parameters are the row's. `Args` is the IPC's own
  // wire type and the cast is the one place a gate-approved object meets it.
  const reply: CallReply = await bridgeCall(tabId, name, input as Args);
  return reply as { ok: boolean; output: string; error?: string | null };
}

/** What a ref still names on its page, as the page describes it: its role and its label. */
export interface Target {
  role: string;
  label: string;
}

/** The form `hands.js` mints a ref in: `ref_<generation>_<hex>`. */
const REF = /^ref_\d+_[0-9a-f]+$/;

/** The parameter values of a card that are refs, in parameter order, each once. */
export function refsOf(params: Readonly<Record<string, unknown>>): string[] {
  const found = Object.values(params).filter((v): v is string => typeof v === "string" && REF.test(v));
  return [...new Set(found)];
}

/**
 * What each ref still names on a tab, through the shell's `hands_describe` (ADR 0099). Not a hand:
 * no manifest offers it and a model cannot call it; the panel asks it for its card. Throws, with
 * the reason, when there is no shell or the page could not be asked, so the card can say so.
 */
export async function describeRefs(tabId: number, refs: readonly string[]): Promise<Record<string, Target>> {
  if (!hasShell()) throw new Error("this window has no shell to ask the page");
  const reply = await call<{ ok: boolean; targets: Record<string, Target>; error: string | null }>(
    "hands_describe",
    { tab_id: tabId, refs: [...refs] },
  );
  if (!reply.ok) throw new Error(reply.error || "the page did not describe its refs");
  return reply.targets ?? {};
}

/**
 * Where a call happens (README 3.4): 1 a page's own tool, 2 a generic hand, 3 a connector. A tool
 * row the panel already holds answers first, since the daemon's catalog reported it; otherwise a
 * connector origin is 3, and a hand's name on a host origin is 2 unless the page registered that
 * name itself (`pageTools`), whose own tool wins (ADR 0065). Says where, never whether it is gated.
 */
export function tierOf(
  origin: string,
  action: string,
  rows: readonly { name: string; tier: number }[] = [],
  pageTools: readonly BridgeTool[] = [],
): 1 | 2 | 3 {
  const row = rows.find((r) => r.name === action);
  if (row && (row.tier === 1 || row.tier === 2 || row.tier === 3)) return row.tier;
  if (origin.startsWith("connector:")) return 3;
  const parts = action.split(".");
  const bare = parts.length > 2 ? parts.slice(2).join(".") : action;
  return origin.startsWith("host:") && isHandCall(bare, pageTools) ? 2 : 1;
}
