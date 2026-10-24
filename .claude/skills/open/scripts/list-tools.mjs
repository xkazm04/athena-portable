#!/usr/bin/env node
/**
 * list-tools: what a built web app registers on `document.modelContext`, through Athena's own
 * `inject.js` and the bridge protocol, as JSON on stdout (the relay's `list` answer: `{ ok, page,
 * tools }`). No Athena, no model, no backend needed when the catalogue registers without one.
 *
 *   node list-tools.mjs --desktop <athena-portable>/apps/desktop --dist <app>/dist \
 *     [--storage key=value ...] [--query "?daemon=http://127.0.0.1:1"] [--wait-ms 20000] > tools.json
 *   node catalog-check.mjs tools.json
 *
 * `--desktop` is where `playwright-core` and `@athena/bridge/inject` resolve (athena-portable's
 * `apps/desktop`, after `pnpm install`). `--dist` is the app's built frontend, served from this
 * process on an ephemeral port and opened as `http://localhost:<port>/` (Athena admits `localhost`,
 * never `127.0.0.1`). `--storage` seeds `localStorage` before the app's scripts run: the app's
 * opt-in, e.g. `--storage shadowrunr.athena.drive=1`. Exit 1 when no tool registered in time.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

const args = process.argv.slice(2);
const one = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const many = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const desktop = one("--desktop");
const dist = one("--dist");
if (!desktop || !dist) {
  console.error("usage: node list-tools.mjs --desktop <athena-portable>/apps/desktop --dist <app dist> [--storage k=v] [--query ?x=y] [--wait-ms n]");
  process.exit(1);
}
const storage = Object.fromEntries(many("--storage").map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
const query = one("--query", "");
const waitMs = Number(one("--wait-ms", "20000"));

const require = createRequire(join(resolve(desktop), "package.json"));
const { chromium } = require("playwright-core");
const inject = require.resolve("@athena/bridge/inject");

const root = resolve(dist);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  let file = normalize(join(root, decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname)));
  if (!file.startsWith(root + sep) && file !== root) return void res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const port = server.address().port;

const browser = await chromium.launch({ headless: true, ...(process.env.ATHENA_BROWSER ? { executablePath: process.env.ATHENA_BROWSER } : {}) });
let code = 0;
try {
  const page = await (await browser.newContext()).newPage();
  await page.addInitScript({ path: inject });
  if (Object.keys(storage).length > 0) {
    await page.addInitScript({ content: `(() => { try { var e = ${JSON.stringify(storage)}; for (var k in e) localStorage.setItem(k, e[k]); } catch (x) {} })();` });
  }
  await page.goto(`http://localhost:${port}/${query}`, { waitUntil: "load" });
  const list = () =>
    page.evaluate(
      () =>
        new Promise((ok) => {
          const id = `list-${Date.now()}-${Math.random()}`;
          const timer = setTimeout(() => ok({ ok: false, error: "no bridge answered" }), 5000);
          const on = (e) => {
            const m = e.data;
            if (e.source !== window || !m || m.__ns !== "athena-webmcp" || m.dir !== "to-ext" || m.id !== id) return;
            removeEventListener("message", on);
            clearTimeout(timer);
            ok(m);
          };
          addEventListener("message", on);
          postMessage({ __ns: "athena-webmcp", dir: "to-page", id, type: "list" }, location.origin);
        }),
    );
  const until = Date.now() + waitMs;
  let answer = await list();
  while ((answer.tools ?? []).length === 0 && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 250));
    answer = await list();
  }
  console.log(JSON.stringify(answer, null, 2));
  if ((answer.tools ?? []).length === 0) {
    console.error(`no tools registered in ${waitMs} ms (is the opt-in seeded with --storage? does the catalogue need its backend?)`);
    code = 1;
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
