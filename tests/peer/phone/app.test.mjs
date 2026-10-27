// The phone page itself (src/athena/peer/mobile/app.js), run in jsdom against a scripted beacon.
// Run with `node --test tests/peer/phone/`; tests/peer/test_phone_turn.py runs it under pytest.
//
// app.js starts at import and touches `document`, so each case builds a fresh JSDOM from index.html,
// puts its window's pieces on globalThis, and imports app.js under a new query string.
// jsdom is the desktop app's devDependency (apps/desktop/node_modules); the suite skips without it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const MOBILE = new URL("../../../src/athena/peer/mobile/", import.meta.url);

let JSDOM = null;
for (const home of ["../../../apps/desktop/", "../../../packages/athena-bridge/"]) {
  try {
    JSDOM = createRequire(new URL(`${home}package.json`, import.meta.url))("jsdom").JSDOM;
    break;
  } catch {
    // try the next workspace
  }
}
const skip = JSDOM ? false : "jsdom is not installed";

const encoder = new TextEncoder();
const realSetInterval = globalThis.setInterval;
let loads = 0;

function sse(events) {
  const text = events.map((event, index) => `id: ${index}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  const closing = `event: remote.closed\ndata: ${JSON.stringify({ kind: "remote.closed", reason: "finished" })}\n\n`;
  return new Response(encoder.encode(`: athena turn\nretry: 3000\n\n${text}${closing}`), { status: 200 });
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

/** A fresh page on a scripted beacon. `route(method, path, init)` returns a Response. */
async function page({ route, token = true }) {
  const dom = new JSDOM(readFileSync(new URL("index.html", MOBILE), "utf8"), {
    url: "http://100.64.0.2:8765/m/",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = () => {};
  if (token) window.localStorage.setItem("athena.peer.v1", JSON.stringify({ token: "tok", peer_id: "p", device_id: "d", beacon_name: "Desk" }));
  const requests = [];
  const intervals = [];
  const patch = {
    document: window.document,
    window,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    location: window.location,
    history: window.history,
    fetch: async (path, init = {}) => {
      const headers = init.headers || {};
      requests.push({ method: init.method || "GET", path, bearer: headers.Authorization || null });
      return route(init.method || "GET", path, init);
    },
    setInterval: (fn, ms) => {
      const handle = realSetInterval(fn, ms);
      handle.unref();
      intervals.push(handle);
      return handle;
    },
  };
  for (const [key, value] of Object.entries(patch)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  loads += 1;
  await import(`${new URL("app.js", MOBILE).href}?case=${loads}`);
  return { window, document: window.document, requests, intervals, close: () => intervals.forEach(clearInterval) };
}

async function until(check, what, ms = 5000) {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const quiet = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

// --- a removed phone goes quiet -------------------------------------------------------------------

test("a phone the beacon removed sends nothing more with its dead token when the screen wakes", { skip }, async () => {
  const phone = await page({
    route: (method, path) => (path === "/peer/hello" ? json(401, { error: "unauthorized" }) : json(200, { pending: [] })),
  });
  await until(() => phone.document.body.textContent.includes("This phone was removed"), "the removed panel");
  assert.equal(phone.window.localStorage.getItem("athena.peer.v1"), null);
  await quiet(200); // ready() finishes arming the page (or, once fixed, never does)
  const before = phone.requests.length;
  Object.defineProperty(phone.document, "visibilityState", { value: "visible", configurable: true });
  phone.document.dispatchEvent(new phone.window.Event("visibilitychange"));
  await quiet();
  const knocks = phone.requests.slice(before).filter((request) => request.bearer);
  assert.deepEqual(knocks, [], "requests carrying the revoked bearer after the wake");
  phone.close();
});

// --- a streamed answer is announced once ----------------------------------------------------------

/** Whether a node is inside a live region a screen reader announces, as the ARIA tree says. */
function announced(node) {
  for (let at = node.nodeType === 1 ? node : node.parentElement; at; at = at.parentElement) {
    if (at.getAttribute("aria-hidden") === "true") return false;
    const live = at.getAttribute("aria-live");
    if (live === "off") return false;
    if (live === "polite" || live === "assertive") return true;
    if (["log", "status", "alert"].includes(at.getAttribute("role"))) return true;
  }
  return false;
}

test("a streamed answer reaches a screen reader once, not once per delta", { skip }, async () => {
  const words = Array.from({ length: 20 }, (_, index) => `ans${index} `);
  const events = [...words.map((text) => ({ kind: "text.delta", text })), { kind: "turn.finished", text: words.join("") }];
  const phone = await page({
    route: (method, path) => {
      if (path === "/peer/hello") return json(200, { name: "Desk" });
      if (path === "/peer/decisions") return json(200, { pending: [] });
      if (path === "/peer/message") return json(200, { request_id: "job_0123456789ab" });
      if (path.startsWith("/peer/turns/")) return sse(events);
      return json(404, {});
    },
  });
  await until(() => phone.document.querySelector(".composer"), "the chat view");
  let heard = 0;
  const watcher = new phone.window.MutationObserver((records) => {
    for (const record of records) {
      const added = record.type === "characterData" ? [record.target] : [...record.addedNodes].filter((node) => announced(node));
      const text = record.type === "characterData" ? record.target.data : added.map((node) => node.textContent).join("");
      if (text.includes("ans") && announced(record.target)) heard += 1;
    }
  });
  watcher.observe(phone.document.body, { childList: true, characterData: true, subtree: true });
  phone.document.querySelector(".composer textarea").value = "hello";
  phone.document.querySelector(".composer").dispatchEvent(new phone.window.Event("submit", { cancelable: true }));
  await until(() => phone.requests.some((request) => request.path.startsWith("/peer/turns/")), "the turn");
  await until(() => !phone.document.querySelector(".composer button").disabled, "the turn to finish");
  await quiet();
  watcher.disconnect();
  assert.ok(phone.document.querySelector(".msg.her").textContent.includes("ans19"), "the answer is on the page");
  assert.equal(phone.document.querySelector(".msg.her").hasAttribute("aria-hidden"), false, "and readable once finished");
  assert.equal(heard, 1, "announcements of her answer");
  assert.equal(phone.document.getElementById("app").hasAttribute("aria-live"), false, "<main> must not be one big live region");
  phone.close();
});

test("a waiting card is drawn inside a live region, so the person hears that Athena is waiting", { skip }, async () => {
  const card = { id: "dec_1", action: "connector.setup.install_overlay", rationale: "r", params: {}, options: ["approve", "decline"] };
  const phone = await page({
    route: (method, path) => (path === "/peer/decisions" ? json(200, { pending: [card] }) : json(200, { name: "Desk" })),
  });
  const drawn = await until(() => phone.document.querySelector("article.card"), "the card");
  assert.equal(announced(drawn), true, "a card the person must answer is in a live region");
  phone.close();
});
