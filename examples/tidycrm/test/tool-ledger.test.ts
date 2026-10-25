/**
 * Every tool the shell registers, run through its OWN handler, and held to the class it declares.
 *
 * The AUTO/GATED split is the safety line of this app's agent surface, and design 5.1 computes it
 * from two hand-typed fields: `reversible` and `sideEffects`. `tools.test.ts` checks those fields
 * against the rule; nothing checked them against what the handler does. A tool that declared
 * `reversible: true` while its action logged a row nothing can put back, or `sideEffects: "none"`
 * while it wrote, would be classed AUTO, run unasked by a browser agent's gate, and pass every gate
 * this repo had - no tidycrm test had ever executed one of these handlers.
 *
 * So the registrations are captured as the page hands them to the kit (`support/capture-tools.ts`:
 * HostCapabilities rendered, its outside imports recorded, the server actions and library real),
 * each handler is called with a fixture on a scratch copy of the seed, and what it wrote - the
 * four tables' digests and the activity rows it logged - is the observed ledger the declaration is
 * checked against. A declaration that does not hold is a violation; the one this app knowingly
 * carries (`export`) sits in EXCEPTIONS with its reason, and an exception that stops being needed
 * fails as stale, so the map cannot quietly outlive the gap it excuses.
 *
 * What a run proves is "on these fixtures" (the seed's ordinary path), not "on every argument":
 * `write-paths.model.test.ts` is the instrument for sequences the seed cannot produce.
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { WebMCPToolSpec } from "@athena/demo-kit/webmcp";

import { tempHome } from "./tmp-home";

tempHome("tidycrm-tool-ledger-");

const { captureTools, call } = await import("./support/capture-tools");
const { db, listOpenPairs, readConflicts } = await import("../lib/db");
const { planNormalize, resolvePair } = await import("../lib/mutations");
const { RULES } = await import("../lib/normalize");
const { TABLES, digest, restore, take } = await import("./model/snapshot");
type Table = (typeof TABLES)[number];

const captured = await captureTools();
const tools = new Map(captured.specs.map((s) => [s.name, s]));
const tool = (name: string): WebMCPToolSpec => {
  const spec = tools.get(name);
  assert.ok(spec, `the shell registers no ${name}`);
  return spec;
};

const seed = take(db());

/* --------------------------------------------------------------- the observed ledger */

interface Logged {
  id: number;
  action: string;
  reversible: boolean;
}

interface Observed {
  /** Tables whose rows differ after the call, in TABLES order. */
  changed: Table[];
  /** Activity rows the call added. */
  logged: Logged[];
}

const digests = (): Record<Table, string> =>
  Object.fromEntries(TABLES.map((t) => [t, digest(db(), t)])) as Record<Table, string>;

const lastActivity = (): number => db().get<{ n: number | null }>("SELECT MAX(id) AS n FROM activity")?.n ?? 0;

/** Call one handler and record what it wrote. */
async function observe(spec: WebMCPToolSpec, args: Record<string, unknown>): Promise<{ result: unknown; obs: Observed }> {
  const before = digests();
  const mark = lastActivity();
  const result = await call(spec, args);
  const after = digests();
  const logged = db()
    .all<{ id: number; action: string; reversible: number }>(
      "SELECT id, action, reversible FROM activity WHERE id > ? ORDER BY id",
      [mark],
    )
    .map((r) => ({ id: r.id, action: r.action, reversible: r.reversible === 1 }));
  return { result, obs: { changed: TABLES.filter((t) => before[t] !== after[t]), logged } };
}

type Declared = Pick<WebMCPToolSpec, "name" | "reversible" | "sideEffects">;

/**
 * The declaration against the ledger. Empty means the two fields the gate reads are true of what
 * the handler did on this fixture.
 */
