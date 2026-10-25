/**
 * What only the Accounts depth reads of the Connectors module — README section 4; ADR 0144 and 0166.
 *
 * A separate file from `model.ts` on purpose: `model.ts` is in the first frame (the surface and
 * the store read it), so everything in it ships before the first paint, used or not. Only the
 * depth's own lazy chunk imports this file, so none of what is here does.
 *
 * The MCP servers as accounts.
 * Since ADR 0144 a server written into `mcp.json` is a connector: its `AUTO` tools run without a
 * card from the first turn, and `GET /connectors` lists it under `mcp_servers`. This reads that
 * list into rows the Accounts depth draws beside the vault's: the same standing vocabulary
 * (`Standing`), from the server's own facts. A tool's class is the one the daemon reported, never
 * a classify here, so no second policy is born (README invariant 3).
 *
 * The store mirrors `mcp_servers` unparsed, and the parse happens here.
 */
import type { McpServerView, McpToolView } from "@/lib/api";
import type { Tone } from "@/components/StatusDot";

import { labelOfId, type Standing } from "./model";

/**
 * One MCP server as an account. Nothing on it can be switched: the stop is the configuration, and
 * `stop` says so in words, because no vault writes switch or allow-list applies (ADR 0144).
 */
export interface ServerRow {
  id: string;
  label: string;
  url: string;
  /** The token variable's name, never its value. */
  tokenEnv: string;
  tokenSet: boolean;
  standing: Standing;
  word: string;
  sentence: string;
  tone: Tone;
  /** The health detail, verbatim, or "". */
  detail: string;
  /** Bare tool names (`gt_read`) the gate runs without a card: the daemon's `AUTO` and `READ`. */
  unattended: readonly string[];
  /** Bare tool names the daemon classed `GATED`: each call is a card. */
  gated: readonly string[];
  /** How a person stops it, since no switch here can. */
  stop: string;
}

const HEALTH: readonly string[] = ["healthy", "broken", "unknown"];
const CLASSES: readonly string[] = ["AUTO", "READ", "GATED"];
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * The `mcp_servers` of a list, parsed. A foreign shape is never trusted and never fatal: anything
 * but a list reads as no servers, an entry with no id is dropped, a health outside the three words
 * reads "unknown", tools that are not a list read as none, and a tool whose class is not one of
 * the daemon's reads `GATED`, so nothing unknown is ever shown as running without a card.
 */
export function serversOf(raw: unknown): McpServerView[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s: unknown): McpServerView[] => {
    if (!isRecord(s) || !text(s.id)) return [];
    const tools: McpToolView[] = (Array.isArray(s.tools) ? s.tools : []).flatMap((t: unknown) =>
      isRecord(t) && text(t.name)
        ? [{ name: text(t.name), class: (CLASSES.includes(text(t.class)) ? t.class : "GATED") as McpToolView["class"] }]
        : [],
    );
    return [
      {
        id: text(s.id),
        origin: text(s.origin),
        kind: "mcp",
        url: text(s.url),
        token_env: text(s.token_env),
        token_set: s.token_set === true,
        live: s.live === true,
        health: (HEALTH.includes(text(s.health)) ? s.health : "unknown") as McpServerView["health"],
        health_detail: text(s.health_detail),
        tools,
      },
    ];
  });
}

type Facts = Pick<ServerRow, "standing" | "word" | "sentence" | "tone">;

/** The standing, from what is known in order: no token, a broken last call, an answer, nothing yet. */
function factsOf(view: McpServerView, label: string): Facts {
  if (!view.token_set) {
    const variable = view.token_env || "Its token variable";
    return { standing: "not-connected", word: "not connected", sentence: `${variable} is not set, so nothing runs.`, tone: "neutral" };
  }
  if (view.health === "broken") {
    return {
      standing: "broken",
      word: "broken",
      sentence: view.health_detail || `${label} did not answer its last call.`,
      tone: "error",
    };
  }
  if (view.health === "healthy") {
    return { standing: "connected", word: "connected", sentence: `${label} answered its last call.`, tone: "success" };
  }
  return {
    standing: "connected",
    word: "connected",
    sentence: "Its token is set, and the server is not reached yet.",
    tone: "warning",
  };
}

export function serverRowOf(view: McpServerView): ServerRow {
  const label = labelOfId(view.id);
  const prefix = `connector.${view.id}.`;
  const bare = (name: string) => (name.startsWith(prefix) ? name.slice(prefix.length) : name);
  return {
    id: view.id,
    label,
    url: view.url,
    tokenEnv: view.token_env,
    tokenSet: view.token_set,
    ...factsOf(view, label),
    detail: view.health_detail,
    unattended: view.tools.filter((t) => t.class !== "GATED").map((t) => bare(t.name)),
    gated: view.tools.filter((t) => t.class === "GATED").map((t) => bare(t.name)),
    stop: `No switch here: remove ${view.id} from mcp.json${view.token_env ? ` or unset ${view.token_env}` : ""}, and its tools stop on the next call.`,
  };
}

/** The model's unparsed `servers`, as rows. */
export function serverRowsOf(raw: unknown): ServerRow[] {
  return serversOf(raw).map(serverRowOf);
}

/** The guide as paragraphs: split on blank lines, URLs left as text a person can copy. */
export function paragraphsOf(guide: string): string[] {
  return guide
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}
