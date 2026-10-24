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

import { REFUSAL_REASONS } from "../gate.js";

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
   * Wait for a condition rather than for a length of time. A loaded machine delays every timer
   * and every delivery, never their order, so a test that sleeps a fixed 5 or 80 ms and then
   * asserts an answer is a test that fails when the machine is busy. `capMs` is a ceiling on a
   * hang, not a clock the assertion depends on.
   * @param {() => boolean} done
   * @param {number} [capMs]
   */
  const until = async (done, capMs = 3000) => {
    for (let waited = 0; !done() && waited < capMs; waited += 5) await settle(5);
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

  /**
   * The reply to one request, waited for until it arrives (or the cap passes, and the assertion
   * that reads it fails on `undefined`).
   * @param {unknown} id
   */
  const answer = async (id) => {
    await until(() => replies.some((r) => r.id === id));
    return replyTo(id);
  };

  return { window, replies, send, settle, until, answer, replyTo, dom };
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

  const reply = await p.answer("1");
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
  await p.until(() => p.replyTo("n1") !== undefined && p.replyTo("n2") !== undefined);

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
  assert.deepEqual((await p.answer("m")).page.manifest, { source: "inline", value: inline });

  const broken = page({ html: `<!doctype html><meta name="athena:app-manifest" content='{"app_id":'>` });
  broken.send({ id: "m", type: "list" });
  assert.equal((await broken.answer("m")).page.manifest, null, "a broken manifest is not an exception");
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
  await p.until(() => ["e1", "e2", "e3", "e4"].every((id) => p.replyTo(id) !== undefined));

  assert.deepEqual(p.replyTo("e1"), { __ns: NS, dir: "to-ext", id: "e1", ok: false, error: "the invoice is locked" });
  assert.equal(p.replyTo("e2").ok, false);
  assert.equal(p.replyTo("e2").error, "async no");
  assert.equal(p.replyTo("e3").error, "No tool named nope");
  assert.equal(p.replyTo("e4").error, "Unknown request wat");
});

test("a missing tool and an unknown request carry their own reason; a handler fault carries none", async () => {
  // README 3.3 and ADR 0009: the reason is a member of the one refusal vocabulary, so the surface
  // and the ledger can tell "nothing by that name" and "not a request this bridge speaks" from a
  // tool that ran and failed. The catalog already says unknown_ref for a name it does not hold
  // (src/athena/core/catalog.py) and so does the hands script for a hand it does not have.
  const p = page();
  register(p.window, "explode", () => {
    throw new Error("the invoice is locked");
  });
  p.send({ id: "r1", type: "call", name: "nope" });
  p.send({ id: "r2", type: "wat" });
  p.send({ id: "r3", type: "call", name: "explode" });
  await p.until(() => ["r1", "r2", "r3"].every((id) => p.replyTo(id) !== undefined));

  assert.deepEqual(p.replyTo("r1"), { __ns: NS, dir: "to-ext", id: "r1", ok: false, reason: "unknown_ref", error: "No tool named nope" });
  assert.deepEqual(p.replyTo("r2"), { __ns: NS, dir: "to-ext", id: "r2", ok: false, reason: "validator_failed", error: "Unknown request wat" });
  assert.equal("reason" in p.replyTo("r3"), false, "a fault inside the tool is the tool's outcome, not a refusal");
  for (const id of ["r1", "r2"]) assert.ok(REFUSAL_REASONS.includes(p.replyTo(id).reason), `${id}: a vocabulary member`);
});

test("a call is given its input and its output is rendered as text", async () => {
  const p = page();
  register(p.window, "categorise", (input) => ({
    content: [{ type: "text", text: `filed ${input.id} under ${input.label}` }],
  }));
  register(p.window, "count", () => 12);

  p.send({ id: "c1", type: "call", name: "categorise", input: { id: "inv-3", label: "travel" } });
  p.send({ id: "c2", type: "call", name: "count" });
  await p.until(() => p.replyTo("c1") !== undefined && p.replyTo("c2") !== undefined);

  assert.equal(p.replyTo("c1").output, "filed inv-3 under travel");
  assert.equal(p.replyTo("c2").output, "12");
});

