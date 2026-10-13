#!/usr/bin/env node
// scan-sweep hand-off - file the items a run left open into Personas Approvals.
//
// Approvals -> Backlog is Personas' `dev_ideas` table. The memory outbox reaches it
// only 30 findings a pass and only when a Fleet session exits, so a sweep's
// leftovers used to sit in repo files nobody reopened. This script files them over
// the app's local HTTP door instead (POST /dev-tools/ideas, origin scan_sweep), with
// no cap, and reports per item what the app did.
//
// Usage:
//   node approvals.mjs --file <cards.jsonl> [--repo <root>] [--dry-run] [--register]
//                      [--out <results.jsonl>] [--json]
//
// A card is one JSON object per line, the SKILL.md section 9 finding shape:
//   {"title","body","evidence","lens","context","size","effort","impact","risk",
//    "gate","result","method", "lane":"B|C", "source":"<run id / file>"}
// Only `title` is required. Scales are the skill's 1-10 and are converted to the
// app's 1-5 (ceil(v/2), the app's own exchange rate). A missing scale is
// defaulted (effort from size, impact 3, risk 3) and the card says so.
//
// Exit codes: 0 every card landed (created / deduped / rated / near_duplicate),
// 1 at least one card failed, 2 bad arguments, 3 Personas is not running,
// 4 the repo is not a registered Personas project (pass --register).
// The caller deletes a source file only on exit 0: a card that did not land is
// still owed, and the file is its only record.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, basename } from 'node:path';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const file = opt('--file');
const repo = resolve(opt('--repo', process.cwd()));
const dryRun = has('--dry-run');
const register = has('--register');
const outPath = opt('--out');
const asJson = has('--json');

if (!file || !existsSync(file)) {
  console.error('usage: approvals.mjs --file <cards.jsonl> [--repo <root>] [--dry-run] [--register] [--out <p>] [--json]');
  process.exit(2);
}

const cards = readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
  try { return JSON.parse(l); } catch { console.error(`line ${i + 1}: not JSON, skipped`); return null; }
}).filter((c) => c && typeof c.title === 'string' && c.title.trim());

const handshakePath = join(homedir(), '.personas', 'local-http.json');
if (!existsSync(handshakePath)) {
  console.error(`Personas is not running (${handshakePath} missing). Start the app and re-run; ${cards.length} cards are still owed.`);
  process.exit(3);
}
const { port, token } = JSON.parse(readFileSync(handshakePath, 'utf8'));
const base = `http://127.0.0.1:${port}/dev-tools`;

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-personas-local-token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

let projects;
try { projects = await call('GET', '/projects'); } catch (e) {
  console.error(`Personas did not answer (${e.message}). Is the app running? ${cards.length} cards are still owed.`);
  process.exit(3);
}
let project = projects.find((p) => norm(p.root_path) === norm(repo));
if (!project) {
  if (!register) {
    console.error(`${repo} is not a registered Personas project. Re-run with --register, or register it in the app.`);
    process.exit(4);
  }
  if (dryRun) {
    console.log(`would register ${basename(repo)} at ${repo}`);
  } else {
    project = await call('POST', '/projects', { name: basename(repo), root_path: repo });
    console.log(`registered ${project.name} (${project.id})`);
  }
}

const contexts = new Map();
if (project) {
  try {
    for (const c of await call('GET', `/contexts/${project.id}`)) {
      if (c && c.name && c.id) contexts.set(String(c.name).trim().toLowerCase(), c.id);
    }
  } catch { /* no contexts, or the last context scan was refused: file unbound */ }
}

const SIZE_EFFORT = { XS: 1, S: 1, M: 2, L: 3, XL: 4 };
const to5 = (v) => (Number.isFinite(v) && v > 0 ? Math.min(5, Math.max(1, Math.ceil(v / 2))) : null);

function toFiling(c) {
  const defaulted = [];
  let effort = to5(c.effort);
  if (effort == null) { effort = SIZE_EFFORT[String(c.size || '').toUpperCase()] || 2; defaulted.push('effort'); }
  let impact = to5(c.impact);
  if (impact == null) { impact = 3; defaulted.push('impact'); }
  let risk = to5(c.risk);
  if (risk == null) { risk = 3; defaulted.push('risk'); }

  const lane = String(c.lane || '').toUpperCase();
  const head = lane === 'B'
    ? '> **Lane B - A/B-drainable.** An instrument can decide this. Accept = run `/scan-sweep --ab-only` on it; reject = drop it.\n\n'
    : '';
  const evidence = c.evidence ? `\n\n## Evidence\n${c.evidence}` : '';
  const description = (head + (c.body || '') + evidence).slice(0, 6000);

  const why = [
    lane ? `Lane ${lane}` : null,
    c.gate && c.gate !== 'none' ? `gate ${c.gate}` : null,
    c.result ? `result ${c.result}` : null,
    c.method ? `method ${c.method}` : null,
    c.size ? `size ${c.size}` : null,
    c.source ? `from ${c.source}` : null,
    defaulted.length ? `scales defaulted: ${defaulted.join(', ')}` : null,
  ].filter(Boolean).join('; ');

  return {
    project_id: project ? project.id : '<unregistered>',
    title: c.title.trim().slice(0, 200),
    description,
    reasoning: `scan-sweep hand-off - ${why}`,
    category: c.category || 'technical',
    effort, impact, risk,
    context_id: c.context ? contexts.get(String(c.context).trim().toLowerCase()) ?? null : null,
    origin: 'scan_sweep',
    lens: c.lens || null,
  };
}

const LANDED = new Set(['created', 'deduped', 'rated', 'near_duplicate']);
const results = [];
for (const c of cards) {
  const body = toFiling(c);
  if (dryRun) { results.push({ title: body.title, outcome: 'dry-run', filing: body }); continue; }
  try {
    const r = await call('POST', '/ideas', body);
    results.push({ title: body.title, outcome: r.outcome, id: r.idea?.id, status: r.idea?.status, note: r.duplicateNote || r.goalNote || null });
  } catch (e) {
    results.push({ title: body.title, outcome: 'error', error: e.message });
  }
}

const tally = {};
for (const r of results) tally[r.outcome] = (tally[r.outcome] || 0) + 1;
if (outPath) writeFileSync(outPath, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
if (asJson) {
  console.log(JSON.stringify({ project: project?.name ?? null, cards: cards.length, tally, results }, null, 2));
} else {
  console.log(`${project?.name ?? basename(repo)}: ${cards.length} cards -> ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing'}`);
  for (const r of results.filter((r) => r.outcome === 'error')) console.log(`  FAILED ${r.title}: ${r.error}`);
  const accepted = results.filter((r) => r.status && r.status !== 'pending');
  if (accepted.length) console.log(`  ${accepted.length} already decided in Approvals (dedup hit on a ${[...new Set(accepted.map((r) => r.status))].join('/')} row)`);
}
// exitCode, not exit(): exiting while fetch's sockets close trips a libuv assertion on Windows.
process.exitCode = dryRun || results.every((r) => LANDED.has(r.outcome)) ? 0 : 1;
