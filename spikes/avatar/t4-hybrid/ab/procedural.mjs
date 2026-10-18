// Dump t1's procedural RigParams (seed 7, the same as t1's page default) for each line, so the A/B
// metrics in t4/compare.py compare like for like. Imports t1's motion.js unchanged.
//   node spikes/avatar/t4-hybrid/ab/procedural.mjs [calm question long]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { generateRigParams } from '../../web/src/motion.js';

const HOME = process.env.ATHENA_AVATAR_HOME || join(homedir(), '.athena-avatar');
// --scale 0.7 = t1's glow-being motion scale; written as <line>.procedural-glow.rigparams.json
const argv = process.argv.slice(2);
const si = argv.indexOf('--scale');
const scale = si >= 0 ? Number(argv.splice(si, 2)[1]) : 1;
const lines = argv.length ? argv : ['calm', 'question', 'long'];
const out = join(HOME, 'voice', 't4-hybrid');
mkdirSync(out, { recursive: true });
for (const line of lines) {
  const tl = JSON.parse(readFileSync(join(HOME, 'voice', `${line}.timeline.json`), 'utf8'));
  const rp = generateRigParams(tl, { duration: tl.duration_s, fps: 60, seed: 7, motionScale: scale });
  writeFileSync(join(out, `${line}.procedural${scale === 1 ? '' : '-glow'}.rigparams.json`), JSON.stringify(rp));
  console.log(line, rp.frames.length, 'frames');
}
