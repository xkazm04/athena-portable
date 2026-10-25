/**
 * The write-path walk: a seeded generator over every mutation in lib/mutations.ts, the op trace it
 * records, and the replay that turns a trace back into the same sequence of calls.
 *
 * - The stream is mulberry32 from a fixed seed, and every choice reads only the stream and the
 *   database, so a walk from a fresh seed is the same walk on every machine.
 * - Each seed draws a swarm: a subset of the eight ops (at least three), so a walk spends its steps
 *   deep in a few interactions instead of thinly across all of them.
 * - Choices lean on the states the seed cannot produce: dead and merged ids as targets, a whole
 *   domain deleted at once, the swapped orientation of a pair, an undo of something already undone
 *   or overwritten, an extra pair on a record that is already paired.
 * - What a failing walk leaves behind is its trace (JSON `{op,args}` list), not its seed: a seed
 *   reproduces only while the generator is unchanged, a trace reproduces against the code.
 *
 * Imported after `tempHome` (it reaches lib/db.ts), like every library module under test.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import type { Db } from "@athena/demo-kit/db";

import { db, domainSpellings } from "../../lib/db";
import { restamp } from "../../lib/flags";
import {
  deleteContacts,
  flagStale,
  mergeContacts,
  normalizeFields,
  planMerge,
  resolveCompany,
  resolvePair,
  undoWrite,
} from "../../lib/mutations";
import { RULES, type NormalizeRule } from "../../lib/normalize";
import { digest } from "./snapshot";
import type { Violation } from "./oracle";

export const OP_NAMES = [
  "normalizeFields",
  "flagStale",
  "resolveCompany",
  "mergeContacts",
  "deleteContacts",
  "resolvePair",
  "undoWrite",
  "insertExtraPair",
] as const;
export type OpName = (typeof OP_NAMES)[number];

export type Op =
  | { op: "normalizeFields"; args: [string[], NormalizeRule[]] }
  | { op: "flagStale"; args: [string[]] }
  | { op: "resolveCompany"; args: [string, string] }
  | { op: "mergeContacts"; args: [string, string] }
  | { op: "deleteContacts"; args: [string[]] }
  | { op: "resolvePair"; args: [string, "kept_both" | "skipped"] }
  | { op: "undoWrite"; args: [number] }
  | { op: "insertExtraPair"; args: [string, string, string] };

export interface Trace {
  /** Why the trace is committed while it still fails: the defect it pins, filed to its owner. */
  todo?: string;
  seed?: number;
  ops: Op[];
}

/** States the seed cannot reach; the walk suite fails if the generator stops getting to one. */
export const REACH = [
  "contact in two open pairs",
  "domain emptied of working contacts",
  "refused undo",
  "merge adopts the drop's phone",
  "refused merge",
  "open pair across two domains",
] as const;
export type Reach = (typeof REACH)[number];
export type Tally = Record<Reach, number>;

export function emptyTally(): Tally {
  return Object.fromEntries(REACH.map((k) => [k, 0])) as Tally;
}

/* ---------------------------------------------------------------- apply */

export interface Outcome {
  ok: boolean;
  /** The reversible activity row the op wrote, which is what an immediate undo names. */
  reversibleId: number | null;
  reached: Reach[];
}

const maxActivity = () => db().get<{ n: number | null }>("SELECT MAX(id) AS n FROM activity")?.n ?? 0;

/**
 * A pair the matcher could have proposed: an open row between two records, stamped through the
 * flags' own writer like every other pair status change. The seed gives each contact one pair;
 * this is how a walk (and pairs.test.ts) gets a record into two.
 */
export function insertExtraPair(handle: Db, id: string, keepId: string, dropId: string): void {
  handle.run(
    `INSERT INTO merge_pairs (id, keep_id, drop_id, confidence, evidence_json, status)
     VALUES (?, ?, ?, 0.5, '[]', 'open')`,
    [id, keepId, dropId],
  );
  restamp(handle, { ids: [keepId, dropId] });
}

