// Page glue: URL params -> rig + motion source + clock. One rAF loop, none when paused, hidden or calm.
import { createRig } from './rig.js';
import { createGlowRig } from './glow.js';
import { generateRigParams, sampleTrack, loudnessEnvelope } from './motion.js';

const q = new URLSearchParams(location.search);
const portrait = q.get('portrait');
const line = q.get('line');
const paramsUrl = q.get('params');
const capture = q.get('capture') === '1';
const calm = q.get('calm') === '1';
const status = document.getElementById('status');
const say = (s) => { if (status) status.textContent = s; };
const t0 = performance.now();

async function json(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }

async function main() {
  if (!portrait) { say('add ?portrait=<id>'); return; }
  const canvas = document.getElementById('c');
  const w = Number(q.get('w')) || Math.round(innerWidth * devicePixelRatio);
  const h = Number(q.get('h')) || Math.round(innerHeight * devicePixelRatio);
  canvas.width = w; canvas.height = h;
  const layersUrl = `/home/portraits/${encodeURIComponent(portrait)}/t1-rig/layers/layers.json`;
  const spec = await json(layersUrl);
  const glow = spec.rig_type === 'glow';
  const rig = glow
    ? await createGlowRig(canvas, { layersUrl, spec, zoom: q.get('zoom') && q.get('zoom') !== 'auto' ? Number(q.get('zoom')) : 1, offsetY: Number(q.get('oy')) || 0 })
    : await createRig(canvas, { layersUrl, zoom: q.get('zoom') || 'auto', offsetY: Number(q.get('oy')) || 0 });

  let timeline = null;
  if (line) { try { timeline = await json(`/home/voice/${line}.timeline.json`); } catch (e) { console.warn('no timeline', e); } }
  const duration = Number(q.get('dur')) || (timeline ? timeline.duration_s : 30);
  let envelope = null;
  if (line && q.get('env') !== '0') {
    try {
      const actx = new OfflineAudioContext(1, 1, 24000);
      const buf = await actx.decodeAudioData(await (await fetch(`/home/voice/${line}.wav`)).arrayBuffer());
      envelope = loudnessEnvelope(buf.getChannelData(0), buf.sampleRate);
    } catch (e) { console.warn('no loudness envelope', e); }
  }
  if (envelope && rig.setEnvelope) rig.setEnvelope(envelope, 100);
  const procedural = generateRigParams(timeline, { duration, fps: 60, seed: Number(q.get('seed')) || 7, envelope, motionScale: glow ? 0.7 : 1 });
  let track = procedural;
  if (paramsUrl) {
    track = await json(paramsUrl);
    if (q.get('blend') === 'procedural') {
      const orig = track;
      track = { ...orig, frames: orig.frames.map((f) => {
        const p = sampleTrack(procedural, f.t);
        return { ...f, eyes: f.eyes || p.eyes, brow: f.brow || p.brow, head: f.head || p.head, mouth: f.mouth || p.mouth };
      }) };
    }
  }
  const frameAt = (t) => sampleTrack(track, t);

  // capture: the caller drives time
  window.__rig = {
    rig, track, duration,
    renderAt(t) { rig.setFrame(frameAt(t)); rig.render(t); return true; },
    firstFrameMs: 0,
  };
  rig.setFrame(frameAt(0));
  rig.render(0);
  window.__rig.firstFrameMs = performance.now() - t0;
  if (capture) { window.__rig.ready = true; say(''); return; }
  if (calm) { window.__rig.ready = true; say('calm: one still frame'); return; }

  // live: audio clock when a line is given, else performance clock; loop the idle
  let audio = null, ctx = null, startAt = 0;
  if (line) {
    ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(await (await fetch(`/home/voice/${line}.wav`)).arrayBuffer());
    audio = buf;
  }
  const perf = (window.__perf = { intervals: [], last: 0 });
  let raf = 0, playing = false, startPerf = 0;
  function now() {
    if (ctx) return ctx.currentTime - startAt;
    return (performance.now() - startPerf) / 1000;
  }
  function tick(ts) {
    raf = 0;
    if (!playing) return;
    if (perf.last) perf.intervals.push(ts - perf.last);
    perf.last = ts;
    let t = now();
    if (t > duration + 0.5) {
      if (q.get('loop') === '0') { playing = false; return; }
      play(); return;
    }
    rig.setFrame(frameAt(Math.min(t, duration)));
    rig.render(t);
    raf = requestAnimationFrame(tick);
  }
  function play() {
    rig.reset();
    if (ctx) {
      const src = ctx.createBufferSource();
      src.buffer = audio; src.connect(ctx.destination);
      startAt = ctx.currentTime + 0.05; src.start(startAt);
    }
    startPerf = performance.now();
    playing = true;
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function pause() { playing = false; if (raf) cancelAnimationFrame(raf); raf = 0; perf.last = 0; }
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  window.__rig.play = play; window.__rig.pause = pause;
  window.__rig.ready = true;
  if (ctx && ctx.state === 'suspended') {
    say('click to play');
    addEventListener('click', async () => { await ctx.resume(); say(''); play(); }, { once: true });
  } else { say(''); play(); }
}

main().catch((e) => { console.error(e); say(String(e.message || e)); window.__rig = { error: String(e.stack || e) }; });
