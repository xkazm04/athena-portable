/**
 * The Blocks' tools, driven through their OWN handlers, against what their registrations claim.
 *
 * `components/blocks/tools/BlocksTools.tsx` says in its header that nothing it registers changes
 * the database: "this layer looks and moves, so every tool in it is `readOnlyHint` and none is
 * `consequentialHint`". A browser agent's gate reads exactly that class and runs every one of these
 * seven tools unasked. Until this file no test ran any of their handlers: `tools.test.ts` reads the
 * shell's registrations as source text and calls the library "minus the toast", and nothing loaded
 * the Blocks' file at all. A search that rewrote the sheet it was handed, or a read that moved the
 * view where its description does not say it does, was green on every gate.
 *
 * So `BlocksTools.tsx` is loaded as the app ships it, with stand-ins in front of what it imports:
 * the kit's `useWebMCPTool` records each registration, and the kit's REAL `useZoomTools` registers
 * its four verbs through the same recorder. Each handler is then called through the kit's own
 * execute door (`runTool`), with the arguments an agent would send, against a sheet built from a
 * scratch copy of the seed - never the app's own `data/` file.
 *
 * What a run proves is "on these arguments, no tool here changed the sheet or the database, and
 * each moved the view only the way its description says" - not "cannot", on a branch the seed
 * never takes (mcp-tools/tool-schema-design, "publish them honestly is a test";
 * test-harness/negative-control-tests: the check is shown catching a lying tool below).
 *
 *   node --experimental-transform-types --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

import type { WebMCPToolSpec } from "@athena/demo-kit/webmcp";
import type { ZoomNav } from "@athena/demo-kit/zoom";

import { tempHome } from "./tmp-home";

// Own scratch cwd, own seeded copy: `openDb` resolves the file from `process.cwd()/data`.
tempHome("tidycrm-spatial-model-tools-");

/* ------------------------------------------------------------------- the stand-ins */

const here = (path: string): string => new URL(`../${path}`, import.meta.url).href;
const kit = (path: string): string => new URL(`../../demo-kit/src/${path}`, import.meta.url).href;
const moduleOf = (source: string): string => `data:text/javascript,${encodeURIComponent(source)}`;

const RECORDER = Symbol.for("tidycrm.test.spatialRecorder");
const recorder = `globalThis[Symbol.for("tidycrm.test.spatialRecorder")]`;

/** What a handler call reached: a view setter, the opener, the nav. */
let reached: string[] = [];
const registered = new Map<string, WebMCPToolSpec>();

const record = {
  /** What `useRun`'s transition was handed back by its action, and what it toasted. */
  transition: undefined as Promise<unknown> | undefined,
  toasts: [] as [string, string][],
  register(spec: WebMCPToolSpec) {
    assert.ok(!registered.has(spec.name), `${spec.name} is registered twice`);
    registered.set(spec.name, spec);
  },
};
(globalThis as Record<symbol, unknown>)[RECORDER] = record;

/**
 * `[importer, specifier] -> module`. An importer is matched by URL prefix, so a stand-in applies
 * only to the files named here; everything else, the stand-ins included, gets the real module.
 */
const STAND_INS: [string, string, string][] = [
  // The Blocks' tool files: the kit's hook records, `bounded` and `useZoomTools` are the real ones.
  [
    here("components/blocks/tools/"),
    "@athena/demo-kit/webmcp",
    moduleOf(
      [
        `export { bounded } from ${JSON.stringify(kit("webmcp/bounded.ts"))};`,
        `export { useZoomTools } from ${JSON.stringify(kit("webmcp/zoomTools.ts"))};`,
        `export const useWebMCPTool = (spec) => ${recorder}.register(spec);`,
      ].join("\n"),
    ),
  ],
  // The kit's zoom verbs, run for real: their registration goes to the same recorder.
  [kit("webmcp/zoomTools.ts"), "react", moduleOf("export const useMemo = (make) => make();")],
  [kit("webmcp/zoomTools.ts"), "./hooks", moduleOf(`export const useWebMCPTool = (spec) => ${recorder}.register(spec);`)],
  // `useRun`, outside React: the transition hands back what its action returned, the toast records.
  [
    here("components/blocks/useRun.ts"),
    "react",
    moduleOf(
      [
        "export const useCallback = (fn) => fn;",
        `export const useTransition = () => [false, (action) => { ${recorder}.transition = action(); }];`,
        "export const useState = (v) => [v, () => {}];",
        "export const useRef = (v) => ({ current: v });",
        "export const useEffect = () => {};",
      ].join("\n"),
    ),
  ],
  [
    here("components/blocks/useRun.ts"),
    "@athena/demo-kit/ui",
    moduleOf(`export const useToast = () => ({ toast: (text, tone) => ${recorder}.toasts.push([tone, text]) });`),
  ],
];

registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL ?? "";
    const hit = STAND_INS.find(([scope, spec]) => spec === specifier && parent.startsWith(scope));
    if (hit) return { url: hit[2], shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    // Node has no `.tsx` loader. The registration file renders nothing and holds no JSX, so its
    // types are stripped exactly as a `.ts` file's are; a `.tsx` that does hold JSX still fails.
    if (url.startsWith(here("components/blocks/tools/")) && url.endsWith(".tsx")) {
      const source = stripTypeScriptTypes(readFileSync(new URL(url), "utf8"));
      return { format: "module", source, shortCircuit: true };
    }
    return next(url, context);
  },
});

const { db } = await import("../lib/db");
const { buildSheet } = await import("../lib/blocks");
const { annotationsFor } = await import("@athena/demo-kit/webmcp");
const { runTool } = await import("../../demo-kit/src/webmcp/door");
const { parametersToJsonSchema } = await import("../../demo-kit/src/webmcp/types");
const { BlocksTools } = await import("../components/blocks/tools/BlocksTools");

/* --------------------------------------------------------------------- the page */

const sheet = buildSheet();

type Focus = { level: 0 | 1 | 2; group: string | null; item: string | null };
const focus: Focus = { level: 0, group: null, item: null };
const nav = {
  state: { focus },
  openGroup: (id: string) => {
    reached.push("nav.openGroup");
    Object.assign(focus, { level: 1, group: id, item: null });
  },
  openItem: (group: string, id: string) => {
    reached.push("nav.openItem");
    Object.assign(focus, { level: 2, group, item: id });
  },
  up: () => {
    reached.push("nav.up");
    Object.assign(focus, focus.level === 2 ? { level: 1, item: null } : { level: 0, group: null, item: null });
  },
} as unknown as ZoomNav;

// Mounted the way `Blocks.tsx` mounts it: the opener a click uses, and the breakdown's setter.
BlocksTools({
  sheet,
  nav,
  onOpenDatabase: (id) => {
    reached.push("openDatabase");
    nav.openGroup(id);
  },
  showKinds: false,
  setShowKinds: () => reached.push("setShowKinds"),
});

/* ------------------------------------------------------------- what an agent sends */

const billing = sheet.databases.find((d) => d.id === "billing")!;
const table = billing.tables[0]!;
const someone = table.rows[0]!;

/**
 * One session over the whole surface, in the order an agent might make it: read the plate, open a
 * database, read it, open a table, read it, search, toggle the breakdown, come back out. Every
 * registered tool must appear, so a tool added to the page without a call here fails.
 */
const SESSION: [string, Record<string, unknown>][] = [
  ["read_view", {}],
  ["search_blocks", { awaiting_a_person: true }],
  ["search_blocks", { text: table.domain, deviations_over: 0, coverage_under: 100 }],
  ["search_records", { text: someone.name.split(" ")[0]!, database: "billing" }],
  ["show_breakdown", {}],
  ["show_breakdown", { open: true }],
  ["plan_repairs", {}],
  ["plan_repairs", { kind: "stale", database: "billing", page: 0 }],
  ["open_group", { id: "billing" }],
  ["read_view", {}],
  ["open_item", { id: table.ident }],
  ["read_view", {}],
  ["next_table", { direction: "next" }],
  ["zoom_out", {}],
  ["zoom_out", {}],
];

/**
 * Where each tool may move the view, as its description says. A read reaches nothing; the three
 * movers reach exactly the door a click reaches; the breakdown toggles only when asked to.
 */
const MAY_MOVE: Record<string, string[]> = {
  read_view: [],
  search_blocks: [],
  search_records: [],
  show_breakdown: ["setShowKinds"],
  plan_repairs: [],
  open_group: ["openDatabase", "nav.openGroup"],
  open_item: ["nav.openItem"],
  next_table: ["nav.openItem"],
  zoom_out: ["nav.up"],
};

type Seen = { name: string; answer: Record<string, unknown>; moved: string[]; changed: string[] };

