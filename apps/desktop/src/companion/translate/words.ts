/**
 * The translator's vocabulary - data, not sentences (the contest's `translator.js`, athena-mini-window).
 *
 * Every plain sentence her window shows for a tool call is composed from parts found in the call:
 * the tool's verb and object, counts, names, sums. Nothing here is written per tool; a tool these
 * tables have never seen still reads as a humanised verb and object.
 */

/** A value as JSON carries it. The one door that makes one is `readJson` in `payload.ts`. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

const BRANDS: Readonly<Record<string, string>> = { tidycrm: "TidyCRM", gmail: "Gmail", ledgerbox: "Ledgerbox", hirelane: "Hirelane" };
const IRREGULAR_PAST: Readonly<Record<string, string>> = {
  read: "read",
  send: "sent",
  make: "made",
  find: "found",
  get: "got",
  set: "set",
  run: "ran",
  write: "wrote",
  show: "showed",
  put: "put",
  pay: "paid",
  hold: "held",
  build: "built",
};
export const READ_VERBS: ReadonlySet<string> = new Set(["read", "list", "get", "find", "search", "recall", "fetch", "show", "open", "check", "look"]);
/**
 * Verbs whose decision sentence names a recipient ("will receive"). Only the sentence's shape: whether
 * it can be taken back is the tool's declared flags (ADR 0189), never a verb list.
 */
export const OUTBOUND: ReadonlySet<string> = new Set(["send", "post", "publish", "share", "email", "reply", "forward", "submit", "invite"]);
/** Verbs that take their object bare: "void invoice INV-109", not "void an invoice". */
export const DIRECT: ReadonlySet<string> = new Set(["void", "delete", "remove", "cancel", "archive", "close", "mark", "reject", "revoke"]);
const LEXICON: Readonly<Record<string, string>> = { mail: "email" };
/**
 * Her own tools whose names are not `verb_object` (`src/athena/core/catalog.py`), as a verb and an
 * object: without them `core.tasks` read "Tasksed 1 memory" and `core.task_stop` "Tasked a stop".
 */
export const CORE_WORDS: Readonly<Record<string, readonly [verb: string, object: string]>> = {
  checkpoint: ["save", "note"],
  delegate: ["delegate", "task"],
  tasks: ["list", "tasks"],
  task_stop: ["stop", "task"],
  devices: ["list", "devices"],
};
/** An id's prefix names the thing; only a naming aid, an unknown prefix falls back to the tool's noun. */
export const PREFIX_NOUN: Readonly<Record<string, string>> = { inv: "invoice", cand: "candidate", acc: "account", act: "activity", tsk: "task", apr: "decision", draft: "draft", msg: "message" };
export const MONEY_KEY = /^(amount|balance|invoiced|collected|outstanding|overdue|paid|total|price|cost|revenue|spent|budget|due)$/;
export const AGE_KEY = /^days_/;
export const NAME_KEYS = ["client", "name", "title", "subject", "number", "label", "id"] as const;
export const NOTE_KEY = /^(dispute|note|notes|warning|reason|comment|issue)$/;
export const SKIP_KEY = /^(id|ok|message|filter|screen|page|pages|showing|of|truncated|chars)$/;

export const isObj = (v: Json | undefined): v is JsonObject => v !== null && typeof v === "object" && !Array.isArray(v);
export const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
export const lower1 = (s: string): string => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
export const plural = (n: number, w: string): string =>
  n === 1 ? w : /(s|x|ch|sh)$/.test(w) ? w + "es" : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + "ies" : w + "s";
export const singular = (w: string): string =>
  /ies$/.test(w) ? w.slice(0, -3) + "y" : /(ses|xes|ches|shes)$/.test(w) ? w.slice(0, -2) : /[^s]s$/.test(w) ? w.slice(0, -1) : w;
export const article = (w: string): string => (/^[aeiou]/i.test(w) ? "an" : "a");
export const humanKey = (k: string): string => k.replace(/_at$/, " date").replace(/_/g, " ").trim();
export const brand = (app: string): string => (app ? (BRANDS[app] ?? cap(app)) : "");

export function money(n: number): string {
  const a = Math.abs(n);
  const s = Number.isInteger(a)
    ? a.toLocaleString("en-US")
    : a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? "-$" : "$") + s;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

