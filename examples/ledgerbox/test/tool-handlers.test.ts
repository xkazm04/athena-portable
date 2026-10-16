/**
 * Every tool the page registers, driven through its OWN handler, against what its class claims.
 *
 * `lib/tool-classes.ts` is what a browser agent's gate reads: a read is `readOnlyHint` and runs
 * unasked, a reversible write runs unasked too, and only the three irreversible acts stop for a
 * person. The class is published by the HANDLER's registration, not by the server action behind
 * it - and until this file no test ever ran a handler. `ledgerbox-domain-lib.test.ts` drives the
 * eight acts straight through `app/actions.ts`; `tools.test.ts` reads the manifest. Neither would
 * notice `read_invoice` calling `voidInvoiceAction`, or `categorize` registered under
 * `registration("mark_paid")`: the first is a read a trusting host auto-approves that writes, the
 * second a write wearing another tool's class. Both are the dangerous direction, and both were
 * green on every gate.
 *
 * So the two registration files are loaded as the app ships them, with stand-ins in front of what
 * they import (`test/register.mjs`): the kit's `useWebMCPTool` records each registration, the
 * server actions are wrapped so every call is recorded before it runs for real against a scratch
 * copy of the books, and the router, the toast and the view setters only record. Each handler is
 * then called through the kit's own execute door, with the arguments an agent would send.
 *
 * What a run proves is "on these arguments, no read reached an act, and every write reached
 * exactly its own act, which logged the class the table declares" - not "this tool cannot write"
 * on a branch the seeded books never take (mcp-tools/tool-schema-design, "publish them honestly
 * is a test").
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ZoomNav } from "@athena/demo-kit/zoom";

import type { WebMCPToolSpec } from "@athena/demo-kit/webmcp";

import { tempHome } from "./tmp-home";

// Own scratch cwd, own seeded copy: `openDb` resolves the file from `process.cwd()/data`.
tempHome("ledgerbox-tool-handlers-");

const { db, listInvoices, unappliedCredits } = await import("../lib/db");
const { buildBooks, buildSheet } = await import("../lib/lanes");
const actions = await import("../app/actions");
const { TOOL_CLASSES } = await import("../lib/tool-classes");
const { CAPABILITIES, registration } = await import("../lib/manifest");
const { NO_FILTER } = await import("../components/lanes/model");
const { runTool } = await import("../../demo-kit/src/webmcp/door");
const { parametersToJsonSchema } = await import("../../demo-kit/src/webmcp/types");

type Name = keyof typeof TOOL_CLASSES;
type Class = { reversible: boolean; sideEffects: string };

/* ------------------------------------------------------------------- the stand-ins */

/** What one handler call reached: server actions, the router's refresh, a toast, a view setter. */
let reached: string[] = [];
const registered = new Map<string, WebMCPToolSpec>();
let zoomVerbsMounted = 0;

const RECORDER = Symbol.for("ledgerbox.test.recorder");
(globalThis as Record<symbol, unknown>)[RECORDER] = {
  register(spec: WebMCPToolSpec) {
    assert.ok(!registered.has(spec.name), `${spec.name} is registered twice`);
    registered.set(spec.name, spec);
  },
  zoom() {
    zoomVerbsMounted += 1;
  },
  router: { refresh: () => reached.push("router.refresh") },
  toaster: { toast: () => reached.push("toast") },
  act(name: string, args: unknown[]) {
    reached.push(`act:${name}`);
    return (actions as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args);
  },
};

const moduleOf = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const recorder = `globalThis[Symbol.for("ledgerbox.test.recorder")]`;
// Every server action the module exports, read off the module rather than listed by hand.
const actionNames = Object.keys(actions).filter(
  (k) => typeof (actions as Record<string, unknown>)[k] === "function",
);
const kitWebmcp = import.meta.resolve("@athena/demo-kit/webmcp");

