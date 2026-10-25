/**
 * docs/demo.md sections 1 and 5: the film's schedule, derived once.
 *
 * Where every beat, narration clip, speed-up label and caption lands is a pure function of the
 * script, the takes the recorders logged and the clips' lengths. This module is that function and
 * nothing else: no file is read, no process is spawned, so it is tested offline
 * (`scripts/test/timeline.test.mjs`). `compose.mjs` (take and film mode), `record-desktop.mjs` and
 * `placeholders.mjs` are thin IO shells over it: they read files, probe lengths, call a plan
 * function here, and run or print what it returns.
 *
 * The hold and caption rules are `src/script.ts`'s, restated for plain .mjs callers; a parity test
 * imports the .ts and compares beat by beat, so the two cannot drift.
 */

export const FADE_MS = 200;
export const AUDIO_RATE = 48_000;
export const FILM_W = 1440;
export const FILM_H = 900;
export const FILM_FPS = 25;
export const FRAME_MS = 1000 / FILM_FPS;
export const DEFAULT_MAX_MS = 179_000;
export const SEGMENT_TAKES = {
  web: 'take.json',
  card: 'cards.take.json',
  proving: 'proving.take.json',
  desktop: 'desktop.take.json',
};

// ---------------------------------------------------------------- the script's clock

/** What the audience reads under the picture: Mira and Athena are named, the narrator is bare. */
export function captionOf(beat) {
  if (beat.voice === 'mira') return `Mira: ${beat.line}`;
  if (beat.voice === 'athena') return `Athena: ${beat.line}`;
  return beat.line;
}

/**
 * The measured lengths a recorder may pace to: positive numbers, minus any clip the narration
 * manifest says was read from a line of another length (`src/script.ts` loadDurations/isStale).
 * `manifest` is the parsed `take/audio/manifest.json`, or undefined when there is none.
 */
export function freshDurations(script, durations = {}, manifest = undefined) {
  const narrated = {};
  for (const b of manifest?.beats ?? []) {
    if (typeof b?.id === 'string' && typeof b.chars === 'number') narrated[b.id] = b.chars;
  }
  const lines = new Map(script.acts.flatMap((act) => act.beats.map((b) => [b.id, b.line])));
  const fresh = {};
  for (const [id, value] of Object.entries(durations ?? {})) {
    const ms = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    const chars = narrated[id];
    if (chars !== undefined && lines.has(id) && lines.get(id).length !== chars) continue;
    fresh[id] = ms;
  }
  return fresh;
}

/** How long the voice takes over this beat: the measured clip, or the script's own estimate. */
export function clipMsOf(beat, script, measured) {
  const known = measured[beat.id];
  if (known !== undefined) return known;
  if (script.chars_per_second !== undefined && script.chars_per_second > 0) {
    return Math.round((beat.line.length / script.chars_per_second) * 1000);
  }
  const words = beat.line.split(/\s+/).filter((word) => word.length > 0).length;
  return Math.round((words / script.words_per_second) * 1000);
}

/** `max(clip, settle) + breath`, where the clip is a fresh measured length or the estimate. */
export function holdOf(beat, script, durations = {}, manifest = undefined) {
  const measured = freshDurations(script, durations, manifest);
  return Math.max(clipMsOf(beat, script, measured), beat.settle_ms) + script.breath_ms;
}

// ---------------------------------------------------------------- formatting

