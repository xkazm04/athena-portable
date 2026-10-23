#!/usr/bin/env node
/**
 * ADR 0055 (a playbook's evidence), README section 14: film one playbook's layer replaying its run.
 *
 * Usage:
 *   node examples/journey/scripts/capture-playbook.mjs --fixture shipped:<id> --seconds 72.5
 *        --out evidence/<id> [--port N]
 *
 * `python -m athena.proving.playbooks evidence` runs this; it is not meant to be run by hand,
 * though nothing stops you. It starts the desktop's own Vite dev server on a free port (1431 is
 * the shell's and may well be taken), opens
 * `preview.html?module=playbooks&fixture=<fixture>&theme=dark&chrome=0` in a recorded Chromium,
 * and walks the layer for `--seconds`: the abstract, then *Watch the run* turn by turn to the
 * last, then *What she filed*, which it also takes as a still. The pace is the narration's: each
 * stretch ends at a fixed share of `--seconds`, scheduled from one clock so a slow click does not
 * push the rest late. The server is stopped on the way out, whatever happened.
 *
 * Writes `<out>/capture.webm`, `<out>/result.png` (the layer's sheet on the result view), and
 * `<out>/capture.json`: `lead_s`, how far into the webm the walk starts (the page loading is cut
 * off by the mux), `walked_s`, `turns`, and the URL that was filmed.
 *
 * Stills (the storyboard, ADR 0055's amendment, ADR 0137):
 *   node examples/journey/scripts/capture-playbook.mjs --stills --fixture shipped:<id>
 *        --out evidence/<id> [--turns 1,4,6,9] [--desktop <dir>] [--port N]
 *
 * No film and no pacing: the playbook photographed as the Chores depth draws it today (ADR 0090,
 * 0096), each place opened by its own address rather than reached by clicks, so no still can catch
 * a layer halfway through its transition. Still 01 is the topic page's drawing, *How it runs*
 * (`.pa-flow`), alone and centred; then each turn named by `--turns` (1-based; by default up to
 * four spread evenly, always the first and the last; `--turns ""` for none) on the replay,
 * `#/chores/<id>/run/N`. Every still is the live `.stage__layer`, with the stage's bar, dock and
 * gauge taken away so the layer fills the viewport: 1280 x 800, so every frame is 16:10, the shape
 * of the topic page's hero box and gallery frames. A drawing taller than that widens its frame,
 * still 16:10, rather than losing its end.
 *
 * No still shows a figure (ADR 0137): the page draws the money, the time, the verdict and the
 * estimate live from the record, so a picture of them could only drift from it. The capture hides
 * the replay's running total and the drawing's result node, and fails when any of `FORBIDDEN` (the
 * figure tiles, the verdict, the estimate) would still be drawn inside a frame.
 *
 * Rendered at deviceScaleFactor 2, so the PNGs are twice the frame (2560 x 1600) and `evidence.py`
 * shrinks them to 1280: supersampled text, sharper than a 1280 render at scale 1.
 *
 * `--desktop` serves the walk from another checkout's `apps/desktop` (a capture that must not see
 * somebody's half-saved edit through Vite's hot reload). Writes `<out>/still-NN.png` and
 * `<out>/stills.json`, `[{ file, kind, turn, frame }]` in order: `kind` "drawing" (turn null) or
 * "turn", `frame` the CSS size photographed ("1280x800").
 *
 * The film walk above still targets the retired Playbooks layer (`.pb-abstract`); the films return
 * in a later pass, on the stills' frames.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const DESKTOP = path.join(REPO, 'apps', 'desktop');
const VIEWPORT = { width: 1440, height: 900 };
/** What every still frames: the depth's layer, without the crumbs above it or the dock below. */
const STILL = '.stage__layer';
/** A still's frame in CSS px: 16:10, the topic page's hero and gallery boxes, and STORY_WIDTH wide. */
const STILL_VIEWPORT = { width: 1280, height: 800 };
/** Rendered at twice the frame and shrunk by `evidence.py`: text drawn at 2x and averaged reads sharper. */
const SCALE = 2;
/** The space above and below the drawing inside its frame, CSS px. */
const DRAWING_PAD = 40;
/** How a drawing's frame grows when it does not fit, and how far: twice the base is 1:1 at scale 2. */
const FRAME_STEP = 160;
const FRAME_MAX = 2560;
/** The most turns a storyboard samples; `evidence.py` holds the same number (`STORY_TURNS`). */
const STORY_TURNS = 4;

/** The walk's shares of the narration: the abstract, the replay, and the result after it. */
const SHARE = { abstract: 0.18, result: 0.22 };

