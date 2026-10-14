// inject.js in a real window — README §3.4 tier 1, packages/athena-bridge/protocol.md.
//
// jsdom gives us a window whose globals we can freeze, whose iframes are real, and whose
// `postMessage` delivers. It does not populate `origin` or `source` on the event it delivers
// (both are the browser's job and jsdom leaves them empty), so a request is dispatched as an
// explicit `MessageEvent` with the fields the bridge's two guards read. Replies travel the real
// way: inject.js calls `window.postMessage` and the test listens for it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

const SOURCE = readFileSync(fileURLToPath(new URL("../inject.js", import.meta.url)), "utf8");
const ORIGIN = "https://app.example";
const NS = "athena-webmcp";

const PAGE = `<!doctype html><html><head>
<title>Ledgerbox</title>
<meta name="athena:app" content="ledgerbox">
<meta name="athena:app-name" content="Ledgerbox">
<meta name="athena:app-version" content="1.4.0">
<meta name="athena:app-manifest" content="/.well-known/athena-manifest.json">
</head><body><iframe></iframe></body></html>`;

/**
 * A window with the bridge in it, plus the two things every test needs: a way to send a request
 * and the replies that came back.
 * @param {{ html?: string, before?: (window: any) => void }} [options]
 */
function page(options = {}) {
  const dom = new JSDOM(options.html ?? PAGE, { runScripts: "outside-only", url: `${ORIGIN}/inbox` });
  const window = /** @type {any} */ (dom.window);
  /** @type {any[]} */
  const replies = [];
  window.addEventListener("message", (/** @type {any} */ event) => {
    const data = event.data;
    if (data && data.__ns === NS && data.dir === "to-ext") replies.push(data);
  });
  if (options.before) options.before(window);
  window.eval(SOURCE);

  /**
   * @param {Record<string, unknown>} request
   * @param {{ source?: unknown, origin?: string }} [from]
   */
  const send = (request, from = {}) => {
    window.dispatchEvent(
      new window.MessageEvent("message", {
        data: { __ns: NS, dir: "to-page", ...request },
        origin: from.origin ?? window.location.origin,
        source: "source" in from ? from.source : window,
      }),
    );
  };

  /** Replies are posted, and a posted message is delivered on a later task. */
  const settle = async (ms = 5) => {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  };

  /**
   * The reply to one request, as a plain object: a structured clone from jsdom's realm has
   * jsdom's `Object.prototype`, which `deepStrictEqual` counts as a difference.
   * @param {unknown} id
   */
  const replyTo = (id) => {
    const found = replies.find((r) => r.id === id);
    return found === undefined ? undefined : JSON.parse(JSON.stringify(found));
  };

  return { window, replies, send, settle, replyTo, dom };
}

/**
 * Register one tool through the polyfilled registry.
 * @param {any} window
 * @param {string} name
 * @param {(input: any, options: any) => unknown} execute
 * @param {Record<string, unknown>} [extra]
 */
function register(window, name, execute, extra = {}) {
  window.document.modelContext.registerTool({
    name,
    description: name,
    inputSchema: { type: "object", properties: {} },
    execute,
    ...extra,
  });
}

test("the polyfill is installed, and list reports it as the transport", async () => {
  const p = page();
  assert.equal(p.window.__athenaBridge, `${NS}/1`);
  register(p.window, "read_inbox", () => "12 invoices");
  register(p.window, "archive", () => "done", { athena: { reversible: true, side_effects: "internal" } });

  p.send({ id: "1", type: "list" });
  await p.settle();

  const reply = p.replyTo("1");
  assert.ok(reply, "list must answer");
  assert.equal(reply.ok, true);
  assert.equal(reply.page.transport, "webmcp-polyfill");
  assert.equal(reply.page.origin, ORIGIN);
  assert.equal(reply.page.app_id, "ledgerbox");
  assert.equal(reply.page.app_name, "Ledgerbox");
  assert.equal(reply.page.app_version, "1.4.0");
  assert.deepEqual(reply.page.manifest, { source: "url", url: "/.well-known/athena-manifest.json" });
  assert.deepEqual(
    reply.tools.map((/** @type {any} */ t) => t.name),
    ["archive", "read_inbox"],
    "sorted, so an unchanged registry is an unchanged manifest",
  );
  assert.deepEqual(reply.tools[0].athena, { reversible: true, side_effects: "internal" });
  assert.equal(reply.tools[1].athena, null, "a tool that declared nothing says nothing");
});

test("a page that already had document.modelContext keeps it, and list says webmcp-native", async () => {
  const p = page({
    before(window) {
      window.document.modelContext = /** @type {any} */ ({
        tools: [{ name: "native_tool", description: "n", execute: () => "native" }],
        listTools() {
          return this.tools;
        },
        addEventListener() {},
      });
    },
  });

  p.send({ id: "n1", type: "list" });
  p.send({ id: "n2", type: "call", name: "native_tool" });
  await p.settle();

  assert.equal(p.replyTo("n1").page.transport, "webmcp-native");
  assert.equal(p.replyTo("n1").page.deprecated_navigator, false);
  assert.equal(p.window.document.modelContext.polyfilled, undefined, "the page's registry is untouched");
  assert.deepEqual(p.replyTo("n2"), { __ns: NS, dir: "to-ext", id: "n2", ok: true, output: "native" });
});

