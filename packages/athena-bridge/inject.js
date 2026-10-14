// The page's half of the bridge — README §3.4 tier 1 ("the page's own WebMCP tools, through
// inject.js and the relay"). The wire format is packages/athena-bridge/protocol.md.
//
// This file runs in the page's own JavaScript world at document start, before the application's
// scripts, and does three things:
//
//   1. polyfills `document.modelContext` when the browser has none, so a page written against
//      WebMCP behaves the same in every build;
//   2. answers `list` and `call` for the relay over `window.postMessage`;
//   3. posts `toolchange` whenever the registry moves, so the surface's manifest is never stale.
//
// It decides nothing. Whether a tool is AUTO or GATED is decided by gate.js in the surface and by
// the catalog behind it (README §3.3, ADR 0004); a page cannot argue itself out of GATED and
// neither can a model. Everything here is wrapped in one `try`: a page that froze its globals
// before this script ran gets no bridge, and no bridge is a page with zero tools — never an
// exception thrown into someone else's application. See ADR 0008.
(() => {
  "use strict";

  /** The one namespace on the wire. Anything without it is not ours. */
  const NS = "athena-webmcp";

  /** The page's deadline for one `call`. The relay's own timer is deliberately longer. */
  const CALL_TIMEOUT_MS = 30_000;

  /** The only refusal reason this half mints. The vocabulary itself lives in gate.js. */
  const TIMEOUT = "timeout";

  try {
    install();
  } catch {
    // No bridge. Deliberately silent: a page is not ours to break, and the surface reads the
    // absence as "this page has no tools" because `list` simply never answers.
  }

  function install() {
    // A frame is not the page. Reading `top` across origins throws, which lands in the catch
    // above and leaves the frame without a bridge — which is the answer we wanted anyway.
    if (window.top !== window) return;
    if (window.__athenaBridge) return;
    // The first write to a global. A frozen `window` throws here, before anything is installed.
    Object.defineProperty(window, "__athenaBridge", { value: `${NS}/1`, configurable: true });

    const native = document.modelContext;
    /** @type {WebMCPRegistry} */
    const registry = native || polyfill();
    const transport = native ? "webmcp-native" : "webmcp-polyfill";

    window.addEventListener("message", (event) => {
      // Two checks, and both matter. `source` rejects an iframe's message: only the page itself
      // talks to its own bridge. `origin` rejects a window that is not this document.
      if (event.source !== window) return;
      if (event.origin !== location.origin) return;
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;
      const request = /** @type {{ __ns?: string, dir?: string, id?: unknown, type?: string,
        name?: string, input?: unknown, timeout_ms?: unknown }} */ (msg);
      if (request.__ns !== NS || request.dir !== "to-page") return;
      const id = request.id === undefined ? null : request.id;
      handle(request).then(
        (body) => post(id, body),
        (error) => post(id, { ok: false, error: messageOf(error) }),
      );
    });

    // Both halves of the change notification: the polyfill dispatches it, and a native registry
    // is asked for it the same way. `addEventListener` is optional on a foreign implementation.
    if (typeof registry.addEventListener === "function") {
      registry.addEventListener("toolchange", () => post(null, { type: "toolchange" }));
    }

    /**
     * One request in, one answer out. Never rejects for a reason the surface could act on: a
     * refusal is a result, so the relay's pending entry always clears.
     * @param {{ type?: string, name?: string, input?: unknown, timeout_ms?: unknown }} request
     * @returns {Promise<Record<string, unknown>>}
     */
    async function handle(request) {
      if (request.type === "list") {
        return { ok: true, page: describePage(), tools: (await toolsOf()).map(describeTool) };
      }
      if (request.type === "call") {
        return call(String(request.name ?? ""), request.input, request.timeout_ms);
      }
      return { ok: false, error: `Unknown request ${String(request.type)}` };
    }

    /**
     * Run one registered tool under a deadline.
     * @param {string} name
     * @param {unknown} input
     * @param {unknown} requestedMs the relay may ask for less than the ceiling, never for more
     * @returns {Promise<Record<string, unknown>>}
     */
    async function call(name, input, requestedMs) {
      const tools = await toolsOf();
      const tool = tools.find((t) => t && t.name === name);
      if (!tool) return { ok: false, error: `No tool named ${name}` };

      const budgetMs = deadline(requestedMs);
      const controller = new AbortController();
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        controller.abort();
      }, budgetMs);
      try {
        // Raced, not merely aborted: a tool that ignores its signal must not be able to hold the
        // surface open past the deadline. The abort is the courtesy; the race is the guarantee.
        const output = await Promise.race([execute(tool, input, controller.signal), aborted(controller.signal)]);
        return { ok: true, output: render(output) };
      } catch (error) {
        if (expired) {
          return { ok: false, reason: TIMEOUT, error: `${name} did not answer within ${budgetMs} ms` };
        }
        return { ok: false, error: messageOf(error) };
      } finally {
        clearTimeout(timer);
      }
    }

    /**
     * Call the tool through whichever door this registry offers.
     * @param {WebMCPTool} tool
     * @param {unknown} input
     * @param {AbortSignal} signal
     */
    function execute(tool, input, signal) {
      const params = input && typeof input === "object" ? input : {};
      if (typeof tool.execute === "function") return Promise.resolve(tool.execute(params, { signal }));
      if (typeof registry.callTool === "function") {
        return Promise.resolve(registry.callTool(tool.name, params, { signal }));
      }
      if (typeof registry.executeTool === "function") {
        return Promise.resolve(registry.executeTool(tool, JSON.stringify(params), { signal }));
      }
      return Promise.reject(new Error(`${tool.name} registered no way to run it`));
    }

    /** Everything the page registered, whichever shape this registry keeps it in. */
    async function toolsOf() {
      /** @type {unknown} */
      let listed = [];
      if (typeof registry.listTools === "function") listed = await registry.listTools();
      else if (typeof registry.getTools === "function") listed = await registry.getTools();
      else if (registry.tools instanceof Map) listed = [...registry.tools.values()];
      else if (Array.isArray(registry.tools)) listed = registry.tools;
      const tools = Array.isArray(listed) ? listed : [];
      return /** @type {WebMCPTool[]} */ (tools).filter((t) => t && typeof t.name === "string");
    }

    /** The page's identity, from the `athena:app` meta tags it publishes about itself. */
    function describePage() {
      return {
        origin: location.origin,
        href: location.href,
        title: document.title,
        app_id: meta("athena:app"),
        app_name: meta("athena:app-name"),
        app_version: meta("athena:app-version"),
        manifest: manifestHint(),
        transport,
        deprecated_navigator: Boolean(navigator.modelContext),
      };
    }

    /**
     * `athena:app-manifest` is either a URL the surface may fetch or a manifest inline as JSON.
     * A page that wrote unparseable JSON gets no manifest rather than an error: this half reports
     * what it found, and the surface can always derive a manifest from the tool list instead.
     */
    function manifestHint() {
      const raw = meta("athena:app-manifest");
      if (!raw) return null;
      const trimmed = raw.trim();
      if (!trimmed.startsWith("{")) return { source: "url", url: trimmed };
      try {
        return { source: "inline", value: JSON.parse(trimmed) };
      } catch {
        return null;
      }
    }

    /**
     * @param {string} name
     * @returns {string | null}
     */
    function meta(name) {
      const el = document.querySelector(`meta[name="${name}"]`);
      const content = el ? el.getAttribute("content") : null;
      return content && content.trim() ? content.trim() : null;
    }

    /**
     * One tool, as the surface sees it. The non-standard `athena` block is the README §3.3 hint
     * (`reversible`, `side_effects`); a native registry drops it and gate.js falls back to the
     * standard annotations, where unknown is GATED.
     * @param {WebMCPTool} tool
     */
    function describeTool(tool) {
      return {
        name: tool.name,
        title: tool.title ?? null,
        description: tool.description ?? "",
        inputSchema: tool.inputSchema ?? { type: "object" },
        annotations: tool.annotations ?? null,
        athena: tool.athena ?? null,
      };
    }

    /**
     * @param {unknown} id
     * @param {Record<string, unknown>} body
     */
    function post(id, body) {
      window.postMessage({ __ns: NS, dir: "to-ext", id, ...body }, location.origin);
    }
  }

  /** The polyfill, used only when the browser has no `document.modelContext` of its own. */
  function polyfill() {
    class ModelContextPolyfill extends EventTarget {
      constructor() {
        super();
        this.polyfilled = true;
        /** @type {Map<string, WebMCPTool>} */
        this.registered = new Map();
      }

      /**
       * @param {WebMCPTool} tool
       * @param {{ signal?: AbortSignal }} [options]
       */
      registerTool(tool, options = {}) {
        if (!tool || typeof tool.name !== "string" || !tool.name) {
          throw new TypeError("registerTool: name is required");
        }
        if (typeof tool.execute !== "function") {
          throw new TypeError(`registerTool(${tool.name}): execute is required`);
        }
        if (options.signal && options.signal.aborted) return;
        this.registered.set(tool.name, tool);
        this.dispatchEvent(new Event("toolchange"));
        if (options.signal) {
          options.signal.addEventListener("abort", () => this.unregisterTool(tool.name), { once: true });
        }
      }

      /** @param {string} name */
      unregisterTool(name) {
        if (this.registered.delete(name)) this.dispatchEvent(new Event("toolchange"));
      }

      /** Sorted, so two `list` calls over an unchanged registry are the same manifest. */
      listTools() {
        return [...this.registered.values()].sort((a, b) => a.name.localeCompare(b.name));
      }
    }

    const created = new ModelContextPolyfill();
    Object.defineProperty(document, "modelContext", { value: created, configurable: true, writable: false });
    return created;
  }

  /**
   * A promise that rejects when `signal` aborts and never resolves otherwise.
   * @param {AbortSignal} signal
   * @returns {Promise<never>}
   */
  function aborted(signal) {
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  }

  /**
   * The page's own ceiling, and the relay's request when it asked for less.
   * @param {unknown} requested
   */
  function deadline(requested) {
    const ms = typeof requested === "number" && Number.isFinite(requested) ? Math.floor(requested) : CALL_TIMEOUT_MS;
    return Math.min(Math.max(ms, 1), CALL_TIMEOUT_MS);
  }

  /**
   * Whatever the tool returned, as text. A WebMCP content array is flattened to its text parts;
   * anything else is JSON. Bounding and fencing belong to the surface (gate.js), not here.
   * @param {unknown} output
   * @returns {string}
   */
  function render(output) {
    if (output === null || output === undefined) return "";
    if (typeof output === "string") return output;
    const content = /** @type {{ content?: unknown }} */ (output).content;
    if (Array.isArray(content)) {
      return content
        .map((part) => (part && typeof part === "object" ? String(/** @type {{ text?: unknown }} */ (part).text ?? "") : String(part)))
        .join("\n");
    }
    try {
      return JSON.stringify(output) ?? String(output);
    } catch {
      return String(output);
    }
  }

  /**
   * @param {unknown} error
   * @returns {string}
   */
  function messageOf(error) {
    if (error && typeof error === "object" && "message" in error) {
      const message = /** @type {{ message?: unknown }} */ (error).message;
      if (message) return String(message);
    }
    return String(error);
  }
})();
