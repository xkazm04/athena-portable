#!/usr/bin/env node
/**
 * docs/demo.md section 5 ("desktop" segment): the desktop app on camera, driven over CDP.
 *
 * The desktop shell is WebView2, so Playwright cannot record it the way it records its own pages,
 * and a transparent window has no pixels of its own (uat/env.md). So the picture is the screen:
 * ffmpeg grabs the rectangle the app's windows cover (`ddagrab`, the Desktop Duplication API, or
 * `gdigrab` where ddagrab is missing or fails), and this driver attaches to the running shell
 * over CDP, plays the script's `desktop` acts beat by beat, and logs every beat's offset on the
 * capture's clock to `take/desktop.take.json`. A beat with a `cue` first waits for it on the
 * page (`card`: a decision card is up; `decided`: it is stamped), and the wait is logged as a
 * speed-up range, exactly as the proving recorder does.
 *
 * The app must be started with its CDP port open (docs/demo.md section 5, uat/env.md):
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 ./athena-desktop.exe
 *
 * Usage:
 *   node scripts/record-desktop.mjs [--dry] [--cdp http://127.0.0.1:9222] [--window all|largest]
 *        [--grabber ddagrab|gdigrab] [--process athena-desktop] [--cue-timeout-s 300]
 *
 * --dry needs no app: it prints the beats, their holds and steps, the grabbers this ffmpeg has,
 * and the ffmpeg command it would run (for the app's real windows when the app is up, for a
 * sample rectangle when it is not).
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const JOURNEY = path.resolve(HERE, '..');
const TAKE = path.join(JOURNEY, 'take');
const VIDEO = path.join(TAKE, 'desktop.mp4');
const OFFSETS = path.join(TAKE, 'desktop.take.json');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 25;
const MIN_SPEEDUP_MS = 2500;

function parseArgs(argv) {
  const args = {
    dry: false,
    cdp: process.env.CDP ?? 'http://127.0.0.1:9222',
    window: 'all',
    grabber: null,
    processName: 'athena-desktop',
    cueTimeoutMs: 300_000,
    script: process.env.JOURNEY_SCRIPT
      ? path.resolve(JOURNEY, process.env.JOURNEY_SCRIPT)
      : path.join(JOURNEY, 'script', 'proving.en.json'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry') args.dry = true;
    else if (a === '--cdp') args.cdp = argv[(i += 1)];
    else if (a === '--window') args.window = argv[(i += 1)];
    else if (a === '--grabber') args.grabber = argv[(i += 1)];
    else if (a === '--process') args.processName = argv[(i += 1)];
    else if (a === '--cue-timeout-s') args.cueTimeoutMs = Number(argv[(i += 1)]) * 1000;
    else if (a === '--script') args.script = path.resolve(JOURNEY, argv[(i += 1)] ?? '');
    else if (a === '--help' || a === '-h') {
      console.log('node scripts/record-desktop.mjs [--dry] [--cdp url] [--window all|largest] [--grabber ddagrab|gdigrab]');
      process.exit(0);
    } else fail(`unknown argument: ${a}`);
  }
  if (!['all', 'largest'].includes(args.window)) fail('--window is all or largest');
  if (args.grabber && !['ddagrab', 'gdigrab'].includes(args.grabber)) fail('--grabber is ddagrab or gdigrab');
  return args;
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

// ---------------------------------------------------------------- the script's clock

/** `src/script.ts`'s hold rule, restated for a plain .mjs: max(clip, settle) + breath. */
function holdOf(beat, script, durations) {
  let clip = Number(durations[beat.id]);
  if (!(clip > 0)) {
    clip = script.chars_per_second
      ? (beat.line.length / script.chars_per_second) * 1000
      : (beat.line.split(/\s+/).filter(Boolean).length / (script.words_per_second || 2.5)) * 1000;
  }
  return Math.round(Math.max(clip, Number(beat.settle_ms) || 0) + (Number(script.breath_ms) || 0));
}

function captionOf(beat) {
  if (beat.voice === 'mira') return `Mira: ${beat.line}`;
  if (beat.voice === 'athena') return `Athena: ${beat.line}`;
  return beat.line;
}

// ---------------------------------------------------------------- the picture

async function windowRects(processName) {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'window-rect.ps1'), '-process', processName,
    ]);
    return [...stdout.matchAll(/rect=(-?\d+),(-?\d+),(-?\d+),(-?\d+)/g)].map((m) => ({
      l: +m[1], t: +m[2], r: +m[3], b: +m[4],
    }));
  } catch {
    return [];
  }
}

/** Below this a window is the shell's floating presence mark, not a window worth filming. */
const MIN_SIDE = 200;

/**
 * The capture rectangle: the union of the app's real windows (the browser window and Athena's),
 * or only the largest; even sides, because yuv420p will not encode an odd one.
 */
