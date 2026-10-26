/**
 * The film pipeline's schedule, offline: `scripts/lib/timeline.mjs` is the one derivation of
 * where every beat, clip, speed-up label and caption lands, so it is tested here without
 * ffmpeg, a take or a running app. `pnpm test:unit` runs this file; `pnpm test` is the e2e.
 *
 * The parity cases import `src/script.ts` read-only (Node 24 strips its types), so the .mjs and
 * .ts hold and caption rules cannot drift apart again.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  captionOf,
  ffmpegArgs,
  holdOf,
  layClips,
  placeholderTakes,
  planFilm,
  planTake,
} from '../lib/timeline.mjs';
import { captionOf as tsCaptionOf, holdMsOf as tsHoldMsOf } from '../../src/script.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JOURNEY = path.resolve(HERE, '..', '..');
const readJson = (rel) => JSON.parse(readFileSync(path.join(JOURNEY, rel), 'utf8'));

const SCRIPT_BASE = { title: 't', language: 'en', words_per_second: 2.5, breath_ms: 500 };
const beat = (id, line = `line ${id}`) => ({ id, app: 'x', voice: 'narrator', line, screen: '', settle_ms: 800 });
const audioOf = (ids, ms) => Object.fromEntries(ids.map((id) => [id, { file: `audio/${id}.mp3`, ms }]));

// ---------------------------------------------------------------- case 0

test('case 0: with a crossfade, act 1 last clip ends by act 2 first placed beat', () => {
  const script = {
    ...SCRIPT_BASE,
    acts: [
      { id: 'one', title: '1', segment: 'web', beats: [beat('a1'), beat('a2')] },
      { id: 'two', title: '2', segment: 'card', beats: [beat('b1')] },
    ],
  };
  const takes = {
    web: { take: { beats: [{ id: 'a1', start_ms: 0, end_ms: 3000 }, { id: 'a2', start_ms: 3000, end_ms: 6000 }] }, video: 'web.mp4', videoMs: 6000 },
    card: { take: { beats: [{ id: 'b1', start_ms: 0, end_ms: 4000 }] }, video: 'card.mp4', videoMs: 4000 },
  };
  // a2's clip fills its beat exactly: 3000 ms.
  const plan = planFilm({ script, takes, audio: { ...audioOf(['a1', 'a2'], 3000), ...audioOf(['b1'], 2000) }, xfade: 300, maxMs: 179_000 });
  assert.equal(plan.refused, undefined);
  const a2 = plan.clips.find((c) => c.id === 'a2');
  const b1 = plan.placed.find((b) => b.id === 'b1');
  assert.ok(a2 && b1);
  assert.ok(a2.start + a2.keep <= b1.start, `a2 runs to ${a2.start + a2.keep} ms, b1 starts at ${b1.start} ms`);
  assert.equal(a2.trimmed, true);
});

// ---------------------------------------------------------------- case 1 (guard)

test('case 1 (guard): a logged wait is sped up, a later beat lands earlier and the label spans the fast stretch', () => {
  const script = { ...SCRIPT_BASE, acts: [{ id: 'live', title: 'L', segment: 'proving', beats: [beat('p1'), beat('p2')] }] };
  const takes = {
    proving: {
      take: {
        beats: [{ id: 'p1', start_ms: 0, end_ms: 10_000 }, { id: 'p2', start_ms: 20_000, end_ms: 22_000 }],
        speedups: [{ start_ms: 10_000, end_ms: 18_000, factor: 4 }],
      },
      video: 'proving.mp4',
      videoMs: 22_000,
    },
  };
  const plan = planFilm({ script, takes, audio: {}, maxMs: 179_000 });
  assert.equal(plan.placed.find((b) => b.id === 'p2').start, 14_000);
  const labels = plan.blocks.filter((b) => b.text.includes('sped up 4x'));
  assert.equal(labels.length, 1);
  assert.equal(labels[0].e - labels[0].s, 2000);
});

// ---------------------------------------------------------------- case 2

test('case 2: take mode trims a clip whose beat the next beat overlaps, with a fade', () => {
  const take = { video: 'v.mp4', beats: [{ id: 'A', start_ms: 0, end_ms: 5000 }, { id: 'B', start_ms: 4000, end_ms: 9000 }] };
  const plan = planTake({ take, video: 'v.mp4', videoMs: 10_000, audio: audioOf(['A', 'B'], 5000) });
  const a = plan.clips.find((c) => c.id === 'A');
  const b = plan.clips.find((c) => c.id === 'B');
  assert.equal(a.keep, 4000);
  assert.equal(a.trimmed, true);
  assert.equal(b.start, 4000);
  assert.ok(a.start + a.keep <= b.start);
  const argv = ffmpegArgs(plan, { out: 'out.mp4' });
  const graph = argv[argv.indexOf('-filter_complex') + 1];
  assert.match(graph, /atrim=0:4\.000,asetpts=PTS-STARTPTS,afade=t=out:st=3\.800:d=0\.200,adelay=0:all=1\[a0\]/);
});

// ---------------------------------------------------------------- case 3

test('case 3: layClips is the one rule - a single-piece film lays the same clips as the take', () => {
  assert.equal(typeof layClips, 'function');
  const marks = [
    { id: 'c1', start_ms: 0, end_ms: 3000, caption: 'one' },
    { id: 'c2', start_ms: 3000, end_ms: 5000, caption: 'two' },
    { id: 'c3', start_ms: 4500, end_ms: 8000, caption: 'three' },
  ];
  const audio = { ...audioOf(['c1'], 2500), ...audioOf(['c2'], 2400), ...audioOf(['c3'], 4000) };
  const takePlan = planTake({ take: { beats: marks }, video: 'v.mp4', videoMs: 8000, audio });
  const script = { ...SCRIPT_BASE, acts: [{ id: 'only', title: 'o', segment: 'web', beats: [beat('c1'), beat('c2'), beat('c3')] }] };
  const filmPlan = planFilm({ script, takes: { web: { take: { beats: marks }, video: 'v.mp4', videoMs: 8000 } }, audio, maxMs: 179_000 });
  assert.deepEqual(takePlan.clips, filmPlan.clips);
  const lengths = Object.fromEntries(Object.entries(audio).map(([id, a]) => [id, a.ms]));
  const laid = layClips(filmPlan.placed, lengths, filmPlan.totalMs).clips;
  assert.deepEqual(laid.map(({ id, start, keep, trimmed }) => ({ id, start, keep, trimmed })),
    filmPlan.clips.map(({ id, start, keep, trimmed }) => ({ id, start, keep, trimmed })));
});

// ---------------------------------------------------------------- case 4

test('case 4: a clip the manifest says was read from another line is not paced to', () => {
  const script = { ...SCRIPT_BASE, chars_per_second: 15, acts: [{ id: 'd', title: 'd', segment: 'desktop', beats: [beat('D1', 'Send Halcyon Works a reminder.')] }] };
  const b = script.acts[0].beats[0];
  const durations = { D1: 12_000 };
  const manifest = { beats: [{ id: 'D1', chars: b.line.length + 20 }] };
  const estimate = Math.max(Math.round((b.line.length / 15) * 1000), b.settle_ms) + script.breath_ms;
  assert.equal(holdOf(b, script, durations, manifest), estimate);
  // and a manifest that agrees keeps the measured clip
  assert.equal(holdOf(b, script, durations, { beats: [{ id: 'D1', chars: b.line.length }] }), 12_000 + script.breath_ms);
});

// ---------------------------------------------------------------- case 5 (guard)

test('case 5 (guard): hold and caption equal src/script.ts for every beat of both scripts', () => {
  for (const rel of ['script/proving.en.json', 'script/journey.en.json', 'script/film.en.json']) {
    const script = readJson(rel);
    const beats = script.acts.flatMap((a) => a.beats);
    const measured = Object.fromEntries(beats.filter((_, i) => i % 2 === 0).map((b, i) => [b.id, 1500 + i * 731]));
    const manifest = { beats: beats.map((b) => ({ id: b.id, chars: b.line.length })) };
    for (const b of beats) {
      assert.equal(holdOf(b, script, {}, undefined), tsHoldMsOf(b, script, {}), `${rel} ${b.id} estimate`);
      assert.equal(holdOf(b, script, measured, manifest), tsHoldMsOf(b, script, measured), `${rel} ${b.id} measured`);
      assert.equal(captionOf(b), tsCaptionOf(b), `${rel} ${b.id} caption`);
    }
  }
});

// ---------------------------------------------------------------- case 6 (guard)

test('case 6 (guard): a cut over the limit is refused and builds no ffmpeg argv', () => {
  const script = { ...SCRIPT_BASE, max_ms: 179_000, acts: [{ id: 'long', title: 'l', segment: 'web', beats: [beat('x')] }] };
  const takes = { web: { take: { beats: [{ id: 'x', start_ms: 0, end_ms: 200_000 }] }, video: 'v.mp4', videoMs: 200_000 } };
  const plan = planFilm({ script, takes, audio: {}, maxMs: script.max_ms, allowLong: false });
  assert.match(plan.refused, /^the cut runs 3:20\.0, over the 2:59\.0 limit$/);
  assert.throws(() => ffmpegArgs(plan, { out: 'film.mp4', srtFilterPath: 'film.srt' }), /refused/);
  const long = planFilm({ script, takes, audio: {}, maxMs: script.max_ms, allowLong: true });
  assert.equal(long.refused, undefined);
});

// ---------------------------------------------------------------- case 7 (guard)

test('case 7 (guard): the placeholder film argv equals the snapshot taken before the refactor', () => {
  const snap = readJson('scripts/test/fixtures/film-placeholder.argv.json');
  const script = readJson('script/proving.en.json');
  const fixture = placeholderTakes(script, { beatMs: 2500, waitMs: 8000 });
  const dir = 'take/placeholder';
  const takes = Object.fromEntries(
    fixture.segments.map((s) => [s.segment, { take: s.take, video: `${dir}/${s.take.video}`, videoMs: s.videoMs }]),
  );
  const audio = Object.fromEntries(
    Object.entries(fixture.durations).map(([id, ms]) => [id, { file: `${dir}/audio/${id}.mp3`, ms }]),
  );
  for (const [key, captions] of [['plain', false], ['captions', true]]) {
    const plan = planFilm({ script, takes, audio, maxMs: script.max_ms, captions });
    const argv = ffmpegArgs(plan, { out: `${dir}/film.mp4`, srtFilterPath: `${dir}/film.srt` });
    assert.deepEqual(argv, snap[key], key);
  }
});