/** Run one op through the library, as the server actions would. */
export function apply(op: Op): Outcome {
  const before = maxActivity();
  const reached: Reach[] = [];
  let ok: boolean;
  switch (op.op) {
    case "normalizeFields":
      ok = normalizeFields(...op.args).ok;
      break;
    case "flagStale":
      ok = flagStale(...op.args).ok;
      break;
    case "resolveCompany":
      ok = resolveCompany(...op.args).ok;
      break;
    case "mergeContacts": {
      const plan = planMerge(...op.args);
      ok = mergeContacts(...op.args).ok;
      if (!ok) reached.push("refused merge");
      if (ok && !("refusal" in plan) && plan.outcome.adopts.some((a) => a.field === "phone")) {
        reached.push("merge adopts the drop's phone");
      }
      break;
    }
    case "deleteContacts":
      ok = deleteContacts(...op.args).ok;
      break;
    case "resolvePair":
      ok = resolvePair(...op.args).ok;
      break;
    case "undoWrite":
      ok = undoWrite(...op.args).ok;
      if (!ok) reached.push("refused undo");
      break;
    case "insertExtraPair":
      insertExtraPair(db(), ...op.args);
      ok = true;
      break;
  }
  const fresh = db().get<{ id: number }>(
    "SELECT id FROM activity WHERE id > ? AND reversible = 1 ORDER BY id DESC LIMIT 1",
    [before],
  );
  if (twoPairs()) reached.push("contact in two open pairs");
  if (emptiedDomain()) reached.push("domain emptied of working contacts");
  if (crossDomainPair()) reached.push("open pair across two domains");
  return { ok, reversibleId: fresh?.id ?? null, reached };
}

function twoPairs(): boolean {
  return (
    db().get(
      `SELECT c FROM (SELECT keep_id AS c FROM merge_pairs WHERE status = 'open'
                      UNION ALL SELECT drop_id FROM merge_pairs WHERE status = 'open')
        GROUP BY c HAVING COUNT(*) > 1 LIMIT 1`,
    ) !== undefined
  );
}

function crossDomainPair(): boolean {
  return (
    db().get(
      `SELECT p.id FROM merge_pairs p
         JOIN contacts k ON k.id = p.keep_id
         JOIN contacts d ON d.id = p.drop_id
        WHERE p.status = 'open' AND k.domain <> d.domain LIMIT 1`,
    ) !== undefined
  );
}

function emptiedDomain(): boolean {
  return (
    db().get(
      `SELECT domain FROM contacts GROUP BY domain
        HAVING SUM(deleted_at IS NULL AND merged_into IS NULL) = 0 LIMIT 1`,
    ) !== undefined
  );
}

/* ------------------------------------------------------------ generate */

/** mulberry32: a seeded, repeatable stream. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A subset of the ops for one seed: each with probability 0.6, topped up to at least three. */
export function swarm(r: () => number): OpName[] {
  const chosen = OP_NAMES.filter(() => r() < 0.6);
  const rest = OP_NAMES.filter((n) => !chosen.includes(n));
  while (chosen.length < 3) chosen.push(rest.splice(Math.floor(r() * rest.length), 1)[0]!);
  return OP_NAMES.filter((n) => chosen.includes(n));
}

interface Row {
  id: string;
  domain: string;
  phone_ok: number;
  is_stale: number;
  stale_flagged: number;
  deleted_at: string | null;
  merged_into: string | null;
}
interface PairRow {
  id: string;
  keep_id: string;
  drop_id: string;
  status: string;
}

