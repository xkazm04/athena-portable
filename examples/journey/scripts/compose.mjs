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
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JOURNEY = path.resolve(HERE, '..');

const FADE_MS = 200;
const AUDIO_RATE = 48_000;

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = {
    captions: false,
    dry: false,
    take: path.join(JOURNEY, 'take', 'take.json'),
    out: path.join(JOURNEY, 'take', 'journey.mp4'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--captions') args.captions = true;
    else if (a === '--dry') args.dry = true;
    else if (a === '--take') args.take = path.resolve(JOURNEY, argv[(i += 1)] ?? '');
    else if (a === '--out') args.out = path.resolve(JOURNEY, argv[(i += 1)] ?? '');
    else if (a === '--help' || a === '-h') {
      console.log(
        'node scripts/compose.mjs [--captions] [--dry] [--take take/take.json] [--out take/journey.mp4]',
      );
      process.exit(0);
    } else fail(`unknown argument: ${a}`);
  }
  return args;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---------------------------------------------------------------- subtitles

function srtTime(ms) {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const milli = clamped % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

function buildSrt(beats) {
  const lines = [];
  let index = 0;
  for (const beat of beats) {
    const caption = String(beat.caption ?? '').trim();
    if (!caption) continue;
    const start = Number(beat.start_ms) || 0;
    const end = Math.max(start + 500, Number(beat.end_ms) || start + 500);
    index += 1;
    lines.push(String(index), `${srtTime(start)} --> ${srtTime(end)}`, caption, '');
  }
  return lines.join('\n');
}

/** ffmpeg filtergraph escaping: the option separator and the Windows drive colon. */
function escapeForFilter(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

// ---------------------------------------------------------------- ffprobe

async function probeDurationMs(file) {
  const { stdout } = await execFileAsync('ffprobe', [
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

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.take)) fail(`no take at ${path.relative(JOURNEY, args.take)}; run the recorder first`);
  const take = JSON.parse(await readFile(args.take, 'utf8'));
  const takeDir = path.dirname(args.take);

  const video = path.resolve(takeDir, take.video ?? '');
  if (!existsSync(video)) fail(`the take names a video that is not there: ${video}`);

  const beats = Array.isArray(take.beats) ? [...take.beats] : [];
  beats.sort((a, b) => (Number(a.start_ms) || 0) - (Number(b.start_ms) || 0));
  if (beats.length === 0) console.warn('warn: the take has no beats; the cut will be silent');

  const audioDir = path.join(takeDir, 'audio');
  const durationsPath = path.join(audioDir, 'durations.json');
  let durations = {};
  if (existsSync(durationsPath)) durations = JSON.parse(await readFile(durationsPath, 'utf8'));
  else console.warn(`warn: no ${path.relative(JOURNEY, durationsPath)}; clip lengths come from ffprobe`);

  const videoMs = await probeDurationMs(video);

  // Each clip is placed at its beat's start and, if it overruns the beat, trimmed with a fade
  // so two clips can never overlap.
  const clips = [];
  let previousEnd = -1;
  for (const beat of beats) {
    const mp3 = path.join(audioDir, `${beat.id}.mp3`);
    if (!existsSync(mp3)) {
      console.warn(`warn: beat ${beat.id} has no mp3 at ${path.relative(JOURNEY, mp3)}, skipping`);
      continue;
    }
    const start = Math.max(0, Number(beat.start_ms) || 0);
    const beatEnd = Math.max(start, Number(beat.end_ms) || start);
    let clipMs = Number(durations[beat.id]);
    if (!Number.isFinite(clipMs) || clipMs <= 0) clipMs = await probeDurationMs(mp3);

    const room = Math.max(0, Math.min(beatEnd, videoMs) - start);
    if (room <= 0) {
      console.warn(`warn: beat ${beat.id} starts at or past the end of the video, skipping`);
      continue;
    }
    if (start < previousEnd) {
      console.warn(`warn: beat ${beat.id} starts before the previous beat ends; it will be trimmed`);
    }
    const keep = Math.min(clipMs, room);
    clips.push({ id: beat.id, file: mp3, start, keep, trimmed: keep < clipMs });
    previousEnd = start + keep;
  }

  // ---- filtergraph
  const inputs = ['-i', video, '-f', 'lavfi', '-t', (videoMs / 1000).toFixed(3), '-i', `anullsrc=r=${AUDIO_RATE}:cl=stereo`];
  for (const clip of clips) inputs.push('-i', clip.file);

  const chains = [];
  const format = `aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;
  chains.push(`[1:a]${format}[bed]`);
  clips.forEach((clip, i) => {
    const parts = [format];
    if (clip.trimmed) {
      const keepS = clip.keep / 1000;
      parts.push(`atrim=0:${keepS.toFixed(3)}`, 'asetpts=PTS-STARTPTS');
      parts.push(`afade=t=out:st=${Math.max(0, keepS - FADE_MS / 1000).toFixed(3)}:d=${(FADE_MS / 1000).toFixed(3)}`);
    }
    parts.push(`adelay=${clip.start}:all=1`);
    chains.push(`[${i + 2}:a]${parts.join(',')}[a${i}]`);
  });

  let audioLabel;
  if (clips.length === 0) {
    audioLabel = '[bed]';
  } else {
    const ins = ['[bed]', ...clips.map((_, i) => `[a${i}]`)].join('');
    chains.push(`${ins}amix=inputs=${clips.length + 1}:normalize=0:duration=first:dropout_transition=0[aout]`);
    audioLabel = '[aout]';
  }

  let videoLabel = '0:v';
  let srtPath = null;
  if (args.captions) {
    srtPath = args.out.replace(/\.mp4$/i, '') + '.srt';
    const srt = buildSrt(beats);
    await mkdir(path.dirname(srtPath), { recursive: true });
    if (!args.dry) await writeFile(srtPath, `${srt}\n`);
    let filterPath = path.relative(process.cwd(), srtPath);
    if (filterPath.startsWith('..') || path.isAbsolute(filterPath)) filterPath = srtPath;
    chains.push(`[0:v]subtitles=${escapeForFilter(filterPath)}:force_style='FontSize=7,MarginV=16,Outline=1,Shadow=0'[vout]`);
    videoLabel = '[vout]';
  }

  const filter = chains.join(';');
  const cmd = [
    'ffmpeg',
    '-y',
    ...inputs,
    '-filter_complex',
    filter,
    '-map',
    videoLabel,
    '-map',
    audioLabel,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '25',
    '-c:a',
    'aac',
    '-ar',
    String(AUDIO_RATE),
    '-b:a',
    '192k',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    '-shortest',
    args.out,
  ];

  console.log(
    `${clips.length} clip(s) on ${(videoMs / 1000).toFixed(2)} s of video` +
      (clips.some((c) => c.trimmed)
        ? `; trimmed: ${clips.filter((c) => c.trimmed).map((c) => c.id).join(', ')}`
        : ''),
  );
  if (srtPath) console.log(`captions: ${path.relative(JOURNEY, srtPath)}`);

  if (args.dry) {
    console.log('');
    console.log(cmd.map((a) => (/[\s;'"]/.test(a) ? `"${a}"` : a)).join(' '));
    return;
  }

  await mkdir(path.dirname(args.out), { recursive: true });
  const code = await new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', (err) => {
      console.error(String(err?.message ?? err));
      resolve(127);
    });
    child.on('close', resolve);
  });
  if (code !== 0) fail(`ffmpeg exited ${code}`);

  const outMs = await probeDurationMs(args.out);
  console.log(`\nwrote ${path.relative(JOURNEY, args.out)} — ${(outMs / 1000).toFixed(2)} s`);
}

main().catch((err) => {
  console.error(String(err?.stack ?? err));
  process.exit(1);
});
