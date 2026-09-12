/**
 * `document.modelContext` — the WebMCP surface (W3C draft, July 2026; design 4.4 "WebMCP bridge").
 *
 * The shape this file targets, verbatim from the Chrome imperative-API reference:
 *
 *   document.modelContext.registerTool({ name, description, inputSchema, execute, annotations }, { signal })
 *   document.modelContext.getTools()                -> ToolDescriptor[] (alphabetical)
 *   document.modelContext.executeTool(tool, json)   -> string | null
 *   document.modelContext.addEventListener("toolchange", ...)
 *
 * `navigator.modelContext` (Chrome < 150) is detected and reported, never used.
 *
 * Where the browser has no `document.modelContext`, `ensureModelContext()` installs a polyfill with the
 * same surface so a page written against the standard behaves identically in every Chromium build.
 * The polyfill is marked `polyfilled: true` so a consumer (the Athena side panel) can say which it is
 * talking to. It decides nothing: it stores tools, runs them and fires `toolchange`.
 */

export interface WebMCPAnnotations {
  /** The tool changes nothing. Athena maps this to `side_effects: none` and AUTO. */
  readOnlyHint?: boolean;
  /** Effects the user would want to be asked about first. Athena maps this to GATED. */
  consequentialHint?: boolean;
  /** The result carries text from outside the app; consumers should fence it. */
  untrustedContentHint?: boolean;
}

export interface JsonSchemaObject {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export type ToolExecute = (
  params: Record<string, unknown>,
  options: { signal?: AbortSignal },
) => string | Promise<string>;

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
  execute: ToolExecute;
  annotations?: WebMCPAnnotations;
  title?: string;
}

export interface RegisteredTool extends ToolDescriptor {
  origin: string;
}

export interface ModelContext extends EventTarget {
  registerTool(tool: ToolDescriptor, options?: { signal?: AbortSignal; exposedTo?: string[] }): Promise<void> | void;
  unregisterTool?(name: string): void;
  getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredTool[]>;
  executeTool(tool: RegisteredTool | string, input: string, options?: { signal?: AbortSignal }): Promise<string | null>;
  /** Set only by the polyfill below. */
  polyfilled?: boolean;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    modelContext?: unknown;
  }
}

export interface Detection {
  available: boolean;
  polyfilled: boolean;
  /** `navigator.modelContext` was found: an older Chrome. Reported, never used. */
  deprecated: boolean;
}

export function detectModelContext(): Detection {
  if (typeof document === "undefined") return { available: false, polyfilled: false, deprecated: false };
  const mc = document.modelContext;
  return {
    available: Boolean(mc),
    polyfilled: Boolean(mc?.polyfilled),
    deprecated: !mc && typeof navigator !== "undefined" && Boolean(navigator.modelContext),
  };
}

class ModelContextPolyfill extends EventTarget implements ModelContext {
  readonly polyfilled = true;
  private readonly tools = new Map<string, RegisteredTool>();

  registerTool(tool: ToolDescriptor, options: { signal?: AbortSignal } = {}): void {
    if (!tool || typeof tool.name !== "string" || !tool.name) throw new TypeError("registerTool: name is required");
    if (typeof tool.execute !== "function") throw new TypeError(`registerTool(${tool.name}): execute is required`);
    if (options.signal?.aborted) return;
    this.tools.set(tool.name, { ...tool, origin: location.origin });
    this.changed();
    options.signal?.addEventListener("abort", () => this.unregisterTool(tool.name), { once: true });
  }

  unregisterTool(name: string): void {
    if (this.tools.delete(name)) this.changed();
  }

  async getTools(): Promise<RegisteredTool[]> {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async executeTool(tool: RegisteredTool | string, input: string, options: { signal?: AbortSignal } = {}): Promise<string | null> {
    const name = typeof tool === "string" ? tool : tool.name;
    const found = this.tools.get(name);
    if (!found) throw new Error(`No tool named ${name}`);
    const params = input ? (JSON.parse(input) as Record<string, unknown>) : {};
    const result = await found.execute(params, { signal: options.signal });
    return result === undefined || result === null ? null : String(result);
  }

  private changed(): void {
    this.dispatchEvent(new Event("toolchange"));
  }
}

/**
 * The page's model context, installing the polyfill when the browser has none. Idempotent. Returns
 * `undefined` on the server.
 */
export function ensureModelContext(): ModelContext | undefined {
  if (typeof document === "undefined") return undefined;
  if (!document.modelContext) {
    Object.defineProperty(document, "modelContext", {
      value: new ModelContextPolyfill(),
      configurable: true,
      writable: false,
    });
  }
  return document.modelContext;
}