function checkDeclaration(spec: Declared, obs: Observed): string[] {
  const out: string[] = [];
  const wrote = obs.changed.length > 0;
  if (spec.sideEffects === "none" && wrote) {
    out.push(`${spec.name} declares sideEffects "none" but changed ${obs.changed.join(", ")}`);
  }
  if (spec.sideEffects !== "none" && !wrote) {
    out.push(`${spec.name} declares sideEffects "${spec.sideEffects}" but changed nothing on its fixture`);
  }
  if (spec.reversible) {
    const kept = obs.logged.filter((l) => !l.reversible).map((l) => l.action);
    if (kept.length > 0) out.push(`${spec.name} declares reversible: true but logged non-reversible ${kept.join(", ")}`);
    if (wrote && obs.logged.length === 0) {
      out.push(`${spec.name} declares reversible: true but wrote with no activity row for undo to reach`);
    }
  } else if (spec.sideEffects !== "none" && !obs.logged.some((l) => !l.reversible)) {
    out.push(`${spec.name} declares reversible: false but logged no non-reversible row`);
  }
  return out;
}

/**
 * The declaration-behaviour gaps this app carries on purpose, each with the violation it excuses
 * and why. An entry whose tool no longer shows that violation fails as stale.
 */
const EXCEPTIONS: Record<string, { violation: string; reason: string }> = {
  export: {
    violation: "declares reversible: true but logged non-reversible export",
    reason:
      "The download is the act and it changes no contact, pair or revision; the route's non-reversible " +
      "`export` row is provenance (app/api/export/route.ts). Declaring reversible: false would gate a " +
      "read-shaped export behind approval; declaring none would promise readOnlyHint while a row lands. " +
      "So it stays a reversible data tool, AUTO, and this entry is the place the gap is written down.",
  },
};

/** Violations not excused, and exceptions no longer earned. Empty is a ledger that agrees. */
function exceptionVerdicts(byTool: Record<string, string[]>, exceptions: typeof EXCEPTIONS): string[] {
  const out: string[] = [];
  for (const [name, violations] of Object.entries(byTool)) {
    const excused = exceptions[name]?.violation;
    for (const v of violations) if (v !== `${name} ${excused}`) out.push(v);
  }
  for (const [name, { violation }] of Object.entries(exceptions)) {
    if (!(byTool[name] ?? []).includes(`${name} ${violation}`)) {
      out.push(`EXCEPTIONS.${name} is stale: its tool no longer shows "${violation}"`);
    }
  }
  return out;
}

/* -------------------------------------------------------------------- the fixtures */

const liveIds = (): string[] =>
  db()
    .all<{ id: string }>("SELECT id FROM contacts WHERE deleted_at IS NULL AND merged_into IS NULL ORDER BY id LIMIT 500")
    .map((r) => r.id);

const firstOpenPair = () => {
  const [pair] = listOpenPairs(1);
  assert.ok(pair, "the seed has an open pair");
  return pair;
};

const someConflict = () => {
  const [conflict] = readConflicts(undefined, 1).domains;
  assert.ok(conflict, "the seed has a conflicted domain");
  return { domain: conflict.domain, canonical_name: conflict.consensus };
};

const toNormalize = () => {
  const [plan] = planNormalize(liveIds(), [...RULES]);
  assert.ok(plan, "the seed has a contact with normalisation work");
  return { ids: [plan.contact_id], rules: [...RULES] };
};

/**
 * One call per tool on the restored seed: `args()` runs any precondition and returns what an agent
 * would send. Every captured tool must have one (a registration added without a fixture fails).
 */
