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
