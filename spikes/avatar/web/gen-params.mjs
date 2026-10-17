// Write the procedural RigParams v1 for a line to a file (for t4-hybrid comparison or blending).
//   node spikes/avatar/web/gen-params.mjs --line calm [--out <file>] [--fps 60] [--seed 7]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { generateRigParams, loudnessEnvelope } from './src/motion.js';
import { HOME } from './serve.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const line = opt('line');
const tl = line ? JSON.parse(readFileSync(join(HOME, 'voice', `${line}.timeline.json`), 'utf8')) : null;
// PCM16 mono WAV -> float samples (the contract's voice format)
function readWav(p) {
  const b = readFileSync(p);
  let o = 12, rate = 24000;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4), len = b.readUInt32LE(o + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(o + 12);
    if (id === 'data') { const n = len / 2, s = new Float32Array(n); for (let i = 0; i < n; i++) s[i] = b.readInt16LE(o + 8 + i * 2) / 32768; return { s, rate }; }
    o += 8 + len + (len % 2);
  }
  return null;
}
const wavP = line && join(HOME, 'voice', `${line}.wav`);
const wav = wavP && existsSync(wavP) && opt('env', '1') !== '0' ? readWav(wavP) : null;
const track = generateRigParams(tl, { envelope: wav ? loudnessEnvelope(wav.s, wav.rate) : null, fps: Number(opt('fps', 60)), seed: Number(opt('seed', 7)), duration: tl ? undefined : Number(opt('dur', 10)) });
const out = opt('out', join(HOME, 't1-rig', 'params', `${line || 'idle'}.rigparams.json`));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(track));
console.log(`${out}: ${track.frames.length} frames @ ${track.fps} fps`);
