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

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.film) return film(args);

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
    FFMPEG,
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

// ---------------------------------------------------------------- film mode

const SEGMENT_TAKES = {
  web: 'take.json',
  card: 'cards.take.json',
  proving: 'proving.take.json',
  desktop: 'desktop.take.json',
};
const FILM_W = 1440;
const FILM_H = 900;
const FILM_FPS = 25;
const FRAME_MS = 1000 / FILM_FPS;
const DEFAULT_MAX_MS = 179_000;

function clock(ms) {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

/**
 * One act's window of its segment video, split where the recorder logged a wait: real-time
 * stretches at factor 1 and waiting stretches at their factor, contiguous from `from` to `to`.
 */
function rangesOf(from, to, speedups, speedOverride) {
  const fast = speedups
    .map((r) => ({
      from: Math.max(from, Number(r.start_ms) || 0),
      to: Math.min(to, Number(r.end_ms) || 0),
      factor: speedOverride ?? (Number(r.factor) || 4),
    }))
    .filter((r) => r.to - r.from >= FRAME_MS * 2 && r.factor > 1)
    .sort((a, b) => a.from - b.from);
  const out = [];
  let at = from;
  for (const r of fast) {
    if (r.from < at) r.from = at;
    if (r.to <= r.from) continue;
    if (r.from > at) out.push({ from: at, to: r.from, factor: 1 });
    out.push(r);
    at = r.to;
  }
  if (to > at) out.push({ from: at, to, factor: 1 });
  return out.filter((r) => r.to - r.from >= FRAME_MS);
}

/** Segment clock -> milliseconds from the start of the piece, through the piece's speed ranges. */
function mapThrough(ranges, t) {
  let out = 0;
  for (const r of ranges) {
    if (t <= r.from) break;
    out += (Math.min(t, r.to) - r.from) / r.factor;
  }
  return out;
}

function srtBlock(index, start, end, text) {
  return [String(index), `${srtTime(start)} --> ${srtTime(end)}`, text, ''].join('\n');
}

async function film(args) {
  if (!existsSync(args.script)) fail(`no script at ${path.relative(JOURNEY, args.script)}`);
  const script = JSON.parse(await readFile(args.script, 'utf8'));
  const maxMs = args.maxS !== undefined ? args.maxS * 1000 : Number(script.max_ms) || DEFAULT_MAX_MS;
  const xfadeMs = args.xfade || 0;

  // ---- the takes, one per segment the script uses
  const takes = new Map();
  for (const act of script.acts) {
    const segment = act.segment ?? 'web';
    if (takes.has(segment)) continue;
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
    takes.set(segment, { file, take, video, videoMs: await probeDurationMs(video) });
  }

  // ---- the pieces: one per act, cut from its segment's video
  const pieces = [];
  for (const act of script.acts) {
    const segment = act.segment ?? 'web';
    const { take, video, videoMs } = takes.get(segment);
    const ids = new Set(act.beats.map((b) => b.id));
    const marks = (take.beats ?? []).filter((m) => ids.has(m.id));
    const missing = act.beats.filter((b) => !marks.some((m) => m.id === b.id)).map((b) => b.id);
    if (marks.length === 0) fail(`act ${act.id}: the ${segment} take has none of its beats (${[...ids].join(', ')})`);
    if (missing.length) console.warn(`warn: act ${act.id}: the ${segment} take has no mark for ${missing.join(', ')}`);
    for (const m of marks) if (m.error) console.warn(`warn: beat ${m.id} was recorded with an error: ${m.error}`);
    const from = Math.max(0, Math.min(...marks.map((m) => Number(m.start_ms) || 0)));
    const to = Math.min(videoMs, Math.max(...marks.map((m) => Number(m.end_ms) || 0)));
    if (to <= from) fail(`act ${act.id}: its beats fall outside the ${segment} video (${videoMs} ms)`);
    const ranges = rangesOf(from, to, take.speedups ?? [], args.speed);
    const ms = ranges.reduce((sum, r) => sum + (r.to - r.from) / r.factor, 0);
    pieces.push({ act, segment, video, from, to, ranges, ms, marks, at: 0 });
  }

  // ---- the timeline: where each piece starts in the film (a crossfade overlaps neighbours)
  const fade = pieces.length > 1 ? Math.round(Math.min(xfadeMs, ...pieces.map((p) => p.ms / 2))) : 0;
  let at = 0;
  for (const p of pieces) {
    p.at = at;
    at += p.ms - fade;
  }
  const totalMs = Math.round(at + fade);

  // ---- the beats, on the film's clock
  const placed = [];
  for (const p of pieces) {
    for (const m of p.marks) {
      placed.push({
        id: m.id,
        caption: m.caption,
        start: Math.round(p.at + mapThrough(p.ranges, Number(m.start_ms) || 0)),
        end: Math.round(p.at + mapThrough(p.ranges, Number(m.end_ms) || 0)),
      });
    }
  }
  placed.sort((a, b) => a.start - b.start);

  // ---- the plan, printed whether or not it runs
  console.log(`film: ${path.relative(JOURNEY, args.script)}: ${pieces.length} pieces, ${placed.length} beats`);
  for (const p of pieces) {
    const fast = p.ranges.filter((r) => r.factor > 1);
    console.log(
      `  ${clock(p.at)}  ${p.act.id.padEnd(10)} ${p.segment.padEnd(8)} ` +
        `${((p.to - p.from) / 1000).toFixed(1)} s recorded -> ${(p.ms / 1000).toFixed(1)} s` +
        (fast.length
          ? `; sped up: ${fast.map((r) => `${((r.to - r.from) / 1000).toFixed(1)} s at ${r.factor}x`).join(', ')}`
          : ''),
    );
  }
  console.log(`  total ${clock(totalMs)} (${totalMs} ms)${fade ? `, crossfade ${fade} ms` : ''}; limit ${clock(maxMs)}`);
  if (totalMs > maxMs) {
    const over = `the cut runs ${clock(totalMs)}, over the ${clock(maxMs)} limit`;
    if (!args.allowLong) fail(`refused: ${over}. Shorten the script, raise --speed, or pass --allow-long for a draft.`);
    console.warn(`warn: ${over} (--allow-long)`);
  }

  // ---- audio clips, as the take's compose lays them: at the beat, trimmed with a fade at the
  // beat's end so two clips never overlap
  const audioDir = path.join(args.takes, 'audio');
  const durationsPath = path.join(audioDir, 'durations.json');
  const durations = existsSync(durationsPath) ? JSON.parse(await readFile(durationsPath, 'utf8')) : {};
  const clips = [];
  for (const beat of placed) {
    const mp3 = path.join(audioDir, `${beat.id}.mp3`);
    if (!existsSync(mp3)) {
      console.warn(`warn: beat ${beat.id} has no mp3 at ${path.relative(JOURNEY, mp3)}, silent`);
      continue;
    }
    let clipMs = Number(durations[beat.id]);
    if (!Number.isFinite(clipMs) || clipMs <= 0) clipMs = await probeDurationMs(mp3);
    const room = Math.max(0, Math.min(beat.end, totalMs) - beat.start);
    if (room <= 0) continue;
    const keep = Math.min(clipMs, room);
    clips.push({ id: beat.id, file: mp3, start: beat.start, keep, trimmed: keep < clipMs });
  }
  const trimmed = clips.filter((c) => c.trimmed).map((c) => c.id);
  console.log(`  ${clips.length} clip(s)${trimmed.length ? `; trimmed to their beat: ${trimmed.join(', ')}` : ''}`);

  // ---- subtitles: the speed-up label top right, always; the captions at the bottom, on request
  const blocks = [];
  for (const p of pieces) {
    for (const r of p.ranges.filter((x) => x.factor > 1)) {
      const s = p.at + mapThrough(p.ranges, r.from);
      const e = p.at + mapThrough(p.ranges, r.to);
      blocks.push({ s, e, text: `{\\an9}sped up ${r.factor}x` });
    }
  }
  if (args.captions) {
    for (const b of placed) {
      const text = String(b.caption ?? '').trim();
      if (text) blocks.push({ s: b.start, e: Math.max(b.start + 500, b.end), text });
    }
  }
  blocks.sort((a, b) => a.s - b.s);
  const srtPath = args.out.replace(/\.mp4$/i, '') + '.srt';
  const srt = blocks.map((b, i) => srtBlock(i + 1, b.s, b.e, b.text)).join('\n');

  // ---- the filtergraph: every piece's ranges cut from its video, normalised to one look,
  // concatenated (or crossfaded), then the subtitles; the audio bed with the clips mixed in
  const files = [...new Set(pieces.map((p) => p.video))];
  const uses = new Map(files.map((f) => [f, 0]));
  for (const p of pieces) uses.set(p.video, uses.get(p.video) + p.ranges.length);
  const inputs = [];
  for (const f of files) inputs.push('-i', f);
  const bedIndex = files.length;
  inputs.push('-f', 'lavfi', '-t', (totalMs / 1000).toFixed(3), '-i', `anullsrc=r=${AUDIO_RATE}:cl=stereo`);
  for (const clip of clips) inputs.push('-i', clip.file);

  const chains = [];
  const taps = new Map();
  files.forEach((f, i) => {
    const n = uses.get(f);
    const labels = Array.from({ length: n }, (_, k) => `[s${i}_${k}]`);
    chains.push(`[${i}:v]split=${n}${labels.join('')}`);
    taps.set(f, labels);
  });
  const look =
    `fps=${FILM_FPS},scale=${FILM_W}:${FILM_H}:force_original_aspect_ratio=decrease,` +
    `pad=${FILM_W}:${FILM_H}:(ow-iw)/2:(oh-ih)/2:color=0x0b0e14,setsar=1,format=yuv420p`;
  pieces.forEach((p, i) => {
    const parts = p.ranges.map((r, j) => {
      const tap = taps.get(p.video).shift();
      const speed = r.factor > 1 ? `(PTS-STARTPTS)/${r.factor}` : 'PTS-STARTPTS';
      chains.push(
        `${tap}trim=start=${(r.from / 1000).toFixed(3)}:end=${(r.to / 1000).toFixed(3)},setpts=${speed},${look}[r${i}_${j}]`,
      );
      return `[r${i}_${j}]`;
    });
    chains.push(
      // One timebase for every piece: xfade refuses two inputs whose timebases differ, and concat
      // hands back a finer one than a single range does.
      parts.length === 1
        ? `${parts[0]}settb=1/${FILM_FPS}[p${i}]`
        : `${parts.join('')}concat=n=${parts.length}:v=1:a=0,settb=1/${FILM_FPS}[p${i}]`,
    );
  });
  if (pieces.length === 1) chains.push('[p0]null[vcat]');
  else if (!fade) chains.push(`${pieces.map((_, i) => `[p${i}]`).join('')}concat=n=${pieces.length}:v=1:a=0[vcat]`);
  else {
    let prev = '[p0]';
    for (let i = 1; i < pieces.length; i += 1) {
      const label = i === pieces.length - 1 ? '[vcat]' : `[x${i}]`;
      chains.push(
        `${prev}[p${i}]xfade=transition=fade:duration=${(fade / 1000).toFixed(3)}:offset=${(pieces[i].at / 1000).toFixed(3)}${label}`,
      );
      prev = label;
    }
  }
  let videoLabel = '[vcat]';
  if (blocks.length) {
    let filterPath = path.relative(process.cwd(), srtPath);
    if (filterPath.startsWith('..') || path.isAbsolute(filterPath)) filterPath = srtPath;
    chains.push(
      `[vcat]subtitles=${escapeForFilter(filterPath)}:force_style='FontSize=10,MarginV=18,MarginR=18,Outline=1,Shadow=0'[vout]`,
    );
    videoLabel = '[vout]';
  }

  const format = `aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;
  chains.push(`[${bedIndex}:a]${format}[bed]`);
  clips.forEach((clip, i) => {
    const parts = [format];
    if (clip.trimmed) {
      const keepS = clip.keep / 1000;
      parts.push(`atrim=0:${keepS.toFixed(3)}`, 'asetpts=PTS-STARTPTS');
      parts.push(`afade=t=out:st=${Math.max(0, keepS - FADE_MS / 1000).toFixed(3)}:d=${(FADE_MS / 1000).toFixed(3)}`);
    }
    parts.push(`adelay=${clip.start}:all=1`);
    chains.push(`[${bedIndex + 1 + i}:a]${parts.join(',')}[a${i}]`);
  });
  const audioLabel = clips.length === 0 ? '[bed]' : '[aout]';
  if (clips.length) {
    chains.push(
      `[bed]${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length + 1}:normalize=0:duration=first:dropout_transition=0[aout]`,
    );
  }

  const cmd = [
    FFMPEG, '-y', '-hide_banner', '-loglevel', 'error', '-stats', ...inputs,
    '-filter_complex', chains.join(';'),
    '-map', videoLabel, '-map', audioLabel,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FILM_FPS),
    '-c:a', 'aac', '-ar', String(AUDIO_RATE), '-b:a', '192k', '-ac', '2',
    '-movflags', '+faststart', '-t', (totalMs / 1000).toFixed(3), args.out,
  ];

  if (args.dry) {
    console.log(`\nsubtitles: ${blocks.length} block(s), would be written to ${path.relative(JOURNEY, srtPath)}`);
    console.log('');
    console.log(cmd.map((a) => (/[\s;'"]/.test(a) ? `"${a}"` : a)).join(' '));
    return;
  }

  await mkdir(path.dirname(args.out), { recursive: true });
  if (blocks.length) await writeFile(srtPath, `${srt}\n`);
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
  console.log(`\nwrote ${path.relative(JOURNEY, args.out)}: ${(outMs / 1000).toFixed(2)} s (${clock(outMs)})`);
  if (outMs > maxMs + FRAME_MS && !args.allowLong) fail(`the written cut runs ${clock(outMs)}, over the ${clock(maxMs)} limit`);
}

main().catch((err) => {
  console.error(String(err?.stack ?? err));
  process.exit(1);
});
