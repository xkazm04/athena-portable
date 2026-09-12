// The page-side types the bridge needs and `lib.dom` does not have yet — README §3.4 tier 1.
//
// WebMCP is a draft: `document.modelContext` is the current shape and `navigator.modelContext` is
// the deprecated one. These declarations are what `tsc --noEmit` checks inject.js against, and
// they are deliberately permissive about a *native* registry: a browser's implementation may
// expose `listTools`, `getTools` or a plain `tools` collection, and the bridge reads whichever it
// finds rather than assuming the draft it was written against won.

/** One tool a page registered. `athena` is the non-standard README §3.3 hint. */
declare interface WebMCPTool {
  name: string;
  title?: string | null;
  description?: string | null;
  inputSchema?: unknown;
  annotations?: Record<string, unknown> | null;
  athena?: { reversible?: boolean; side_effects?: string } | null;
  execute?: (input: unknown, options: { signal: AbortSignal }) => unknown;
}

/** `document.modelContext`: the page's tool registry, native or polyfilled. */
declare interface WebMCPRegistry extends EventTarget {
  /** Set by this repository's polyfill; absent on a native implementation. */
  polyfilled?: boolean;
  registerTool(tool: WebMCPTool, options?: { signal?: AbortSignal }): void;
  unregisterTool(name: string): void;
  listTools?(): WebMCPTool[] | Promise<WebMCPTool[]>;
  getTools?(): WebMCPTool[] | Promise<WebMCPTool[]>;
  tools?: WebMCPTool[] | Map<string, WebMCPTool>;
  callTool?(name: string, input: unknown, options?: { signal?: AbortSignal }): unknown;
  executeTool?(tool: WebMCPTool | string, input: string, options?: { signal?: AbortSignal }): unknown;
}

declare interface Document {
  modelContext?: WebMCPRegistry;
}

declare interface Navigator {
  /** The deprecated location. Reported on `page`, never used. */
  modelContext?: unknown;
}

declare interface Window {
  /** The re-injection marker, `"athena-webmcp/1"`. Absent means no bridge installed. */
  __athenaBridge?: string;
}