/** The figures that would move if anything wrote: the contacts, their revisions, the activity log. */
const ledger = () =>
  db().get<{ c: number; r: number; a: number }>(
    `SELECT (SELECT COUNT(*) FROM contacts) AS c, (SELECT COUNT(*) FROM revisions) AS r,
            (SELECT COUNT(*) FROM activity) AS a`,
  )!;

/** Call one registered tool the way the page's execute door does, and record what it reached. */
async function drive(spec: WebMCPToolSpec, args: Record<string, unknown>, on = sheet): Promise<Seen> {
  const schema = { ...parametersToJsonSchema(spec.parameters ?? []), type: "object" };
  const sheetBefore = structuredClone(on);
  const ledgerBefore = ledger();
  reached = [];
  const text = await runTool(schema, args, spec.handler);
  const changed: string[] = [];
  try {
    assert.deepEqual(on, sheetBefore);
  } catch {
    changed.push("the sheet");
  }
  try {
    assert.deepEqual(ledger(), ledgerBefore);
  } catch {
    changed.push("the database");
  }
  return { name: spec.name, answer: JSON.parse(text) as Record<string, unknown>, moved: reached, changed };
}

/**
 * Every call whose observed reach differs from what the registration claims: a `readOnlyHint`
 * tool that changed the sheet or the database, a tool that moved the view somewhere its
 * description does not, or a registration whose class is not the read class at all.
 */
function disagreements(seen: Seen[], specs: Map<string, WebMCPToolSpec>): string[] {
  const out = new Set<string>();
  for (const s of seen) {
    const ann = annotationsFor(specs.get(s.name)!);
    if (ann.readOnlyHint !== true || ann.consequentialHint !== false) out.add(`${s.name}: not a read`);
    if (s.changed.length > 0) out.add(`${s.name}: changed ${s.changed.join(" and ")}`);
    const allowed = MAY_MOVE[s.name] ?? [];
    const stray = s.moved.filter((m) => !allowed.includes(m));
    if (stray.length > 0) out.add(`${s.name}: moved ${stray.join(", ")}`);
  }
  return [...out].sort();
}

const seen: Seen[] = [];
for (const [name, args] of SESSION) {
  // A tool the page does not register is caught by the registration case below, not here, so the
  // rest of the session is still driven and the guards still judge what is registered.
  const spec = registered.get(name);
  if (spec) seen.push(await drive(spec, args));
}

/* --------------------------------------------------------------------- the checks */

test("the page registers the kit's four verbs and the Blocks' five, and the session calls each", () => {
  assert.deepEqual(
    [...registered.keys()].sort(),
    [
      "next_table",
      "open_group",
      "open_item",
      "plan_repairs",
      "read_view",
      "search_blocks",
      "search_records",
      "show_breakdown",
      "zoom_out",
    ],
  );
  assert.deepEqual(
    [...registered.keys()].filter((name) => !SESSION.some(([called]) => called === name)),
    [],
    "registered and never driven",
  );
});

test("every call answered, rather than refusing the arguments an agent would send", () => {
  for (const s of seen) {
    assert.notEqual(s.answer.ok, false, `${s.name} refused: ${JSON.stringify(s.answer)}`);
  }
  // The session really did walk the three levels, so read_view's detail was read at each.
  const levels = seen.filter((s) => s.name === "read_view").map((s) => s.answer.level);
  assert.deepEqual(levels, [0, 1, 2]);
});

test("no tool the Blocks register changes the sheet or the database, or moves the view unannounced", () => {
  assert.deepEqual(disagreements(seen, registered), []);
  // The movers did move: an assertion that only ever sees empty reaches proves nothing.
  const movedBy = Object.fromEntries(seen.filter((s) => s.moved.length > 0).map((s) => [s.name, s.moved]));
  assert.deepEqual(movedBy, {
    show_breakdown: ["setShowKinds"],
    open_group: ["openDatabase", "nav.openGroup"],
    open_item: ["nav.openItem"],
    next_table: ["nav.openItem"],
    zoom_out: ["nav.up"],
  });
});

test("coverage_under keeps every table whose printed coverage is at or under it", async () => {
  // The filter and the figure it filters on are one number: a table search_blocks prints at 72
  // must come back for coverage_under 72, or the agent is told it is not there.
  const spec = registered.get("search_blocks")!;
  const dropped: string[] = [];
  for (const t of sheet.databases.flatMap((d) => d.tables)) {
    const { answer } = await drive(spec, { text: t.ident });
    const printed = (answer.items as { id: string; coverage: number }[]).find((i) => i.id === t.ident)!.coverage;
    const { answer: under } = await drive(spec, { text: t.ident, coverage_under: printed });
    if (!(under.items as { id: string }[]).some((i) => i.id === t.ident)) dropped.push(`${t.ident} at ${printed}`);
  }
  assert.deepEqual(dropped, [], "printed at N, missing from coverage_under N");
});

