#!/usr/bin/env node
/**
 * docs/demo.md section 1, step 3 (compose): ffmpeg lays each beat's narration clip on the
 * recorder's video at the offset the recorder logged, optionally burns the caption strip,
 * and exports the mp4.
 *
 * Usage:
 *   node scripts/compose.mjs [--captions] [--dry] [--take take/take.json] [--out take/journey.mp4]
 *
 * Inputs:  take/take.json (from the recorder), take/audio/durations.json and the mp3s.
 * Output:  take/journey.mp4 (H.264 yuv420p, AAC 48 kHz, faststart) and, with --captions,
 *          take/journey.srt beside it.
 *
 * Film mode (docs/demo.md section 5), for a script whose acts name a `segment`:
 *   node scripts/compose.mjs --film [--script script/proving.en.json] [--takes take]
 *        [--out take/film.mp4] [--captions] [--xfade 300] [--speed 4] [--max-s 179]
 *        [--allow-long] [--dry]
 *
 * Every act is cut out of its segment's video (`<takes>/take.json` for web, `cards.take.json`,
 * `proving.take.json`, `desktop.take.json`) from its first beat's start to its last beat's end;
 * the waiting stretches a live recorder logged inside that window are played `--speed` times
 * faster (default: the take's own factor) under an on-screen "sped up Nx" label; the pieces are
 * concatenated in script order, with an optional crossfade; each beat's clip from
 * `<takes>/audio` is laid at its place on the concatenated timeline. A cut longer than the
 * script's `max_ms` (else 2:59) is refused before ffmpeg runs, unless --allow-long; --dry prints
 * the plan, the timeline and the ffmpeg command and runs nothing. The ffmpeg on PATH is used, or
 * the one `FFMPEG` (and `FFPROBE`) names.
 *
 * Both modes are IO around one pure plan, `scripts/lib/timeline.mjs` (planTake, planFilm and the
 * one clip-laying rule, layClips, which trims a clip at its beat's end or the next voiced beat's
 * start, whichever comes first, so no two clips overlap, a crossfaded seam included). This file
 * reads the takes, probes lengths, asks for the plan and its ffmpeg argv, and runs or prints it.
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  clock,
  DEFAULT_MAX_MS,
  ffmpegArgs,
  FRAME_MS,
  planFilm,
  planTake,
  SEGMENT_TAKES,
} from './lib/timeline.mjs';

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JOURNEY = path.resolve(HERE, '..');

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = {
    captions: false,
    dry: false,
    take: path.join(JOURNEY, 'take', 'take.json'),
    out: path.join(JOURNEY, 'take', 'journey.mp4'),
    film: false,
    script: process.env.JOURNEY_SCRIPT
      ? path.resolve(JOURNEY, process.env.JOURNEY_SCRIPT)
      : path.join(JOURNEY, 'script', 'proving.en.json'),
    takes: path.join(JOURNEY, 'take'),
    xfade: 0,
    speed: undefined,
    maxS: undefined,
    allowLong: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--captions') args.captions = true;
    else if (a === '--dry') args.dry = true;
    else if (a === '--take') args.take = path.resolve(JOURNEY, argv[(i += 1)] ?? '');
    else if (a === '--out') args.out = path.resolve(JOURNEY, argv[(i += 1)] ?? '');
    else if (a === '--film') args.film = true;
    else if (a === '--script') args.script = path.resolve(JOURNEY, argv[(i += 1)] ?? '');
    else if (a === '--takes') args.takes = path.resolve(JOURNEY, argv[(i += 1)] ?? '');
    else if (a === '--xfade') args.xfade = Number(argv[(i += 1)]);
    else if (a === '--speed') args.speed = Number(argv[(i += 1)]);
    else if (a === '--max-s') args.maxS = Number(argv[(i += 1)]);
    else if (a === '--allow-long') args.allowLong = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        'node scripts/compose.mjs [--captions] [--dry] [--take take/take.json] [--out take/journey.mp4]\n' +
          'node scripts/compose.mjs --film [--script script/proving.en.json] [--takes take] [--out take/film.mp4]\n' +
          '     [--captions] [--xfade 300] [--speed 4] [--max-s 179] [--allow-long] [--dry]',
      );
      process.exit(0);
    } else fail(`unknown argument: ${a}`);
  }
  if (args.film && !outGiven(argv)) args.out = path.join(args.takes, 'film.mp4');
  for (const [flag, v] of [['--xfade', args.xfade], ['--speed', args.speed], ['--max-s', args.maxS]]) {
    if (v !== undefined && !(Number.isFinite(v) && v >= 0)) fail(`${flag} needs a number`);
  }
  return args;
}

function outGiven(argv) {
  return argv.includes('--out');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---------------------------------------------------------------- ffprobe

async function probeDurationMs(file) {
  const { stdout } = await execFileAsync(FFPROBE, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    file,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe gave no duration for ${file}`);
  return Math.round(seconds * 1000);
}

// ---------------------------------------------------------------- IO around the plan

async function readDurations(audioDir, warnMissing) {
  const durationsPath = path.join(audioDir, 'durations.json');
  if (existsSync(durationsPath)) return JSON.parse(await readFile(durationsPath, 'utf8'));
  if (warnMissing) console.warn(`warn: no ${path.relative(JOURNEY, durationsPath)}; clip lengths come from ffprobe`);
  return {};
}

/** { id: { file, ms } } for every id whose mp3 is on disk: durations.json's length, else ffprobe's. */
async function audioOf(ids, audioDir, durations) {
  const audio = {};
  for (const id of ids) {
    const file = path.join(audioDir, `${id}.mp3`);
    if (!existsSync(file)) continue;
    let ms = Number(durations[id]);
    if (!Number.isFinite(ms) || ms <= 0) ms = await probeDurationMs(file);
    audio[id] = { file, ms };
  }
  return audio;
}