/**
 * One schema and fifteen inputs, with the verdict `check_schema` (src/athena/core/validators.py)
 * gives each. The page checks the same subset at dispatch and may never be stricter than the gate:
 * an input the gate accepts must reach the tool.
 */
const SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", maxLength: 4 },
    label: { type: "string", enum: ["travel", "food"] },
    count: { type: "integer", minimum: 1, maximum: 10 },
    tags: { type: "array", maxItems: 2, items: { type: "string" } },
    ratio: { type: "number" },
  },
  required: ["id"],
  additionalProperties: false,
};

/** @type {Array<[string, unknown, boolean]>} name, input, does check_schema accept it */
const VERDICTS = [
  ["valid", { id: "inv3", label: "travel", count: 3, tags: ["a"], ratio: 0.5 }, true],
  ["missing required", { label: "travel" }, false],
  ["wrong type", { id: 7 }, false],
  ["enum miss", { id: "a", label: "golf" }, false],
  ["unknown key", { id: "a", extra: 1 }, false],
  ["too long", { id: "abcde" }, false],
  // Four code points and eight UTF-16 units: Python counts the first, so the page must too.
  ["astral at the limit", { id: "\u{1F600}\u{1F600}\u{1F600}\u{1F600}" }, true],
  ["boolean for integer", { id: "a", count: true }, false],
  ["fraction for integer", { id: "a", count: 2.5 }, false],
  ["below minimum", { id: "a", count: 0 }, false],
  ["above maximum", { id: "a", count: 11 }, false],
  ["too many items", { id: "a", tags: ["a", "b", "c"] }, false],
  ["wrong item type", { id: "a", tags: ["a", 1] }, false],
  ["null for a string", { id: null }, false],
  // An own key that is also an Object.prototype name is still an unknown key.
  ["inherited name as a key", { id: "a", constructor: 1 }, false],
];

test("a call is checked against the tool's own inputSchema before the tool runs", async () => {
  // README 3.3, the registry's mcp-tools/tool-schema-design: validation runs at dispatch,
  // against the schema the tool publishes now. The gate checked the manifest it was given at
  // list time; a page that re-registered the tool since, or a surface with no catalog behind it,
  // must not be able to hand the handler arguments its own schema refuses.
  const p = page();
  /** @type {unknown[]} */
  const ran = [];
  register(
    p.window,
    "file",
    (input) => {
      ran.push(input);
      return "filed";
    },
    { inputSchema: SCHEMA },
  );

  VERDICTS.forEach(([, input], i) => p.send({ id: `v${i}`, type: "call", name: "file", input }));
  await p.until(() => VERDICTS.every((_, i) => p.replyTo(`v${i}`) !== undefined));

  VERDICTS.forEach(([name, input, accepted], i) => {
    const reply = p.replyTo(`v${i}`);
    if (accepted) {
      assert.equal(reply.ok, true, `${name}: the gate accepts it, so the page must`);
      assert.equal(reply.output, "filed");
    } else {
      assert.equal(reply.ok, false, `${name}: refused before the tool ran`);
      assert.equal(reply.reason, "validator_failed", name);
      assert.match(reply.error, /^file: /, `${name}: the sentence names the tool`);
      assert.equal(
        ran.some((r) => JSON.stringify(r) === JSON.stringify(input)),
        false,
        `${name}: never reached the tool`,
      );
    }
  });
  assert.equal(ran.length, VERDICTS.filter(([, , ok]) => ok).length);
});

test("a tool with no usable schema runs as before, and an omitted input is an empty object", async () => {
  // Defence in depth may never be a new way to refuse: a schema the manifest door would have
  // refused, or none at all, is the gate's business, not a reason for the page to stop a call.
  const p = page();
  register(p.window, "loose", (input) => JSON.stringify(input), { inputSchema: undefined });
  register(p.window, "odd", (input) => JSON.stringify(input), { inputSchema: { type: "object", required: "id" } });
  register(p.window, "bare", (input) => JSON.stringify(input), { inputSchema: { type: "object", properties: {} } });

  p.send({ id: "s1", type: "call", name: "loose", input: { anything: 1 } });
  p.send({ id: "s2", type: "call", name: "odd", input: { x: 1 } });
  p.send({ id: "s3", type: "call", name: "bare" });
  p.send({ id: "s4", type: "call", name: "bare", input: ["not", "an", "object"] });
  await p.until(() => ["s1", "s2", "s3", "s4"].every((id) => p.replyTo(id) !== undefined));

  assert.equal(p.replyTo("s1").output, '{"anything":1}');
  assert.equal(p.replyTo("s2").output, '{"x":1}');
  assert.equal(p.replyTo("s3").output, "{}");
  assert.equal(p.replyTo("s4").reason, "validator_failed", "an input that is not an object is refused, as the gate refuses it");
});

