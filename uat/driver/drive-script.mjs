#!/usr/bin/env node
/**
 * The L2 driver for the desktop app: one process, the whole journey inline (uat skill, "Driver & environment").
 *
 * It attaches to the running shell's WebView2 over CDP (the app must be started with
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222, see uat/env.md), exposes the two
 * privileged pages as `athena` and `chrome`, every browsed tab as `pages()`, and real-pixel window crops via
 * `crop()` (a transparent window has no pixels of its own; the screen does).
 *
 * Usage:  node uat/driver/drive-script.mjs <runDir> <name> <<'EOF'  ...steps...  EOF
 * Exit codes are the verdict: 0 ran and every expect() passed, 1 the driver threw, 2 an expect() failed.
 * A failed expect is a finding, never a reason to loosen an assertion.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, "../../examples/journey/package.json"));
const { chromium } = require("@playwright/test");

const [runDir, name] = process.argv.slice(2);
if (!runDir || !name) {
  console.error("usage: drive-script.mjs <runDir> <name> < steps");
  process.exit(1);
}
const shots = path.resolve(runDir, "shots");
fs.mkdirSync(shots, { recursive: true });
const checks = [];
const notes = [];
const t0 = Date.now();
const log = (...a) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const browser = await chromium.connectOverCDP(process.env.CDP ?? "http://127.0.0.1:9222");
const all = () => browser.contexts().flatMap((c) => c.pages());
const byUrl = (frag) => all().find((p) => p.url().includes(frag));

const api = {
  browser,
  pages: all,
  get athena() { return byUrl("athena.html"); },
  get chrome() { return byUrl("chrome.html"); },
  /** every browsed tab (not one of our two privileged pages) */
  tabs: () => all().filter((p) => !/athena\.html|chrome\.html/.test(p.url())),
  log,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  note: (text) => { notes.push(text); log("note:", text); },
  /** invoke a Tauri command from a privileged page */
  invoke: (page, cmd, args = {}) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]),
  /** the OS windows of the shell as [{rect:[l,t,r,b], w, h}] and, when `tag` is set, a PNG of each. */
  crop(tag) {
    const prefix = path.join(shots, `${name}-${tag ?? "tmp"}`).replaceAll("\\", "/");
    const out = execFileSync("powershell", ["-NoProfile", "-File", path.join(here, "crop.ps1"), "-outprefix", prefix]).toString();
    const wins = [...out.matchAll(/(\S+\.png) rect=(-?\d+),(-?\d+),(-?\d+),(-?\d+)/g)].map((m) => ({
      file: m[1], rect: [+m[2], +m[3], +m[4], +m[5]], w: +m[4] - +m[2], h: +m[5] - +m[3],
    }));
    if (!tag) for (const w of wins) fs.rmSync(w.file, { force: true });
    return wins;
  },
  async waitUntil(fn, { label = "condition", timeout = 15000, every = 250 } = {}) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      try { last = await fn(); if (last) return last; } catch (e) { last = e; }
      await api.sleep(every);
    }
    throw new Error(`timed out waiting for ${label}`);
  },
  /** record a verdict. A false check is a finding: the process exits 2. */
  expect(label, ok, detail = {}) {
    checks.push({ label, ok: !!ok, ...detail });
    log(ok ? "PASS" : "FAIL", label, Object.keys(detail).length ? JSON.stringify(detail) : "");
    return ok;
  },
};

let code = 0;
try {
  const src = fs.readFileSync(0, "utf8");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(...Object.keys(api), src)(...Object.values(api));
} catch (e) {
  log("DRIVER ERROR", e?.stack ?? e);
  notes.push(`driver error: ${String(e).slice(0, 300)}`);
  code = 1;
}
if (!code && checks.some((c) => !c.ok)) code = 2;
const journal = { name, ms: Date.now() - t0, code, checks, notes };
fs.writeFileSync(path.resolve(runDir, `${name}.journal.json`), JSON.stringify(journal, null, 2));
console.log(JSON.stringify(journal));
try { await browser.close(); } catch { /* the app owns the browser; closing our handle is all that is asked */ }
process.exit(code);
