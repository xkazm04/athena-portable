#!/usr/bin/env node
// scan-sweep coverage table - per-context lens coverage from scan-history.
// Reads the context map (repo root) + .claude/scan-history/scan-sweep.jsonl.
//
// Usage:
//   node coverage.mjs             # table, least-covered first (top 30)
//   node coverage.mjs --all       # every context
//   node coverage.mjs --next      # ONLY the next context the loop should take
//   node coverage.mjs --json      # machine-readable, for a caller that ranks itself
//   node coverage.mjs --map <p>   # context map at a non-default path
//
// --next implements the picker rule in SKILL.md section 1, verbatim and in one place:
// never-swept first (in map order), else smallest lens union, else oldest last sweep.
// The loop asks this script rather than re-deriving it, so the ledger and the picker
// cannot drift apart.
import { readFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const all = has('--all');
const asJson = has('--json');
const nextOnly = has('--next');
const mapPath = opt('--map', 'context-map.json');

if (!existsSync(mapPath)) {
  console.error(`no context map at ${mapPath} - pass --map <path>`);
  process.exit(2);
}
const map = JSON.parse(readFileSync(mapPath, 'utf8'));
const histPath = '.claude/scan-history/scan-sweep.jsonl';
const hist = existsSync(histPath)
  ? readFileSync(histPath, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];

// Total lens count is read from the reference, not hardcoded: a lens added to
// lenses.md must not silently make every "22/22" row a lie.
// `Group: challenge` lenses run only under --challenge and are NOT part of the
// denominator (SKILL.md "Challenge mode"): a challenge run must never make a
// context read as swept.
let TOTAL_LENSES = 22;
const CHALLENGE_LENSES = new Set();
try {
  const ref = new URL('../references/lenses.md', import.meta.url);
  const sections = readFileSync(ref, 'utf8').split(/^(?=## [a-z-]+ )/m).filter((s) => s.startsWith('## '));
  for (const s of sections) if (/^Group: challenge\s*$/m.test(s)) CHALLENGE_LENSES.add(s.slice(3).split(' ')[0]);
  const n = sections.length - CHALLENGE_LENSES.size;
  if (n > 0) TOTAL_LENSES = n;
} catch { /* keep the fallback */ }

// Challenge snapshots are tallied apart: they feed the --challenge cohort picker
// and nothing else.
const challenged = new Map();
for (const h of hist) {
  if (h.strategy !== 'challenge') continue;
  const prev = challenged.get(h.scope);
  if (!prev || h.at > prev) challenged.set(h.scope, h.at);
}
// --in-flight <cohort.json>[,<cohort.json>]: a run whose scouts are done but whose
// snapshots are not yet written (challenge.md section 2.2, pipelining). Its hosts and
// riders count as challenged "now" so the next cohort does not pick them again.
for (const f of (opt('--in-flight', '') || '').split(',').filter(Boolean)) {
  const c = JSON.parse(readFileSync(f, 'utf8'));
  const now = new Date().toISOString();
  for (const h of c.cohort ?? []) {
    challenged.set(h.name, now);
    for (const r of h.riders ?? []) challenged.set(r.name, now);
  }
}

const byScope = new Map();
for (const h of hist) {
  if (h.strategy === 'challenge') continue;
  const e = byScope.get(h.scope) ?? { lenses: new Set(), findings: 0, fixed: 0, leads: 0, sweeps: 0, last: null, strategy: null, carried: 0 };
  for (const k of h.lens_keys ?? []) e.lenses.add(k);
  e.findings += h.findings ?? 0; e.fixed += h.fixed ?? 0; e.leads += h.leads ?? 0; e.sweeps += 1;
  // `carried` is a STATE, not a tally: only the latest snapshot's count is owed (SKILL.md section 5).
  if (!e.last || h.at > e.last) { e.last = h.at; e.strategy = h.strategy ?? null; e.carried = h.carried ?? 0; }
  byScope.set(h.scope, e);
}

// The self-correction of section 5: three false positives across the last five rounds on
// this REPO (any context) and auto-accept needs Method `gate` until three rounds at fp=0.
// Computed here so the round header can print it without re-deriving the window.
const recent = [...hist].sort((a, b) => (a.at > b.at ? 1 : -1)).slice(-5);
const fpRecent = recent.reduce((n, h) => n + (h.fp ?? 0), 0);
const trailingClean = (() => { let n = 0; for (let i = recent.length - 1; i >= 0 && (recent[i].fp ?? 0) === 0; i--) n++; return n; })();
const strict = fpRecent >= 3 && trailingClean < 3;

// A context map is either FLAT (`contexts: [...]`) or GROUPED (`groups: [{contexts: [...]}]`,
// which is what a v2.x map and project-populate both emit). Reading only `map.contexts` made
// `--next` exit 2 with "no contexts in the map" against every grouped map — and because the loop
// asks this script first, that reads as "the repo has no contexts" rather than "the picker cannot
// see them", so the round falls back to a hand-picked context and the rotation stops being
// auditable. Flatten both shapes; map order is group order, then context order within the group.
const contexts = [
  ...(map.contexts ?? []),
  ...(map.groups ?? []).flatMap((g) => (g.contexts ?? []).map((c) => ({ group: g.name, ...c }))),
];
const rows = contexts.map((c, order) => {
  const e = byScope.get(c.name);
  return {
    name: c.name, order, group: c.group ?? c.group_id ?? null,
    challenged: challenged.get(c.name) ?? null,
    files: (c.file_paths ?? c.filePaths ?? []).length,
    lenses: e ? e.lenses.size : 0, sweeps: e ? e.sweeps : 0,
    findings: e ? e.findings : 0, fixed: e ? e.fixed : 0, leads: e ? e.leads : 0,
    carried: e ? e.carried : 0,
    strategy: e && e.strategy ? e.strategy : '-',
    last: e && e.last ? e.last : null,
    age: e && e.last ? Math.round((Date.now() - Date.parse(e.last)) / 86400000) + 'd' : 'never',
  };
});

// The picker: never-swept in MAP order first (so a fresh repo is walked in the
// order its author laid it out), then fewest lenses, then oldest.
const unswept = rows.filter((r) => r.sweeps === 0).sort((a, b) => a.order - b.order);
const swept = rows.filter((r) => r.sweeps > 0)
  .sort((a, b) => a.lenses - b.lenses || Date.parse(a.last) - Date.parse(b.last));
const queue = [...unswept, ...swept];
const next = queue[0] ?? null;
const reason = !next ? 'no contexts'
  : next.sweeps === 0 ? 'never swept'
  : `lens coverage ${next.lenses}/${TOTAL_LENSES}, last swept ${next.age} ago`
    + (next.carried ? `, ${next.carried} carried item(s) owed first` : '');
const strictNote = strict ? `strict: fp=${fpRecent} in last ${recent.length} rounds - auto-accept needs Method gate` : '';

// --challenge: the cohort rule of references/challenge.md section 2, in one place.
// >= 10 files; never challenged first, then oldest challenge; at most one context per
// group; larger first among equals. A group-less context is its own group.
// Riders (references/challenge.md section 2.1): a context under 10 files is never a host
// while its group still has an unchallenged >= 10-file context; it rides with that group's
// host instead (up to RIDERS per host). A group with no such host left promotes its small
// contexts to hosts, largest first, so full coverage is reachable.
if (has('--challenge')) {
  const size = Math.max(1, Number(opt('--cohort', '6')) || 6);
  const RIDERS = Math.max(0, Number(opt('--riders', '3')) || 0);
  const onlyGroup = opt('--group', null);
  const groupOf = (r) => r.group ?? `solo:${r.name}`;
  const bigLeft = new Set(rows.filter((r) => r.files >= 10 && !r.challenged).map(groupOf));
  const pool = rows
    .filter((r) => r.files > 0 && (r.files >= 10 || (!r.challenged && !bigLeft.has(groupOf(r)))))
    .filter((r) => !onlyGroup || r.group === onlyGroup)
    .sort((a, b) => (a.challenged ? 1 : 0) - (b.challenged ? 1 : 0)
      || (a.challenged && b.challenged ? Date.parse(a.challenged) - Date.parse(b.challenged) : 0)
      || b.files - a.files || a.order - b.order);
  const seen = new Set();
  const cohort = [];
  for (const r of pool) {
    if (cohort.length >= size) break;
    const g = r.group ?? `solo:${r.name}`;
    if (!onlyGroup && seen.has(g)) continue;
    seen.add(g);
    cohort.push({ name: r.name, group: r.group, files: r.files, reason: r.challenged ? `last challenged ${r.challenged.slice(0, 10)}` : 'never challenged', riders: [] });
  }
  // Attach riders: unchallenged small contexts of the host's group, map order.
  const riding = new Set(cohort.map((c) => c.name));
  for (const c of cohort) {
    for (const r of rows) {
      if (c.riders.length >= RIDERS) break;
      if (r.files > 0 && r.files < 10 && !r.challenged && !riding.has(r.name) && groupOf(r) === (c.group ?? `solo:${c.name}`)) {
        c.riders.push({ name: r.name, files: r.files });
        riding.add(r.name);
      }
    }
  }
  const uncovered = rows.filter((r) => r.files > 0 && !r.challenged).length;
  if (asJson) console.log(JSON.stringify({ cohort, eligible: pool.length, uncovered }, null, 2));
  else {
    for (const c of cohort) console.log(`${c.name}\t${c.files} files\t${c.group ?? '-'}\t${c.reason}${c.riders.length ? `\triders: ${c.riders.map((x) => `${x.name}(${x.files})`).join(', ')}` : ''}`);
    console.log(`${uncovered} context(s) never challenged`);
    console.log(`\n${cohort.length} of ${pool.length} eligible contexts (>= 10 files${onlyGroup ? `, group ${onlyGroup}` : ', one per group'})`);
  }
  process.exit(cohort.length ? 0 : 2);
}

if (nextOnly) {
  if (!next) { console.error('no contexts in the map'); process.exit(2); }
  if (asJson) console.log(JSON.stringify({ next: next.name, reason, lenses: next.lenses, totalLenses: TOTAL_LENSES, sweeps: next.sweeps, carried: next.carried, strict, fpRecent }));
  else console.log(`${next.name}\t${reason}${strictNote ? '\t' + strictNote : ''}`);
  process.exit(0);
}

if (asJson) {
  console.log(JSON.stringify({ totalLenses: TOTAL_LENSES, contexts: rows.length, swept: rows.filter((r) => r.sweeps > 0).length, next: next && next.name, reason, strict, fpRecent, rows: queue }, null, 2));
  process.exit(0);
}

const shown = all ? queue : queue.slice(0, 30);
const pad = (s, n, r) => (r ? String(s).padStart(n) : String(s).padEnd(n));
console.log(pad('CONTEXT', 36) + pad('FILES', 6, 1) + pad('LENSES', 8, 1) + pad('SWEEPS', 7, 1) + pad('FOUND', 6, 1) + pad('FIXED', 6, 1) + pad('CARRY', 6, 1) + pad('LEADS', 6, 1) + pad('STRATEGY', 11, 1) + pad('LAST', 7, 1));
for (const r of shown) {
  console.log(pad(r.name.slice(0, 35), 36) + pad(r.files, 6, 1) + pad(r.lenses + '/' + TOTAL_LENSES, 8, 1) + pad(r.sweeps, 7, 1) + pad(r.findings, 6, 1) + pad(r.fixed, 6, 1) + pad(r.carried, 6, 1) + pad(r.leads, 6, 1) + pad(r.strategy, 11, 1) + pad(r.age, 7, 1));
}
const covered = rows.filter((r) => r.sweeps > 0).length;
console.log('\n' + covered + '/' + rows.length + ' contexts swept; least-covered first' + (all ? '' : ' (top 30 - pass --all for every context)'));
if (next) console.log('next: ' + next.name + ' (' + reason + ')');
if (strictNote) console.log(strictNote);