function regionOf(rects, mode) {
  const real = rects.filter((r) => r.r - r.l >= MIN_SIDE && r.b - r.t >= MIN_SIDE);
  if (real.length === 0) return null;
  const pick = mode === 'largest'
    ? [real.reduce((a, b) => ((b.r - b.l) * (b.b - b.t) > (a.r - a.l) * (a.b - a.t) ? b : a))]
    : real;
  const l = Math.max(0, Math.min(...pick.map((r) => r.l)));
  const t = Math.max(0, Math.min(...pick.map((r) => r.t)));
  const w = Math.max(...pick.map((r) => r.r)) - l;
  const h = Math.max(...pick.map((r) => r.b)) - t;
  return { x: l, y: t, w: w - (w % 2), h: h - (h % 2) };
}

async function grabbers() {
  const have = [];
  try {
    const { stdout } = await execFileAsync(FFMPEG, ['-hide_banner', '-filters']);
    if (/\bddagrab\b/.test(stdout)) have.push('ddagrab');
  } catch {
    fail(`no ffmpeg at "${FFMPEG}"; put it on PATH or set FFMPEG`);
  }
  try {
    const { stdout } = await execFileAsync(FFMPEG, ['-hide_banner', '-devices']);
    if (/\bgdigrab\b/.test(stdout)) have.push('gdigrab');
  } catch {
    /* listed as absent */
  }
  return have;
}

function captureArgs(grabber, region) {
  const { x, y, w, h } = region;
  const input = grabber === 'ddagrab'
    ? ['-f', 'lavfi', '-i', `ddagrab=output_idx=0:framerate=${FPS}:offset_x=${x}:offset_y=${y}:video_size=${w}x${h}:draw_mouse=1,hwdownload,format=bgra`]
    : ['-f', 'gdigrab', '-framerate', String(FPS), '-offset_x', String(x), '-offset_y', String(y), '-video_size', `${w}x${h}`, '-draw_mouse', '1', '-i', 'desktop'];
  return ['-y', '-hide_banner', ...input, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', VIDEO];
}

/**
 * Start the capture and learn when its first frame was taken: ffmpeg's progress line reports
 * frames written, so the first one that shows N frames at wall time T puts frame 0 at T - N/fps.
 */
function startCapture(grabber, region) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, captureArgs(grabber, region), { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let tail = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`${grabber}: no frame within 15 s\n${tail.slice(-600)}`));
      }
    }, 15_000);
    child.stderr.on('data', (chunk) => {
      tail = (tail + chunk.toString()).slice(-4000);
      const m = /frame=\s*(\d+)/.exec(chunk.toString());
      if (!settled && m && Number(m[1]) > 0) {
        settled = true;
        clearTimeout(timer);
        resolve({ child, t0: Date.now() - (Number(m[1]) * 1000) / FPS, tail: () => tail });
      }
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`${grabber} exited ${code}\n${tail.slice(-600)}`));
      }
    });
  });
}

function stopCapture(capture) {
  return new Promise((resolve) => {
    capture.child.on('close', resolve);
    capture.child.stdin.write('q');
    capture.child.stdin.end();
    setTimeout(() => capture.child.kill(), 10_000).unref();
  });
}

// ---------------------------------------------------------------- the drive

/** Athena's own window, the one with the composer and the decision cards. */
const SELECTORS = {
  composer: 'input[name="message"]',
  card: '[data-card]',
  approve: '[data-act="approve"]',
  decline: '[data-act="decline"]',
  decided: '[data-decision]',
};

async function perform(api, beat, step) {
  const page = api.athena();
  if (!page) throw new Error('no athena.html page over CDP; is the Athena window open?');
  if (step === 'type-command') {
    await page.locator(SELECTORS.composer).click();
    await page.locator(SELECTORS.composer).pressSequentially(beat.command ?? beat.line, { delay: 35 });
  } else if (step === 'send') {
    await page.locator(SELECTORS.composer).press('Enter');
  } else if (step === 'approve' || step === 'decline') {
    await page.locator(SELECTORS[step]).first().click();
  } else if (step === 'wait-decided') {
    await page.locator(SELECTORS.decided).first().waitFor({ timeout: 30_000 });
  } else {
    throw new Error(`unknown desktop step: ${step}`);
  }
}