test("a call past the deadline is a timeout refusal, even when the tool ignores its signal", async () => {
  const p = page();
  // The hostile case: nothing here ever settles and the signal is never read. The reply must
  // still arrive, or the surface waits on a page that is never coming back.
  register(p.window, "hangs", () => new Promise(() => {}));

  p.send({ id: "t1", type: "call", name: "hangs", timeout_ms: 20 });

  // Waited for, not slept on: the tool never settles, so the only reply that can ever arrive is
  // the deadline's, and how long a busy machine takes to deliver it is not what is under test.
  const reply = await p.answer("t1");
  assert.ok(reply, "the deadline must produce an answer");
  assert.equal(reply.ok, false);
  assert.equal(reply.reason, "timeout");
  assert.match(reply.error, /hangs did not answer within 20 ms/);
});

test("a call that settles after its deadline is answered timeout, then posted as late", async () => {
  const p = page();
  // The write that outlives the deadline: the reply says "no answer yet", and the answer it
  // eventually gives still reaches the relay, named by the request it belongs to.
  register(p.window, "sends", () => new Promise((resolve) => p.window.setTimeout(() => resolve({ sent: 1 }), 80)));
  register(p.window, "breaks", () => new Promise((_r, reject) => p.window.setTimeout(() => reject(new Error("smtp down")), 80)));

  p.send({ id: "l1", type: "call", name: "sends", timeout_ms: 50 });
  p.send({ id: "l2", type: "call", name: "breaks", timeout_ms: 50 });
  // Polled rather than slept: a loaded machine delays both timers, never their order.
  await p.until(() => p.replies.filter((r) => r.type === "late").length >= 2);
  assert.equal(p.replyTo("l1").reason, "timeout");
  assert.equal(p.replyTo("l2").reason, "timeout");
  const at = (/** @type {(r: any) => boolean} */ match) => p.replies.findIndex(match);
  assert.ok(
    at((r) => r.type === "late" && r.call === "l1") > at((r) => r.id === "l1"),
    "the timeout is the reply; late comes after it",
  );

  const late = p.replies.filter((r) => r.type === "late").map((r) => JSON.parse(JSON.stringify(r)));
  assert.deepEqual(
    late.find((r) => r.call === "l1"),
    { __ns: NS, dir: "to-ext", id: null, type: "late", call: "l1", ok: true, output: '{"sent":1}' },
  );
  const broke = late.find((r) => r.call === "l2");
  assert.equal(broke.ok, false);
  assert.equal(broke.error, "smtp down");
  assert.equal(late.length, 2, "one late event per timed-out call");
});

test("a call answered in time posts no late event", async () => {
  const p = page();
  register(p.window, "quick", () => "ok");
  p.send({ id: "q1", type: "call", name: "quick", timeout_ms: 50 });
  assert.equal((await p.answer("q1")).ok, true);
  // Past the deadline, where a late event would have been posted had the reply been a timeout.
  await p.settle(100);
  assert.equal(p.replies.some((r) => r.type === "late"), false);
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
  const reply = await p.answer("a1");

  assert.equal(aborted, true, "the abort is the courtesy the race does not replace");
  assert.equal(reply.reason, "timeout", "0 clamps to a real deadline, not to the ceiling");
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
  assert.equal((await p.answer("ok")).ok, true, "the page's own message is still answered");
});

test("toolchange is posted when the registry moves, and carries no payload", async () => {
  const p = page();
  register(p.window, "a", () => "a");
  p.window.document.modelContext.unregisterTool("a");
  await p.until(() => p.replies.filter((r) => r.type === "toolchange").length >= 2);

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
  await p.answer("one");
  // A second bridge would answer on the same task as the first; give it room to show itself.
  await p.settle(20);
  assert.equal(p.replies.filter((r) => r.id === "one").length, 1);
});

