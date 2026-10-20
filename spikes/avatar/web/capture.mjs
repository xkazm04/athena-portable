// Bench capture for the t1 rig: headless Edge renders each line at 1920x1080 30 fps by driving time
// (never the wall clock), ffmpeg muxes the WAV, then a live pass measures realtime fps/CPU/GPU.
//
//   node spikes/avatar/web/capture.mjs --portrait <id> [--lines calm,question,long]
//        [--track t1-rig] [--params-dir /home/portraits/<id>/t4-hybrid] [--no-realtime] [--headed-realtime]
//
// Writes ~/.athena-avatar/bench/<track>/<portrait>/<line>.mp4 and <line>.metrics.json
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer, HOME } from './serve.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const portrait = opt('portrait');
if (!portrait) { console.error('--portrait <id> required'); process.exit(2); }
const lines = (opt('lines', 'calm,question,long')).split(',');
const track = opt('track', 't1-rig');
// accepts '/home/...', 'home/...' (Git Bash rewrites a leading /home) or a full http URL
const paramsDirRaw = opt('params-dir');
const paramsDir = !paramsDirRaw ? undefined : /^https?:/.test(paramsDirRaw) ? paramsDirRaw : '/' + paramsDirRaw.replace(/\\/g, '/').replace(/^.*?\/?(home\/)/, '$1');
const port = Number(opt('port', 5181));
const fps = Number(opt('fps', 30));
const W = 1920, H = 1080;

function findPlaywright() {
  // A linked worktree has no node_modules of its own; the main checkout's sits beside the shared .git.
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
  const roots = [join(dirname(fileURLToPath(import.meta.url)), '../../../node_modules/.pnpm'), join(dirname(common), 'node_modules/.pnpm')];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    const d = readdirSync(r).filter((x) => x.startsWith('playwright-core@')).sort().pop();
    if (d) return join(r, d, 'node_modules/playwright-core/index.mjs');
  }
  throw new Error('playwright-core not found');
}
function findFfmpeg() {
  for (const c of [join(HOME, 'tools/ffmpeg.exe'), 'C:/ffmpeg/bin/ffmpeg.exe']) if (existsSync(c)) return c;
  return 'ffmpeg';
}

const { chromium } = await import(pathToFileURL(findPlaywright()).href);
const ffmpeg = findFfmpeg();
const server = await startServer(port);
let browserVersion = '';
const base = `http://127.0.0.1:${port}/`;
const gpuArgs = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required'];
const outDir = opt('out') || join(HOME, 'bench', track, portrait);
const maxDur = Number(opt('dur', 0));
mkdirSync(outDir, { recursive: true });

const licence = [
  { component: 't1-rig runtime + motion (our code)', licence: 'repo', commercial_ok: true },
  ...(() => {
    const src = JSON.parse(readFileSync(join(HOME, 'portraits', portrait, 't1-rig/layers/layers.json'), 'utf8')).source;
    if (src === 'glow') return [];  // glow split: authored regions + luminance + LaMa only
    if (src === 'see-through') return [{ component: 'See-through code', licence: 'Apache-2.0', commercial_ok: true },
      { component: 'See-through LayerDiff3D weights (offline prep only; finetune of Animagine XL 4.0)', licence: 'OpenRAIL++-M', commercial_ok: true }];
    return [{ component: 'MediaPipe face landmarker + selfie multiclass (offline prep only)', licence: 'Apache-2.0', commercial_ok: true },
      { component: 'BiRefNet (offline prep only)', licence: 'MIT', commercial_ok: true }];
  })(),
  { component: 'big-LaMa (offline prep only)', licence: 'Apache-2.0', commercial_ok: true },
];

function urlFor(line, extra = '') {
  let u = `${base}index.html?portrait=${encodeURIComponent(portrait)}&line=${line}`;
  if (paramsDir) u += `&params=${encodeURIComponent(`${paramsDir}/${line}.rigparams.json`)}&blend=procedural`;
  return u + extra;
}

async function captureLine(browser, line) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  await page.goto(urlFor(line, `&capture=1&w=${W}&h=${H}`));
  await page.waitForFunction(() => window.__rig && (window.__rig.ready || window.__rig.error), null, { timeout: 120000 });
  const err = await page.evaluate(() => window.__rig.error);
  if (err) throw new Error(err);
  const duration = await page.evaluate(() => window.__rig.duration);
  const wav = join(HOME, 'voice', `${line}.wav`);
  const mp4 = join(outDir, `${line}.mp4`);
  const n = Math.ceil((maxDur ? Math.min(maxDur, duration) : duration) * fps);
  const ffArgs = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
  if (existsSync(wav)) ffArgs.push('-i', wav);
  ffArgs.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  if (existsSync(wav)) ffArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  ffArgs.push(mp4);
  const ff = spawn(ffmpeg, ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((ok, no) => ff.on('close', (c) => (c === 0 ? ok() : no(new Error(`ffmpeg ${c}`)))));
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const b64 = await page.evaluate((t) => { window.__rig.renderAt(t); return document.getElementById('c').toDataURL('image/png').slice(22); }, i / fps);
    if (!ff.stdin.write(Buffer.from(b64, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
  const secs = (Date.now() - t0) / 1000;
  await page.close();
  console.log(`${line}: ${n} frames in ${secs.toFixed(1)} s -> ${mp4}`);
  return { mp4, seconds: secs, duration };
}

function winCounter(path) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      `(Get-Counter '${path}' -SampleInterval 1 -MaxSamples 3).CounterSamples | Group-Object Path | % { ($_.Group | Measure-Object CookedValue -Average).Average } | Measure-Object -Sum | % Sum`], { encoding: 'utf8', timeout: 30000 });
    const v = Number(out.trim());
    return Number.isFinite(v) ? v : undefined;
  } catch { return undefined; }
}

