#!/usr/bin/env node
/**
 * docs/demo.md section 5 (rehearsal) — placeholder takes for every segment, so compose can be
 * proven end to end without a key, a running app or a live run.
 *
 * For each segment the script uses it writes a solid-colour clip (ffmpeg's lavfi `color`, one
 * colour per segment), a segment take beside it with every beat held `--beat-s` seconds, a logged
 * waiting stretch of `--wait-s` before every beat that has a `cue` (so the speed-up path runs),
 * and a short tone per beat in place of narration. Everything lands in `take/placeholder/`
 * (gitignored), laid out exactly as a real take directory, so the real compose reads it with
 * `--takes take/placeholder`:
 *
 *   node scripts/placeholders.mjs [--script script/proving.en.json] [--beat-s 2.5] [--wait-s 8]
 *   node scripts/compose.mjs --film --takes take/placeholder --captions
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { placeholderTakes } from './lib/timeline.mjs';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const JOURNEY = path.resolve(HERE, '..');
const OUT = path.join(JOURNEY, 'take', 'placeholder');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const COLOURS = { web: '0x1d3557', card: '0x0b0e14', proving: '0x2a9d8f', desktop: '0x6d597a' };

function parseArgs(argv) {
  const args = {
    script: process.env.JOURNEY_SCRIPT
      ? path.resolve(JOURNEY, process.env.JOURNEY_SCRIPT)
      : path.join(JOURNEY, 'script', 'proving.en.json'),
    beatMs: 2500,
    waitMs: 8000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--script') args.script = path.resolve(JOURNEY, argv[(i += 1)] ?? '');
    else if (a === '--beat-s') args.beatMs = Number(argv[(i += 1)]) * 1000;
    else if (a === '--wait-s') args.waitMs = Number(argv[(i += 1)]) * 1000;
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(1);
    }
  }
  if (!(args.beatMs > 0) || !(args.waitMs >= 0)) {
    console.error('--beat-s must be positive and --wait-s non-negative');
    process.exit(1);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const script = JSON.parse(await readFile(args.script, 'utf8'));
  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, 'audio'), { recursive: true });

  // The takes are planned by scripts/lib/timeline.mjs (the same captions and clock compose reads);
  // this file only renders them.
  const { segments, durations } = placeholderTakes(script, args);
  for (const { segment, file, take, videoMs } of segments) {
    const { video, beats, speedups } = take;
    await execFileAsync(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=${COLOURS[segment]}:s=1440x900:r=25:d=${(videoMs / 1000).toFixed(3)}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(OUT, video),
    ]);
    await writeFile(
      path.join(OUT, file),
      `${JSON.stringify({ segment, video, width: 1440, height: 900, script: path.relative(JOURNEY, args.script), video_offset_uncertainty_ms: 0, beats, speedups, notes: ['placeholder'] }, null, 2)}\n`,
    );
    console.log(`${segment}: ${beats.length} beats, ${speedups.length} wait(s), ${(videoMs / 1000).toFixed(1)} s -> ${path.relative(JOURNEY, path.join(OUT, video))}`);
  }

  // A tone per beat, where the narration would be: compose lays and mixes these exactly as clips.
  let n = 0;
  for (const [id, ms] of Object.entries(durations)) {
    const hz = 330 + (n % 5) * 55;
    n += 1;
    await execFileAsync(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${(ms / 1000).toFixed(3)}`,
      '-af', 'volume=0.2', '-c:a', 'libmp3lame', '-b:a', '96k', path.join(OUT, 'audio', `${id}.mp3`),
    ]);
  }
  await writeFile(path.join(OUT, 'audio', 'durations.json'), `${JSON.stringify(durations, null, 2)}\n`);
  console.log(`${n} placeholder clip(s) in ${path.relative(JOURNEY, path.join(OUT, 'audio'))}`);
  console.log(`next: node scripts/compose.mjs --film --takes ${path.relative(JOURNEY, OUT)} --captions`);
}

main().catch((err) => {
  console.error(String(err?.stack ?? err));
  process.exit(1);
});
