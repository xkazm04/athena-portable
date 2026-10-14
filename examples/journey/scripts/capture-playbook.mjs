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
 * Stills (the storyboard, ADR 0055's amendment):
 *   node examples/journey/scripts/capture-playbook.mjs --stills --fixture shipped:<id>
 *        --out evidence/<id> [--turns 1,4,6,9] [--desktop <dir>] [--port N]
 *
 * No film and no pacing: the same playbook photographed at its stages, as the Chores depth draws
 * them (ADR 0090), each a place opened by its own address rather than reached by clicks, so no
 * still can catch a layer halfway through its transition. The abstract (`#/chores/<id>`), each
 * turn named by `--turns` (1-based; by default up to four spread evenly, always the first and the
 * last), and *What she filed* (the `shipped-proof` fixture opens a chore on that facet; the chore
 * is scrolled so the facets and the panel stand at the top). Every still is the same element,
 * `.stage__layer`: the scene under the crumbs and above the dock, so the chrome that is the same
 * on every screen is not paid for a hundred times. The old film's `.layer__sheet` no longer exists:
 * the layer it framed became the Chores depth.
 *
 * `--desktop` serves the walk from another checkout's `apps/desktop` (a capture that must not see
 * somebody's half-saved edit through Vite's hot reload). Writes `<out>/still-NN.png` and
 * `<out>/stills.json`, `[{ file, turn }]` in order, `turn` null for the abstract and the result.
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
/**
 * Smaller than the film's: a still is shrunk to 960 px and must stay under 24,000 bytes as WebP,
 * and the abstract framed at 1440 x 900 does not, even at quality 30 (about 28,700 bytes, nearly
 * all of it text: hiding the water saves nothing). At 1280 x 800 it is about 21,700 at 30 and
 * still reads. (Measured with a lanczos shrink; `evidence.py` shrinks bilinear, which is smaller
 * again, and cuts the rare still that is still too heavy shorter, never less legible.)
 */
const STILL_VIEWPORT = { width: 1280, height: 800 };
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
    else if (a === '--turns') args.turns = (argv[(i += 1)] ?? '').split(',').map(Number);
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

/** One still: the layer at a place, once it has drawn and nothing is mid-move. */
async function still(page, url, ready, file, prepare) {
  await page.goto(url, { waitUntil: 'load' });
  await page.locator(ready).first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  const layer = page.locator(`${STILL}:not([inert])`);
  if ((await layer.count()) !== 1) fail(`${url}: expected one live ${STILL}, found ${await layer.count()}`);
  if (prepare) await prepare(page);
  await page.waitForTimeout(350);
  await layer.screenshot({ path: file, animations: 'disabled' });
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
    const context = await browser.newContext({ viewport: args.viewport, deviceScaleFactor: 1, colorScheme: 'dark' });
    const page = await context.newPage();
    const name = () => path.join(args.out, `still-${String(shots.length + 1).padStart(2, '0')}.png`);
    const take = async (url, ready, turn, prepare) => {
      const file = name();
      await still(page, url, ready, file, prepare);
      shots.push({ file: path.basename(file), turn });
    };

    await take(at('shipped', chore), '.ch-chore__top', null);
    const count = await page.locator('.ch-facet', { hasText: 'Watch the run' }).count();
    let turns = args.turns;
    if (turns === null) {
      // The number of turns is on the replay's own marquee: "Turn 1 of 13".
      await page.goto(at('shipped', `${chore}/run/1`), { waitUntil: 'load' });
      const of = await page.locator('.ch-marquee__of').first().textContent({ timeout: 60_000 });
      turns = sampleTurns(Number(/of (\d+)/.exec(of ?? '')?.[1] ?? 0));
    }
    if (turns.length && count === 0) fail(`${id} has no "Watch the run": no turns to photograph`);
    for (const n of turns) {
      await take(at('shipped', `${chore}/run/${n}`), '.ch-run .ch-turn', n, async (p) => {
        const marquee = (await p.locator('.ch-marquee--run').first().textContent()) ?? '';
        if (!marquee.startsWith(`Turn ${n} `)) fail(`${id}: turn ${n} drew "${marquee}"`);
      });
    }
    await take(at('shipped-proof', chore), '.ch-panel[aria-label="What she filed"]', null, async (p) => {
      // The facets and the panel to the top of the layer: the result, not the abstract again.
      await p.locator('.ch-chore').evaluate((el) => {
        const body = el.querySelector('.ch-chore__body');
        if (body) el.scrollTo({ top: body.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 16 });
      });
    });
    await context.close();
    writeFileSync(path.join(args.out, 'stills.json'), `${JSON.stringify(shots, null, 2)}\n`);
    console.log(`stills ${id}: ${shots.length} (${shots.map((s) => s.turn ?? '-').join(' ')}) on port ${port}`);
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
