#!/usr/bin/env node
/**
 * docs/demo.md section 1, step 1 (narrate): one ElevenLabs mp3 per beat of the journey script,
 * with every clip's duration measured so the recorder can pace the video to the voice.
 *
 * Usage:
 *   node scripts/narrate.mjs [--dry] [--force] [--yes] [--only 1.3,1.4]
 *
 * Environment:
 *   ELEVENLABS_API_KEY          required unless --dry (read from the environment, or a .env
 *                               file in examples/journey/ or at the repository root)
 *   ELEVENLABS_MODEL            default eleven_multilingual_v2
 *   ELEVENLABS_VOICE_NARRATOR   voice id or name; otherwise chosen from the account library
 *   ELEVENLABS_VOICE_MIRA       "
 *   ELEVENLABS_VOICE_ATHENA     "
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JOURNEY = path.resolve(HERE, '..');
const REPO = path.resolve(JOURNEY, '..', '..');
const SCRIPT_PATH = path.join(JOURNEY, 'script', 'journey.en.json');
const AUDIO_DIR = path.join(JOURNEY, 'take', 'audio');

const API = 'https://api.elevenlabs.io/v1';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const CHAR_BUDGET = 20_000;
const CONCURRENCY = 3;

/** The three roles, most constrained first: narrator takes whatever is left. */
const ROLES = ['mira', 'athena', 'narrator'];