test("a write that throws is toasted and disarms its gate, rather than escaping the transition", async () => {
  // The dossier's buttons run every server action through `useRun`, and the two irreversible ones
  // pass `disarm` as `after`. A thrown action (the database locked, the connection dropped) used
  // to reject inside the transition: no toast, `after` never called, the merge still armed, and
  // React handing the rejection to the error boundary.
  const { useRun } = await import("../components/blocks/useRun");
  const { run } = useRun();
  const after: unknown[] = [];
  const logged: unknown[] = [];
  const log = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    record.toasts = [];
    run(() => Promise.reject(new Error("database is locked")), (result) => after.push(result));
    await record.transition;
  } finally {
    console.error = log;
  }
  assert.equal(record.toasts.length, 1, "the person is told");
  assert.equal(record.toasts[0]![0], "error");
  assert.match(record.toasts[0]![1], /database is locked/);
  assert.equal(after.length, 1, "the gate's after runs, so the irreversible control disarms");
  assert.equal((after[0] as { ok: boolean }).ok, false);
  assert.equal(logged.length, 1, "the developer gets the stack");

  // And an answer still goes the way it always did.
  record.toasts = [];
  run(() => Promise.resolve({ ok: true, summary: "Merged." }), (result) => after.push(result));
  await record.transition;
  assert.deepEqual(record.toasts, [["success", "Merged."]]);
  assert.equal(after.length, 2);
});

test("up and down step a row and never a column, so down then up comes back", async () => {
  // L1's roving focus (`Field.tsx`) walks a database's tables with `gridStep`, three across. A
  // key at an edge is still spent - the rig's own arrows orbit - so where there is no row it stays.
  const { gridStep } = await import("../components/blocks/model");
  const cols = 3;
  const sideways: string[] = [];
  const lost: string[] = [];
  for (let count = 1; count <= 7; count += 1) {
    for (let at = 0; at < count; at += 1) {
      for (const key of ["ArrowUp", "ArrowDown"]) {
        const next = gridStep(key, at, count, cols)!;
        if (next % cols !== at % cols) sideways.push(`${key} from ${at} of ${count} -> ${next}`);
      }
      const down = gridStep("ArrowDown", at, count, cols)!;
      if (down !== at && gridStep("ArrowUp", down, count, cols) !== at) lost.push(`${at} of ${count}`);
    }
  }
  assert.deepEqual(sideways, []);
  assert.deepEqual(lost, [], "down then up did not come back");
  // Left, right, Home and End are unchanged: one step, the ends, nothing off the end.
  assert.equal(gridStep("ArrowRight", 2, 5, cols), 3);
  assert.equal(gridStep("ArrowLeft", 0, 5, cols), 0);
  assert.equal(gridStep("End", 1, 5, cols), 4);
  assert.equal(gridStep("Tab", 1, 5, cols), null);
});

test("the check catches a read that writes, a read that moves, and a write wearing the read class", async () => {
  // Negative controls, through the same drive and the same disagreements, on a copy of the sheet.
  const copy = structuredClone(sheet);
  const real = registered.get("search_blocks")!;
  const liars = new Map<string, WebMCPToolSpec>([
    ["search_blocks", { ...real, handler: () => (copy.databases.pop(), { ok: true }) }],
    ["search_records", { ...registered.get("search_records")!, handler: () => (reached.push("nav.up"), {}) }],
    ["read_view", { ...registered.get("read_view")!, sideEffects: "data" }],
  ]);
  const caught: Seen[] = [];
  for (const [name, spec] of liars) {
    caught.push(await drive(spec, name === "search_records" ? { text: someone.name } : {}, copy));
  }
  assert.deepEqual(disagreements(caught, liars), [
    "read_view: not a read",
    "search_blocks: changed the sheet",
    "search_records: moved nav.up",
  ]);
});

