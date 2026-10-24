/**
 * The one WebMCP execute door's pure parts: validate against the published schema, run the
 * handler under the caller's abort and the door's own ceiling, and cap the result text.
 *
 * mcp-tools/tool-schema-design: the schema `useWebMCPTool` publishes is the schema enforced
 * here (one artifact), validation runs at dispatch and reports every mismatch by path, and a
 * result is bounded. `runToolOutcome` says what a call came to; a registered tool REJECTS a
 * refusal or a fault so the bridge replies `ok: false` (ADR 0146), while `runTool` keeps the
 * in-band text for direct callers.
 */

/** Longest result text a tool hands back, in characters. */
export const MAX_RESULT_CHARS = 16_384;

type Schema = {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  /** Published by `parametersToJsonSchema` on every capped array, so it is enforced here too. */
  maxItems?: number;
};

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** One mismatch between an argument and the published schema, addressed by its path. */
export interface ArgumentError {
  /** `stage`, `row.x`, `rows[0].z`; empty for the arguments object itself. */
  path: string;
  /** `type`, `enum`, `maxItems`, `required` or `unknown`. */
  code: "type" | "enum" | "maxItems" | "required" | "unknown";
  /** The sentence an agent reads, naming the argument and what is allowed. */
  message: string;
}

function check(value: unknown, schema: Schema, path: string, out: ArgumentError[]): void {
  const t = typeOf(value);
  if (schema.type && schema.type !== t) {
    out.push({ path, code: "type", message: `argument "${path}" must be ${schema.type}, got ${t}` });
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    out.push({
      path,
      code: "enum",
      message: `argument "${path}" must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}, got ${JSON.stringify(value)}`,
    });
    return;
  }
  if (t === "array" && Number.isInteger(schema.maxItems) && (value as unknown[]).length > schema.maxItems!) {
    out.push({
      path,
      code: "maxItems",
      message: `argument "${path}" has ${(value as unknown[]).length} items; at most ${schema.maxItems} allowed`,
    });
    return;
  }
  if (t === "array" && schema.items) {
    for (let i = 0; i < (value as unknown[]).length; i++) {
      check((value as unknown[])[i], schema.items, `${path}[${i}]`, out);
    }
  }
  if (t === "object" && schema.properties) {
    checkObject(value as Record<string, unknown>, schema, path, out);
  }
}

function checkObject(obj: Record<string, unknown>, schema: Schema, prefix: string, out: ArgumentError[]): void {
  const props = schema.properties ?? {};
  const at = (k: string) => (prefix ? `${prefix}.${k}` : k);
  for (const k of schema.required ?? []) {
    if (obj[k] === undefined) out.push({ path: at(k), code: "required", message: `missing required argument "${at(k)}"` });
  }
  for (const k of Object.keys(obj)) {
    if (!(k in props)) {
      out.push({
        path: at(k),
        code: "unknown",
        message: `unknown argument "${at(k)}"; allowed: ${Object.keys(props).join(", ") || "(none)"}`,
      });
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || !(k in props)) continue;
    check(v, props[k] ?? {}, at(k), out);
  }
}

/**
 * Every mismatch between `params` and `schema`, in the order the door reads them (required,
 * unknown, then each value, depth first); empty when the call is well formed.
 */
export function argumentErrors(params: unknown, schema: unknown): ArgumentError[] {
  if (typeOf(params) !== "object") {
    return [{ path: "", code: "type", message: `arguments must be an object, got ${typeOf(params)}` }];
  }
  const out: ArgumentError[] = [];
  checkObject(params as Record<string, unknown>, schema as Schema, "", out);
  return out;
}

/** `null` when `params` satisfies `schema`, else a message naming the first argument and what is allowed. */
export function validateArgs(params: unknown, schema: unknown): string | null {
  return argumentErrors(params, schema)[0]?.message ?? null;
}

export function toolError(message: string): string {
  return JSON.stringify({ ok: false, error: message });
}