const VOICE_SETTINGS = {
  narrator: { stability: 0.6, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
  mira: { stability: 0.4, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
  athena: { stability: 0.55, similarity_boost: 0.75, style: 0.05, use_speaker_boost: true },
};

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = { dry: false, force: false, yes: false, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry') args.dry = true;
    else if (a === '--force') args.force = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--only') {
      const v = argv[i + 1];
      if (!v) fail(1, '--only needs a comma-separated list of beat ids, e.g. --only 1.3,1.4');
      args.only = new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
      i += 1;
    } else if (a.startsWith('--only=')) {
      args.only = new Set(a.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--help' || a === '-h') {
      console.log('node scripts/narrate.mjs [--dry] [--force] [--yes] [--only 1.3,1.4]');
      process.exit(0);
    } else fail(1, `unknown argument: ${a}`);
  }
  return args;
}

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

// ---------------------------------------------------------------- the key

/** Parse KEY=value lines. The contents are never printed. */
function parseDotEnv(text) {
  const out = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

async function loadDotEnvInto(env) {
  for (const file of [path.join(JOURNEY, '.env'), path.join(REPO, '.env')]) {
    if (!existsSync(file)) continue;
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const [k, v] of parseDotEnv(text)) if (env[k] === undefined) env[k] = v;
  }
}

// ---------------------------------------------------------------- voices

function normalise(s) {
  return String(s ?? '').trim().toLowerCase();
}

function labelText(voice) {
  const labels = voice.labels ?? {};
  return normalise(
    [voice.name, voice.description, ...Object.values(labels)].filter(Boolean).join(' '),
  );
}

function isFemale(voice) {
  const g = normalise(voice.labels?.gender);
  if (g) return g.includes('female');
  return /\b(female|woman)\b/.test(labelText(voice));
}

function isEnglish(voice) {
  const t = labelText(voice);
  const lang = normalise(voice.fine_tuning?.language ?? voice.language ?? '');
  if (lang && !lang.startsWith('en')) return false;
  return /english|american|british|australian|transatlantic|irish|us\b|uk\b/.test(t) || !lang;
}

function scoreFor(role, voice) {
  const t = labelText(voice);
  let score = 0;
  if (isEnglish(voice)) score += 3;
  if (normalise(voice.category) === 'premade') score += 1;
  if (role === 'narrator') {
    if (/narrat|storytell|documentar|informativ/.test(t)) score += 6;
    if (/calm|neutral|even|measured|clear|deep|warm/.test(t)) score += 3;
    if (/excited|hyped|whisper|character|child|old/.test(t)) score -= 4;
  } else if (role === 'mira') {
    if (!isFemale(voice)) return -100;
    if (/conversation|casual|friendly|natural|social media/.test(t)) score += 6;
    if (/warm|approachable|expressive/.test(t)) score += 3;
    if (/narrat|news|announcer/.test(t)) score -= 2;
  } else {
    if (!isFemale(voice)) return -100;
    if (/clear|crisp|articulate|professional|calm|confident/.test(t)) score += 6;
    if (/narrat|informativ/.test(t)) score += 2;
    if (/whisper|character|child/.test(t)) score -= 4;
  }
  return score;
}

function findOverride(voices, wanted) {
  const w = normalise(wanted);
  return (
    voices.find((v) => normalise(v.voice_id) === w) ??
    voices.find((v) => normalise(v.name) === w) ??
    voices.find((v) => normalise(v.name).includes(w)) ??
    null
  );
}

async function listVoices(apiKey) {
  const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': apiKey } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    fail(3, `GET /v1/voices failed: ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const voices = Array.isArray(json.voices) ? json.voices : [];
  if (voices.length === 0) fail(3, 'the account library returned no voices');
  return voices;
}

function chooseVoices(voices, env) {
  const overrides = {
    narrator: env.ELEVENLABS_VOICE_NARRATOR,
    mira: env.ELEVENLABS_VOICE_MIRA,
    athena: env.ELEVENLABS_VOICE_ATHENA,
  };
  const picked = {};
  const taken = new Set();

  for (const role of ROLES) {
    const wanted = overrides[role];
    if (!wanted) continue;
    const match = findOverride(voices, wanted);
    if (!match) fail(3, `no voice in the account library matches ${role} override "${wanted}"`);
    picked[role] = match;
    taken.add(match.voice_id);
  }

  for (const role of ROLES) {
    if (picked[role]) continue;
    let best = null;
    let bestScore = -Infinity;
    for (const v of voices) {
      if (taken.has(v.voice_id)) continue;
      const s = scoreFor(role, v);
      if (s > bestScore) {
        bestScore = s;
        best = v;
      }
    }
    if (!best) fail(3, `not enough distinct voices in the account library to cast ${role}`);
    picked[role] = best;
    taken.add(best.voice_id);
  }
  return picked;
}

// ---------------------------------------------------------------- synthesis

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function synthesise({ apiKey, voiceId, role, text, model, file }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let res;
    try {
      res = await fetch(`${API}/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: VOICE_SETTINGS[role] ?? VOICE_SETTINGS.narrator,
        }),
      });
    } catch (err) {
      if (attempt === 0) {
        await sleep(2000);
        continue;
      }
      throw err;
    }
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error('the API returned an empty body');
      await writeFile(file, buf);
      return;
    }
    const retryable = res.status === 429 || res.status >= 500;
    const body = await res.text().catch(() => '');
    if (retryable && attempt === 0) {
      const after = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 3000);
      continue;
    }
    throw new Error(`${res.status} ${res.statusText} ${body.slice(0, 300)}`);
  }
}

async function measureMs(file) {
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

async function pool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

// ---------------------------------------------------------------- report

function pad(s, n) {
  const v = String(s);
  return v.length >= n ? v : v + ' '.repeat(n - v.length);
}

function padLeft(s, n) {
  const v = String(s);
  return v.length >= n ? v : ' '.repeat(n - v.length) + v;
}

function formatMs(ms) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const script = JSON.parse(await readFile(SCRIPT_PATH, 'utf8'));
  const allBeats = script.acts.flatMap((act) => act.beats.map((b) => ({ ...b, act: act.id })));
  if (args.only) {
    const known = new Set(allBeats.map((b) => b.id));
    for (const id of args.only) if (!known.has(id)) fail(1, `--only names an unknown beat: ${id}`);
  }
  const beats = args.only ? allBeats.filter((b) => args.only.has(b.id)) : allBeats;
  const wps = Number(script.words_per_second) || 2.5;

  await mkdir(AUDIO_DIR, { recursive: true });
  const durationsPath = path.join(AUDIO_DIR, 'durations.json');
  const manifestPath = path.join(AUDIO_DIR, 'manifest.json');

  /** Durations are merged, so --only never drops the beats it did not touch. */
  let durations = {};
  if (existsSync(durationsPath)) {
    try {
      durations = JSON.parse(await readFile(durationsPath, 'utf8'));
    } catch {
      durations = {};
    }
  }

  const totalChars = beats.reduce((sum, b) => sum + b.line.length, 0);

  if (args.dry) {
    const entries = [];
    for (const beat of beats) {
      const words = beat.line.trim().split(/\s+/).filter(Boolean).length;
      const ms = Math.round((words / wps) * 1000);
      durations[beat.id] = ms;
      entries.push({
        id: beat.id,
        voice: beat.voice,
        voice_id: null,
        chars: beat.line.length,
        ms,
        file: `audio/${beat.id}.mp3`,
      });
    }
    await writeFile(durationsPath, `${JSON.stringify(durations, null, 2)}\n`);
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          dry: true,
          generated_at: new Date().toISOString(),
          model: process.env.ELEVENLABS_MODEL ?? DEFAULT_MODEL,
          words_per_second: wps,
          voices: { narrator: null, mira: null, athena: null },
          beats: entries,
        },
        null,
        2,
      )}\n`,
    );
    report(entries, durations, allBeats, `dry run: ${beats.length} beats estimated at ${wps} words/second`);
    return;
  }

  const env = { ...process.env };
  if (!env.ELEVENLABS_API_KEY) await loadDotEnvInto(env);
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    fail(
      2,
      'ELEVENLABS_API_KEY is not set (environment, examples/journey/.env or the repository root .env).',
    );
  }
  const model = env.ELEVENLABS_MODEL ?? DEFAULT_MODEL;

  const voices = await listVoices(apiKey);
  const cast = chooseVoices(voices, env);
  console.log('Voices');
  for (const role of ['narrator', 'mira', 'athena']) {
    console.log(`  ${role}: ${cast[role].name} (${cast[role].voice_id})`);
  }
  console.log(`  model: ${model}`);
  console.log('');

  const todo = beats.filter(
    (b) => args.force || !existsSync(path.join(AUDIO_DIR, `${b.id}.mp3`)),
  );
  const spend = todo.reduce((sum, b) => sum + b.line.length, 0);
  console.log(
    `${beats.length} beats, ${totalChars} characters in scope; ${todo.length} to synthesize, ${spend} characters to spend.`,
  );
  if (spend > CHAR_BUDGET && !args.yes) {
    fail(
      4,
      `that is over the ${CHAR_BUDGET} character guard. Re-run with --yes to spend it.`,
    );
  }
  if (todo.length === 0) console.log('Nothing to synthesize; measuring what is on disk.');
  console.log('');

  const failures = [];
  await pool(todo, CONCURRENCY, async (beat) => {
    const file = path.join(AUDIO_DIR, `${beat.id}.mp3`);
    try {
      await synthesise({
        apiKey,
        voiceId: cast[beat.voice].voice_id,
        role: beat.voice,
        text: beat.line,
        model,
        file,
      });
      console.log(`  ok   ${pad(beat.id, 6)} ${pad(beat.voice, 9)} ${beat.line.length} chars`);
    } catch (err) {
      failures.push({ id: beat.id, message: String(err?.message ?? err) });
      console.error(`  FAIL ${pad(beat.id, 6)} ${String(err?.message ?? err)}`);
    }
  });
  if (todo.length > 0) console.log('');

  const entries = [];
  for (const beat of beats) {
    const file = path.join(AUDIO_DIR, `${beat.id}.mp3`);
    if (!existsSync(file)) {
      console.error(`  warn ${beat.id}: no mp3 on disk, skipping`);
      continue;
    }
    const ms = await measureMs(file);
    durations[beat.id] = ms;
    entries.push({
      id: beat.id,
      voice: beat.voice,
      voice_id: cast[beat.voice].voice_id,
      chars: beat.line.length,
      ms,
      file: `audio/${beat.id}.mp3`,
    });
  }

  await writeFile(durationsPath, `${JSON.stringify(durations, null, 2)}\n`);
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        dry: false,
        generated_at: new Date().toISOString(),
        model,
        words_per_second: wps,
        voices: Object.fromEntries(
          ['narrator', 'mira', 'athena'].map((r) => [
            r,
            { name: cast[r].name, voice_id: cast[r].voice_id },
          ]),
        ),
        beats: entries,
      },
      null,
      2,
    )}\n`,
  );

  report(entries, durations, allBeats, `${entries.length} clips measured`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} beat(s) failed: ${failures.map((f) => f.id).join(', ')}`);
    process.exit(5);
  }
}

function report(entries, durations, allBeats, headline) {
  console.log(`${pad('beat', 7)}${pad('voice', 10)}${padLeft('chars', 6)}${padLeft('ms', 8)}`);
  let total = 0;
  for (const e of entries) {
    total += e.ms;
    console.log(`${pad(e.id, 7)}${pad(e.voice, 10)}${padLeft(e.chars, 6)}${padLeft(e.ms, 8)}`);
  }
  console.log('');
  console.log(`${headline}; narration ${formatMs(total)} (${total} ms).`);
  const missing = allBeats.filter((b) => durations[b.id] === undefined).map((b) => b.id);
  if (missing.length > 0) console.log(`durations.json still missing: ${missing.join(', ')}`);
  else console.log(`durations.json covers all ${allBeats.length} beats.`);
  console.log(`wrote ${path.relative(JOURNEY, path.join(AUDIO_DIR, 'durations.json'))}`);
}

main().catch((err) => {
  console.error(String(err?.stack ?? err));
  process.exit(1);
});