(globalThis as Record<symbol, unknown>)[Symbol.for("ledgerbox.test.standIns")] = {
  scope: new URL("../components/lanes/tools/", import.meta.url).href,
  modules: {
    react: moduleOf("export const useMemo = (make) => make();"),
    "next/navigation": moduleOf(`export const useRouter = () => ${recorder}.router;`),
    "@athena/demo-kit/ui": moduleOf(`export const useToast = () => ${recorder}.toaster;`),
    "@athena/demo-kit/webmcp": moduleOf(
      [
        `export { bounded, boundedPage, PAGE } from ${JSON.stringify(new URL("bounded.ts", kitWebmcp).href)};`,
        `export const useWebMCPTool = (spec) => ${recorder}.register(spec);`,
        `export const useZoomTools = (spec) => ${recorder}.zoom(spec);`,
      ].join("\n"),
    ),
    "@/app/actions": moduleOf(
      actionNames
        .map((n) => `export const ${n} = (...a) => ${recorder}.act(${JSON.stringify(n)}, a);`)
        .join("\n"),
    ),
  },
};

const { BooksTools } = await import("../components/lanes/tools/BooksTools");
const { LanesTools } = await import("../components/lanes/tools/LanesTools");

/* --------------------------------------------------------------------- the page */

const sheet = buildSheet();
const books = buildBooks();
const nav = {
  state: { focus: { level: 0, group: null, item: null } },
  home: () => reached.push("nav.home"),
  openGroup: () => reached.push("nav.openGroup"),
  openItem: () => reached.push("nav.openItem"),
  up: () => reached.push("nav.up"),
} as unknown as ZoomNav;
const view = {
  setFilter: () => reached.push("view.setFilter"),
  setPicked: () => reached.push("view.setPicked"),
  setPeriod: () => reached.push("view.setPeriod"),
};

// Both files, mounted together, the way `Lanes.tsx` mounts them on the one shipped route.
LanesTools({ sheet, nav, filter: NO_FILTER, setFilter: view.setFilter });
BooksTools({ sheet, books, nav, filter: NO_FILTER, picked: [], period: "2026-08", ...view });

/** The four verbs `useZoomTools` registers inside the kit, with the class the kit's source gives them. */
const KIT_VERBS = ["read_view", "open_group", "open_item", "zoom_out"];

/* ------------------------------------------------------------- what an agent sends */

const rows = listInvoices();
const credit = unappliedCredits().find((c) => !c.ambiguous && c.suggestions.length > 0)!;
const creditFor = credit.suggestions[0]!.invoice_id;
const chase = rows.find((r) => r.state === "overdue" && !r.has_draft_reminder && r.id !== creditFor)!;
const voidable = rows.find(
  (r) => r.state === "overdue" && r.paid_cents === 0 && ![chase.id, creditFor].includes(r.id),
)!;
const payable = rows.find((r) => r.state === "partial" && ![chase.id, creditFor].includes(r.id))!;
const seeded = db().get<{ invoice_id: string; line_id: string }>(
  `SELECT m.invoice_id, m.line_id FROM matches m JOIN invoices i ON i.id = m.invoice_id
   WHERE i.status = 'sent' ORDER BY m.line_id LIMIT 1`,
)!;

/**
 * One plausible call per tool the page registers, in the order a session might make them: the
 * reads and view moves first, then the writes (the draft before the send it is for). Its keys are
 * checked against the registrations below, so a tool added to the page without a call here fails.
 */
const CALLS: Record<string, Record<string, unknown>> = {
  search_invoices: { state: "overdue", overdue_by: 30 },
  set_filter: { state: "disputed" },
  read_books: {},
  read_inbox: { filter: "overdue", page: 0 },
  read_invoice: { id: chase.number },
  read_credits: { only: "ambiguous" },
  read_clients: {},
  navigate: { view: "overdue" },
  open_invoice: { id: chase.id },
  select: { ids: [chase.id, voidable.number] },
  set_period: { period: "2026-07" },
  categorize: { ids: [chase.id], category: "consulting" },
  match_bank_line: { invoice_id: creditFor, line_id: credit.line.id },
  unmatch: { invoice_id: seeded.invoice_id, line_id: seeded.line_id },
  draft_reminder: { id: chase.id, tone: "gentle" },
  export_summary: { period: "2026-08" },
  mark_paid: { id: payable.id, amount: 1 },
  send_reminder: { id: chase.id },
  void_invoice: { id: voidable.id },
};