test("an inline manifest is parsed, and an unparseable one is simply absent", async () => {
  const inline = { app_id: "x", tools: [] };
  const html = `<!doctype html><meta name="athena:app-manifest" content='${JSON.stringify(inline)}'>`;
  const p = page({ html });
  p.send({ id: "m", type: "list" });
  await p.settle();
  assert.deepEqual(p.replyTo("m").page.manifest, { source: "inline", value: inline });

  const broken = page({ html: `<!doctype html><meta name="athena:app-manifest" content='{"app_id":'>` });
  broken.send({ id: "m", type: "list" });
  await broken.settle();
  assert.equal(broken.replyTo("m").page.manifest, null, "a broken manifest is not an exception");
});

test("a throw inside execute is a result, not a dropped promise", async () => {
  const p = page();
  register(p.window, "explode", () => {
    throw new Error("the invoice is locked");
  });
  register(p.window, "reject_later", async () => {
    throw new Error("async no");
  });

  p.send({ id: "e1", type: "call", name: "explode" });
  p.send({ id: "e2", type: "call", name: "reject_later" });
  p.send({ id: "e3", type: "call", name: "nope" });
  p.send({ id: "e4", type: "wat" });
  await p.settle();

  assert.deepEqual(p.replyTo("e1"), { __ns: NS, dir: "to-ext", id: "e1", ok: false, error: "the invoice is locked" });
  assert.equal(p.replyTo("e2").ok, false);
  assert.equal(p.replyTo("e2").error, "async no");
  assert.equal(p.replyTo("e3").error, "No tool named nope");
  assert.equal(p.replyTo("e4").error, "Unknown request wat");
});

test("a call is given its input and its output is rendered as text", async () => {
  const p = page();
  register(p.window, "categorise", (input) => ({
    content: [{ type: "text", text: `filed ${input.id} under ${input.label}` }],
  }));
  register(p.window, "count", () => 12);

  p.send({ id: "c1", type: "call", name: "categorise", input: { id: "inv-3", label: "travel" } });
  p.send({ id: "c2", type: "call", name: "count" });
  await p.settle();

  assert.equal(p.replyTo("c1").output, "filed inv-3 under travel");
  assert.equal(p.replyTo("c2").output, "12");
});

test("a call past the deadline is a timeout refusal, even when the tool ignores its signal", async () => {
  const p = page();
  // The hostile case: nothing here ever settles and the signal is never read. The reply must
  // still arrive, or the surface waits on a page that is never coming back.
  register(p.window, "hangs", () => new Promise(() => {}));

  p.send({ id: "t1", type: "call", name: "hangs", timeout_ms: 20 });
  await p.settle(80);

  const reply = p.replyTo("t1");
  assert.ok(reply, "the deadline must produce an answer");
  assert.equal(reply.ok, false);
  assert.equal(reply.reason, "timeout");
  assert.match(reply.error, /hangs did not answer within 20 ms/);
});

test("the tool is handed a signal that aborts at the deadline, and 0 is not 'no deadline'", async () => {
  const p = page();
  let aborted = false;
  register(
    p.window,
    "watches",
    (_input, options) =>
      new Promise(() => {
        options.signal.addEventListener("abort", () => {
          aborted = true;
        });
      }),
  );

  p.send({ id: "a1", type: "call", name: "watches", timeout_ms: 0 });
  await p.settle(60);

  assert.equal(aborted, true, "the abort is the courtesy the race does not replace");
  assert.equal(p.replyTo("a1").reason, "timeout", "0 clamps to a real deadline, not to the ceiling");
});

test("a message from a frame is ignored, and so is one from another origin", async () => {
  const p = page();
  register(p.window, "read_inbox", () => "12 invoices");
  const frame = p.window.document.querySelector("iframe").contentWindow;

  p.send({ id: "f1", type: "list" }, { source: frame });
  p.send({ id: "f2", type: "list" }, { origin: "https://evil.example" });
  p.send({ id: "f3", type: "list" }, { source: null });
  await p.settle();

  for (const id of ["f1", "f2", "f3"]) {
    assert.equal(p.replyTo(id), undefined, `${id}: an iframe and a foreign origin are not the page`);
  }

  p.send({ id: "ok", type: "list" });
  await p.settle();
  assert.equal(p.replyTo("ok").ok, true, "the page's own message is still answered");
});

test("toolchange is posted when the registry moves, and carries no payload", async () => {
  const p = page();
  register(p.window, "a", () => "a");
  p.window.document.modelContext.unregisterTool("a");
  await p.settle();

  const events = p.replies.filter((r) => r.type === "toolchange");
  assert.equal(events.length, 2, "one for the registration, one for the removal");
  assert.deepEqual(p.replyTo(null), { __ns: NS, dir: "to-ext", id: null, type: "toolchange" });
});

test("a page that froze its globals gets no bridge, and list simply never answers", async () => {
  const p = page({
    before(window) {
      // The risk this test retires (plan §9): the application sealed the slot before the shell's
      // initialization script ran. Nothing may be thrown into it, and the surface must see a page
      // with no tools rather than an error.
      Object.defineProperty(window.document, "modelContext", {
        value: undefined,
        configurable: false,
        writable: false,
      });
      Object.freeze(window.document);
      Object.preventExtensions(window);
    },
  });

  assert.equal(p.window.__athenaBridge, undefined, "no marker means no bridge");
  p.send({ id: "z", type: "list" });
  await p.settle(30);
  assert.equal(p.replies.length, 0, "no reply, no exception, no tools");
  assert.equal(p.window.document.modelContext, undefined, "and the page's own slot is untouched");
});

test("injecting twice leaves one bridge and one answer per request", async () => {
  const p = page();
  p.window.eval(SOURCE);
  register(p.window, "read_inbox", () => "12 invoices");
  p.send({ id: "one", type: "list" });
  await p.settle();
  assert.equal(p.replies.filter((r) => r.id === "one").length, 1);
});