/** Thrown, never `process.exit`: the `finally` that stops the dev server must still run. */
function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = {
    fixture: '',
    seconds: 0,
    out: '',
    port: 0,
    stills: false,
    turns: null,
    desktop: DESKTOP,
    viewport: STILL_VIEWPORT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--fixture') args.fixture = argv[(i += 1)] ?? '';
    else if (a === '--seconds') args.seconds = Number(argv[(i += 1)]);
    else if (a === '--out') args.out = path.resolve(argv[(i += 1)] ?? '');
    else if (a === '--port') args.port = Number(argv[(i += 1)]);
    else if (a === '--stills') args.stills = true;
    else if (a === '--turns') {
      const list = (argv[(i += 1)] ?? '').trim();
      args.turns = list ? list.split(',').map(Number) : [];
    }
    else if (a === '--desktop') args.desktop = path.resolve(argv[(i += 1)] ?? '');
    else if (a === '--viewport') {
      const [width, height] = (argv[(i += 1)] ?? '').split('x').map(Number);
      args.viewport = { width, height };
    }
    else fail(`unknown argument ${a}`);
  }
  if (!args.fixture.startsWith('shipped:')) fail('--fixture shipped:<playbook id> is required');
  if (!args.stills && !(args.seconds > 5)) fail('--seconds must be the narration length, in seconds');
  if (!args.out) fail('--out <dir> is required');
  if (args.turns && !args.turns.every((n) => Number.isInteger(n) && n >= 1)) {
    fail('--turns takes 1-based turn numbers, comma-separated');
  }
  return args;
}

/**
 * Up to {@link STORY_TURNS} of `count` turns, 1-based and spread evenly, always the first and the
 * last. The same rule as `evidence.sample_turns`, which normally passes `--turns` itself; this is
 * for a run by hand.
 */
function sampleTurns(count) {
  const k = Math.min(count, STORY_TURNS);
  if (k <= 1) return count >= 1 ? [1] : [];
  const picked = new Set();
  for (let i = 0; i < k; i += 1) picked.add(Math.floor((i * (count - 1)) / (k - 1) + 0.5) + 1);
  return [...picked].sort((a, b) => a - b);
}

/** A port nobody holds right now, from the OS. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** The desktop's own Vite, run as its JavaScript entry with this Node: no shell, a shallow tree. */
function startVite(port, desktop = DESKTOP) {
  const require = createRequire(path.join(desktop, 'package.json'));
  const pkgPath = require.resolve('vite/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.vite;
  const child = spawn(
    process.execPath,
    [path.join(path.dirname(pkgPath), bin), '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: desktop, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' },
  );
  let said = '';
  child.stdout.on('data', (d) => (said += d));
  child.stderr.on('data', (d) => (said += d));
  return { child, said: () => said };
}

function stopVite(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

async function waitForServer(url, vite, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (vite.child.exitCode !== null) fail(`vite exited with ${vite.child.exitCode}:\n${vite.said()}`);
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`vite did not answer ${url} within ${timeoutMs / 1000} s:\n${vite.said()}`);
}

/** True while something still answers on `port`: how a stopped server is known to be gone. */
function listening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(1000);
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
    socket.once('error', () => resolve(false));
  });
}

/** Stop the server, then make sure its port is free; a server that outlived its kill is said. */
async function stopAndCheck(vite, port) {
  stopVite(vite.child);
  for (let i = 0; i < 20; i += 1) {
    if (!(await listening(port))) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.error(`capture-playbook: something still listens on ${port} after vite was stopped`);
  process.exitCode = 1;
}

/**
 * What the capture adds to the page so a still is a frame and not a window: the stage's bar, dock
 * and gauge go and the layer fills the viewport (which is 16:10, so the layer is too), and the
 * figure tiles go (ADR 0137: no figure is baked into a still; the page draws them live). A tile is
 * hidden with `visibility`, so the layout around it does not move.
 */
const FRAME_CSS = `
  .stage__top, .stage__dock, .stage__gauge { display: none !important; }
  .stage__scenes, .stage__layer { inset: 0 !important; }
  .ch-found { visibility: hidden !important; }
`;
/** The drawing alone: every other section of the topic page goes, and the drawing stands centred. */
const DRAWING_CSS = `
  .pa-wrap > :not(.pa-flow) { display: none !important; }
  .pa-flow .pa-result, .pa-flow .pa-spine__note { display: none !important; }
  .pa-page { display: flex; flex-direction: column; justify-content: center; }
  .pa-wrap { width: 100%; max-width: none; padding: ${DRAWING_PAD}px 60px; margin: auto; }
`;
/**
 * No still may show these (ADR 0137): the page's figure tiles, the verdict line, the estimate line,
 * the drawing's result node and the replay's running total. Each must be hidden or outside the frame.
 */
const FORBIDDEN = ['.pa-kpis', '.pa-kpi', '.pa-verdict', '.pa-estimate', '.pa-result', '.pa-spine__note', '.ch-found'];

/** Fail when anything in {@link FORBIDDEN} is drawn inside `clip` (CSS px of the viewport). */
async function assertNoFigures(page, clip, where) {
  const seen = await page.evaluate(
    ({ selectors, clip }) => {
      const hits = [];
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          const style = getComputedStyle(el);
          if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
          if (style.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const inside = r.right > clip.x && r.left < clip.x + clip.width && r.bottom > clip.y && r.top < clip.y + clip.height;
          if (inside) hits.push(sel);
        }
      }
      return hits;
    },
    { selectors: FORBIDDEN, clip },
  );
  if (seen.length) fail(`${where}: the frame would show ${[...new Set(seen)].join(', ')}`);
}

