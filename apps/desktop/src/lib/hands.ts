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
}

let hands: readonly BridgeTool[] = [];

/** The hands, as the shell shaped them like a page's tools. Empty until {@link startHands} ran. */
export function handTools(): readonly BridgeTool[] {
  return hands;
}

/** Test seam: set the list without a shell. */
export function setHandsForTests(next: readonly BridgeTool[]): void {
  hands = next;
}

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
  return [...pageTools, ...hands.filter((h) => !named.has(h.name))];
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