/** The subtitle path as the filtergraph names it: relative to the cwd ffmpeg runs in, when it can be. */
function filterPathOf(srtPath) {
  const rel = path.relative(process.cwd(), srtPath);
  return rel.startsWith('..') || path.isAbsolute(rel) ? srtPath : rel;
}

function printCommand(cmd) {
  console.log('');
  console.log(cmd.map((a) => (/[\s;'"]/.test(a) ? `"${a}"` : a)).join(' '));
}

async function runFfmpeg(cmd) {
  const code = await new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', (err) => {
      console.error(String(err?.message ?? err));
      resolve(127);
    });
    child.on('close', resolve);
  });
  if (code !== 0) fail(`ffmpeg exited ${code}`);
}

// ---------------------------------------------------------------- take mode

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.film) return film(args);

  if (!existsSync(args.take)) fail(`no take at ${path.relative(JOURNEY, args.take)}; run the recorder first`);
  const take = JSON.parse(await readFile(args.take, 'utf8'));
  const takeDir = path.dirname(args.take);

  const video = path.resolve(takeDir, take.video ?? '');
  if (!existsSync(video)) fail(`the take names a video that is not there: ${video}`);
  if (!Array.isArray(take.beats) || take.beats.length === 0) console.warn('warn: the take has no beats; the cut will be silent');

  const audioDir = path.join(takeDir, 'audio');
  const durations = await readDurations(audioDir, true);
  const videoMs = await probeDurationMs(video);
  const audio = await audioOf((take.beats ?? []).map((b) => b.id), audioDir, durations);

  const plan = planTake({ take, video, videoMs, audio });
  for (const s of plan.skipped) {
    if (s.reason === 'no-audio') {
      console.warn(`warn: beat ${s.id} has no mp3 at ${path.relative(JOURNEY, path.join(audioDir, `${s.id}.mp3`))}, skipping`);
    } else if (s.reason === 'past-end') console.warn(`warn: beat ${s.id} starts at or past the end of the video, skipping`);
    else console.warn(`warn: beat ${s.id} leaves no room before the next beat starts, skipping`);
  }

  let srtPath = null;
  if (args.captions) {
    srtPath = args.out.replace(/\.mp4$/i, '') + '.srt';
    await mkdir(path.dirname(srtPath), { recursive: true });
    if (!args.dry) await writeFile(srtPath, `${plan.srt}\n`);
  }
  const cmd = ffmpegArgs(plan, { out: args.out, ffmpeg: FFMPEG, srtFilterPath: srtPath ? filterPathOf(srtPath) : undefined });

  const trimmed = plan.clips.filter((c) => c.trimmed).map((c) => c.id);
  console.log(
    `${plan.clips.length} clip(s) on ${(videoMs / 1000).toFixed(2)} s of video` +
      (trimmed.length ? `; trimmed: ${trimmed.join(', ')}` : ''),
  );
  if (srtPath) console.log(`captions: ${path.relative(JOURNEY, srtPath)}`);

  if (args.dry) return printCommand(cmd);

  await mkdir(path.dirname(args.out), { recursive: true });
  await runFfmpeg(cmd);
  const outMs = await probeDurationMs(args.out);
  console.log(`\nwrote ${path.relative(JOURNEY, args.out)} — ${(outMs / 1000).toFixed(2)} s`);
}

// ---------------------------------------------------------------- film mode