/** One still: the live layer at a place, once it has drawn and nothing is mid-move. */
async function still(page, url, ready, file, { css = '', prepare } = {}) {
  await page.goto(url, { waitUntil: 'load' });
  await page.locator(ready).first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.addStyleTag({ content: FRAME_CSS + css });
  await page.evaluate(() => document.fonts.ready);
  const layer = page.locator(`${STILL}:not([inert])`);
  if ((await layer.count()) !== 1) fail(`${url}: expected one live ${STILL}, found ${await layer.count()}`);
  if (prepare) await prepare(page);
  await page.waitForTimeout(350);
  const box = await layer.boundingBox();
  if (!box) fail(`${url}: the layer has no box`);
  const ratio = box.width / box.height;
  if (Math.abs(ratio - 1.6) > 0.01) fail(`${url}: the layer is ${box.width} x ${box.height}, not 16:10`);
  await assertNoFigures(page, box, url);
  await layer.screenshot({ path: file, animations: 'disabled' });
  return box;
}

/**
 * The drawing's frame: the smallest 16:10 viewport, from the base up in steps of {@link FRAME_STEP}
 * CSS px, that holds the whole drawing. The topic page caps its width; the capture lifts the cap,
 * so a wider frame also lays the drawing out wider, and a drawing with many steps and gates grows
 * across instead of down. Its text is smaller once shrunk to 1280 px, never cut. Leaves the page
 * at that viewport.
 */
async function fitDrawing(page, base) {
  for (let width = base.width; ; width += FRAME_STEP) {
    const frame = { width, height: Math.round((width * 10) / 16) };
    await page.setViewportSize(frame);
    await page.waitForTimeout(50);
    const height = await page.locator('.pa-flow').evaluate((el) => el.getBoundingClientRect().height);
    if (height + 2 * DRAWING_PAD <= frame.height || width + FRAME_STEP > FRAME_MAX) return frame;
  }
}