export function dateText(s: string): string {
  const t = ISO_TIME.exec(s);
  if (t) return `${Number(t[3])} ${MONTHS[Number(t[2]) - 1]}, ${t[4]}:${t[5]}`;
  const d = ISO_DAY.exec(s);
  return d ? `${Number(d[3])} ${MONTHS[Number(d[2]) - 1]}` : s;
}

/** `HH:MM` out of any stamp, or "". */
export function clock(s: string | undefined): string {
  const m = /(\d{2}:\d{2})(:\d{2})?/.exec(s ?? "");
  return m ? m[1]! : "";
}

export function past(v: string): string {
  const irregular = IRREGULAR_PAST[v];
  if (irregular) return cap(irregular);
  if (/e$/.test(v)) return cap(v + "d");
  if (/[^aeiou]y$/.test(v)) return cap(v.slice(0, -1) + "ied");
  if (/^[^aeiou]*[aeiou][bdglmnprt]$/.test(v) && v.length <= 4) return cap(v + v.slice(-1) + "ed");
  return cap(v + "ed");
}

export function gerund(v: string): string {
  if (/ie$/.test(v)) return cap(v.slice(0, -2) + "ying");
  if (/[^aeiou]e$/.test(v)) return cap(v.slice(0, -1) + "ing");
  if (/^[^aeiou]*[aeiou][bdglmnprt]$/.test(v) && v.length <= 4) return cap(v + v.slice(-1) + "ing");
  return cap(v + "ing");
}

/** Where a tool name says the call happens. */
export type ToolSource = "host" | "connector" | "tabs" | "core";

export interface ToolName {
  source: ToolSource;
  app: string;
  verb: string;
  object: string;
  name: string;
}

const SOURCES: readonly ToolSource[] = ["host", "connector", "tabs", "core"];

/** `host.ledgerbox.read_inbox` -> `{ source: host, app: ledgerbox, verb: read, object: inbox }`. */
export function parseTool(name: string): ToolName {
  const parts = name.split(".");
  const head = parts[0] ?? "";
  const source: ToolSource = (SOURCES as readonly string[]).includes(head) ? (head as ToolSource) : "host";
  const scoped = source === "host" || source === "connector";
  const app = scoped ? (parts[1] ?? "") : "";
  const leaf = (scoped ? parts.slice(2).join("_") : parts.slice(1).join("_")) || parts[parts.length - 1] || "";
  const words = leaf.split("_").filter(Boolean);
  const core = source === "core" ? CORE_WORDS[leaf] : undefined;
  if (core) return { source, app, verb: core[0], object: core[1], name };
  const verb = (words[0] ?? "run").toLowerCase();
  let object = words.slice(1).join(" ");
  if (!object) object = source === "tabs" ? "tab" : source === "core" ? "memory" : "";
  object = LEXICON[object] ?? object;
  return { source, app, verb, object, name };
}

/** `inv_118` -> `INV-118`; anything else passes through. */
export function tidyId(v: string): string {
  return /^[a-z]+_\d+$/.test(v) ? v.replace("_", "-").toUpperCase() : v;
}

export function objectPhrase(t: ToolName, withArticle: boolean): string {
  const o = t.object;
  if (!o) return "";
  if (!withArticle || DIRECT.has(t.verb)) return o;
  if (READ_VERBS.has(t.verb)) return "the " + o;
  return article(o) + " " + o;
}

export function appSuffix(t: ToolName): string {
  if (t.source === "tabs" || t.source === "core") return "";
  return t.app ? " in " + brand(t.app) : "";
}

/** Where she reached: her own memory, the app's own tool, the page, another tab, an account. */
export type Lane = "memory" | "app" | "page" | "tab" | "account";

export function laneOf(t: ToolName, tier: number | undefined): { lane: Lane; where: string } {
  if (t.source === "tabs") return { lane: "tab", where: "Read from another tab" };
  if (t.source === "connector") return { lane: "account", where: `Through your ${brand(t.app)} account` };
  if (t.source === "core") return { lane: "memory", where: "From her own memory" };
  if (tier === 2) return { lane: "page", where: "Through the page you have open" };
  return { lane: "app", where: `${brand(t.app)}'s own tool` };
}