async function waitCue(api, cue, timeout) {
  const page = api.athena();
  if (!page) throw new Error('no athena.html page over CDP');
  const selector = { card: SELECTORS.card, decided: SELECTORS.decided }[cue];
  if (!selector) throw new Error(`unknown desktop cue: ${cue}`);
  await page.locator(selector).first().waitFor({ timeout });
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const script = JSON.parse(readFileSync(args.script, 'utf8'));
  const acts = script.acts.filter((a) => a.segment === 'desktop');
  if (acts.length === 0) fail(`${path.relative(JOURNEY, args.script)} has no desktop acts`);
  const durationsPath = path.join(TAKE, 'audio', 'durations.json');
  const durations = existsSync(durationsPath) ? JSON.parse(readFileSync(durationsPath, 'utf8')) : {};

  const have = await grabbers();
  const order = args.grabber ? [args.grabber] : ['ddagrab', 'gdigrab'];
  const usable = order.filter((g) => have.includes(g));
  if (usable.length === 0) fail(`this ffmpeg has none of ${order.join(', ')} (it has: ${have.join(', ') || 'none'})`);
  const rects = await windowRects(args.processName);

  if (args.dry) {
    console.log(`desktop segment of ${path.relative(JOURNEY, args.script)}`);
    let total = 0;
    for (const act of acts) {
      for (const beat of act.beats) {
        const hold = holdOf(beat, script, durations);
        total += hold;
        console.log(
          `  ${beat.id.padEnd(4)} ${String(hold).padStart(6)} ms  ${beat.cue ? `cue ${beat.cue}, then ` : ''}` +
            `${(beat.do ?? []).join(' > ') || 'hold'}`,
        );
      }
    }
    console.log(`  held ${(total / 1000).toFixed(1)} s, plus the live waits (sped up ${acts[0].speedup ?? 4}x in compose)`);
    console.log(`grabbers in this ffmpeg: ${have.join(', ')}; would use ${usable[0]}, falling back to ${usable[1] ?? 'nothing'}`);
    const found = regionOf(rects, args.window);
    const region = found ?? { x: 0, y: 0, w: 1440, h: 900 };
    console.log(found
      ? `${args.processName} is up: ${rects.length} window(s), region ${region.w}x${region.h} at ${region.x},${region.y}`
      : `${args.processName} has no window to film (${rects.length} too small or none); showing a sample 1440x900 region at 0,0`);
    console.log(`\n${FFMPEG} ${captureArgs(usable[0], region).map((a) => (/[\s;]/.test(a) ? `"${a}"` : a)).join(' ')}`);
    return;
  }

  const region = regionOf(rects, args.window);
  if (!region) {
    fail(`${args.processName} has no visible window to film. Start the app with its CDP port and open Athena (docs/demo.md section 5).`, 2);
  }
  const require = createRequire(path.join(JOURNEY, 'package.json'));
  const { chromium } = require('@playwright/test');
  const browser = await chromium.connectOverCDP(args.cdp);
  const all = () => browser.contexts().flatMap((c) => c.pages());
  const api = { athena: () => all().find((p) => p.url().includes('athena.html')) };
  if (!api.athena()) fail('connected over CDP but found no athena.html page; open Athena\'s window first', 2);

  await mkdir(TAKE, { recursive: true });
  let capture = null;
  let grabber = null;
  for (const g of usable) {
    try {
      capture = await startCapture(g, region);
      grabber = g;
      break;
    } catch (err) {
      console.warn(`warn: ${String(err.message).split('\n')[0]}; trying the next grabber`);
    }
  }
  if (!capture) fail('no grabber produced a frame', 3);
  console.log(`capturing ${region.w}x${region.h} at ${region.x},${region.y} with ${grabber}`);

  const marks = [];
  const speedups = [];
  try {
    for (const act of acts) {
      const factor = act.speedup ?? 4;
      for (const beat of act.beats) {
        let error;
        if (beat.cue) {
          const from = Date.now();
          try {
            await waitCue(api, beat.cue, args.cueTimeoutMs);
          } catch (err) {
            error = `cue ${beat.cue}: ${String(err.message).split('\n')[0]}`;
          }
          const waited = Date.now() - from;
          if (waited >= MIN_SPEEDUP_MS) {
            speedups.push({ start_ms: from - capture.t0, end_ms: Date.now() - capture.t0, factor, waiting_for: beat.cue });
          }
          console.log(`cue ${beat.cue}: ${(waited / 1000).toFixed(1)} s`);
        }
        const startedAt = Date.now();
        if (!error) {
          try {
            for (const step of beat.do ?? []) await perform(api, beat, step);
          } catch (err) {
            error = String(err.message).split('\n')[0];
          }
        }
        if (error) console.error(`beat ${beat.id} failed: ${error}`);
        const remaining = holdOf(beat, script, durations) - (Date.now() - startedAt);
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
        marks.push({
          id: beat.id,
          start_ms: Math.round(startedAt - capture.t0),
          end_ms: Math.round(Date.now() - capture.t0),
          caption: captionOf(beat),
          ...(error ? { error } : {}),
        });
      }
    }
  } finally {
    await stopCapture(capture);
    await browser.close().catch(() => {});
    await writeFile(
      OFFSETS,
      `${JSON.stringify(
        {
          segment: 'desktop',
          video: 'desktop.mp4',
          width: region.w,
          height: region.h,
          script: path.relative(JOURNEY, args.script),
          grabber,
          // Frame 0 is inferred from ffmpeg's first progress line, which arrives about every half second.
          video_offset_uncertainty_ms: 500,
          beats: marks,
          speedups,
        },
        null,
        2,
      )}\n`,
    );
  }
  console.log(`desktop: ${path.relative(JOURNEY, VIDEO)}\noffsets: ${path.relative(JOURNEY, OFFSETS)}`);
  const broken = marks.filter((m) => m.error);
  if (broken.length) fail(`${broken.length} beat(s) errored: ${broken.map((m) => m.id).join(', ')} (the capture was kept)`, 4);
}

main().catch((err) => {
  console.error(String(err?.stack ?? err));
  process.exit(1);
});