test("plan_repairs pages every stale target on the sheet, each page one whole JSON answer under 12,000 chars", async () => {
  // The dossier's flag button fires on `table.acts.flag.ids`; before this tool no read named them,
  // and an agent saw only the stale rows that fell in a table's six-row sample (68 of 135 on the
  // seed). Walked page by page, the union is every table's list.
  const spec = registered.get("plan_repairs");
  assert.ok(spec, "plan_repairs is registered");
  const want = new Set(sheet.databases.flatMap((d) => d.tables.flatMap((t) => t.acts.flag.ids)));
  assert.ok(want.size > 0, "the seed has stale work");
  const got = new Set<string>();
  const schema = { ...parametersToJsonSchema(spec.parameters ?? []), type: "object" };
  let page = 0;
  for (;;) {
    const text = await runTool(schema, { kind: "stale", page }, spec.handler);
    assert.ok(text.length <= 12_000, `page ${page} is ${text.length} chars`);
    const answer = JSON.parse(text) as {
      page: number;
      next_page: number | null;
      items: { kind: string; table: string; database: string; act: { tool: string; args: { ids: string[] } } }[];
    };
    assert.equal(answer.page, page);
    for (const item of answer.items) {
      assert.equal(item.kind, "stale");
      assert.equal(item.act.tool, "flag_stale");
      for (const id of item.act.args.ids) got.add(id);
    }
    if (answer.next_page === null) break;
    assert.equal(answer.next_page, page + 1);
    page += 1;
    assert.ok(page < 100, "the walk ends");
  }
  assert.deepEqual([...got].sort(), [...want].sort());
  assert.equal(got.size, sheet.databases.flatMap((d) => d.tables).reduce((n, t) => n + t.staleIds.length, 0));
});

test("next_table walks the worklist from the open table, and from L0 opens its head", async () => {
  // The dossier's ] key and the agent's next_table are one walk over `worklistOf(sheet)`: one call
  // instead of search_blocks + open_item, crossing databases through the same nav door.
  const spec = registered.get("next_table");
  assert.ok(spec, "next_table is registered");
  const { worklistOf } = (await import("../components/blocks/model")) as unknown as {
    worklistOf: (s: typeof sheet) => { database: string; ident: string }[];
  };
  const { tableRead } = await import("../components/blocks/tools/read");
  const { ARRIVAL_MS } = await import("../components/blocks/beats");
  const list = worklistOf(sheet);
  const tableBy = (ident: string) => sheet.databases.flatMap((d) => d.tables).find((t) => t.ident === ident)!;
  const calls: [string, string][] = [];
  const openItem = nav.openItem;
  (nav as { openItem: ZoomNav["openItem"] }).openItem = (group, id) => {
    calls.push([group, id]);
    openItem(group, id);
  };
  try {
    // At L2 on the worst table.
    Object.assign(focus, { level: 2, group: list[0]!.database, item: list[0]!.ident });
    const seen = await drive(spec, { direction: "next" });
    assert.deepEqual(calls, [[list[1]!.database, list[1]!.ident]]);
    assert.deepEqual(seen.moved, ["nav.openItem"]);
    assert.deepEqual(seen.changed, []);
    const answer = seen.answer as Record<string, unknown>;
    assert.equal(answer.at, 2);
    assert.equal(answer.of, list.length);
    assert.equal(answer.database, list[1]!.database);
    assert.deepEqual({ ...answer, at: undefined, of: undefined, database: undefined, arrives_in_ms: undefined }, {
      ...tableRead(tableBy(list[1]!.ident)),
      at: undefined,
      of: undefined,
      database: undefined,
      arrives_in_ms: undefined,
    });
    // A database change is a flight and a dress; a step inside one is not.
    assert.equal(answer.arrives_in_ms, list[1]!.database === list[0]!.database ? 0 : ARRIVAL_MS);

    // At L0, nothing open: the head of the list, a flight away.
    calls.length = 0;
    Object.assign(focus, { level: 0, group: null, item: null });
    const fromTop = await drive(spec, {});
    assert.deepEqual(calls, [[list[0]!.database, list[0]!.ident]]);
    assert.equal(fromTop.answer.at, 1);
    assert.equal(fromTop.answer.arrives_in_ms, ARRIVAL_MS);

    // previous from the head: the end, said, and nothing moves.
    calls.length = 0;
    const end = await drive(spec, { direction: "previous" });
    assert.deepEqual(calls, []);
    assert.equal(end.answer.done, true);
  } finally {
    (nav as { openItem: ZoomNav["openItem"] }).openItem = openItem;
    Object.assign(focus, { level: 0, group: null, item: null });
  }
});