type Seen = { acts: string[]; rows: { action: string; reversible: boolean }[]; answer: string };

const newestActivity = () =>
  db().get<{ n: number }>("SELECT COALESCE(MAX(id), 0) AS n FROM activity")!.n;

/** Call one registered tool the way the page's execute door does, and record what it reached. */
async function drive(name: string, args: Record<string, unknown>): Promise<Seen> {
  const spec = registered.get(name)!;
  const schema = { ...parametersToJsonSchema(spec.parameters ?? []), type: "object" };
  const before = newestActivity();
  reached = [];
  const answer = await runTool(schema, args, spec.handler);
  const written = db().all<{ action: string; reversible: number; undo_json: string | null }>(
    "SELECT action, reversible, undo_json FROM activity WHERE id > ? ORDER BY id",
    [before],
  );
  return {
    acts: reached.filter((r) => r.startsWith("act:")),
    rows: written.map((w) => ({ action: w.action, reversible: w.reversible === 1 && w.undo_json !== null })),
    answer,
  };
}

/**
 * Every tool whose observed reach differs from its declared class. A read reaches no act and
 * writes no row; a write reaches exactly one act, which logs one row under the tool's own name,
 * as reversible (with an undo) as the class says.
 */
function disagreements(classes: Record<string, Class>, seen: Record<string, Seen>): string[] {
  return Object.entries(seen)
    .filter(([name, s]) => {
      const declared = classes[name]!;
      if (declared.sideEffects === "none") return s.acts.length > 0 || s.rows.length > 0;
      const row = s.rows[0];
      return s.acts.length !== 1 || s.rows.length !== 1 || row!.action !== name || row!.reversible !== declared.reversible;
    })
    .map(([name]) => name)
    .sort();
}

/* ------------------------------------------------------------------------ tests */

test("the page registers exactly the manifest, each tool under its own name's class and parameters", () => {
  const names = [...registered.keys()];
  assert.equal(zoomVerbsMounted, 1, "the kit's four zoom verbs are mounted once");
  assert.deepEqual(
    [...names, ...KIT_VERBS].sort(),
    CAPABILITIES.map((c) => c.name).sort(),
    "what the two files register, plus the kit's verbs, is the manifest",
  );
  for (const [name, spec] of registered) {
    // `name` and `...registration(...)` are two statements at one call site; a mismatch would
    // publish one tool's class under another tool's name.
    const declared = registration(name as Name);
    assert.deepEqual(
      { reversible: spec.reversible, sideEffects: spec.sideEffects, parameters: spec.parameters },
      { reversible: declared.reversible, sideEffects: declared.sideEffects, parameters: declared.parameters },
      `${name} is registered with its own class and parameters`,
    );
  }
  assert.deepEqual(Object.keys(CALLS).sort(), [...names].sort(), "every registered tool has a call below");
});

test("every handler reaches only what its class allows: reads no act, each write its own act", async () => {
  const seen: Record<string, Seen> = {};
  for (const [name, args] of Object.entries(CALLS)) seen[name] = await drive(name, args);

  // The calls are real, so a refusal would leave a write "honest" by having done nothing.
  for (const [name, s] of Object.entries(seen)) {
    assert.ok(!s.answer.startsWith('{"ok":false'), `${name} answered ${s.answer}`);
  }
  assert.deepEqual(disagreements(TOOL_CLASSES, seen), []);

  // The negative control, in both directions: a table that calls an act a read, and one that
  // calls a read a write, are each caught on the tool they lie about.
  const lying = {
    ...TOOL_CLASSES,
    mark_paid: { reversible: true, sideEffects: "none" },
    read_invoice: { reversible: false, sideEffects: "data" },
  };
  assert.deepEqual(disagreements(lying, seen), ["mark_paid", "read_invoice"], "a lying table is caught");
});
