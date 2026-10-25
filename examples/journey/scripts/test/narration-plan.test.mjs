/**
 * Narration is content-addressed: `scripts/lib/narration-plan.mjs` decides which beats need new
 * audio from the script, the manifest and the directory listing, before anything is spent. Tested
 * offline: no ElevenLabs call (the CLI cases run `narrate.mjs` with fetch replaced by a tripwire),
 * no ffprobe, and every file in a scratch directory under the OS temp dir, never `take/`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_MODEL,
  castFromEnv,
  clipKey,
  dryDurations,
  lineKey,
  nextManifestBeats,
  overBudget,
  planNarration,
  settingsOf,
} from '../lib/narration-plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NARRATE = path.resolve(HERE, '..', 'narrate.mjs');

const VOICES = { narrator: 'v-narr', mira: 'v-mira', athena: 'v-athe' };
const RECORDED = {
  narrator: { name: 'Calm Narrator', voice_id: 'v-narr' },
  mira: { name: 'Warm Mira', voice_id: 'v-mira' },
  athena: { name: 'Clear Athena', voice_id: 'v-athe' },
};

const SCRIPT = {
  title: 't',
  language: 'en',
  words_per_second: 2.5,
  breath_ms: 500,
  acts: [
    {
      id: 'one',
      beats: [
        { id: '1.1', voice: 'narrator', line: 'The film opens on a quiet desk.', settle_ms: 800 },
        { id: '1.2', voice: 'mira', line: 'Can you check the invoices?', settle_ms: 800 },
        { id: '1.3', voice: 'athena', line: 'Three are overdue; here they are.', settle_ms: 800 },
      ],
    },
    {
      id: 'two',
      beats: [
        { id: '2.1', voice: 'mira', line: 'Send the reminders, please.', settle_ms: 800 },
        { id: '2.2', voice: 'narrator', line: 'And the week is done.', settle_ms: 800 },
      ],
    },
  ],
};
const beatsOf = (script) => script.acts.flatMap((a) => a.beats);

/** A real manifest whose every entry was voiced from `script` with VOICES. */
function manifestFor(script, { legacy = [] } = {}) {
  return {
    dry: false,
    model: DEFAULT_MODEL,
    voices: RECORDED,
    beats: beatsOf(script).map((b) => {
      const base = { id: b.id, voice: b.voice, voice_id: VOICES[b.voice], chars: b.line.length, ms: 3000, file: `audio/${b.id}.mp3` };
      if (legacy.includes(b.id)) return base;
      return {
        ...base,
        model: DEFAULT_MODEL,
        sha: clipKey({ line: b.line, voice: b.voice, voiceId: VOICES[b.voice], settings: settingsOf(script, b.voice), model: DEFAULT_MODEL }),
        line_sha: lineKey(b.line),
      };
    }),
  };
}

function withLine(script, id, line) {
  return {
    ...script,
    acts: script.acts.map((a) => ({ ...a, beats: a.beats.map((b) => (b.id === id ? { ...b, line } : b)) })),
  };
}

const allOnDisk = () => true;
const plan = (script, manifest, extra = {}) =>
  planNarration({ script, beats: beatsOf(script), manifest, onDisk: allOnDisk, cast: VOICES, model: DEFAULT_MODEL, ...extra });

// ---------------------------------------------------------------- case 0

test('case 0: a same-length line edit with the old mp3 on disk is re-voiced', () => {
  const old = SCRIPT.acts[0].beats[2].line;
  const edited = 'Four are overdue; here they are!';
  const sameLength = edited.padEnd(old.length, '.');
  assert.equal(sameLength.length, old.length);
  const after = withLine(SCRIPT, '1.3', sameLength);
  const p = plan(after, manifestFor(SCRIPT));
  assert.deepEqual(
    p.synthesize.map((s) => s.id),
    ['1.3'],
  );
  assert.equal(p.synthesize[0].reason, 'line');
});

// ---------------------------------------------------------------- case 1

test('case 1: a changed beat that was not re-voiced keeps its old sha and chars in the manifest', () => {
  const before = manifestFor(SCRIPT);
  const after = withLine(SCRIPT, '1.3', 'A much longer line than the one the clip was actually read from.');
  const p = plan(after, before);
  assert.deepEqual(
    p.synthesize.map((s) => s.id),
    ['1.3'],
  );
  // Its synthesis failed: nothing was made this run, every clip on disk was re-measured.
  const measured = { '1.1': 3100, '1.2': 3200, '1.3': 3300, '2.1': 3400, '2.2': 3500 };
  const beats = nextManifestBeats(before.beats, [], measured);
  const entry = beats.find((b) => b.id === '1.3');
  const old = before.beats.find((b) => b.id === '1.3');
  assert.equal(entry.sha, old.sha);
  assert.equal(entry.chars, SCRIPT.acts[0].beats[2].line.length);
  assert.notEqual(entry.chars, after.acts[0].beats[2].line.length);
});

// ---------------------------------------------------------------- case 2 (guard)

test('case 2: every beat unchanged reuses every clip and spends nothing', () => {
  const p = plan(SCRIPT, manifestFor(SCRIPT));
  assert.deepEqual(p.reuse, ['1.1', '1.2', '1.3', '2.1', '2.2']);
  assert.deepEqual(p.synthesize, []);
  assert.equal(p.spend, 0);
});

// ---------------------------------------------------------------- case 3