/** The next op for this state. Every branch reads only `r` and the database. */
export function generate(r: () => number, ops: readonly OpName[], lastReversible: number | null): Op {
  const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(r() * xs.length)];
  const some = <T>(xs: readonly T[], n: number): T[] =>
    Array.from({ length: n }, () => pick(xs)).filter((x): x is T => x !== undefined);

  const all = db().all<Row>(
    "SELECT id, domain, phone_ok, is_stale, stale_flagged, deleted_at, merged_into FROM contacts ORDER BY id",
  );
  const working = all.filter((c) => c.deleted_at === null && c.merged_into === null);
  const gone = all.filter((c) => c.deleted_at !== null || c.merged_into !== null);
  const targets = (n: number) => some(r() < 0.75 || gone.length === 0 ? working : gone, n).map((c) => c.id);
  const pairs = db().all<PairRow>("SELECT id, keep_id, drop_id, status FROM merge_pairs ORDER BY id");
  const open = pairs.filter((p) => p.status === "open");

  const name = pick(ops) ?? "flagStale";
  switch (name) {
    case "normalizeFields": {
      const rules = RULES.filter(() => r() < 0.6);
      return { op: name, args: [targets(1 + Math.floor(r() * 5)), rules.length > 0 ? rules : ["phone_e164"]] };
    }
    case "flagStale": {
      const due = working.filter((c) => c.is_stale === 1 && c.stale_flagged === 0);
      const ids = r() < 0.6 && due.length > 0 ? some(due, 1 + Math.floor(r() * 4)).map((c) => c.id) : targets(2);
      return { op: name, args: [ids] };
    }
    case "resolveCompany": {
      const domain = (r() < 0.85 ? pick(working) : pick(all))?.domain ?? "verdant-supply.example";
      const spelled = domainSpellings(domain);
      const company = r() < 0.8 && spelled.length > 0 ? pick(spelled)!.company : `${domain.split(".")[0]} Group`;
      return { op: name, args: [domain, company] };
    }
    case "mergeContacts": {
      const roll = r();
      // A pair whose survivor would take the drop's good phone, when one is open.
      const phoneOf = new Map(all.map((c) => [c.id, c.phone_ok]));
      const adopting = open.filter((p) => phoneOf.get(p.keep_id) === 0 && phoneOf.get(p.drop_id) === 1);
      const p = roll < 0.25 && adopting.length > 0 ? pick(adopting) : pick(open);
      if (p && roll < 0.75) return { op: name, args: [p.keep_id, p.drop_id] };
      if (p && roll < 0.88) return { op: name, args: [p.drop_id, p.keep_id] };
      const settled = pick(pairs.filter((q) => q.status !== "open"));
      if (settled && r() < 0.5) return { op: name, args: [settled.keep_id, settled.drop_id] };
      const [a, b] = some(all, 2);
      return { op: name, args: [a?.id ?? "", b?.id ?? ""] };
    }
    case "deleteContacts": {
      if (r() < 0.3) {
        // A whole domain at once, the smallest first, so a domain can be emptied in one step.
        const sizes = new Map<string, number>();
        for (const c of working) sizes.set(c.domain, (sizes.get(c.domain) ?? 0) + 1);
        const small = [...sizes.entries()].sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0])).slice(0, 6);
        const domain = pick(small)?.[0];
        if (domain) return { op: name, args: [working.filter((c) => c.domain === domain).map((c) => c.id)] };
      }
      return { op: name, args: [some(r() < 0.8 ? working : all, 1 + Math.floor(r() * 3)).map((c) => c.id)] };
    }
    case "resolvePair": {
      const p = r() < 0.85 ? pick(open) : pick(pairs);
      return { op: name, args: [p?.id ?? "pair_none", r() < 0.5 ? "kept_both" : "skipped"] };
    }
    case "undoWrite": {
      if (lastReversible !== null && r() < 0.4) return { op: name, args: [lastReversible] };
      const ids = db().all<{ id: number }>("SELECT id FROM activity ORDER BY id").map((a) => a.id);
      return { op: name, args: [pick(ids) ?? 1] };
    }
    case "insertExtraPair": {
      const paired = new Set(open.flatMap((p) => [p.keep_id, p.drop_id]));
      const keep = (r() < 0.7 ? pick(working.filter((c) => paired.has(c.id))) : undefined) ?? pick(working);
      const between = new Set(
        pairs.filter((p) => p.keep_id === keep?.id || p.drop_id === keep?.id).flatMap((p) => [p.keep_id, p.drop_id]),
      );
      // Mostly on the keeper's domain, as every pair the seed's matcher proposes is, and otherwise
      // across two domains: such a pair is attached to the keeper's block only, and the sheet must
      // count it once (traces/cross-domain-pair.json).
      const candidates = working.filter((c) => c.id !== keep?.id && !between.has(c.id));
      const sameDomain = candidates.filter((c) => c.domain === keep?.domain);
      const drop = (r() < 0.7 ? pick(sameDomain) : undefined) ?? pick(candidates.filter((c) => c.domain !== keep?.domain));
      const n = pairs.filter((p) => p.id.startsWith("pair_x")).length + 1;
      return { op: name, args: [`pair_x${String(n).padStart(3, "0")}`, keep?.id ?? "", drop?.id ?? ""] };
    }
  }
}

