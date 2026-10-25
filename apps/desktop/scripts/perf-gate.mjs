/**
 * The performance gate — README section 3.1, ADR 0089.
 *
 *   pnpm perf                                     prove the gate can pass and can fail
 *   pnpm perf --url <url> --drive <module.mjs>    run a scenario against a page
 *   pnpm perf:stage | perf:bell                   build, serve and drive a preview scene
 *                                                 (scripts/perf-<scene>.drive.mjs)
 *   pnpm perf:all                                 the self-test, then every scene with a drive
 *                                                 from one build, each judged even when one fails
 *
 * Each scene is read beside a still control, measured in the same browser right after it: a scene
 * that misses only wall-clock budgets while the still page misses one too is INCONCLUSIVE (the
 * machine), not green and not the scene's fault; the run still exits 1 (ADR 0216). Every line shows
 * the headroom left under each budget, and a scene run writes dist-perf/perf-report.json.
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
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { chromium } from "playwright-core";

import { BUDGETS, judge, verdict } from "./perf-budgets.mjs";
import { attributeTasks, recordingPage } from "./perf-trace.mjs";

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
      // The start is kept, on the page's clock, so the gate can tie the task to the drive's step.
      const task = { start: e.startTime, duration: e.duration };
      if (probe.idle) probe.idleLongTasks.push(task);
      else if (probe.recording) probe.longTasks.push(task);
    }
  }).observe({ type: "longtask", buffered: false });
}

async function launch() {
  const executablePath = process.env.ATHENA_BROWSER;
  if (executablePath) return chromium.launch({ executablePath });
  return chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chrome" });
}

/**
 * Run `drive` against an already-opened page and return the judged numbers. The drive gets a
 * recording page (`perf-trace.mjs`), so each long task is judged with the step it ran under.
 */