const FIXTURES: Record<string, { args: () => Record<string, unknown> }> = {
  navigate: { args: () => ({ view: "blocks" }) },
  export: { args: () => ({ segment: "all" }) },
  read_state: { args: () => ({}) },
  normalize_fields: { args: toNormalize },
  preview_normalize: { args: toNormalize },
  flag_stale: {
    args: () => {
      const row = db().get<{ id: string }>(
        "SELECT id FROM contacts WHERE deleted_at IS NULL AND merged_into IS NULL AND stale_flagged = 0 ORDER BY id",
      );
      assert.ok(row, "the seed has an unflagged live contact");
      return { ids: [row.id] };
    },
  },
  merge_contacts: {
    args: () => {
      const pair = firstOpenPair();
      return { keep_id: pair.keep_id, drop_id: pair.drop_id };
    },
  },
  delete_contacts: { args: () => ({ ids: [liveIds()[0]] }) },
  read_pairs: { args: () => ({ limit: 5 }) },
  preview_merge: { args: () => ({ pair_id: firstOpenPair().id }) },
  resolve_pair: { args: () => ({ pair_id: firstOpenPair().id, verdict: "kept_both" }) },
  read_conflicts: { args: () => ({}) },
  preview_company: { args: someConflict },
  resolve_company: { args: someConflict },
  undo: {
    // Precondition: one reversible write to put back, made through the library so the tool under
    // observation is the undo alone.
    args: () => {
      assert.equal(resolvePair(firstOpenPair().id, "skipped").ok, true);
      return { activity_id: lastActivity() };
    },
  },
};

const uncovered = (specs: Pick<WebMCPToolSpec, "name">[]): string[] =>
  specs.map((s) => s.name).filter((n) => !(n in FIXTURES));

/** Restore the seed, run the fixture's precondition, observe the handler. */
async function run(spec: WebMCPToolSpec): Promise<{ result: unknown; obs: Observed }> {
  restore(db(), seed);
  const fixture = FIXTURES[spec.name];
  assert.ok(fixture, `${spec.name} has no fixture`);
  return observe(spec, fixture.args());
}

const NONE = captured.specs.filter((s) => s.sideEffects === "none").map((s) => s.name);
const REVERSIBLE_WRITES = captured.specs.filter((s) => s.reversible && s.sideEffects === "data" && s.name !== "export");
const IRREVERSIBLE = captured.specs.filter((s) => !s.reversible).map((s) => s.name);

/* ------------------------------------------------------------------------ the cases */

test("coverage: every captured tool has a fixture, and a planted registration without one is named", () => {
  assert.equal(captured.specs.length, 15);
  assert.deepEqual(uncovered(captured.specs), []);
  assert.deepEqual(Object.keys(FIXTURES).filter((n) => !tools.has(n)), [], "a fixture for a tool that is gone");
  assert.deepEqual(uncovered([...captured.specs, { name: "planted_tool" }]), ["planted_tool"]);
});

test("none means none: every sideEffects \"none\" handler leaves the four tables as it found them", async () => {
  assert.deepEqual(NONE, [
    "navigate",
    "read_state",
    "preview_normalize",
    "read_pairs",
    "preview_merge",
    "read_conflicts",
    "preview_company",
  ]);
  for (const name of NONE) {
    const { result, obs } = await run(tool(name));
    assert.deepEqual(obs, { changed: [], logged: [] }, `${name} wrote`);
    assert.ok(result !== undefined && result !== null, `${name} answered nothing`);
  }
  assert.ok(captured.pushes.includes("/"), "navigate reached the router");
});

test("declared reversible is real: each reversible write logs one reversible row and the undo tool puts it back", async () => {
  assert.deepEqual(
    REVERSIBLE_WRITES.map((s) => s.name),
    ["normalize_fields", "flag_stale", "resolve_pair", "resolve_company"],
  );
  const undo = tool("undo");
  for (const spec of REVERSIBLE_WRITES) {
    restore(db(), seed);
    const fixture = FIXTURES[spec.name]!;
    const args = fixture.args();
    const before = { contacts: digest(db(), "contacts"), merge_pairs: digest(db(), "merge_pairs") };

    const { obs } = await observe(spec, args);
    assert.equal(obs.logged.length, 1, `${spec.name} logged ${obs.logged.length} rows`);
    const [row] = obs.logged;
    assert.equal(row!.reversible, true, `${spec.name} logged a non-reversible row`);
    assert.ok(obs.changed.some((t) => t !== "activity"), `${spec.name} wrote nothing but the log`);

    assert.equal(await call(undo, { activity_id: row!.id }), `Undid #${row!.id}.`);
    assert.deepEqual(
      { contacts: digest(db(), "contacts"), merge_pairs: digest(db(), "merge_pairs") },
      before,
      `undo of ${spec.name} did not restore contacts and merge_pairs`,
    );
  }
});