async function realtime(line, headed) {
  const browser = await chromium.launch({ headless: !headed, args: gpuArgs });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const cdp = await browser.newBrowserCDPSession();
  const t0 = Date.now();
  await page.goto(urlFor(line, `&w=${W}&h=${H}&loop=1`));
  await page.waitForFunction(() => window.__rig && (window.__rig.ready || window.__rig.error), null, { timeout: 120000 });
  const firstFrame = await page.evaluate(() => window.__rig.firstFrameMs);
  await page.waitForTimeout(1500);
  const procInfo = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo;
  const p0 = await procInfo();
  const w0 = Date.now();
  await page.evaluate(() => { window.__perf.intervals.length = 0; });
  const gpuPid = p0.find((p) => p.type === 'GPU')?.id;
  // sample the GPU counters while the clip plays
  const vramMb = gpuPid ? winCounter(`\\GPU Process Memory(pid_${gpuPid}_*)\\Dedicated Usage`) : undefined;
  const util = gpuPid ? winCounter(`\\GPU Engine(pid_${gpuPid}_*engtype_3D)\\Utilization Percentage`) : undefined;
  await page.waitForTimeout(Math.max(0, Number(opt('rt-ms', 8000)) - (Date.now() - w0)));
  const p1 = await procInfo();
  const wall = (Date.now() - w0) / 1000;
  const iv = await page.evaluate(() => window.__perf.intervals.slice());
  const cpu0 = Object.fromEntries(p0.map((p) => [p.id, p.cpuTime]));
  const cpuSec = p1.reduce((s, p) => s + Math.max(0, p.cpuTime - (cpu0[p.id] ?? p.cpuTime)), 0);
  await browser.close();
  const fpsList = iv.filter((x) => x > 0).map((x) => 1000 / x).sort((a, b) => a - b);
  const pct = (q) => fpsList[Math.max(0, Math.min(fpsList.length - 1, Math.floor(q * fpsList.length)))];
  const r = {
    fps_p50: Math.round(pct(0.5) * 10) / 10,
    fps_p5: Math.round(pct(0.05) * 10) / 10,
    cpu_pct: Math.round((cpuSec / wall / cpus().length) * 1000) / 10,
    first_frame_ms: Math.round(firstFrame),
  };
  if (vramMb !== undefined) r.vram_mb = Math.round(vramMb / 1048576);
  if (util !== undefined) r.gpu_util_pct = Math.round(util * 10) / 10;
  r._cpu_one_core_pct = Math.round((cpuSec / wall) * 1000) / 10;
  r._headed = !!headed;
  r._load_ms = Date.now() - t0;
  return r;
}

try {
  const browser = await chromium.launch({ headless: true, args: gpuArgs });
  browserVersion = browser.version();
  const results = {};
  for (const line of lines) results[line] = await captureLine(browser, line);
  await browser.close();
  for (const line of lines) {
    const rt = flag('no-realtime') ? null : await realtime(line, flag('headed-realtime'));
    const { _cpu_one_core_pct, _headed, _load_ms, ...realtimeM } = rt || {};
    const m = {
      track, portrait_id: portrait, line_id: line,
      render: { width: W, height: H, fps, seconds_per_clip: Math.round(results[line].seconds * 10) / 10 },
      ...(rt ? { realtime: realtimeM } : {}),
      licence,
      notes: `t1 rig in Chromium ${browserVersion} (${rt ? (_headed ? 'headed' : 'headless') : 'no realtime pass'}), WebGL2, ${paramsDir ? 'RigParams from ' + paramsDir : 'procedural motion'}. ` +
        (rt ? `cpu_pct is the share of all ${cpus().length} logical cores (${_cpu_one_core_pct}% of one core), all browser processes; vram_mb is the browser GPU process's dedicated memory (Windows GPU counter, mean of 3 s while playing; not a peak), gpu_util_pct its 3D-engine share. ` : '') +
        `Clip ${results[line].duration.toFixed(2)} s rendered deterministically at ${fps} fps.`,
    };
    writeFileSync(join(outDir, `${line}.metrics.json`), JSON.stringify(m, null, 2));
    console.log(line, JSON.stringify(m.realtime || {}));
  }
} finally {
  server.close();
}
