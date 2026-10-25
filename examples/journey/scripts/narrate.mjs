#!/usr/bin/env node
/**
 * docs/demo.md section 1, step 1 (narrate): one ElevenLabs mp3 per beat of the journey script,
 * with every clip's duration measured so the recorder can pace the video to the voice.
 *
 * Usage:
 *   node scripts/narrate.mjs [--plan] [--dry] [--force] [--yes] [--only 1.3,1.4]
 *
 * A plain run plans first (`scripts/lib/narration-plan.mjs`): every manifest beat carries a sha of
 * its line, role, voice id, settings and model, and exactly the beats whose sha changed (or whose
 * mp3 is missing) are voiced. The plan is printed before anything is spent; `--plan` stops there
 * (no key, no network). `--dry` estimates only the beats with no current clip. `--force`
 * re-voices every beat in scope; `--only` narrows the scope and names the stale beats it left out.
 *
 * Environment:
 *   ELEVENLABS_API_KEY          required unless --dry (read from the environment, or a .env
 *                               file in examples/journey/ or at the repository root)
 *   ELEVENLABS_MODEL            default eleven_multilingual_v2
 *   ELEVENLABS_VOICE_NARRATOR   voice id or name; otherwise chosen from the account library
 *   ELEVENLABS_VOICE_MIRA       "
 *   ELEVENLABS_VOICE_ATHENA     "
 *   ELEVENLABS_VOICE_<ROLE>     " for any other role the script casts (upper-cased, non-letters as _)
 *
 * Roles are data (docs/demo.md section 5): every `voice` a beat names is cast, and the script's
 * `voices` map may give a role a `hint` (words matched against the library's labels), a `gender`
 * ("female" | "male") and `settings` (ElevenLabs voice_settings). narrator, mira and athena keep
 * the scoring and settings the journey films were cast with.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  CHAR_BUDGET,
  DEFAULT_MODEL,
  castFromEnv,
  dryDurations,
  durationsAfterRun,
  envName,
  estimateMs,
  formatPlan,
  nextManifestBeats,
  overBudget,
  planNarration,
  settingsOf,
} from './lib/narration-plan.mjs';

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JOURNEY = path.resolve(HERE, '..');
const REPO = path.resolve(JOURNEY, '..', '..');
const SCRIPT_PATH = process.env.JOURNEY_SCRIPT ? path.resolve(JOURNEY, process.env.JOURNEY_SCRIPT) : path.join(JOURNEY, 'script', 'journey.en.json');
const AUDIO_DIR = process.env.JOURNEY_AUDIO_DIR
  ? path.resolve(JOURNEY, process.env.JOURNEY_AUDIO_DIR)
  : path.join(JOURNEY, 'take', 'audio');

const API = 'https://api.elevenlabs.io/v1';
const CONCURRENCY = 3;

/** The journey's three roles, most constrained first: narrator takes whatever is left. */
const KNOWN_ROLES = ['mira', 'athena', 'narrator'];

/**
 * The roles this script casts, in casting order: the beats' voices, plus any the `voices` map
 * declares; known roles keep their order, other roles go before narrator, narrator last.
 */
