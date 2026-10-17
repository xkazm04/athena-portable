// Dump t1's procedural RigParams (seed 7, the same as t1's page default) for each line, so the A/B
// metrics in t4/compare.py compare like for like. Imports t1's motion.js unchanged.
//   node spikes/avatar/t4-hybrid/ab/procedural.mjs [calm question long]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { generateRigParams } from '../../web/src/motion.js';

const HOME = process.env.ATHENA_AVATAR_HOME || join(homedir(), '.athena-avatar');
const lines = process.argv.slice(2).length ? process.argv.slice(2) : ['calm', 'question', 'long'];
const out = join(HOME, 'voice', 't4-hybrid');
mkdirSync(out, { recursive: true });
for (const line of lines) {
  const tl = JSON.parse(readFileSync(join(HOME, 'voice', `${line}.timeline.json`), 'utf8'));
  const rp = generateRigParams(tl, { duration: tl.duration_s, fps: 60, seed: 7 });
  writeFileSync(join(out, `${line}.procedural.rigparams.json`), JSON.stringify(rp));
  console.log(line, rp.frames.length, 'frames');
}