export function clock(ms) {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export function srtTime(ms) {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const milli = clamped % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

function srtOf(blocks) {
  return blocks.map((b, i) => [String(i + 1), `${srtTime(b.s)} --> ${srtTime(b.e)}`, b.text, ''].join('\n')).join('\n');
}

/** ffmpeg filtergraph escaping: the option separator and the Windows drive colon. */
export function escapeForFilter(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

// ---------------------------------------------------------------- laying clips

/**
 * The one clip-laying rule, for every mode: each clip starts at its beat and keeps at most the
 * room to the earliest of its beat's end, the next voiced beat's start and the end of the
 * picture, so two clips never overlap, across a crossfaded seam included. A clip cut short is
 * `trimmed` (ffmpegArgs fades it out). `placed` is [{ id, start, end }] on one clock;
 * `durations` is { id: clip ms } for the beats that have a clip.
 */
export function layClips(placed, durations, endMs = Infinity) {
  const sorted = [...placed].sort((a, b) => a.start - b.start);
  const voiced = sorted.filter((b) => Number(durations[b.id]) > 0);
  const clips = [];
  const skipped = sorted.filter((b) => !(Number(durations[b.id]) > 0)).map((b) => ({ id: b.id, reason: 'no-audio' }));
  voiced.forEach((beat, i) => {
    const start = Math.max(0, beat.start);
    const next = i + 1 < voiced.length ? voiced[i + 1].start : Infinity;
    const room = Math.max(0, Math.min(beat.end, next, endMs) - start);
    if (room <= 0) {
      skipped.push({ id: beat.id, reason: start >= endMs ? 'past-end' : next <= start ? 'overlapped' : 'no-room' });
      return;
    }
    const clipMs = Number(durations[beat.id]);
    const keep = Math.min(clipMs, room);
    clips.push({ id: beat.id, start, keep, trimmed: keep < clipMs });
  });
  return { clips, skipped };
}

function lengthsOf(audio) {
  return Object.fromEntries(Object.entries(audio ?? {}).map(([id, a]) => [id, a.ms]));
}

function withFiles(clips, audio) {
  return clips.map((c) => ({ id: c.id, file: audio[c.id].file, start: c.start, keep: c.keep, trimmed: c.trimmed }));
}

// ---------------------------------------------------------------- take mode

/**
 * One recorder's take, cut as it was recorded: its beats' clips on its own video.
 * `audio` is { id: { file, ms } } for every beat whose mp3 exists.
 */
export function planTake({ take, video, videoMs, audio = {} }) {
  const marks = [...(Array.isArray(take.beats) ? take.beats : [])].sort(
    (a, b) => (Number(a.start_ms) || 0) - (Number(b.start_ms) || 0),
  );
  const placed = marks.map((m) => {
    const start = Math.max(0, Number(m.start_ms) || 0);
    return { id: m.id, start, end: Math.max(start, Number(m.end_ms) || start) };
  });
  const { clips, skipped } = layClips(placed, lengthsOf(audio), videoMs);
  const blocks = [];
  for (const m of marks) {
    const text = String(m.caption ?? '').trim();
    if (!text) continue;
    const s = Number(m.start_ms) || 0;
    blocks.push({ s, e: Math.max(s + 500, Number(m.end_ms) || s + 500), text });
  }
  return { kind: 'take', video, videoMs, marks, placed, clips: withFiles(clips, audio), skipped, srt: srtOf(blocks) };
}

// ---------------------------------------------------------------- film mode

/**
 * One act's window of its segment video, split where the recorder logged a wait: real-time
 * stretches at factor 1 and waiting stretches at their factor, contiguous from `from` to `to`.
 */
export function rangesOf(from, to, speedups, speedOverride) {
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
export function mapThrough(ranges, t) {
  let out = 0;
  for (const r of ranges) {
    if (t <= r.from) break;
    out += (Math.min(t, r.to) - r.from) / r.factor;
  }
  return out;
}

/**
 * The film: one piece per act cut from its segment's take, waits sped up, pieces joined (a
 * crossfade overlaps neighbours), beats on the film's clock, clips laid by `layClips`, the
 * speed-up labels and (with `captions`) the caption blocks. `takes` is { segment: { take, video,
 * videoMs } }. Over `maxMs` without `allowLong` the plan carries `refused` and no clips, and
 * ffmpegArgs refuses it. A script or take that cannot be cut throws, naming the act.
 */
export function planFilm({ script, takes, audio = {}, xfade = 0, speed, maxMs, allowLong = false, captions = false }) {
  const limit = maxMs ?? (Number(script.max_ms) || DEFAULT_MAX_MS);
  const warnings = [];

  const pieces = [];
  for (const act of script.acts) {
    const segment = act.segment ?? 'web';
    if (!SEGMENT_TAKES[segment]) throw new Error(`act ${act.id}: unknown segment ${segment}`);
    const t = takes[segment];
    if (!t) throw new Error(`act ${act.id} is a ${segment} segment and there is no ${segment} take`);
    const { take, video, videoMs } = t;
    const ids = new Set(act.beats.map((b) => b.id));
    const marks = (take.beats ?? []).filter((m) => ids.has(m.id));
    const missing = act.beats.filter((b) => !marks.some((m) => m.id === b.id)).map((b) => b.id);
    if (marks.length === 0) throw new Error(`act ${act.id}: the ${segment} take has none of its beats (${[...ids].join(', ')})`);
    if (missing.length) warnings.push(`act ${act.id}: the ${segment} take has no mark for ${missing.join(', ')}`);
    for (const m of marks) if (m.error) warnings.push(`beat ${m.id} was recorded with an error: ${m.error}`);
    const from = Math.max(0, Math.min(...marks.map((m) => Number(m.start_ms) || 0)));
    const to = Math.min(videoMs, Math.max(...marks.map((m) => Number(m.end_ms) || 0)));
    if (to <= from) throw new Error(`act ${act.id}: its beats fall outside the ${segment} video (${videoMs} ms)`);
    const ranges = rangesOf(from, to, take.speedups ?? [], speed);
    const ms = ranges.reduce((sum, r) => sum + (r.to - r.from) / r.factor, 0);
    pieces.push({ act: act.id, segment, video, from, to, ranges, ms, marks, at: 0 });
  }

  const fade = pieces.length > 1 ? Math.round(Math.min(xfade || 0, ...pieces.map((p) => p.ms / 2))) : 0;
  let at = 0;
  for (const p of pieces) {
    p.at = at;
    at += p.ms - fade;
  }
  const totalMs = Math.round(at + fade);

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

  const plan = { kind: 'film', pieces, placed, fade, totalMs, maxMs: limit, warnings, clips: [], skipped: [], blocks: [], srt: '' };
  if (totalMs > limit) {
    plan.over = `the cut runs ${clock(totalMs)}, over the ${clock(limit)} limit`;
    if (!allowLong) {
      plan.refused = plan.over;
      return plan;
    }
  }

  const { clips, skipped } = layClips(placed, lengthsOf(audio), totalMs);
  plan.clips = withFiles(clips, audio);
  plan.skipped = skipped;

  const blocks = [];
  for (const p of pieces) {
    for (const r of p.ranges.filter((x) => x.factor > 1)) {
      blocks.push({ s: p.at + mapThrough(p.ranges, r.from), e: p.at + mapThrough(p.ranges, r.to), text: `{\\an9}sped up ${r.factor}x` });
    }
  }
  if (captions) {
    for (const b of placed) {
      const text = String(b.caption ?? '').trim();
      if (text) blocks.push({ s: b.start, e: Math.max(b.start + 500, b.end), text });
    }
  }
  blocks.sort((a, b) => a.s - b.s);
  plan.blocks = blocks;
  plan.srt = srtOf(blocks);
  return plan;
}

// ---------------------------------------------------------------- ffmpeg

const AUDIO_FORMAT = `aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;

function clipChains(clips, firstInput) {
  return clips.map((clip, i) => {
    const parts = [AUDIO_FORMAT];
    if (clip.trimmed) {
      const keepS = clip.keep / 1000;
      parts.push(`atrim=0:${keepS.toFixed(3)}`, 'asetpts=PTS-STARTPTS');
      parts.push(`afade=t=out:st=${Math.max(0, keepS - FADE_MS / 1000).toFixed(3)}:d=${(FADE_MS / 1000).toFixed(3)}`);
    }
    parts.push(`adelay=${clip.start}:all=1`);
    return `[${firstInput + i}:a]${parts.join(',')}[a${i}]`;
  });
}

/**
 * The ffmpeg argv for a plan. `out` is the mp4; `srtFilterPath` is the subtitle file as the
 * filtergraph should name it (take mode burns captions only when it is given; film mode needs it
 * whenever the plan has blocks). A refused plan builds nothing.
 */
export function ffmpegArgs(plan, { out, ffmpeg = 'ffmpeg', srtFilterPath } = {}) {
  if (plan.refused) throw new Error(`refused: ${plan.refused}`);
  return plan.kind === 'take' ? takeArgs(plan, out, ffmpeg, srtFilterPath) : filmArgs(plan, out, ffmpeg, srtFilterPath);
}

function takeArgs(plan, out, ffmpeg, srtFilterPath) {
  const { clips, videoMs } = plan;
  const inputs = ['-i', plan.video, '-f', 'lavfi', '-t', (videoMs / 1000).toFixed(3), '-i', `anullsrc=r=${AUDIO_RATE}:cl=stereo`];
  for (const clip of clips) inputs.push('-i', clip.file);
  const chains = [`[1:a]${AUDIO_FORMAT}[bed]`, ...clipChains(clips, 2)];
  let audioLabel = '[bed]';
  if (clips.length) {
    const ins = ['[bed]', ...clips.map((_, i) => `[a${i}]`)].join('');
    chains.push(`${ins}amix=inputs=${clips.length + 1}:normalize=0:duration=first:dropout_transition=0[aout]`);
    audioLabel = '[aout]';
  }
  let videoLabel = '0:v';
  if (srtFilterPath) {
    chains.push(`[0:v]subtitles=${escapeForFilter(srtFilterPath)}:force_style='FontSize=7,MarginV=16,Outline=1,Shadow=0'[vout]`);
    videoLabel = '[vout]';
  }
  return [
    ffmpeg, '-y', ...inputs,
    '-filter_complex', chains.join(';'),
    '-map', videoLabel, '-map', audioLabel,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '25',
    '-c:a', 'aac', '-ar', String(AUDIO_RATE), '-b:a', '192k', '-ac', '2',
    '-movflags', '+faststart', '-shortest', out,
  ];
}

function filmArgs(plan, out, ffmpeg, srtFilterPath) {
  const { pieces, clips, fade, totalMs, blocks } = plan;
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
    if (!srtFilterPath) throw new Error('the film has subtitle blocks and no srtFilterPath');
    chains.push(
      `[vcat]subtitles=${escapeForFilter(srtFilterPath)}:force_style='FontSize=10,MarginV=18,MarginR=18,Outline=1,Shadow=0'[vout]`,
    );
    videoLabel = '[vout]';
  }

  chains.push(`[${bedIndex}:a]${AUDIO_FORMAT}[bed]`, ...clipChains(clips, bedIndex + 1));
  const audioLabel = clips.length === 0 ? '[bed]' : '[aout]';
  if (clips.length) {
    chains.push(
      `[bed]${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length + 1}:normalize=0:duration=first:dropout_transition=0[aout]`,
    );
  }

  return [
    ffmpeg, '-y', '-hide_banner', '-loglevel', 'error', '-stats', ...inputs,
    '-filter_complex', chains.join(';'),
    '-map', videoLabel, '-map', audioLabel,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FILM_FPS),
    '-c:a', 'aac', '-ar', String(AUDIO_RATE), '-b:a', '192k', '-ac', '2',
    '-movflags', '+faststart', '-t', (totalMs / 1000).toFixed(3), out,
  ];
}

// ---------------------------------------------------------------- placeholder takes

const PLACEHOLDER_LEAD_MS = 500;

/**
 * The placeholder rehearsal (docs/demo.md section 5), planned: per segment, every beat held
 * `beatMs`, a logged wait of `waitMs` before every beat with a `cue`, and the video's length;
 * plus one clip length per beat (80 % of the hold). `placeholders.mjs` renders it with ffmpeg.
 */
export function placeholderTakes(script, { beatMs, waitMs }) {
  const bySegment = new Map();
  for (const act of script.acts) {
    const segment = act.segment ?? 'web';
    if (!bySegment.has(segment)) bySegment.set(segment, []);
    bySegment.get(segment).push(act);
  }
  const durations = {};
  const segments = [];
  for (const [segment, acts] of bySegment) {
    const beats = [];
    const speedups = [];
    let at = PLACEHOLDER_LEAD_MS;
    for (const act of acts) {
      for (const beat of act.beats) {
        if (beat.cue && waitMs > 0) {
          speedups.push({ start_ms: at, end_ms: at + waitMs, factor: act.speedup ?? 4, waiting_for: beat.cue });
          at += waitMs;
        }
        beats.push({ id: beat.id, start_ms: at, end_ms: at + beatMs, caption: captionOf(beat) });
        durations[beat.id] = Math.round(beatMs * 0.8);
        at += beatMs;
      }
    }
    const video = `${segment}.placeholder.mp4`;
    segments.push({ segment, file: SEGMENT_TAKES[segment], take: { segment, video, beats, speedups }, videoMs: at + PLACEHOLDER_LEAD_MS });
  }
  return { segments, durations };
}