async function stills(args) {
  const id = args.fixture.slice('shipped:'.length);
  mkdirSync(args.out, { recursive: true });
  const port = args.port || (await freePort());
  const base = `http://127.0.0.1:${port}`;
  // `calm=1`: no motion, so the water and a layer's arrival are the same in every frame.
  const at = (fixture, hash) =>
    `${base}/preview.html?${new URLSearchParams({ scene: 'chores', fixture, theme: 'dark', calm: '1', at: hash })}`;
  const chore = `#/chores/${encodeURIComponent(id)}`;
  const vite = startVite(port, args.desktop);
  let browser;
  const shots = [];
  try {
    await waitForServer(`${base}/preview.html`, vite);
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: args.viewport, deviceScaleFactor: SCALE, colorScheme: 'dark' });
    const page = await context.newPage();
    const name = () => path.join(args.out, `still-${String(shots.length + 1).padStart(2, '0')}.png`);

    // 01: the drawing. Measured once at the base viewport, then framed at the size it fits.
    await page.goto(at('shipped', chore), { waitUntil: 'load' });
    await page.locator('.pa-flow').first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.addStyleTag({ content: FRAME_CSS + DRAWING_CSS });
    const frame = await fitDrawing(page, args.viewport);
    const file = name();
    await still(page, at('shipped', chore), '.pa-flow', file, { css: DRAWING_CSS });
    shots.push({ file: path.basename(file), kind: 'drawing', turn: null, frame: `${frame.width}x${frame.height}` });
    await page.setViewportSize(args.viewport);

    let turns = args.turns;
    if (turns === null) {
      // The number of turns is on the replay's own marquee: "Turn 1 of 13".
      await page.goto(at('shipped', `${chore}/run/1`), { waitUntil: 'load' });
      const of = await page.locator('.ch-marquee__of').first().textContent({ timeout: 60_000 });
      turns = sampleTurns(Number(/of (\d+)/.exec(of ?? '')?.[1] ?? 0));
    }
    for (const n of turns) {
      const file = name();
      await still(page, at('shipped', `${chore}/run/${n}`), '.ch-run .ch-turn', file, {
        prepare: async (p) => {
          const marquee = (await p.locator('.ch-marquee--run').first().textContent()) ?? '';
          if (!marquee.startsWith(`Turn ${n} `)) fail(`${id}: turn ${n} drew "${marquee}"`);
        },
      });
      shots.push({ file: path.basename(file), kind: 'turn', turn: n, frame: `${args.viewport.width}x${args.viewport.height}` });
    }
    await context.close();
    writeFileSync(path.join(args.out, 'stills.json'), `${JSON.stringify(shots, null, 2)}\n`);
    console.log(`stills ${id}: ${shots.length} (${shots.map((s) => s.turn ?? 'drawing').join(' ')}) on port ${port}`);
  } finally {
    await browser?.close().catch(() => {});
    await stopAndCheck(vite, port);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.stills) return stills(args);
  mkdirSync(args.out, { recursive: true });
  const port = args.port || (await freePort());
  const base = `http://127.0.0.1:${port}`;
  const query = new URLSearchParams({ module: 'playbooks', fixture: args.fixture, theme: 'dark', chrome: '0' });
  const url = `${base}/preview.html?${query}`;
  const vite = startVite(port, args.desktop);
  const videoDir = mkdtempSync(path.join(os.tmpdir(), 'athena-capture-'));
  let browser;
  try {
    await waitForServer(`${base}/preview.html`, vite);
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      recordVideo: { dir: videoDir, size: VIEWPORT },
    });
    const opened = Date.now();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.locator('.pb-abstract').waitFor({ state: 'visible', timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    const lead = (Date.now() - opened) / 1000;

    // One clock for the whole walk: each stretch ends at its share of the narration.
    const T = args.seconds * 1000;
    const start = Date.now();
    const until = async (ms) => {
      const wait = start + ms - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
    };
    const body = page.locator('.layer__body');

    const run = page.locator('.pb-facet', { hasText: 'Watch the run' });
    let turns = 0;
    if ((await run.count()) > 0) {
      await until(T * SHARE.abstract);
      await run.first().click();
      await page.locator('.pb-replay').waitFor({ state: 'visible' });
      turns = await page.locator('.pb-rail__dot').count();
      const from = T * SHARE.abstract;
      const step = (T * (1 - SHARE.result) - from) / Math.max(1, turns);
      const next = page.getByRole('button', { name: 'Next', exact: true });
      for (let i = 1; i < turns; i += 1) {
        await until(from + step * i);
        await next.click();
        await body.evaluate((el) => el.scrollTo({ top: 0 }));
      }
      await until(T * (1 - SHARE.result));
    } else {
      await until(T * (1 - SHARE.result));
    }

    const result = page.locator('.pb-part__tab', { hasText: 'What she filed' });
    if ((await result.count()) > 0) await result.first().click();
    else await page.locator('.pb-glance').first().click();
    await page.locator('.pb-cards, .pb-proof__stats').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await page.locator('.layer__sheet').screenshot({ path: path.join(args.out, 'result.png') });
    // The rest of the result: down the cards, slowly, to the end of the narration.
    const left = start + T - Date.now();
    const scrolls = Math.max(1, Math.floor(left / 1500));
    for (let i = 1; i <= scrolls; i += 1) {
      await until(T - left + (left * i) / (scrolls + 1));
      await body.evaluate((el) => el.scrollBy({ top: 160, behavior: 'smooth' }));
    }
    await until(T);
    const walked = (Date.now() - start) / 1000;

    const video = page.video();
    await context.close();
    if (!video) fail('Playwright recorded no video');
    await video.saveAs(path.join(args.out, 'capture.webm'));
    await video.delete();
    writeFileSync(
      path.join(args.out, 'capture.json'),
      `${JSON.stringify({ lead_s: Number(lead.toFixed(3)), walked_s: Number(walked.toFixed(3)), turns, url: `/preview.html?${query}` }, null, 2)}\n`,
    );
    console.log(`captured ${args.fixture}: ${turns} turns, ${walked.toFixed(1)} s from ${lead.toFixed(2)} s`);
  } finally {
    await browser?.close().catch(() => {});
    stopVite(vite.child);
    rmSync(videoDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`capture-playbook: ${error?.message ?? String(error)}`);
  process.exit(1);
});