/* ---------------------------------------------------------------- walk */

export interface RoundTrip {
  seed: number;
  step: number;
  op: string;
  restored: boolean;
}

export interface WalkResult {
  seed: number;
  swarm: OpName[];
  trace: Trace;
  landed: number;
  tally: Tally;
  roundTrips: RoundTrip[];
  failure: { step: number; message: string; tracePath: string } | null;
}

const tables = () => `${digest(db(), "contacts")}:${digest(db(), "merge_pairs")}`;

/**
 * One walk from the current database (the caller restores the seed first). After every op the
 * oracle runs; a reversible op is sometimes undone at once, and then the tables must be back where
 * they were. The first failure stops the walk and writes its trace.
 */
export function walk(
  seed: number,
  steps: number,
  opts: { check: () => Violation[]; tracesDir: string },
): WalkResult {
  const r = rng(seed);
  const ops = swarm(r);
  const result: WalkResult = { seed, swarm: ops, trace: { seed, ops: [] }, landed: 0, tally: emptyTally(), roundTrips: [], failure: null };
  let lastReversible: number | null = null;
  let pending: { id: number; before: string; op: string } | null = null;

  const fail = (step: number, message: string) => {
    mkdirSync(opts.tracesDir, { recursive: true });
    const tracePath = `${opts.tracesDir}walk-seed-${seed}.json`;
    writeFileSync(tracePath, `${JSON.stringify({ seed, failure: message, ops: result.trace.ops }, null, 2)}\n`);
    result.failure = { step, message, tracePath };
  };

  for (let step = 0; step < steps; step += 1) {
    // An immediate undo of the write just made is drawn apart from the swarm, so round trips are
    // checked in every walk whose swarm writes reversibly.
    const op: Op =
      pending && r() < 0.35 ? { op: "undoWrite", args: [pending.id] } : generate(r, ops, lastReversible);
    const before = tables();
    result.trace.ops.push(op);
    const outcome = apply(op);
    if (outcome.ok) result.landed += 1;
    for (const k of outcome.reached) result.tally[k] += 1;

    const found = opts.check();
    if (found.length > 0) {
      fail(step, `step ${step} ${JSON.stringify(op)}: ${JSON.stringify(found.slice(0, 5))}`);
      return result;
    }
    if (op.op === "undoWrite" && pending && op.args[0] === pending.id && outcome.ok) {
      const restored = tables() === pending.before;
      result.roundTrips.push({ seed, step, op: pending.op, restored });
      if (!restored) {
        fail(step, `step ${step}: undo of ${pending.op} did not restore contacts and merge_pairs`);
        return result;
      }
    }
    pending = outcome.reversibleId !== null ? { id: outcome.reversibleId, before, op: JSON.stringify(op) } : null;
    if (outcome.reversibleId !== null) lastReversible = outcome.reversibleId;
  }
  return result;
}

/** Apply a trace's ops in order, calling `after` once per step. The caller restores the seed first. */
export function replay(trace: Pick<Trace, "ops">, after: (step: number, op: Op) => void): void {
  trace.ops.forEach((op, step) => {
    apply(op);
    after(step, op);
  });
}