test("declared irreversible is real: merge_contacts, delete_contacts and undo each log a non-reversible row", async () => {
  assert.deepEqual(IRREVERSIBLE, ["merge_contacts", "delete_contacts", "undo"]);
  for (const name of IRREVERSIBLE) {
    const { obs } = await run(tool(name));
    assert.ok(obs.logged.length > 0, `${name} logged nothing`);
    assert.ok(obs.logged.every((l) => !l.reversible), `${name} logged a reversible row: ${JSON.stringify(obs.logged)}`);
  }
  // The excluded half of the gate's reasoning: an undo's own row cannot itself be undone.
  const { obs } = await run(tool("undo"));
  const refused = await call(tool("undo"), { activity_id: obs.logged[0]!.id });
  assert.notEqual(refused, `Undid #${obs.logged[0]!.id}.`);
});

test("export: the anchor click reaches the real route, which logs one non-reversible export row, and the gap is a reasoned exception", async () => {
  const before = captured.downloads.length;
  const { result, obs } = await run(tool("export"));

  assert.equal(captured.downloads.length, before + 1, "the handler clicked no anchor");
  const download = captured.downloads.at(-1)!;
  assert.equal(download.href, "/api/export?segment=all");
  assert.equal(download.status, 200);
  assert.match(await download.body, /^id,first_name,/, "the route answered no CSV");

  assert.deepEqual(obs.changed, ["activity"]);
  assert.deepEqual(obs.logged.map((l) => [l.action, l.reversible]), [["export", false]]);

  assert.ok(result && typeof result === "object", "export answered no summary");
  const answer = result as Record<string, unknown>;
  assert.equal(answer.file, download.download);
  assert.ok(Object.keys(answer).length > 1, "the summary half is missing");

  assert.ok(EXCEPTIONS.export!.reason.length > 0);
  assert.deepEqual(checkDeclaration(tool("export"), obs), [`export ${EXCEPTIONS.export!.violation}`]);
  // An exception the tool no longer earns fails as stale rather than lingering.
  assert.deepEqual(exceptionVerdicts({ export: [] }, EXCEPTIONS), [
    `EXCEPTIONS.export is stale: its tool no longer shows "${EXCEPTIONS.export!.violation}"`,
  ]);
});

test("the ledger agrees with every declaration, export's reasoned exception aside", async () => {
  const byTool: Record<string, string[]> = {};
  for (const spec of captured.specs) {
    const { obs } = await run(spec);
    byTool[spec.name] = checkDeclaration(spec, obs);
  }
  assert.deepEqual(exceptionVerdicts(byTool, EXCEPTIONS), []);
});

test("negative control: a spec declaring sideEffects \"none\" around normalizeAction is caught", async () => {
  const planted = { ...tool("normalize_fields"), sideEffects: "none" as const };
  restore(db(), seed);
  const { obs } = await observe(planted, toNormalize());
  const violations = checkDeclaration(planted, obs);
  assert.ok(
    violations.some((v) => v.startsWith('normalize_fields declares sideEffects "none" but changed contacts')),
    `the checker stayed green: ${JSON.stringify(violations)}`,
  );
  // And a planted irreversible-looking write declared reversible: the other half of the gate.
  const lying = { ...tool("merge_contacts"), reversible: true };
  restore(db(), seed);
  const merged = await observe(lying, FIXTURES.merge_contacts!.args());
  assert.ok(checkDeclaration(lying, merged.obs).some((v) => v.includes("declares reversible: true but logged non-reversible")));
});
