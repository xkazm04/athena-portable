/**
 * The performance gate — README section 3.1, ADR 0089.
 *
 *   pnpm perf                                     prove the gate can pass and can fail
 *   pnpm perf --url <url> --drive <module.mjs>    run a scenario against a page
 *
 * A scenario module's default export is `async (page) => void`: it performs the one fixed path
 * (dive, rise, interrupt) and returns when the motion has finished. The gate watches the page
 * through it: frame intervals, long tasks, how many frame callbacks run in one frame, and how many
 * the page still asks for in a quiet second afterwards. `perf-budgets.mjs` judges the numbers.
 *
 * The browser is Edge on Windows (the engine WebView2 is built on) and Chrome elsewhere, or the
 * executable named by `ATHENA_BROWSER`. Playwright's own download is not needed. A browser is
 * still not the shipped shell, so the cutover phase adds a hand pass in the real window.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";

import { chromium } from "playwright-core";

import { judge } from "./perf-budgets.mjs";

const IDLE_MS = 1000;

/** Installed before any page script: the probes the run reads back. */
function installProbes() {
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const probe = { frames: [], longTasks: [], idleLongTasks: [], perFrame: new Map(), requests: 0, recording: false, idle: false };
  window.__perf = probe;

  // Count frame callbacks per frame time, excluding the gate's own sampler (it uses nativeRaf).
  window.requestAnimationFrame = (cb) => {
    probe.requests += 1;
    return nativeRaf((t) => {
      if (probe.recording) probe.perFrame.set(t, (probe.perFrame.get(t) ?? 0) + 1);
      cb(t);
    });
  };

  let last = 0;
  const sample = (t) => {
    if (probe.recording && last) probe.frames.push(t - last);
    last = t;
    nativeRaf(sample);
  };
  nativeRaf(sample);

  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (probe.idle) probe.idleLongTasks.push(e.duration);
      else if (probe.recording) probe.longTasks.push(e.duration);
    }
  }).observe({ type: "longtask", buffered: false });
}

async function launch() {
  const executablePath = process.env.ATHENA_BROWSER;
  if (executablePath) return chromium.launch({ executablePath });
  return chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chrome" });
}

/** Run `drive` against an already-opened page and return the judged numbers. */
export async function measure(page, drive) {
  await page.evaluate(() => {
    window.__perf.recording = true;
  });
  await drive(page);
  await page.evaluate(() => {
    const p = window.__perf;
    p.recording = false;
    p.idle = true;
    p.requestsAtIdle = p.requests;
  });
  await page.waitForTimeout(IDLE_MS);
  const samples = await page.evaluate(() => {
    const p = window.__perf;
    return {
      frames: p.frames,
      longTasks: p.longTasks,
      loopsPerFrame: Math.max(0, ...p.perFrame.values()),
      idleFrameRequests: p.requests - p.requestsAtIdle,
      idleLongTasks: p.idleLongTasks,
    };
  });
  return judge(samples);
}

export async function runPage(browser, open, drive) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await context.addInitScript(installProbes);
  const page = await context.newPage();
  await open(page);
  const result = await measure(page, drive);
  await context.close();
  return result;
}

const show = (label, r) =>
  console.log(`${r.ok ? "pass" : "FAIL"}  ${label}  ${JSON.stringify(r.metrics)}${r.failures.map((f) => `\n        - ${f}`).join("")}`);

// The self-test: a still page must pass and a deliberately janky one must fail, or the gate is a
// rubber stamp. Both are inline pages, so it needs no dev server.
const STILL = "<!doctype html><body><p>still</p>";
const JANKY = `<!doctype html><body><p>janky</p><script>
  const burn = (ms) => { const e = performance.now() + ms; while (performance.now() < e); };
  for (let i = 0; i < 3; i++) { const loop = () => { burn(i === 0 ? 70 : 1); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
</script>`;
const wait = (ms) => async (page) => page.waitForTimeout(ms);

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? null : args[i + 1];
  };
  const browser = await launch();
  let failed = false;
  try {
    const url = arg("--url");
    if (url) {
      const driveFile = arg("--drive");
      if (!driveFile) throw new Error("--url needs --drive <module.mjs>");
      const drive = (await import(pathToFileURL(path.resolve(driveFile)).href)).default;
      const r = await runPage(browser, (page) => page.goto(url), drive);
      show(url, r);
      failed = !r.ok;
    } else {
      const still = await runPage(browser, (p) => p.setContent(STILL), wait(800));
      const janky = await runPage(browser, (p) => p.setContent(JANKY), wait(800));
      show("self-test: a still page", still);
      show("self-test: a janky page", janky);
      if (!still.ok) {
        console.error("the gate fails a page that does nothing; its thresholds are wrong for this machine");
        failed = true;
      }
      if (janky.ok) {
        console.error("the gate passes a page that blocks the main thread; it cannot fail");
        failed = true;
      }
    }
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