function scratch() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'narration-plan-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Run narrate.mjs against a scratch script and audio dir, with fetch replaced by a tripwire. */
function narrate(dir, script, argv, env = {}) {
  const scriptPath = path.join(dir, 'script.json');
  writeFileSync(scriptPath, JSON.stringify(script));
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('ELEVENLABS_')));
  const tripwire = `data:text/javascript,${encodeURIComponent(
    "globalThis.fetch = () => { process.stderr.write('FETCH CALLED'); process.exit(99); };",
  )}`;
  return spawnSync(process.execPath, [`--import=${tripwire}`, NARRATE, ...argv], {
    env: { ...clean, JOURNEY_SCRIPT: scriptPath, JOURNEY_AUDIO_DIR: path.join(dir, 'audio'), ...env },
    encoding: 'utf8',
  });
}

test('case 3: --dry keeps the measured length of a current clip and estimates only the rest', () => {
  const { dir, cleanup } = scratch();
  try {
    const audio = path.join(dir, 'audio');
    const manifest = manifestFor(SCRIPT);
    manifest.beats = manifest.beats.filter((b) => b.id !== '2.1');
    // 2.1 has never been voiced; every other clip is on disk and current.
    mkdirSync(audio, { recursive: true });
    for (const b of manifest.beats) writeFileSync(path.join(audio, `${b.id}.mp3`), 'mp3');
    writeFileSync(path.join(audio, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(path.join(audio, 'durations.json'), JSON.stringify({ '1.1': 4100, '1.2': 4200, '1.3': 4321, '2.2': 4500 }));

    const run = narrate(dir, SCRIPT, ['--dry']);
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const durations = JSON.parse(readFileSync(path.join(audio, 'durations.json'), 'utf8'));
    assert.equal(durations['1.3'], 4321);
    assert.equal(durations['1.1'], 4100);
    assert.equal(durations['2.1'], Math.round((4 / 2.5) * 1000));
    // A rehearsal leaves a real run's manifest alone.
    assert.deepEqual(JSON.parse(readFileSync(path.join(audio, 'manifest.json'), 'utf8')), manifest);
  } finally {
    cleanup();
  }
});

test('case 3 (pure): dryDurations writes estimates for synthesize beats only', () => {
  const p = plan(SCRIPT, manifestFor(SCRIPT), { onDisk: (id) => id !== '2.1' });
  const next = dryDurations(p, beatsOf(SCRIPT), SCRIPT, { '1.3': 4321 });
  assert.deepEqual(next, { '1.3': 4321, '2.1': 1600 });
});

// ---------------------------------------------------------------- case 4

test('case 4: ELEVENLABS_VOICE_MIRA recast re-voices every mira beat for the voice and reuses the rest', () => {
  const roles = ['mira', 'athena', 'narrator'];
  const cast = castFromEnv({ ELEVENLABS_VOICE_MIRA: 'Someone Else' }, roles, RECORDED);
  assert.equal(cast.athena, 'v-athe');
  assert.equal(cast.narrator, 'v-narr');
  const p = plan(SCRIPT, manifestFor(SCRIPT), { cast });
  assert.deepEqual(
    p.synthesize.map((s) => [s.id, s.reason]),
    [
      ['1.2', 'voice'],
      ['2.1', 'voice'],
    ],
  );
  assert.deepEqual(p.reuse, ['1.1', '1.3', '2.2']);
  // An override that names the recorded voice is not a recast.
  assert.equal(castFromEnv({ ELEVENLABS_VOICE_MIRA: 'warm mira' }, roles, RECORDED).mira, 'v-mira');
});

// ---------------------------------------------------------------- case 5 (guard)

test('case 5: a legacy entry with no sha and the same length is reused and marked legacy', () => {
  const p = plan(SCRIPT, manifestFor(SCRIPT, { legacy: ['1.1', '2.2'] }));
  assert.deepEqual(p.synthesize, []);
  assert.deepEqual(p.legacy, ['1.1', '2.2']);
  assert.equal(p.spend, 0);
  // ... and a legacy entry whose line changed length is re-voiced for the line.
  const edited = withLine(SCRIPT, '1.1', 'A different opening line.');
  const q = plan(edited, manifestFor(SCRIPT, { legacy: ['1.1'] }));
  assert.deepEqual(
    q.synthesize.map((s) => [s.id, s.reason]),
    [['1.1', 'line']],
  );
});

// ---------------------------------------------------------------- case 6 (guard)

test('case 6: --only 1.3 voices 1.3 and names 2.1 as stale outside the scope', () => {
  let after = withLine(SCRIPT, '1.3', 'Three are overdue, and one is disputed.');
  after = withLine(after, '2.1', 'Send the reminders now.');
  const p = plan(after, manifestFor(SCRIPT), { only: new Set(['1.3']) });
  assert.deepEqual(
    p.synthesize.map((s) => s.id),
    ['1.3'],
  );
  assert.deepEqual(p.staleOutOfScope, ['2.1']);
  assert.equal(p.inScope, 1);
});

// ---------------------------------------------------------------- case 7 (guard)

test('case 7: a plan over 20,000 characters without --yes exits 4 before any fetch', () => {
  const long = 'word '.repeat(1400).trim();
  const big = {
    ...SCRIPT,
    acts: [{ id: 'one', beats: ['1.1', '1.2', '1.3'].map((id) => ({ id, voice: 'narrator', line: long, settle_ms: 800 })) }],
  };
  assert.ok(overBudget(plan(big, undefined, { onDisk: () => false })));
  const { dir, cleanup } = scratch();
  try {
    const run = narrate(dir, big, [], { ELEVENLABS_API_KEY: 'test-key-not-real' });
    assert.doesNotMatch(run.stderr, /FETCH CALLED/);
    assert.equal(run.status, 4, run.stderr + run.stdout);
    assert.match(run.stderr, /20000 character guard/);
  } finally {
    cleanup();
  }
});