/**
 * An error as the demo kit's door rejects it: a message, and for a refusal a reason and
 * path-addressed errors (ADR 0146).
 * @param {any} window
 * @param {string} message
 * @param {Record<string, unknown>} fields
 */
function coded(window, message, fields) {
  return Object.assign(new window.Error(message), fields);
}

test("a tool that rejects with a page-mintable reason and errors is replied with both; any other reason is dropped", async () => {
  const p = page();
  const errors = [
    { path: "stage", code: "enum", message: 'argument "stage" must be one of "new", "hired", got "gone"' },
    { path: "extra", code: "unknown", message: 'unknown argument "extra"; allowed: stage' },
  ];
  register(p.window, "refuses", () => Promise.reject(coded(p.window, "2 arguments refused", { reason: "validator_failed", errors })));
  register(p.window, "invents", () => Promise.reject(coded(p.window, "made up", { reason: "not_a_reason" })));
  register(p.window, "stops", () => Promise.reject(coded(p.window, "aborted before it ran", { reason: "cancelled" })));
  register(p.window, "slow", () => Promise.reject(coded(p.window, "did not answer within 50 ms", { reason: "timeout" })));
  for (const id of ["c1", "c2", "c3", "c4"]) {
    p.send({ id, type: "call", name: { c1: "refuses", c2: "invents", c3: "stops", c4: "slow" }[id] });
  }
  await p.until(() => ["c1", "c2", "c3", "c4"].every((id) => p.replyTo(id) !== undefined));

  assert.deepEqual(p.replyTo("c1"), {
    __ns: NS, dir: "to-ext", id: "c1", ok: false, reason: "validator_failed", error: "2 arguments refused", errors,
  });
  assert.deepEqual(p.replyTo("c2"), { __ns: NS, dir: "to-ext", id: "c2", ok: false, error: "made up" });
  assert.equal(p.replyTo("c3").reason, "cancelled");
  assert.equal(p.replyTo("c4").reason, "timeout");
  for (const id of ["c1", "c3", "c4"]) assert.ok(REFUSAL_REASONS.includes(p.replyTo(id).reason), `${id}: a vocabulary member`);
});

test("a page cannot mint a gate's reason: a rejection carrying user_denied is replied with no reason", async () => {
  const p = page();
  register(p.window, "claims", () => Promise.reject(coded(p.window, "the user said no", { reason: "user_denied" })));
  p.send({ id: "g1", type: "call", name: "claims" });
  assert.deepEqual(await p.answer("g1"), { __ns: NS, dir: "to-ext", id: "g1", ok: false, error: "the user said no" });
});

test("a timed-out call whose tool later rejects 'cancelled' (the door answering its abort) is late ok:false with that reason", async () => {
  const p = page();
  register(p.window, "door", (/** @type {any} */ _input, /** @type {any} */ options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      p.window.setTimeout(() => reject(coded(p.window, "aborted: the caller stopped waiting", { reason: "cancelled" })), 10);
    });
  }));
  p.send({ id: "k1", type: "call", name: "door", timeout_ms: 20 });
  await p.until(() => p.replies.some((r) => r.type === "late"));
  assert.equal(p.replyTo("k1").reason, "timeout");
  const late = JSON.parse(JSON.stringify(p.replies.find((r) => r.type === "late")));
  assert.deepEqual(late, {
    __ns: NS, dir: "to-ext", id: null, type: "late", call: "k1", ok: false, output: "",
    reason: "cancelled", error: "aborted: the caller stopped waiting",
  });
});

test("a tool that resolves a domain answer {ok:false} is replied ok:true with that output: a domain answer stays an answer", async () => {
  const p = page();
  const answer = { ok: false, error: "No area with id x", available: ["a", "b"] };
  register(p.window, "open_group", () => JSON.stringify(answer));
  p.send({ id: "d1", type: "call", name: "open_group" });
  assert.deepEqual(await p.answer("d1"), { __ns: NS, dir: "to-ext", id: "d1", ok: true, output: JSON.stringify(answer) });
});