export function asText(result: unknown, max = MAX_RESULT_CHARS): string {
  let text: string;
  if (result === undefined || result === null) text = "ok";
  else text = typeof result === "string" ? result : (JSON.stringify(result) ?? String(result));
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated: showing ${max} of ${text.length} characters]`;
}

/**
 * The longest head of a list whose answer `asText` passes whole, built by `envelope`.
 *
 * `asText` cuts any result past `max` and appends a notice, which is right for prose and fatal for
 * JSON: the cut answer no longer parses, so a caller that asked for a page of rows gets a string,
 * and the `(showing N of M)` it was promised goes with the tail. A tool that answers a list sizes
 * its page here instead, so the count its envelope reports is the count it carries and what did
 * not fit is the difference, as for any other cut. When not even one item fits, the envelope comes
 * back empty and still says how many there were.
 */
export function fitted<E>(count: number, envelope: (kept: number) => E, max = MAX_RESULT_CHARS): E {
  const fits = (n: number): boolean => asText(envelope(n), Number.POSITIVE_INFINITY).length <= max;
  let lo = 0;
  let hi = Math.max(0, Math.floor(count));
  if (fits(hi)) return envelope(hi);
  // `lo` fits (or is 0) and `hi` does not: an envelope only grows with what it carries.
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return envelope(lo);
}

/** What the door hands a handler beside its arguments: the caller's abort, when it sent one. */
export interface ToolContext {
  signal?: AbortSignal;
}

/**
 * The door's own ceiling on one call, in milliseconds. Timeouts are door policy: a caller that
 * sent no signal (a native browser agent, a test) still gets an answer. It is longer than the
 * bridge's 30 s deadline, so under the bridge the bridge's abort is what stops a call.
 */
export const DOOR_CEILING_MS = 60_000;

/** The reasons the door mints, each a member of the bridge's page-mintable set (protocol.md). */
export type RefusalReason = "validator_failed" | "timeout" | "cancelled";

/**
 * What one call through the door came to. A refusal is the door's (the call never ran, or the
 * door stopped waiting); a failure is the handler's own fault; anything the handler RETURNED is
 * `ok`, including a domain answer that says `{ ok: false }`: a domain answer is an answer.
 */
export type ToolOutcome =
  | { kind: "ok"; text: string }
  | { kind: "refused"; reason: RefusalReason; message: string; errors: ArgumentError[] }
  | { kind: "failed"; message: string };

/**
 * The rejection a registered `execute` raises for a refusal. inject.js forwards `reason` (it is
 * page-mintable) and `errors`, so the surface reads `{ ok: false, reason, error, errors }`.
 */
export class ToolRefusal extends Error {
  readonly reason: RefusalReason;
  readonly errors: ArgumentError[];
  constructor(reason: RefusalReason, message: string, errors: ArgumentError[] = []) {
    super(message);
    this.name = "ToolRefusal";
    this.reason = reason;
    this.errors = errors;
  }
}

export interface DoorOptions {
  /** Override the door's ceiling; tests inject a short one. */
  ceilingMs?: number;
}

/**
 * The execute door: validate, run, catch, cap, bound in time. Never throws; says what happened.
 *
 * The caller's `signal` is forwarded to the handler, so a handler that can stop does, and the
 * door stops waiting when it aborts (`cancelled`, ADR 0101). With or without a signal the door
 * stops at its own ceiling (`timeout`). A handler that ignores both may still finish; the bridge
 * reports that as a `late` answer, not as a fresh call.
 */
export async function runToolOutcome(
  schema: unknown,
  params: Record<string, unknown> | undefined,
  handler: (args: Record<string, unknown>, context: ToolContext) => unknown | Promise<unknown>,
  signal?: AbortSignal,
  options: DoorOptions = {},
): Promise<ToolOutcome> {
  const args = params ?? {};
  const errors = argumentErrors(args, schema);
  if (errors.length > 0) {
    return { kind: "refused", reason: "validator_failed", message: errors.map((e) => e.message).join("; "), errors };
  }
  if (signal?.aborted) return { kind: "refused", reason: "cancelled", message: "aborted before it ran", errors: [] };
  const ceilingMs = options.ceilingMs ?? DOOR_CEILING_MS;
  let stop: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<ToolOutcome>((resolve) => {
    timer = setTimeout(
      () => resolve({ kind: "refused", reason: "timeout", message: `did not answer within ${ceilingMs} ms`, errors: [] }),
      ceilingMs,
    );
    if (!signal) return;
    stop = () =>
      resolve({ kind: "refused", reason: "cancelled", message: "aborted: the caller stopped waiting", errors: [] });
    signal.addEventListener("abort", stop, { once: true });
  });
  const ran = (async (): Promise<ToolOutcome> => {
    try {
      return { kind: "ok", text: asText(await handler(args, { signal })) };
    } catch (e) {
      // The agent gets the sentence; the page's developer gets the stack, or nothing in devtools
      // says which handler broke (a refused argument is the caller's, and is not logged).
      console.error("WebMCP tool handler threw:", e);
      return { kind: "failed", message: `tool failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  })();
  try {
    return await Promise.race([ran, stopped]);
  } finally {
    clearTimeout(timer);
    if (stop) signal?.removeEventListener("abort", stop);
  }
}

/**
 * The door as text, for a caller that reads one string (ledgerbox's and tidycrm's handler
 * tests): a refusal or a fault is the in-band `{"ok":false,"error":...}`. A registered tool
 * goes through `toolDescriptorFor` (hooks.ts) instead, which rejects them (ADR 0146).
 */
export async function runTool(
  schema: unknown,
  params: Record<string, unknown> | undefined,
  handler: (args: Record<string, unknown>, context: ToolContext) => unknown | Promise<unknown>,
  signal?: AbortSignal,
  options?: DoorOptions,
): Promise<string> {
  const outcome = await runToolOutcome(schema, params, handler, signal, options);
  return outcome.kind === "ok" ? outcome.text : toolError(outcome.message);
}

/** A refusal rejects a `ToolRefusal`; a fault rejects a plain `Error` with no reason; an answer resolves. */
export function settleOutcome(outcome: ToolOutcome): string {
  if (outcome.kind === "ok") return outcome.text;
  if (outcome.kind === "refused") throw new ToolRefusal(outcome.reason, outcome.message, outcome.errors);
  throw new Error(outcome.message);
}
