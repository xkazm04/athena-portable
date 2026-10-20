/**
 * The one WebMCP execute door's pure parts: validate against the published schema, turn a
 * handler fault into an in-band error, and cap the result text.
 *
 * mcp-tools/tool-schema-design: the schema `useWebMCPTool` publishes is the schema enforced
 * here (one artifact), validation runs at dispatch, a rejected call and a handler fault come
 * back as readable tool results rather than throws, and a result is bounded.
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

function check(value: unknown, schema: Schema, path: string): string | null {
  const t = typeOf(value);
  if (schema.type && schema.type !== t) return `argument "${path}" must be ${schema.type}, got ${t}`;
  if (schema.enum && !schema.enum.includes(value)) {
    return `argument "${path}" must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}, got ${JSON.stringify(value)}`;
  }
  if (t === "array" && Number.isInteger(schema.maxItems) && (value as unknown[]).length > schema.maxItems!) {
    return `argument "${path}" has ${(value as unknown[]).length} items; at most ${schema.maxItems} allowed`;
  }
  if (t === "array" && schema.items) {
    for (let i = 0; i < (value as unknown[]).length; i++) {
      const err = check((value as unknown[])[i], schema.items, `${path}[${i}]`);
      if (err) return err;
    }
  }
  if (t === "object" && schema.properties) {
    return checkObject(value as Record<string, unknown>, schema, path);
  }
  return null;
}

function checkObject(obj: Record<string, unknown>, schema: Schema, prefix: string): string | null {
  const props = schema.properties ?? {};
  const at = (k: string) => (prefix ? `${prefix}.${k}` : k);
  for (const k of schema.required ?? []) {
    if (obj[k] === undefined) return `missing required argument "${at(k)}"`;
  }
  for (const k of Object.keys(obj)) {
    if (!(k in props)) {
      return `unknown argument "${at(k)}"; allowed: ${Object.keys(props).join(", ") || "(none)"}`;
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const err = check(v, props[k] ?? {}, at(k));
    if (err) return err;
  }
  return null;
}

/** `null` when `params` satisfies `schema`, else a message naming the argument and what is allowed. */
export function validateArgs(params: unknown, schema: unknown): string | null {
  if (typeOf(params) !== "object") return `arguments must be an object, got ${typeOf(params)}`;
  return checkObject(params as Record<string, unknown>, schema as Schema, "");
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
 * The execute door: validate, run, catch, cap. Never throws.
 *
 * The caller's `signal` is forwarded to the handler, so a handler that can stop does, and the
 * door stops waiting when it aborts: a call the caller gave up on answers `aborted` instead of
 * holding the page's promise open with no time limit (ADR 0101). A handler that ignores the
 * signal may still finish; the bridge reports that as a `late` answer, not as a fresh call.
 */
export async function runTool(
  schema: unknown,
  params: Record<string, unknown> | undefined,
  handler: (args: Record<string, unknown>, context: ToolContext) => unknown | Promise<unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const args = params ?? {};
  const bad = validateArgs(args, schema);
  if (bad) return toolError(bad);
  if (signal?.aborted) return toolError("aborted before it ran");
  let stop: (() => void) | undefined;
  const aborted = new Promise<string>((resolve) => {
    if (!signal) return;
    stop = () => resolve(toolError("aborted: the caller stopped waiting"));
    signal.addEventListener("abort", stop, { once: true });
  });
  const ran = (async () => {
    try {
      return asText(await handler(args, { signal }));
    } catch (e) {
      // The agent gets the sentence; the page's developer gets the stack, or nothing in devtools
      // says which handler broke (a refused argument is the caller's, and is not logged).
      console.error("WebMCP tool handler threw:", e);
      return toolError(`tool failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  })();
  try {
    return await Promise.race([ran, aborted]);
  } finally {
    if (stop) signal?.removeEventListener("abort", stop);
  }
}
