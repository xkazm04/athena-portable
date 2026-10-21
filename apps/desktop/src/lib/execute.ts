/**
 * The host-call executor's rules — ADR 0101, as the window's and not one store's.
 *
 * Two stores run a host call on the page: the panel's run loop (`stores/run.ts`) and push-to-talk
 * (`stores/voice.ts`). What a call's answer *means* is decided here, once, for both:
 *
 * - a `timeout` on anything but a read is `outcome_unknown`: the call was sent and never answered,
 *   so it may have run ({@link readTimeout}, {@link settleHostCall});
 * - such a tool is remembered as unsure ({@link rememberUnsure}), added to `gated_tools` on every
 *   request either store sends ({@link withUnsure}), and refused locally if a proposal of it
 *   reaches the page before the gate heard ({@link heldBefore});
 * - a card about it, answered either way, lifts the hold ({@link forgetUnsure}).
 *
 * No I/O except the `localStorage` mirror of the unsure set: the stores do the calling, the
 * pushing and the sending, and ask this module what the answer was. The unsure set is module
 * state on purpose. It is the window's: a tool a typed turn left unsure is held for a spoken one.
 */
import { flagsOf } from "@athena/bridge/gate";

import type { BridgeTool } from "@/lib/bridge";
import { handTools, isHandCall } from "@/lib/hands";

/** What a page (or a hand) answered one call with. `reason` is the closed-set code, when it gave one. */
export interface PageAnswer {
  ok: boolean;
  output: string;
  error?: string | null;
  reason?: string | null;
  tier?: number;
  /** The tab a `tabs_read` read, as the shell reports it (ADR 0105). */
  sourceTab?: number | null;
}

/** What a call's answer came to, as the record and the daemon are told it. */
export interface HostCallOutcome {
  /** `outcome_unknown` for a write that timed out, `timeout` for a read, else `null`. */
  timeout: "timeout" | "outcome_unknown" | null;
  /** The result row's error: the page's own, or the timeout reason with its detail. */
  error: string | null;
  /** What the transcript says after the arrow. */
  line: string;
}

/** A local refusal of a call before it reaches the page. */
export interface Held {
  error: string;
  line: string;
}

/**
 * Is this call a read? Only a tool whose flags say reversible *and* no side effects (README 3.3).
 * The flags read are those of the tool the call runs, chosen by {@link isHandCall} as `callOnPage`
 * chooses it: the page's own tool wins over a hand of the same name (ADR 0065), except `tabs_read`,
 * which always runs the shell's hand (ADR 0105). A tool nobody describes is not a read, so its
 * timeout counts as "may have run".
 */
export function isReadCall(bare: string, pageTools: readonly BridgeTool[]): boolean {
  const runs = isHandCall(bare, pageTools) ? handTools() : pageTools;
  const tool = runs.find((t) => t.name === bare);
  if (!tool) return false;
  const flags = flagsOf(tool);
  return flags.reversible === true && flags.side_effects === "none";
}

/**
 * The reason a call's answer carries, for the record. A `timeout` on anything but a read is
 * `outcome_unknown`: the call was sent and never answered, so it may have run (ADR 0101). A hung
 * read is still a plain `timeout`. `null` for an answer that is not a timeout.
 */
export function readTimeout(answer: PageAnswer, read: boolean): "timeout" | "outcome_unknown" | null {
  if (answer.ok) return null;
  const timedOut = answer.reason === "timeout" || answer.error === "timeout";
  if (!timedOut) return null;
  return read ? "timeout" : "outcome_unknown";
}

/**
 * What one answer of `name` (the registry name) came to, read against the tools the call was
 * routed by. Pure: the caller remembers an `outcome_unknown` with {@link rememberUnsure}.
 */
export function settleHostCall(name: string, answer: PageAnswer, listing: readonly BridgeTool[]): HostCallOutcome {
  const timeout = readTimeout(answer, isReadCall(bareName(name), listing));
  let error = answer.error ?? null;
  if (timeout !== null) {
    const detail = answer.error && answer.error !== "timeout" ? answer.error : "no answer before the deadline";
    error = `${timeout}: ${detail}`;
  }
  const line = answer.ok
    ? answer.output
    : timeout === "outcome_unknown"
      ? "may have completed: no answer before the deadline"
      : (error ?? "failed");
  return { timeout, error, line };
}