export async function measure(page, drive) {
  const timeOrigin = await page.evaluate(() => {
    window.__perf.recording = true;
    return performance.timeOrigin;
  });
  const recorded = recordingPage(page);
  await drive(recorded.page);
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
  return judge({
    ...samples,
    longTasks: attributeTasks(samples.longTasks, recorded.actions, timeOrigin),
    idleLongTasks: attributeTasks(
      samples.idleLongTasks.map((t) => ({ ...t, idle: true })),
      recorded.actions,
      timeOrigin,
    ),
  });
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

const stateOf = (r) => r.state ?? (r.ok ? "pass" : "fail");
const LABEL = { pass: "pass", fail: "FAIL", inconclusive: "INCONCLUSIVE" };

/**
 * One scene's line: its state, the numbers, the headroom left under each budget (when it was read
 * beside a control), then each failure and, for an inconclusive scene, what the control missed.
 */
export function formatLine(label, r) {
  const room = r.headroom ? `  headroom ${JSON.stringify(r.headroom)}` : "";
  const notes = [...r.failures, ...(r.reason ? [r.reason] : [])];
  return `${LABEL[stateOf(r)]}  ${label}  ${JSON.stringify(r.metrics)}${room}${notes.map((f) => `\n        - ${f}`).join("")}`;
}

const show = (label, r) => console.log(formatLine(label, r));

/** The run in one line: how many scenes passed, failed and were inconclusive. */
export function summarize(results) {
  const n = (state) => results.filter((r) => stateOf(r) === state).length;
  const inconclusive = n("inconclusive");
  return `${n("pass")} passed, ${n("fail")} failed, ${inconclusive} inconclusive${inconclusive ? " (the machine: re-run)" : ""}`;
}

/** The record a scene run leaves: the budgets, then each scene with its state, numbers, headroom and control. */
export function report(results, budgets = BUDGETS) {
  return {
    budgets,
    scenes: results.map((r) => ({
      name: r.name,
      state: stateOf(r),
      metrics: r.metrics,
      headroom: r.headroom ?? null,
      control: r.control ?? null,
    })),
  };
}

// The self-test: a still page must pass and a deliberately janky one must fail, or the gate is a
// rubber stamp. Both are inline pages, so it needs no dev server.
const STILL = "<!doctype html><body><p>still</p>";
const JANKY = `<!doctype html><body><p>janky</p><script>
  const burn = (ms) => { const e = performance.now() + ms; while (performance.now() < e); };
  for (let i = 0; i < 3; i++) { const loop = () => { burn(i === 0 ? 70 : 1); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
</script>`;
/**
 * Build the preview and serve it with `vite preview`: a production bundle, which is what ships,
 * not the dev server with its hot-reload client. Returns the base URL and a stop function.
 */
/** A free port, asked of the OS, so two gate runs at once (two worktrees) never share a server. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function serveBuild() {
  const port = await freePort();
  const build = spawnSync("pnpm exec vite build --outDir dist-perf --emptyOutDir", {
    stdio: "ignore",
    shell: true,
  });
  if (build.status !== 0) throw new Error("vite build failed; run `pnpm build` to see why");
  const server = spawn(`pnpm exec vite preview --outDir dist-perf --port ${port} --strictPort`, {
    stdio: "ignore",
    shell: true,
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${base}/preview.html`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const stop = () => {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else server.kill();
  };
  return { base, stop };
}

const wait = (ms) => async (page) => page.waitForTimeout(ms);

/** Every scene with a drive in `dir` (`perf-<scene>.drive.mjs`), so `--all` keeps no list of its own. */
export function drivesIn(dir) {
  return readdirSync(dir instanceof URL ? fileURLToPath(dir) : dir)
    .map((f) => /^perf-([a-z]+)\.drive\.mjs$/.exec(f)?.[1])
    .filter(Boolean)
    .sort();
}

/**
 * Judge each scene in turn. A scene that fails, or whose drive throws (a control it presses is
 * gone), is shown as a failure and the next scene still runs, so one red never hides the verdicts
 * after it. A scene may answer with a `verdict` (pass, fail or inconclusive); anything that is not
 * a pass fails the run, so an inconclusive scene never exits green. `done` gets the summary line and
 * every result. Returns whether any did not pass.
 */
export async function runScenes(scenes, runOne, show, done = () => {}) {
  const results = [];
  for (const name of scenes) {
    let r;
    try {
      r = await runOne(name);
    } catch (error) {
      const line = String(error instanceof Error ? error.message : error).split("\n")[0];
      r = { state: "fail", ok: false, metrics: {}, failures: [`the drive did not finish: ${line}`] };
    }
    show(name, r);
    results.push({ name, ...r });
  }
  done(summarize(results), results);
  return results.some((r) => stateOf(r) !== "pass");
}

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
    const scene = args.includes("--stage") ? "stage" : arg("--scene");
    const scenes = args.includes("--all") ? drivesIn(path.resolve("scripts")) : scene ? [scene] : [];
    if (scenes.length) {
      const { base, stop } = await serveBuild();
      const titles = new Map();
      try {
        failed = await runScenes(
          scenes,
          async (name) => {
            const drive = (await import(pathToFileURL(path.resolve(`scripts/perf-${name}.drive.mjs`)).href)).default;
            titles.set(name, drive.title ?? "scenario");
            // A drive may open another scene than its name (a skin is measured on the stage's scene).
            const scene = await runPage(browser, (page) => page.goto(`${base}/preview.html?scene=${drive.scene ?? name}${drive.query ?? ""}`), drive);
            // The still control, in the same browser, right after: the machine's reading this minute.
            const control = await runPage(browser, (p) => p.setContent(STILL), wait(800));
            return verdict(scene, control);
          },
          (name, r) => show(`${name} (${titles.get(name) ?? "scenario"})`, r),
          (line, results) => {
            console.log(line);
            mkdirSync(path.resolve("dist-perf"), { recursive: true });
            writeFileSync(path.resolve("dist-perf/perf-report.json"), `${JSON.stringify(report(results), null, 2)}\n`);
          },
        );
      } finally {
        stop();
      }
    } else if (url) {
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
      // The janky page is read the way a scene is, beside the still control: it must still fail.
      const jankyVerdict = verdict(janky, still);
      show("self-test: a janky page", jankyVerdict);
      if (!still.ok) {
        console.error("the gate fails a page that does nothing; its thresholds are wrong for this machine");
        failed = true;
      }
      if (jankyVerdict.state !== "fail") {
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
