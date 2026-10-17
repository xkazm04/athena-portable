// A/B: the same line, t1 procedural motion (A) vs t4 neural motion (B), one audio clock.
// URL: ?line=calm[&portrait=<id>][&b=<rigparams url>][&a=<rigparams url>][&seed=7]
//   portrait given -> both sides render through t1's WebGL rig (/src/rig.js, unchanged);
//   no portrait    -> a minimal 2D stub face (judging motion only, no art).
import { generateRigParams, sampleTrack } from '/src/motion.js';

const q = new URLSearchParams(location.search);
const line = q.get('line') || 'calm';
const portrait = q.get('portrait');
const say = (s) => { document.getElementById('status').textContent = s; };
const json = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); };

function stubFace(canvas) {
  const g = canvas.getContext('2d');
  return {
    draw(f) {
      const W = canvas.width, H = canvas.height, s = W / 400;
      g.fillStyle = '#17171c'; g.fillRect(0, 0, W, H);
      g.save();
      g.translate(W / 2 + f.head.yaw * 4 * s, H / 2 + f.head.pitch * 4 * s);
      g.rotate((f.head.roll * Math.PI) / 180);
      g.fillStyle = '#d9b9a0'; g.beginPath(); g.ellipse(0, 0, 110 * s, 140 * s, 0, 0, 7); g.fill();
      for (const side of [-1, 1]) {
        const ex = side * 42 * s, ey = -22 * s, bl = side < 0 ? f.eyes.blinkR : f.eyes.blinkL;
        g.fillStyle = '#fff'; g.beginPath(); g.ellipse(ex, ey, 20 * s, Math.max(0.6, 11 * (1 - bl)) * s, 0, 0, 7); g.fill();
        if (bl < 0.8) { g.fillStyle = '#334'; g.beginPath(); g.arc(ex + f.eyes.gazeX * 12 * s, ey + f.eyes.gazeY * 6 * s, 7 * s, 0, 7); g.fill(); }
        g.strokeStyle = '#5a3d2b'; g.lineWidth = 5 * s; g.beginPath();
        const by = ey - 24 * s - f.brow.raise * 12 * s;
        g.moveTo(ex - 20 * s, by + 3 * s); g.quadraticCurveTo(ex, by - 5 * s, ex + 20 * s, by + 3 * s); g.stroke();
      }
      const op = f.mouth?.open || 0;
      g.fillStyle = '#7a2e36'; g.beginPath(); g.ellipse(0, 62 * s, 30 * s, (2 + op * 22) * s, 0, 0, 7); g.fill();
      g.restore();
    },
  };
}

async function rigFace(canvas) {
  const { createRig } = await import('/src/rig.js');
  const rig = await createRig(canvas, { layersUrl: `/home/portraits/${encodeURIComponent(portrait)}/t1-rig/layers/layers.json` });
  return { draw(f, t) { rig.setFrame(f); rig.render(t); }, reset() { rig.reset(); } };
}

const CH = [
  ['yaw', (f) => f.head.yaw / 10, '#6cf'], ['pitch', (f) => f.head.pitch / 10, '#fc6'], ['roll', (f) => f.head.roll / 10, '#c9f'],
  ['blink', (f) => (f.eyes.blinkL + f.eyes.blinkR) / 2, '#fff'], ['brow', (f) => f.brow.raise, '#f88'],
  ['gazeX', (f) => f.eyes.gazeX, '#8f8'], ['open', (f) => f.mouth?.open || 0, '#f6a'],
];

function plot(canvas, tracks, dur, tNow) {
  const W = (canvas.width = canvas.clientWidth * devicePixelRatio), H = (canvas.height = canvas.clientHeight * devicePixelRatio);
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  const rows = CH.length, rh = H / rows;
  g.font = `${11 * devicePixelRatio}px system-ui`;
  CH.forEach(([name, get, col], r) => {
    const y0 = r * rh + rh / 2;
    g.fillStyle = '#888'; g.fillText(name, 4, r * rh + 12 * devicePixelRatio);
    g.strokeStyle = '#2a2a30'; g.beginPath(); g.moveTo(0, y0); g.lineTo(W, y0); g.stroke();
    tracks.forEach((tr, k) => {
      g.strokeStyle = col; g.globalAlpha = k === 0 ? 0.45 : 1; g.setLineDash(k === 0 ? [4, 3] : []);
      g.beginPath();
      for (let x = 0; x < W; x += 2) {
        const f = sampleTrack(tr, (x / W) * dur);
        const y = y0 - get(f) * rh * 0.45;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    });
    g.globalAlpha = 1; g.setLineDash([]);
  });
  g.strokeStyle = '#f33'; g.beginPath(); g.moveTo((tNow / dur) * W, 0); g.lineTo((tNow / dur) * W, H); g.stroke();
}

async function main() {
  let timeline = null;
  try { timeline = await json(`/home/voice/${line}.timeline.json`); } catch { /* idle */ }
  const dur = timeline ? timeline.duration_s : 10;
  const A = q.get('a') ? await json(q.get('a')) : generateRigParams(timeline, { duration: dur, fps: 60, seed: Number(q.get('seed')) || 7 });
  const bUrl = q.get('b') || (portrait ? `/home/portraits/${portrait}/t4-hybrid/${line}.rigparams.json` : `/home/voice/t4-hybrid/${line}.rigparams.json`);
  let B;
  try { B = await json(bUrl); } catch { B = await json(`/home/voice/t4-hybrid/${line}.rigparams.json`); }
  document.getElementById('la').textContent = q.get('a') ? `A: ${q.get('a')}` : 'A: t1 procedural';
  document.getElementById('lb').textContent = 'B: t4 neural (JoyVASA) + timeline mouth';
  const ca = document.getElementById('ca'), cb = document.getElementById('cb');
  for (const c of [ca, cb]) { c.width = c.clientWidth * devicePixelRatio; c.height = c.clientHeight * devicePixelRatio; }
  const fa = portrait ? await rigFace(ca) : stubFace(ca);
  const fb = portrait ? await rigFace(cb) : stubFace(cb);
  const drawAt = (t) => { fa.draw(sampleTrack(A, t), t); fb.draw(sampleTrack(B, t), t); plot(document.getElementById('plot'), [A, B], dur, t); };
  drawAt(0);
  window.__ab = { A, B, dur, drawAt };
  const ctx = new AudioContext();
  const buf = await ctx.decodeAudioData(await (await fetch(`/home/voice/${line}.wav`)).arrayBuffer());
  let start = 0, raf = 0;
  const tick = () => {
    const t = ctx.currentTime - start;
    drawAt(Math.min(Math.max(0, t), dur));
    raf = t < dur + 0.3 ? requestAnimationFrame(tick) : 0;
  };
  document.getElementById('play').onclick = async () => {
    await ctx.resume();
    fa.reset?.(); fb.reset?.();
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    start = ctx.currentTime + 0.05; src.start(start);
    if (!raf) raf = requestAnimationFrame(tick);
  };
  say(`${line} - ${dur.toFixed(2)} s - dashed = A, solid = B`);
}
main().catch((e) => { console.error(e); say(String(e.message || e)); });
