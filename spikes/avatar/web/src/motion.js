// Procedural motion: Timeline v1 (or nothing) -> RigParams v1. Pure and deterministic (seeded),
// so it runs the same in the browser, in Node, and in the bench capture.
import { VISEMES, SHAPES } from './visemes.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
// bump: 0 -> 1 over `up` seconds, back to 0 over `down` seconds, centred so the peak is at t0
function bump(t, t0, up, down) {
  if (t < t0 - up || t > t0 + down) return 0;
  return t < t0 ? smooth((t - (t0 - up)) / up) : 1 - smooth((t - t0) / down);
}

const VOWELS = new Set(['aa', 'E', 'ih', 'oh', 'ou']);

/** Plan the discrete events once (blinks, saccades, nods); frames are then sampled from the plan. */
function plan(timeline, duration, rnd) {
  const vis = (timeline?.visemes || []).filter((s) => s.v !== 'sil');
  const speechStart = vis.length ? vis[0].start : Infinity;
  const speechEnd = vis.length ? vis[vis.length - 1].end : -Infinity;
  const question = !!timeline && /\?\s*$/.test((timeline.text || '').trim());

  // pauses inside speech (>= 220 ms of sil between voiced segments)
  const pauses = [];
  for (let i = 1; i < vis.length; i++) {
    const gap = vis[i].start - vis[i - 1].end;
    if (gap >= 0.22) pauses.push({ start: vis[i - 1].end, end: vis[i].start });
  }

  // stress candidates: stress marks in phonemes when present, else long open vowels
  let stress = [];
  const ph = timeline?.phonemes || [];
  if (ph.some((p) => /[ˈ']/.test(p.p))) {
    for (let i = 0; i < ph.length; i++) if (/[ˈ']/.test(ph[i].p)) {
      const nxt = ph.slice(i).find((q) => /[aeiouæɑɒɔəɛɜɪʊʌ]/i.test(q.p));
      if (nxt) stress.push({ t: nxt.start + 0.04, score: (nxt.end - nxt.start) + 0.1 });
    }
  } else {
    for (const s of vis) if (VOWELS.has(s.v)) stress.push({ t: s.start + 0.04, score: (s.end - s.start) * (0.4 + SHAPES[s.v].open) });
  }
  stress.sort((a, b) => b.score - a.score);
  const nods = [];
  const keep = Math.max(1, Math.round(stress.length * 0.35));
  for (const s of stress.slice(0, keep)) {
    if (nods.every((n) => Math.abs(n.t - s.t) > 0.65)) nods.push({ ...s, amp: 1.4 + 1.6 * rnd() });
  }
  nods.sort((a, b) => a.t - b.t);
  // the first nod after a question tilt reads as nervous - drop nods in the question's last 0.8 s
  const nodsF = question ? nods.filter((n) => n.t < speechEnd - 0.8) : nods;
  const browHits = [...nodsF].sort((a, b) => b.score - a.score).slice(0, 2).map((n) => n.t);

  // blinks: 2-6 s apart, ~20 % doubles, one near speech onset and at long pauses
  const blinks = [];
  const pushBlink = (t) => { if (t > 0.05 && t < duration - 0.2 && blinks.every((b) => Math.abs(b - t) > 0.35)) blinks.push(t); };
  if (isFinite(speechStart)) pushBlink(Math.max(0.15, speechStart - 0.12));
  for (const p of pauses) if (p.end - p.start > 0.35) pushBlink(p.start + 0.05);
  let t = 0.6 + rnd() * 1.6;
  while (t < duration) {
    pushBlink(t);
    if (rnd() < 0.2) pushBlink(t + 0.26 + rnd() * 0.08);
    t += 2 + 4 * Math.pow(rnd(), 1.3);
  }
  blinks.sort((a, b) => a - b);

  // micro-saccades: hold a target 0.5-2.2 s, jump in ~40 ms
  const sacc = [{ t: 0, x: 0, y: 0 }];
  t = 0.4 + rnd();
  while (t < duration) {
    const r = 0.03 + 0.07 * rnd(), a = rnd() * Math.PI * 2;
    sacc.push({ t, x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6 });
    t += 0.5 + 1.7 * rnd();
  }
  // a thinking glance before a reply that starts late enough to have one
  if (speechStart > 0.9 && speechStart < Infinity) {
    sacc.push({ t: speechStart - 0.75, x: 0.32 * (rnd() < 0.5 ? -1 : 1), y: -0.22 });
    sacc.push({ t: speechStart - 0.12, x: 0, y: 0 });
    sacc.sort((a, b) => a.t - b.t);
  }

  const phase = Array.from({ length: 12 }, () => rnd() * Math.PI * 2);
  return { vis, speechStart, speechEnd, question, pauses, nods: nodsF, browHits, blinks, sacc, phase };
}

function blinkCurve(t, blinks) {
  let v = 0;
  for (const b of blinks) {
    const d = t - b; // close 75 ms, hold 35 ms, open 170 ms
    if (d < 0 || d > 0.28) continue;
    v = Math.max(v, d < 0.075 ? smooth(d / 0.075) : d < 0.11 ? 1 : 1 - smooth((d - 0.11) / 0.17));
  }
  return v;
}

function gazeAt(t, sacc) {
  let i = 0;
  while (i + 1 < sacc.length && sacc[i + 1].t <= t) i++;
  const cur = sacc[i];
  const prev = sacc[Math.max(0, i - 1)];
  const k = i === 0 ? 1 : smooth((t - cur.t) / 0.045);
  return { x: prev.x + (cur.x - prev.x) * k, y: prev.y + (cur.y - prev.y) * k };
}

function visemeWeights(t, vis, lead, R) {
  const w = {};
  const tt = t + lead; // mouth leads the audio slightly
  // binary search the first segment that could touch tt
  let lo = 0, hi = vis.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (vis[m].end + R < tt) lo = m + 1; else hi = m; }
  for (let i = lo; i < vis.length && vis[i].start - R <= tt; i++) {
    const s = vis[i];
    const up = (tt - (s.start - R)) / (2 * R);
    const dn = ((s.end + R) - tt) / (2 * R);
    const x = smooth(Math.min(up, dn, 1));
    if (x > 0) w[s.v] = Math.max(w[s.v] || 0, x);
  }
  let sum = 0;
  for (const k in w) sum += w[k];
  if (sum > 1) for (const k in w) w[k] /= sum;
  return w;
}

/**
 * @param timeline Timeline v1 or null (idle)
 * @param opts {duration, fps=60, seed=1, lead=0.035, envelope?: Float32Array RMS at 100 Hz, ~0..1}
 * @returns RigParams v1
 */
export function generateRigParams(timeline, opts = {}) {
  const fps = opts.fps || 60;
  const duration = opts.duration ?? (timeline ? timeline.duration_s : 10);
  const lead = opts.lead ?? 0.035;
  const rnd = mulberry32(opts.seed ?? 1);
  const P = plan(timeline, duration, rnd);
  const env = opts.envelope || null;
  const ms = opts.motionScale ?? 1; // <1: calmer presence (smaller sway and nods)
  const ph = P.phase;
  const n = Math.max(1, Math.round(duration * fps) + 1);
  const frames = [];
  let openPrev = 0;
  const openA = 1 - Math.exp(-1 / (fps * 0.022)); // jaw inertia, tau 22 ms
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const speaking = t > P.speechStart - 0.2 && t < P.speechEnd + 0.3 ? 1 : 0;
    const sp = smooth(Math.min((t - (P.speechStart - 0.4)) / 0.4, (P.speechEnd + 0.6 - t) / 0.6)) * (isFinite(P.speechStart) ? 1 : 0);

    // slow sway (sum of incommensurate sines), livelier while speaking
    let yaw = 1.5 * Math.sin(t * 0.43 + ph[0]) + 0.8 * Math.sin(t * 1.07 + ph[1]) + sp * 0.9 * Math.sin(t * 2.9 + ph[2]);
    let pitch = 0.8 * Math.sin(t * 0.37 + ph[3]) + 0.45 * Math.sin(t * 0.93 + ph[4]) + sp * 0.6 * Math.sin(t * 3.4 + ph[5]);
    let roll = 0.9 * Math.sin(t * 0.29 + ph[6]) + 0.4 * Math.sin(t * 0.81 + ph[7]);
    let brow = 0.06 * Math.sin(t * 0.5 + ph[8]) + sp * 0.08;

    for (const nd of P.nods) {
      const b = bump(t, nd.t + 0.06, 0.13, 0.34);
      pitch += nd.amp * b;
      yaw += 0.25 * nd.amp * b * Math.sin(ph[9]);
    }
    for (const h of P.browHits) brow += 0.32 * bump(t, h, 0.12, 0.45);

    if (P.question) {
      const q0 = P.speechEnd - Math.min(1.6, (P.speechEnd - P.speechStart) * 0.4);
      const q = smooth((t - q0) / 0.7) * (1 - smooth((t - (P.speechEnd + 1.4)) / 0.8));
      roll += 4.2 * q;
      pitch -= 1.6 * q;
      yaw += 1.2 * q;
      brow += 0.45 * q;
    }
    // a small settle in pauses
    for (const p of P.pauses) pitch += 0.6 * bump(t, p.start + 0.12, 0.1, 0.25);

    const g = gazeAt(t, P.sacc);
    // the head trails big gaze shifts a little
    yaw += g.x * 3.0;
    pitch += g.y * 1.5;
    const blink = blinkCurve(t, P.blinks);

    const visemes = visemeWeights(t, P.vis, lead, 0.045);
    let open = 0, press = 0;
    for (const k in visemes) { open += visemes[k] * SHAPES[k].open; press += visemes[k] * SHAPES[k].press; }
    open *= 1 - 0.85 * press;
    if (env) {
      // loudness shapes how far each syllable opens (envelope at 100 Hz, normalised to its p95)
      const e = env[Math.min(env.length - 1, Math.max(0, Math.round((t + lead) * 100)))] || 0;
      open *= 0.6 + 0.55 * Math.min(1.2, e);
    }
    openPrev += (open - openPrev) * openA;
    open = openPrev;
    void speaking;

    yaw *= ms; pitch *= ms; roll *= ms;
    const r3 = (x) => Math.round(x * 1000) / 1000;
    const vOut = {};
    for (const k in visemes) if (visemes[k] > 0.005) vOut[k] = r3(visemes[k]);
    frames.push({
      t: r3(t),
      head: { yaw: r3(yaw), pitch: r3(pitch), roll: r3(roll) },
      eyes: { blinkL: r3(blink), blinkR: r3(blink), gazeX: r3(g.x), gazeY: r3(g.y) },
      brow: { raise: r3(clamp(brow, -1, 1)) },
      mouth: { open: r3(clamp(open, 0, 1)), visemes: vOut },
    });
  }
  return { version: 1, fps, frames };
}

const lerp = (a, b, k) => a + (b - a) * k;
function lerpObj(a, b, k) {
  const o = {};
  for (const key in a) o[key] = typeof a[key] === 'number' && typeof b?.[key] === 'number' ? lerp(a[key], b[key], k) : a[key];
  return o;
}

/** Interpolated frame of a RigParams track at time t (seconds). Missing groups stay missing. */
export function sampleTrack(track, t) {
  const fr = track.frames;
  if (!fr.length) return null;
  if (t <= fr[0].t) return fr[0];
  if (t >= fr[fr.length - 1].t) return fr[fr.length - 1];
  let lo = 0, hi = fr.length - 1;
  const guess = Math.floor(t * (track.fps || 60));
  if (guess > 0 && guess < hi && fr[guess].t <= t && fr[guess + 1].t > t) { lo = guess; hi = guess + 1; }
  else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (fr[m].t <= t) lo = m; else hi = m; }
  const a = fr[lo], b = fr[hi];
  const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const out = { t };
  for (const g of ['head', 'eyes', 'brow']) if (a[g]) out[g] = lerpObj(a[g], b[g], k);
  if (a.mouth) {
    const m = { };
    if (typeof a.mouth.open === 'number') m.open = lerp(a.mouth.open, b.mouth?.open ?? a.mouth.open, k);
    if (a.mouth.visemes || b.mouth?.visemes) {
      const v = {};
      for (const key of VISEMES) {
        const x = lerp(a.mouth.visemes?.[key] || 0, b.mouth?.visemes?.[key] || 0, k);
        if (x > 0) v[key] = x;
      }
      m.visemes = v;
    }
    out.mouth = m;
  }
  return out;
}

/** RMS loudness envelope at 100 Hz from mono samples, normalised so its 95th percentile is 1. */
export function loudnessEnvelope(samples, sampleRate) {
  const hop = Math.round(sampleRate / 100), win = hop * 2;
  const n = Math.ceil(samples.length / hop);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = i * hop - win / 2; j < i * hop + win / 2; j++) if (j >= 0 && j < samples.length) { s += samples[j] * samples[j]; c++; }
    env[i] = Math.sqrt(s / Math.max(1, c));
  }
  const sorted = Array.from(env).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
  for (let i = 0; i < n; i++) env[i] = env[i] / p95;
  return env;
}
