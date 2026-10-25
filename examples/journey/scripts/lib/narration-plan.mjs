/**
 * docs/demo.md section 1, step 1: which beats need new audio, decided before anything is spent.
 *
 * A clip is content-addressed: its manifest entry carries `sha`, a hash of everything that decides
 * what the clip sounds like (the line, the role, the voice id, the voice settings, the model). A
 * beat whose current key differs from the recorded one is re-voiced; one whose key matches and
 * whose mp3 is on disk is reused. So a plain `pnpm narrate` after a script edit or a recast voices
 * exactly the beats that changed, and the operator never has to name ids or pass --force.
 *
 * Pure: no file is read, no request is made. `narrate.mjs` reads the script, the manifest and the
 * directory listing, calls `planNarration`, prints `formatPlan`, and only then spends. Tested
 * offline by `scripts/test/narration-plan.test.mjs`.
 *
 * The manifest keeps `chars` of the line each clip was actually read from, never the current
 * line's, so `src/script.ts` isStale (a length check) stays honest with no change of its own.
 */

import { createHash } from 'node:crypto';

export const CHAR_BUDGET = 20_000;
export const DEFAULT_MODEL = 'eleven_multilingual_v2';

export const VOICE_SETTINGS = {
  narrator: { stability: 0.6, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
  mira: { stability: 0.4, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
  athena: { stability: 0.55, similarity_boost: 0.75, style: 0.05, use_speaker_boost: true },
};

/** The ElevenLabs voice_settings a role is read with: the script's own, else the journey's. */
export function settingsOf(script, role) {
  return script.voices?.[role]?.settings ?? VOICE_SETTINGS[role] ?? VOICE_SETTINGS.narrator;
}

export function envName(role) {
  return `ELEVENLABS_VOICE_${String(role).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

// ---------------------------------------------------------------- the key

/** JSON with object keys sorted, so a settings object hashes the same whatever its key order. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** The hash of the line alone, kept beside `sha` so a changed key can say what changed. */
export function lineKey(line) {
  return sha256(String(line));
}

/** The clip's name: changes whenever anything that decides its audio would. */
export function clipKey({ line, voice, voiceId, settings, model }) {
  return sha256(
    stableJson({ line: String(line), voice: String(voice), voice_id: voiceId ?? null, settings: settings ?? null, model }),
  );
}

// ---------------------------------------------------------------- the cast, offline

function norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

/**
 * The voice id each role would be read with, as far as it can be known without the network:
 * an `ELEVENLABS_VOICE_<ROLE>` override that names the voice the manifest recorded (by id or
 * name) is that voice; one that names anything else is a recast (`env:<value>`, which matches no
 * recorded id); no override assumes the recorded voice. `narrate.mjs` re-plans with the library's
 * real cast before it synthesises, so this is the bill's lower bound, not its last word.
 */
export function castFromEnv(env, roles, recordedVoices = {}) {
  const cast = {};
  for (const role of roles) {
    const recorded = recordedVoices?.[role] ?? null;
    const wanted = env[envName(role)];
    if (!wanted) {
      if (recorded?.voice_id) cast[role] = recorded.voice_id;
      continue;
    }
    const w = norm(wanted);
    const same =
      recorded &&
      (norm(recorded.voice_id) === w || norm(recorded.name) === w || (w && norm(recorded.name).includes(w)));
    cast[role] = same ? recorded.voice_id : `env:${wanted}`;
  }
  return cast;
}

// ---------------------------------------------------------------- the plan

/**
 * @param {object} p
 * @param {object} p.script         the parsed script (voices, words_per_second, ...)
 * @param {Array}  p.beats          every beat of the script, in order
 * @param {Set<string>|null} p.only  --only, or null for every beat
 * @param {boolean} p.force         re-voice everything in scope, changed or not
 * @param {object|undefined} p.manifest  the parsed take/audio/manifest.json
 * @param {(id: string) => boolean} p.onDisk  is take/audio/<id>.mp3 there
 * @param {Record<string, string>} p.cast  role -> voice id (castFromEnv, or the library's)
 * @param {string} p.model
 * @returns {{synthesize: Array<{id: string, voice: string, reason: string, chars: number, sha: string, line_sha: string, voice_id: string|null}>,
 *   reuse: string[], legacy: string[], staleOutOfScope: string[], spend: number, inScope: number}}
 *
 * Reasons: `forced`, `new` (no clip was ever recorded for the id), `missing` (recorded, mp3 gone),
 * `line`, `voice`, `model`, `settings` (the key changed; the first differing input is named).
 * A legacy entry (written before `sha`) is reused while its chars equal the line's length and its
 * voice and model still match: upgrading never sends a surprise bill.
 */
export function planNarration({ script, beats, only = null, force = false, manifest, onDisk, cast = {}, model }) {
  const recorded = new Map();
  for (const b of manifest?.beats ?? []) {
    // A --dry estimate (marked, or an older dry entry with no voice) is no clip at all.
    if (b && typeof b.id === 'string' && !b.estimate && b.voice_id) recorded.set(b.id, b);
  }
  const manifestModel = manifest && manifest.dry === false ? manifest.model : undefined;

  const plan = { synthesize: [], reuse: [], legacy: [], staleOutOfScope: [], spend: 0, inScope: 0 };
  for (const beat of beats) {
    const entry = recorded.get(beat.id);
    const voiceId = cast[beat.voice] ?? entry?.voice_id ?? null;
    const settings = settingsOf(script, beat.voice);
    const sha = clipKey({ line: beat.line, voice: beat.voice, voiceId, settings, model });
    const line_sha = lineKey(beat.line);
    const reason = staleness({ beat, entry, sha, line_sha, voiceId, model, manifestModel, present: onDisk(beat.id) });
    const inScope = only === null || only.has(beat.id);

    if (!inScope) {
      if (reason !== null && reason !== 'legacy') plan.staleOutOfScope.push(beat.id);
      continue;
    }
    plan.inScope += 1;
    const why = force ? 'forced' : reason;
    if (why === null || why === 'legacy') {
      plan.reuse.push(beat.id);
      if (why === 'legacy') plan.legacy.push(beat.id);
      continue;
    }
    plan.synthesize.push({ id: beat.id, voice: beat.voice, reason: why, chars: beat.line.length, sha, line_sha, voice_id: voiceId });
    plan.spend += beat.line.length;
  }
  return plan;
}

/** null when the clip on disk is this line's clip; 'legacy' when it is by the old length rule. */
function staleness({ beat, entry, sha, line_sha, voiceId, model, manifestModel, present }) {
  if (!entry) return 'new';
  if (!present) return 'missing';
  if (typeof entry.sha === 'string') {
    if (entry.sha === sha) return null;
    if (entry.line_sha !== line_sha) return 'line';
    if (entry.voice_id !== voiceId) return 'voice';
    if ((entry.model ?? manifestModel) !== model) return 'model';
    return 'settings';
  }
  // Legacy: written before `sha`. Length is all it can vouch for.
  if (entry.chars !== beat.line.length) return 'line';
  if (entry.voice_id && voiceId && entry.voice_id !== voiceId) return 'voice';
  if (manifestModel !== undefined && manifestModel !== model) return 'model';
  return 'legacy';
}

/** The refusal message when the plan would spend over the guard without --yes, else null. */
export function overBudget(plan, { yes = false, budget = CHAR_BUDGET } = {}) {
  if (yes || plan.spend <= budget) return null;
  return `the plan spends ${plan.spend} characters, over the ${budget} character guard. Re-run with --yes to spend it.`;
}

// ---------------------------------------------------------------- what a run writes

/** The script's own estimate of a line's clip: characters per second if set, else words. */
export function estimateMs(beat, script) {
  const cps = Number(script.chars_per_second) || 0;
  if (cps > 0) return Math.round((beat.line.length / cps) * 1000);
  const wps = Number(script.words_per_second) || 2.5;
  const words = beat.line.trim().split(/\s+/).filter(Boolean).length;
  return Math.round((words / wps) * 1000);
}

/**
 * --dry: estimates for the beats with no current clip, and nothing else. A clip on disk whose key
 * matches keeps the length ffprobe measured for it; a rehearsal never overwrites the truth.
 */
export function dryDurations(plan, beats, script, durations = {}) {
  const byId = new Map(beats.map((b) => [b.id, b]));
  const next = { ...durations };
  for (const s of plan.synthesize) {
    if (s.reason === 'forced') continue;
    next[s.id] = estimateMs(byId.get(s.id), script);
  }
  return next;
}

/**
 * A real run's durations: every clip measured this run, minus the length of any clip that was
 * due for re-voicing and failed - the mp3 left on disk is not this line's clip, so the recorder
 * falls back to the script's estimate for it, as `src/script.ts` does for a length-stale clip.
 */
export function durationsAfterRun(durations, plan, measured, failedIds) {
  const next = { ...durations, ...measured };
  const failed = new Set(failedIds);
  for (const s of plan.synthesize) {
    if (failed.has(s.id) && s.reason !== 'forced') delete next[s.id];
  }
  return next;
}

/**
 * The manifest's beats after a run: an entry for each clip synthesised this run replaces its id;
 * every other beat keeps the entry it had (with `ms` refreshed when it was measured), so a beat
 * that was not re-voiced keeps the sha and chars of the line its clip was really read from.
 * Never lists only the run's beats: src/script.ts is silent about a beat the manifest omits.
 */
export function nextManifestBeats(previous, synthesised, measured = {}) {
  const fresh = new Map(synthesised.map((e) => [e.id, e]));
  const kept = (Array.isArray(previous) ? previous : [])
    .filter((b) => b && typeof b.id === 'string' && !fresh.has(b.id))
    .map((b) => (measured[b.id] !== undefined && !b.estimate ? { ...b, ms: measured[b.id] } : b));
  return [...kept, ...synthesised];
}

// ---------------------------------------------------------------- the table

/** The plan as the operator reads it, before anything is spent. */
export function formatPlan(plan) {
  const lines = [`Plan: ${plan.inScope} beats in scope`];
  for (const s of plan.synthesize) {
    lines.push(`  voice  ${s.id.padEnd(6)} ${String(s.voice).padEnd(9)} ${s.reason.padEnd(9)} ${String(s.chars).padStart(5)} chars`);
  }
  const legacy = plan.legacy.length > 0 ? ` (${plan.legacy.length} legacy, kept by length: ${plan.legacy.join(', ')})` : '';
  lines.push(`  reuse  ${plan.reuse.length} clip(s)${legacy}`);
  if (plan.staleOutOfScope.length > 0) {
    lines.push(`  stale, outside --only: ${plan.staleOutOfScope.join(', ')}`);
  }
  lines.push(`  spend  ${plan.spend} characters for ${plan.synthesize.length} clip(s)`);
  return lines;
}
