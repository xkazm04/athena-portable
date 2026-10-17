// Review stills: render chosen RigParams frames to PNG (headless Edge), for eyeballing the rig.
//   node spikes/avatar/web/shot.mjs --portrait <id> --out <dir> [--w 960 --h 540] [--zoom 2.2] [--poses default|<json file>]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './serve.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const portrait = opt('portrait');
const out = opt('out');
const w = Number(opt('w', 960)), h = Number(opt('h', 540));
const zoom = opt('zoom', '1'), oy = opt('oy', '0');
const port = Number(opt('port', 5182));
mkdirSync(out, { recursive: true });

const P = (o) => ({ head: { yaw: 0, pitch: 0, roll: 0, ...o.head }, eyes: { blinkL: 0, blinkR: 0, gazeX: 0, gazeY: 0, ...o.eyes },
  brow: { raise: 0, ...o.brow }, mouth: { open: 0, visemes: {}, ...o.mouth } });
const DEFAULT = {
  neutral: P({}),
  yaw_r: P({ head: { yaw: 10 } }), yaw_l: P({ head: { yaw: -10 } }),
  pitch_d: P({ head: { pitch: 8 } }), roll: P({ head: { roll: 6 } }),
  blink_half: P({ eyes: { blinkL: 0.5, blinkR: 0.5 } }), blink: P({ eyes: { blinkL: 1, blinkR: 1 } }),
  gaze_r: P({ eyes: { gazeX: 1 } }), brow_up: P({ brow: { raise: 1 } }),
  aa: P({ mouth: { open: 0.9, visemes: { aa: 1 } } }), E: P({ mouth: { open: 0.55, visemes: { E: 1 } } }),
  oh: P({ mouth: { open: 0.62, visemes: { oh: 1 } } }), ou: P({ mouth: { open: 0.32, visemes: { ou: 1 } } }),
  SS: P({ mouth: { open: 0.14, visemes: { SS: 1 } } }), FF: P({ mouth: { open: 0.12, visemes: { FF: 1 } } }),
};
const poses = opt('poses') && opt('poses') !== 'default' ? JSON.parse(readFileSync(opt('poses'), 'utf8')) : DEFAULT;

function findPlaywright() {
  // The main checkout's node_modules sits beside the .git this worktree shares.
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
  const r = join(dirname(common), 'node_modules/.pnpm');
  const d = readdirSync(r).filter((x) => x.startsWith('playwright-core@')).sort().pop();
  return join(r, d, 'node_modules/playwright-core/index.mjs');
}
const { chromium } = await import(pathToFileURL(findPlaywright()).href);
const server = await startServer(port);
try {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', (m) => console.log('[page]', m.type(), m.text().slice(0, 2000)));
  await page.goto(`http://127.0.0.1:${port}/index.html?portrait=${encodeURIComponent(portrait)}&capture=1&w=${w}&h=${h}&zoom=${zoom}&oy=${oy}`);
  await page.waitForFunction(() => window.__rig && (window.__rig.ready || window.__rig.error), null, { timeout: 60000 });
  const err = await page.evaluate(() => window.__rig.error);
  if (err) throw new Error(err);
  for (const [name, f] of Object.entries(poses)) {
    const b64 = await page.evaluate((f) => { const r = window.__rig.rig; r.reset(); r.setFrame(f); r.render(0); r.render(0.5); return document.getElementById('c').toDataURL('image/png').slice(22); }, f);
    writeFileSync(join(out, `${name}.png`), Buffer.from(b64, 'base64'));
  }
  await browser.close();
  console.log(`wrote ${Object.keys(poses).length} stills to ${out}`);
} finally { server.close(); }
