/**
 * Raw transcript entry -> plain message (the contest's `translator.js`, athena-mini-window).
 *
 * The run store writes a tool row as `<tool name> → <output>`, where the output is usually a JSON
 * document, and keeps an assistant's text as the engine sent it, `OP: {...}` and `TTS: "..."` lines
 * included. A person never reads either. `translate` is pure: one entry and what the turn has shown
 * so far in, one message out, its detail one level down and the raw text kept for the technical
 * record only.
 */
import type { TranscriptEntry } from "@/stores/run";

import { EMPTY_CONTEXT, composeTool, readJson, type Detail, type TurnContext } from "./payload";
import {
  DIRECT,
  READ_VERBS,
  appSuffix,
  article,
  brand,
  clock,
  gerund,
  isObj,
  laneOf,
  objectPhrase,
  parseTool,
  tidyId,
  type Json,
  type JsonObject,
  type Lane,
} from "./words";

export type { Detail, TurnContext } from "./payload";
export type { Lane } from "./words";
export { EMPTY_CONTEXT } from "./payload";

/** How a message reads: done, failed, held back (declined, not run), or said. */
export type Tone = "ok" | "fail" | "blocked" | "info";

export interface PlainMessage {
  id: string;
  role: "user" | "her" | "step" | "declined";
  tone: Tone;
  title: string;
  sub: string;
  /** `HH:MM`, or "" when the entry carries no time. */
  time: string;
  /** Where she reached, for a step; `null` for words. */
  lane: Lane | null;
  where: string;
  detail: Detail;
  /** The entry's own text, kept for the technical record. */
  raw: string;
  /** The tool a step or a decline was about (`host.ledgerbox.read_inbox`), for automation; "" for words. */
  tool: string;
  /** A failed step the same tool later completed. */
  recovered: boolean;
}

const ARROW = " → ";

/** An assistant's text with its proposals and its spoken lines taken out. */
export function extractOps(text: string): { ops: JsonObject[]; say: string; text: string } {
  const ops: JsonObject[] = [];
  const say: string[] = [];
  const keep: string[] = [];
  for (const line of text.split("\n")) {
    if (/^OP:\s*/.test(line)) {
      const op = readJson(line.replace(/^OP:\s*/, ""));
      if (isObj(op)) ops.push(op);
    } else if (/^TTS:\s*/.test(line)) {
      const m = /^TTS:\s*"?(.*?)"?\s*$/.exec(line);
      if (m) say.push(m[1]!);
    } else keep.push(line);
  }
  return { ops, say: say.join(" "), text: keep.join("\n").trim() };
}

/** People, drafts and proposals the turn has shown, so a later line can name them. */
export function buildContext(entries: readonly TranscriptEntry[]): TurnContext {
  const ctx: TurnContext = { byId: {}, byEmail: {}, drafts: {}, proposals: {} };
  const visit = (v: Json): void => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!isObj(v)) return;
    if (typeof v.id === "string") ctx.byId[v.id] = v;
    const email = typeof v.contact_email === "string" ? v.contact_email : typeof v.email === "string" ? v.email : null;
    if (email) {
      const who = [v.client, v.name, v.contact_name].find((x): x is string => typeof x === "string") ?? email;
      ctx.byEmail[email] = { who, contact: typeof v.contact_name === "string" ? v.contact_name : null };
    }
    if (typeof v.body === "string" && typeof v.to === "string") ctx.drafts[v.to] = v;
    Object.values(v).forEach(visit);
  };
  for (const e of entries) {
    if (e.kind === "tool") {
      const at = e.text.indexOf(ARROW);
      const out = at >= 0 ? readJson(e.text.slice(at + ARROW.length)) : undefined;
      if (out !== undefined) visit(out);
    } else if (e.kind === "assistant") {
      for (const op of extractOps(e.text).ops) if (typeof op.action === "string") ctx.proposals[op.action] = op;
    }
  }
  return ctx;
}

