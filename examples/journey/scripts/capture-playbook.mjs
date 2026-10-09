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

/** The walk's shares of the narration: the abstract, the replay, and the result after it. */
const SHARE = { abstract: 0.18, result: 0.22 };

/** Thrown, never `process.exit`: the `finally` that stops the dev server must still run. */
function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = { fixture: '', seconds: 0, out: '', port: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--fixture') args.fixture = argv[(i += 1)] ?? '';
    else if (a === '--seconds') args.seconds = Number(argv[(i += 1)]);
    else if (a === '--out') args.out = path.resolve(argv[(i += 1)] ?? '');
    else if (a === '--port') args.port = Number(argv[(i += 1)]);
    else fail(`unknown argument ${a}`);
  }
  if (!args.fixture.startsWith('shipped:')) fail('--fixture shipped:<playbook id> is required');
  if (!(args.seconds > 5)) fail('--seconds must be the narration length, in seconds');
  if (!args.out) fail('--out <dir> is required');
  return args;
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
function startVite(port) {
  const require = createRequire(path.join(DESKTOP, 'package.json'));
  const pkgPath = require.resolve('vite/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.vite;
  const child = spawn(
    process.execPath,
    [path.join(path.dirname(pkgPath), bin), '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: DESKTOP, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' },
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.out, { recursive: true });
  const port = args.port || (await freePort());
  const base = `http://127.0.0.1:${port}`;
  const query = new URLSearchParams({ module: 'playbooks', fixture: args.fixture, theme: 'dark', chrome: '0' });
  const url = `${base}/preview.html?${query}`;
  const vite = startVite(port);
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