async function film(args) {
  if (!existsSync(args.script)) fail(`no script at ${path.relative(JOURNEY, args.script)}`);
  const script = JSON.parse(await readFile(args.script, 'utf8'));
  const maxMs = args.maxS !== undefined ? args.maxS * 1000 : Number(script.max_ms) || DEFAULT_MAX_MS;

  // ---- the takes, one per segment the script uses
  const takes = {};
  for (const act of script.acts) {
    const segment = act.segment ?? 'web';
    if (takes[segment]) continue;
    const name = SEGMENT_TAKES[segment];
    if (!name) fail(`act ${act.id}: unknown segment ${segment}`);
    const file = path.join(args.takes, name);
    if (!existsSync(file)) {
      fail(
        `act ${act.id} is a ${segment} segment and there is no ${path.relative(JOURNEY, file)}; ` +
          'record it first (docs/demo.md section 5)',
      );
    }
    const take = JSON.parse(await readFile(file, 'utf8'));
    const video = path.resolve(path.dirname(file), take.video ?? '');
    if (!existsSync(video)) fail(`${path.relative(JOURNEY, file)} names a video that is not there: ${video}`);
    takes[segment] = { take, video, videoMs: await probeDurationMs(video) };
  }

  const audioDir = path.join(args.takes, 'audio');
  const options = { script, takes, xfade: args.xfade, speed: args.speed, maxMs, allowLong: args.allowLong, captions: args.captions };
  const planOf = (audio) => {
    try {
      return planFilm({ ...options, audio });
    } catch (err) {
      return fail(String(err?.message ?? err));
    }
  };

  // ---- the cut first (the limit is decided before any clip is probed), then the clips on it
  const cut = planOf({});
  for (const w of cut.warnings) console.warn(`warn: ${w}`);
  console.log(`film: ${path.relative(JOURNEY, args.script)}: ${cut.pieces.length} pieces, ${cut.placed.length} beats`);
  for (const p of cut.pieces) {
    const fast = p.ranges.filter((r) => r.factor > 1);
    console.log(
      `  ${clock(p.at)}  ${p.act.padEnd(10)} ${p.segment.padEnd(8)} ` +
        `${((p.to - p.from) / 1000).toFixed(1)} s recorded -> ${(p.ms / 1000).toFixed(1)} s` +
        (fast.length
          ? `; sped up: ${fast.map((r) => `${((r.to - r.from) / 1000).toFixed(1)} s at ${r.factor}x`).join(', ')}`
          : ''),
    );
  }
  console.log(`  total ${clock(cut.totalMs)} (${cut.totalMs} ms)${cut.fade ? `, crossfade ${cut.fade} ms` : ''}; limit ${clock(maxMs)}`);
  if (cut.refused) fail(`refused: ${cut.refused}. Shorten the script, raise --speed, or pass --allow-long for a draft.`);
  if (cut.over) console.warn(`warn: ${cut.over} (--allow-long)`);

  const durations = await readDurations(audioDir, false);
  const plan = planOf(await audioOf(cut.placed.map((b) => b.id), audioDir, durations));
  for (const s of plan.skipped) {
    if (s.reason === 'no-audio') {
      console.warn(`warn: beat ${s.id} has no mp3 at ${path.relative(JOURNEY, path.join(audioDir, `${s.id}.mp3`))}, silent`);
    }
  }
  const trimmed = plan.clips.filter((c) => c.trimmed).map((c) => c.id);
  console.log(`  ${plan.clips.length} clip(s)${trimmed.length ? `; trimmed to their beat or the next: ${trimmed.join(', ')}` : ''}`);

  const srtPath = args.out.replace(/\.mp4$/i, '') + '.srt';
  const cmd = ffmpegArgs(plan, { out: args.out, ffmpeg: FFMPEG, srtFilterPath: filterPathOf(srtPath) });

  if (args.dry) {
    console.log(`\nsubtitles: ${plan.blocks.length} block(s), would be written to ${path.relative(JOURNEY, srtPath)}`);
    return printCommand(cmd);
  }

  await mkdir(path.dirname(args.out), { recursive: true });
  if (plan.blocks.length) await writeFile(srtPath, `${plan.srt}\n`);
  await runFfmpeg(cmd);
  const outMs = await probeDurationMs(args.out);
  console.log(`\nwrote ${path.relative(JOURNEY, args.out)}: ${(outMs / 1000).toFixed(2)} s (${clock(outMs)})`);
  if (outMs > maxMs + FRAME_MS && !args.allowLong) fail(`the written cut runs ${clock(outMs)}, over the ${clock(maxMs)} limit`);
}

main().catch((err) => {
  console.error(String(err?.stack ?? err));
  process.exit(1);
});