function noun(verb: string, object: string, target: string): string {
  if (!object) return target;
  return DIRECT.has(verb) ? object + (target ? " " + target : "") : object + (target ? " for " + target : "");
}

/** One entry as a person reads it. */
export function translate(entry: TranscriptEntry, ctx: TurnContext = EMPTY_CONTEXT): PlainMessage {
  const base = { id: entry.id, time: clock(entry.at), raw: entry.text, tool: "", recovered: false, lane: null, where: "", sub: "", detail: { kind: "none" } as Detail };
  if (entry.kind === "user") return { ...base, role: "user", tone: "info", title: entry.text };
  if (entry.kind === "assistant") return { ...base, role: "her", tone: "info", title: extractOps(entry.text).text };

  const text = entry.text;
  if (/^declined:\s*/.test(text)) {
    const t = parseTool(text.replace(/^declined:\s*/, ""));
    const params = ctx.proposals[t.name]?.params;
    const target = isObj(params) && typeof params.id === "string" ? tidyId(params.id) : "";
    return {
      ...base,
      ...laneOf(t, 1),
      tool: t.name,
      role: "declined",
      tone: "blocked",
      title: `You declined to ${t.verb} ${noun(t.verb, t.object, target)}`.replace(/\s+/g, " ").trim(),
      sub: "Nothing was changed.",
    };
  }

  const at = text.indexOf(ARROW);
  const t = parseTool(at >= 0 ? text.slice(0, at) : text);
  const out = at >= 0 ? text.slice(at + ARROW.length) : "";
  const step = { ...base, ...laneOf(t, entry.tier), tool: t.name, role: "step" as const };
  if (/^not (run|read):\s*/i.test(out)) {
    const reason = out.replace(/^not (run|read):\s*/i, "");
    return {
      ...step,
      tone: "blocked",
      title: `Did not ${t.verb} ${objectPhrase(t, true)}${appSuffix(t)}`.replace(/\s+/g, " ").trim(),
      sub: `${reason.charAt(0).toUpperCase()}${reason.slice(1)}. Nothing was changed.`,
    };
  }
  const parsed = readJson(out);
  const c = composeTool(t, parsed === undefined ? out : parsed, entry.ok !== false, ctx);
  return { ...step, tone: c.tone, title: c.title, sub: c.sub, detail: c.detail };
}

/** A turn's entries, each translated against what came before, and failed steps that later worked marked. */
export function translateAll(entries: readonly TranscriptEntry[]): PlainMessage[] {
  const ctx = buildContext(entries);
  const out = entries.map((e) => translate(e, ctx));
  const nameOf = (m: PlainMessage) => m.tool;
  return out.map((m, i) =>
    m.role === "step" && m.tone === "fail" && out.slice(i + 1).some((n) => n.role === "step" && n.tone === "ok" && nameOf(n) === nameOf(m))
      ? { ...m, recovered: true }
      : m,
  );
}

/** The line while a call runs: "Reading the inbox in Ledgerbox". */
export function describeRunning(action: string, params: Readonly<Record<string, unknown>> = {}): string {
  const t = parseTool(action);
  const target = typeof params.id === "string" ? " " + tidyId(params.id) : "";
  const obj = t.object
    ? READ_VERBS.has(t.verb)
      ? "the " + t.object
      : target || DIRECT.has(t.verb)
        ? t.object
        : article(t.object) + " " + t.object
    : "";
  return `${gerund(t.verb)} ${obj}${target}${appSuffix(t)}`.replace(/\s+/g, " ").trim();
}

/** A tool row's raw text with its JSON laid out, for the technical record. */
export function prettyRaw(text: string): string {
  const at = text.indexOf(ARROW);
  if (at < 0) return text;
  const j = readJson(text.slice(at + ARROW.length));
  return j === undefined ? text : `${text.slice(0, at)} →\n${JSON.stringify(j, null, 2)}`;
}

/** The app a tool name belongs to, named for a person. */
export const appOfTool = (name: string): string => brand(parseTool(name).app);
