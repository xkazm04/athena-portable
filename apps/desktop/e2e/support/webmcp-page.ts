/**
 * Any web app in a real Chromium, with Athena's bridge in it: README section 3.4 tier 1, for
 * whichever app a suite drives (`/open verify`, level 1). `../shadowrunr/support/browser.ts` is
 * the Shadowrunr console's use of it.
 *
 * The page is driven the way `examples/journey/src/relay.ts` drives one: `inject.js` is added
 * with `addInitScript` so it runs in the main world at document start, before the app's own
 * scripts, and every `list` and `call` is an `athena-webmcp` postMessage with a minted id through
 * a relay init script. Nothing here touches `document.modelContext` directly; reaching past the
 * bridge would test a path no surface runs.
 *
 * `storage` seeds `localStorage` before the app's scripts run, which is how a suite switches on
 * an app's own opt-in (e.g. `{ "shadowrunr.athena.drive": "1" }`) so its catalog registers on
 * first load. The shell's generic hands (tier 2, `hands.js`) are not installed: the app publishes
 * its own tools, and `manifestBodyOf` appends hands only inside the shell.
 */
import { createRequire } from "node:module";
import { chromium, type Browser, type Page } from "playwright-core";

import type { BridgeTool } from "@/lib/bridge";

const require = createRequire(import.meta.url);

/** The one file every surface injects, resolved through the workspace package, never copied. */
export const INJECT_PATH: string = require.resolve("@athena/bridge/inject");

/** The relay's half of the protocol, as `examples/journey/src/relay.ts` writes it. */
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

/** An init script that writes `entries` into `localStorage` before the app's scripts run. */
function storageScript(entries: Readonly<Record<string, string>>): string {
  return `(() => { try { var e = ${JSON.stringify(entries)}; for (var k in e) localStorage.setItem(k, e[k]); } catch (x) {} })();`;
}

export interface PageIdentity {
  origin: string;
  href: string;
  title: string;
  app_id: string | null;
  app_name: string | null;
  app_version: string | null;
  transport: string;
}

export interface ListAnswer {
  ok: true;
  page: PageIdentity;
  tools: BridgeTool[];
}

export interface CallAnswer {
  ok: boolean;
  output?: string;
  error?: string;
  reason?: string;
}

export interface AppPage {
  browser: Browser;
  page: Page;
  /** The URL the page was opened at. */
  url: string;
  list: () => Promise<ListAnswer>;
  call: (name: string, input: Record<string, unknown>) => Promise<CallAnswer>;
  hash: () => Promise<string>;
  /** Set `location.hash` and wait for the app's router to have it. */
  goHash: (hash: string) => Promise<void>;
  /** Wait until the relay lists at least `atLeast` tools (a catalog is often a dynamic chunk). */
  waitForTools: (atLeast?: number, timeoutMs?: number) => Promise<ListAnswer>;
  close: () => Promise<void>;
}

export interface OpenAppOptions {
  /** `localStorage` entries set before the app's scripts run: the app's opt-in, typically. */
  storage?: Readonly<Record<string, string>>;
  viewport?: { width: number; height: number };
}

export async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.ATHENA_BROWSER;
  return chromium.launch(executablePath ? { executablePath, headless: true } : { headless: true });
}

/** Open `url` in a fresh context of `browser`, with the bridge and the relay installed. */
export async function openAppPage(browser: Browser, url: string, options: OpenAppOptions = {}): Promise<AppPage> {
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript({ path: INJECT_PATH });
  await page.addInitScript({ content: RELAY_SOURCE });
  if (options.storage && Object.keys(options.storage).length > 0) await page.addInitScript({ content: storageScript(options.storage) });
  await page.goto(url, { waitUntil: "load" });

  const send = (request: Record<string, unknown>) =>
    page.evaluate(
      (req) => (window as unknown as { __athenaRelay(r: unknown): Promise<Record<string, unknown>> }).__athenaRelay(req),
      request,
    );
  const list = async (): Promise<ListAnswer> => {
    const answer = await send({ type: "list" });
    if (answer.ok !== true) throw new Error(`list refused: ${String(answer.error)}`);
    return answer as unknown as ListAnswer;
  };
  const hash = () => page.evaluate(() => location.hash);
  return {
    browser,
    page,
    url,
    list,
    call: async (name, input) => (await send({ type: "call", name, input })) as unknown as CallAnswer,
    hash,
    goHash: async (h) => {
      await page.evaluate((next) => {
        location.hash = next;
      }, h);
      await page.waitForFunction((next) => location.hash === next, h, { timeout: 10_000 });
    },
    waitForTools: async (atLeast = 1, timeoutMs = 20_000) => {
      const until = Date.now() + timeoutMs;
      let last: ListAnswer = await list();
      while (last.tools.length < atLeast && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 200));
        last = await list();
      }
      return last;
    },
    close: () => context.close(),
  };
}