/**
 * The hold (ADR 0101): a call of a tool whose last run never answered waits for the user's answer
 * before it runs again. The gate is told on every request; this is the same rule one step later,
 * for a call proposed before the gate heard. An approved call is the user's answer, so never held.
 */
export function heldBefore(name: string, approved: boolean): Held | null {
  if (approved || !isUnsure(name)) return null;
  return {
    error: `outcome_unknown: ${name} may already have run; it waits for the user's answer before it runs again`,
    line: "held: it may already have run",
  };
}

/** `host.<app_id>.<tool>` is the catalog's name; the page registered the last segment. */
function bareName(name: string): string {
  const parts = name.split(".");
  return parts.length > 2 ? parts.slice(2).join(".") : name;
}

// -- the unsure set: the window's ----------------------------------------------------------------

/** A tool whose last call never answered, by web origin and registry name (ADR 0101). */
export interface Unsure {
  origin: string;
  tool: string;
  at: string;
}

/** How many unanswered calls are remembered. Oldest goes first. */
export const UNSURE_CAP = 32;
const UNSURE_KEY = "athena.run.unsure";

/**
 * The tools gated again because a call of theirs may have run: kept until a card for the tool is
 * answered. Bounded, in memory, and mirrored to `localStorage` when there is one, so a reload does
 * not forget a send that may have gone out. A storage that throws only costs the mirror.
 */
const unsure = new Map<string, Unsure>(readUnsure());

function readUnsure(): Array<[string, Unsure]> {
  try {
    const raw = globalThis.localStorage?.getItem(UNSURE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (u): u is Unsure =>
          typeof u === "object" && u !== null && typeof (u as Unsure).tool === "string" && typeof (u as Unsure).origin === "string",
      )
      .slice(-UNSURE_CAP)
      .map((u) => [`${u.origin}|${u.tool}`, { origin: u.origin, tool: u.tool, at: String(u.at ?? "") }]);
  } catch {
    return [];
  }
}

function writeUnsure(): void {
  try {
    globalThis.localStorage?.setItem(UNSURE_KEY, JSON.stringify([...unsure.values()]));
  } catch {
    // The mirror is a convenience; the map is the truth for this window.
  }
}

/** A call of this tool timed out and may have run: hold it until a card about it is answered. */
export function rememberUnsure(entry: Unsure): void {
  const key = `${entry.origin}|${entry.tool}`;
  unsure.delete(key);
  unsure.set(key, entry);
  while (unsure.size > UNSURE_CAP) {
    const oldest = unsure.keys().next().value;
    if (oldest === undefined) break;
    unsure.delete(oldest);
  }
  writeUnsure();
}

function isUnsure(tool: string): boolean {
  return [...unsure.values()].some((u) => u.tool === tool);
}

/** A card for the tool was answered, approved or declined: the user has had their say. */
export function forgetUnsure(tool: string): void {
  let changed = false;
  for (const [key, entry] of unsure) {
    if (entry.tool === tool) {
      unsure.delete(key);
      changed = true;
    }
  }
  if (changed) writeUnsure();
}

/** What is unsure now, oldest first. For the panel and the tests. */
export function unsureTools(): Unsure[] {
  return [...unsure.values()];
}

/** The two lists a request tightens the gate with (`GatedLists` in `stores/run.ts`, ADR 0063). */
interface Tightened {
  gated_origins: string[];
  gated_tools: string[];
}

/** The gate's lists with every unsure tool added to `gated_tools`. Only ever tightens. */
export function withUnsure(gated: Tightened): Tightened {
  if (unsure.size === 0) return gated;
  const tools = new Set([...gated.gated_tools, ...[...unsure.values()].map((u) => u.tool)]);
  return { gated_origins: gated.gated_origins, gated_tools: [...tools].sort() };
}

/** Test seam: forget every unsure tool, mirror included. */
export function clearUnsureForTests(): void {
  unsure.clear();
  writeUnsure();
}
