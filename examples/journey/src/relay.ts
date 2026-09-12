/**
 * README section 3.4 tier 1 — the surface's relay, over the wire format in
 * `packages/athena-bridge/protocol.md`.
 *
 * The page is driven the way the desktop shell and the side panel drive it and no other way:
 * `inject.js` is added with `page.addInitScript` so it runs in the main world at document start,
 * and every `list` and `call` is an `athena-webmcp` postMessage with a minted id. Nothing here
 * touches `document.modelContext` — reaching past the bridge would test a path no surface runs
 * and would quietly skip the origin and source guards the protocol leans on.
 *
 * The relay half is itself an init script: in a real surface it is the extension's content script
 * or the webview's preload, and it is the party that mints ids, matches replies and owns the
 * outer 35 s timeout that covers a page which is frozen or has no bridge at all.
 */
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import type { GateTool, PageIdentity } from "@athena/bridge/gate";

const require = createRequire(import.meta.url);

/** The one file every surface injects. Resolved through the workspace package, never copied. */
export const INJECT_PATH: string = require.resolve("@athena/bridge/inject");

export interface ListAnswer {
  ok: true;
  page: PageIdentity;
  tools: GateTool[];
}

export interface CallOk {
  ok: true;
  output: string;
}

export interface CallRefused {
  ok: false;
  reason?: string;
  error: string;
}

export type CallAnswer = CallOk | CallRefused;

/** The relay's own half of the protocol, as a classic script for the main world. */
const RELAY_SOURCE = `(() => {
  "use strict";
  var NS = "athena-webmcp";
  var seq = 0;
  var pending = new Map();
  window.__athenaEvents = [];
  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    if (event.origin !== location.origin) return;
    var msg = event.data;
    if (!msg || typeof msg !== "object" || msg.__ns !== NS || msg.dir !== "to-ext") return;
    if (msg.id === null || msg.id === undefined) { window.__athenaEvents.push(String(msg.type)); return; }
    var entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    entry.resolve(msg);
  });
  window.__athenaRelay = function (request) {
    return new Promise(function (resolve) {
      var id = Date.now() + "-" + ++seq;
      var timer = setTimeout(function () {
        pending.delete(id);
        resolve({ ok: false, reason: "timeout", error: "the page did not answer within 35000 ms" });
      }, 35000);
      pending.set(id, { resolve: resolve, timer: timer });
      var message = { __ns: NS, dir: "to-page", id: id };
      for (var key in request) message[key] = request[key];
      window.postMessage(message, location.origin);
    });
  };
})();`;

/** Install both halves at document start. Order matters: the page's bridge first, then the relay. */
export async function installBridge(page: Page): Promise<void> {
  await page.addInitScript({ path: INJECT_PATH });
  await page.addInitScript({ content: RELAY_SOURCE });
}

async function send(page: Page, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return page.evaluate(
    (req) => (window as unknown as { __athenaRelay(r: unknown): Promise<Record<string, unknown>> }).__athenaRelay(req),
    request,
  );
}

/**
 * `list`: what the page registered, right now. A page whose globals were frozen never answers and
 * the relay's timer turns that into a refusal rather than a hang (protocol.md, "No bridge").
 */
export async function list(page: Page): Promise<ListAnswer> {
  const answer = await send(page, { type: "list" });
  if (answer.ok !== true) throw new Error(`list refused: ${String(answer.error)}`);
  return answer as unknown as ListAnswer;
}

/** `call`: run one registered tool. A refusal is a value; the relay never drops a pending entry. */
export async function call(page: Page, name: string, input: Record<string, unknown> = {}): Promise<CallAnswer> {
  const answer = await send(page, { type: "call", name, input });
  return answer as unknown as CallAnswer;
}

/** How many `toolchange` events the page has posted since load — the manifest's staleness signal. */
export async function toolchanges(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __athenaEvents: string[] }).__athenaEvents.slice());
}
