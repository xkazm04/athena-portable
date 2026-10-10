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
import { call, hasShell, type Args } from "@/lib/ipc";

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

/** Test seam: set the list without a shell. */
export function setHandsForTests(next: readonly BridgeTool[]): void {
  hands = next;
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
      if (reply.ok && reply.capture_id) return { id: reply.capture_id, why: null };
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

/** Fetch the list once. It is static, so a second call asks nothing. A failure leaves it empty. */
export async function startHands(): Promise<void> {
  if (!hasShell() || hands.length > 0) return;
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
