// Headless check of the A/B page: starts the 5183 server, loads the page, draws a few instants and
// saves a contact sheet per instant. Stops the server on exit.
//   node spikes/avatar/t4-hybrid/ab/shot.mjs --line calm [--portrait <id>] [--at 0.5,1.5,2.5] --out <dir>
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './serve.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const line = opt('line', 'calm'), portrait = opt('portrait'), out = opt('out', '.');
const at = opt('at', '0.5,1.5,2.5').split(',').map(Number);
const port = Number(opt('port', 5183));

function findPlaywright() {
  // A linked worktree has no node_modules of its own; the main checkout's sits beside the shared .git.
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
  const roots = [join(dirname(fileURLToPath(import.meta.url)), '../../../../node_modules/.pnpm'), join(dirname(common), 'node_modules/.pnpm')];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    const d = readdirSync(r).filter((x) => x.startsWith('playwright-core@')).sort().pop();
    if (d) return join(r, d, 'node_modules/playwright-core/index.mjs');
  }
  throw new Error('playwright-core not found');
}
const { chromium } = await import(pathToFileURL(findPlaywright()).href);
const server = await startServer(port);
mkdirSync(out, { recursive: true });
try {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/t4/?line=${line}${portrait ? `&portrait=${encodeURIComponent(portrait)}` : ''}`);
  await page.waitForFunction(() => window.__ab, null, { timeout: 60000 });
  for (const t of at) {
    await page.evaluate((tt) => window.__ab.drawAt(tt), t);
    const f = join(out, `ab_${line}_${t.toFixed(2)}.png`);
    await page.screenshot({ path: f });
    console.log(f);
  }
  if (errs.length) console.error('page errors:', errs.join('\n'));
  await browser.close();
} finally {
  server.close();
}