function rolesOf(script, beats) {
  const named = new Set([...beats.map((b) => b.voice), ...Object.keys(script.voices ?? {})]);
  const others = [...named].filter((r) => !KNOWN_ROLES.includes(r)).sort();
  const known = KNOWN_ROLES.filter((r) => named.has(r) && r !== 'narrator');
  return [...known, ...others, ...(named.has('narrator') ? ['narrator'] : [])];
}

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = { plan: false, dry: false, force: false, yes: false, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--plan') args.plan = true;
    else if (a === '--dry') args.dry = true;
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
      console.log('node scripts/narrate.mjs [--plan] [--dry] [--force] [--yes] [--only 1.3,1.4]');
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

function scoreFor(role, voice, spec = {}) {
  const t = labelText(voice);
  let score = 0;
  if (isEnglish(voice)) score += 3;
  if (normalise(voice.category) === 'premade') score += 1;
  if (spec.gender === 'female' && !isFemale(voice)) return -100;
  if (spec.gender === 'male' && isFemale(voice)) return -100;
  if (!KNOWN_ROLES.includes(role)) {
    // A role the journey never cast: the script's hint words, matched against the labels.
    for (const word of normalise(spec.hint).split(/[^a-z]+/).filter((w) => w.length > 3)) {
      if (t.includes(word)) score += 2;
    }
    if (/whisper|character|child/.test(t)) score -= 4;
    return score;
  }
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

function chooseVoices(voices, env, roles, specs) {
  const picked = {};
  const taken = new Set();

  for (const role of roles) {
    const wanted = env[envName(role)];
    if (!wanted) continue;
    const match = findOverride(voices, wanted);
    if (!match) fail(3, `no voice in the account library matches ${role} override "${wanted}"`);
    picked[role] = match;
    taken.add(match.voice_id);
  }

  for (const role of roles) {
    if (picked[role]) continue;
    let best = null;
    let bestScore = -Infinity;
    for (const v of voices) {
      if (taken.has(v.voice_id)) continue;
      const s = scoreFor(role, v, specs[role] ?? {});
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

async function synthesise({ apiKey, voiceId, settings, text, model, file }) {
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
          voice_settings: settings,
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

async function readJsonOr(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function printPlan(plan) {
  for (const line of formatPlan(plan)) console.log(line);
  console.log('');
}

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
  const cps = Number(script.chars_per_second) || 0;
  const specs = script.voices ?? {};
  const roles = rolesOf(script, allBeats);

  const durationsPath = path.join(AUDIO_DIR, 'durations.json');
  const manifestPath = path.join(AUDIO_DIR, 'manifest.json');
  const onDisk = (id) => existsSync(path.join(AUDIO_DIR, `${id}.mp3`));

  /** Durations are merged, so --only never drops the beats it did not touch. */
  const durations = await readJsonOr(durationsPath, {});
  const manifest = await readJsonOr(manifestPath, undefined);
  const previousBeats = Array.isArray(manifest?.beats) ? manifest.beats : [];

  const env = { ...process.env };
  if (!env.ELEVENLABS_API_KEY && !args.dry && !args.plan) await loadDotEnvInto(env);
  const model = env.ELEVENLABS_MODEL ?? DEFAULT_MODEL;

  // Phase 1, offline: the cast as far as the environment and the manifest tell it.
  const recordedVoices = manifest?.dry === false ? manifest.voices : {};
  const offline = planNarration({
    script,
    beats: allBeats,
    only: args.only,
    force: args.force && !args.dry,
    manifest,
    onDisk,
    cast: castFromEnv(env, roles, recordedVoices),
    model,
  });

  if (args.plan) {
    printPlan(offline);
    console.log('--plan: nothing spent, nothing written (voices from the environment and the manifest).');
    return;
  }

  if (args.dry) {
    await mkdir(AUDIO_DIR, { recursive: true });
    const next = dryDurations(offline, allBeats, script, durations);
    const byId = new Map(allBeats.map((b) => [b.id, b]));
    const estimated = offline.synthesize.filter((s) => s.reason !== 'forced');
    const entries = estimated.map((s) => ({
      id: s.id,
      voice: s.voice,
      voice_id: null,
      estimate: true,
      chars: s.chars,
      ms: estimateMs(byId.get(s.id), script),
      file: `audio/${s.id}.mp3`,
    }));
    await writeFile(durationsPath, `${JSON.stringify(next, null, 2)}\n`);
    // A real run's manifest records the voices and the clips' keys; a rehearsal leaves it alone.
    if (manifest?.dry !== false) {
      await writeFile(
        manifestPath,
        `${JSON.stringify(
          {
            dry: true,
            generated_at: new Date().toISOString(),
            model,
            words_per_second: wps,
            chars_per_second: cps || null,
            voices: Object.fromEntries(roles.map((r) => [r, null])),
            beats: nextManifestBeats(previousBeats, entries),
          },
          null,
          2,
        )}\n`,
      );
    }
    printPlan(offline);
    report(
      entries,
      next,
      allBeats,
      `dry run: ${entries.length} of ${beats.length} beats estimated at ${cps > 0 ? `${cps} characters` : `${wps} words`}/second, ` +
        `${offline.reuse.length} keep their measured clip`,
    );
    const held = beats.reduce(
      (sum, b) => sum + Math.max(next[b.id] ?? 0, Number(b.settle_ms) || 0) + (Number(script.breath_ms) || 0),
      0,
    );
    console.log(
      `ElevenLabs characters a real run would spend: ${offline.spend} (${roles.join(', ')}); ` +
        `held on screen with settles and breaths: ${formatMs(held)} (${held} ms) before any live wait.`,
    );
    return;
  }

  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    fail(
      2,
      'ELEVENLABS_API_KEY is not set (environment, examples/journey/.env or the repository root .env).',
    );
  }

  // The guard runs before any request: the offline plan is the bill's lower bound.
  const early = overBudget(offline, { yes: args.yes });
  if (early) {
    printPlan(offline);
    fail(4, early);
  }

  // Phase 2: the library's real cast, which may recast a role the environment did not name.
  const voices = await listVoices(apiKey);
  const cast = chooseVoices(voices, env, roles, specs);
  console.log('Voices');
  for (const role of roles) {
    console.log(`  ${role}: ${cast[role].name} (${cast[role].voice_id})`);
  }
  console.log(`  model: ${model}`);
  console.log('');

  const plan = planNarration({
    script,
    beats: allBeats,
    only: args.only,
    force: args.force,
    manifest,
    onDisk,
    cast: Object.fromEntries(roles.map((r) => [r, cast[r].voice_id])),
    model,
  });
  printPlan(plan);
  const refusal = overBudget(plan, { yes: args.yes, budget: CHAR_BUDGET });
  if (refusal) fail(4, refusal);
  if (plan.synthesize.length === 0) console.log('Nothing to synthesize; measuring what is on disk.');

  await mkdir(AUDIO_DIR, { recursive: true });
  const byId = new Map(allBeats.map((b) => [b.id, b]));
  const failures = [];
  const made = [];
  await pool(plan.synthesize, CONCURRENCY, async (s) => {
    const beat = byId.get(s.id);
    const file = path.join(AUDIO_DIR, `${beat.id}.mp3`);
    try {
      await synthesise({
        apiKey,
        voiceId: s.voice_id,
        settings: settingsOf(script, beat.voice),
        text: beat.line,
        model,
        file,
      });
      made.push(s);
      console.log(`  ok   ${pad(beat.id, 6)} ${pad(beat.voice, 9)} ${beat.line.length} chars`);
    } catch (err) {
      failures.push({ id: beat.id, message: String(err?.message ?? err) });
      console.error(`  FAIL ${pad(beat.id, 6)} ${String(err?.message ?? err)}`);
    }
  });
  if (plan.synthesize.length > 0) console.log('');

  const measured = {};
  for (const beat of beats) {
    if (failures.some((f) => f.id === beat.id)) continue;
    const file = path.join(AUDIO_DIR, `${beat.id}.mp3`);
    if (!existsSync(file)) {
      console.error(`  warn ${beat.id}: no mp3 on disk, skipping`);
      continue;
    }
    measured[beat.id] = await measureMs(file);
  }
  // Only a clip made this run gets a new entry, keyed and counted on the line it was read from.
  const entries = made
    .filter((s) => measured[s.id] !== undefined)
    .map((s) => ({
      id: s.id,
      voice: s.voice,
      voice_id: s.voice_id,
      model,
      chars: s.chars,
      sha: s.sha,
      line_sha: s.line_sha,
      ms: measured[s.id],
      file: `audio/${s.id}.mp3`,
    }));
  const next = durationsAfterRun(
    durations,
    plan,
    measured,
    failures.map((f) => f.id),
  );

  await writeFile(durationsPath, `${JSON.stringify(next, null, 2)}\n`);
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        dry: false,
        generated_at: new Date().toISOString(),
        model,
        words_per_second: wps,
        voices: Object.fromEntries(
          roles.map((r) => [
            r,
            { name: cast[r].name, voice_id: cast[r].voice_id },
          ]),
        ),
        beats: nextManifestBeats(previousBeats, entries, measured),
      },
      null,
      2,
    )}\n`,
  );

  report(entries, next, allBeats, `${entries.length} clips voiced, ${Object.keys(measured).length} measured`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} beat(s) failed: ${failures.map((f) => f.id).join(', ')}`);
    console.error('their old clips (if any) keep their old manifest entries, so the recorder still sees them as stale.');
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
