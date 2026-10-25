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
/** What `useZoomTools` was handed, so `read_view` can be read the way the kit's verb reads it. */
let zoomSpec: { detail: () => unknown } | null = null;
/** The one server action that throws instead of answering, when a test asks for it. */
let breaks: string | null = null;
/** Every server action call a handler made, with the arguments it passed. */
let calls: { name: string; args: unknown[] }[] = [];

const RECORDER = Symbol.for("ledgerbox.test.recorder");
(globalThis as Record<symbol, unknown>)[RECORDER] = {
  register(spec: WebMCPToolSpec) {
    assert.ok(!registered.has(spec.name), `${spec.name} is registered twice`);
    registered.set(spec.name, spec);
  },
  zoom(spec: { detail: () => unknown }) {
    zoomVerbsMounted += 1;
    zoomSpec = spec;
  },
  router: { refresh: () => reached.push("router.refresh") },
  toaster: { toast: (_text: string, tone: string) => reached.push(`toast:${tone}`) },
  act(name: string, args: unknown[]) {
    reached.push(`act:${name}`);
    calls.push({ name, args });
    if (breaks === name) return Promise.reject(new Error("database is locked"));
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

type Seen = {
  acts: string[];
  rows: { action: string; reversible: boolean }[];
  answer: string;
  /** Everything else the call reached: the view setters, the router, the toast. */
  moved: string[];
};

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
    moved: reached.filter((r) => !r.startsWith("act:")),
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

/* ------------------------------------------------------------- a refusal is one */

test("a refusal answers { ok: false, error } on every tool that can refuse, as the kit's door does", async () => {
  // The door refuses a bad argument as `{"ok":false,"error":...}` (`toolError`), and `navigate`,
  // `open_invoice`, `set_filter` and the kit's zoom verbs answer their own refusals the same way.
  // A tool that answers a refusal as a bare sentence reads, to a caller and to anything that keeps
  // its answers, exactly like a success (mcp-tools/tool-schema-design, two error channels).
  const stranger = "INV-118";
  const refusals: Record<string, Record<string, unknown>> = {
    set_filter: { client: "nobody" },
    search_invoices: { area: "nowhere" },
  };
  // Every tool that takes an invoice reference is asked about one that is not in the books; the
  // set is read off the registrations, so a new invoice-taking tool joins it without an edit here.
  for (const [name, spec] of registered) {
    const params = new Map((spec.parameters ?? []).map((p) => [p.name, p]));
    if (params.has("ids") && name !== "select") refusals[name] = { ids: [stranger], category: "design" };
    if (params.has("id")) refusals[name] = { id: stranger, ...(params.has("tone") ? { tone: "gentle" } : {}), ...(params.has("amount") ? { amount: 1 } : {}) };
    if (params.has("invoice_id")) refusals[name] = { invoice_id: stranger, line_id: credit.line.id };
  }
  assert.ok(Object.keys(refusals).length >= 11, `${Object.keys(refusals).length} tools can refuse`);

  const bare: string[] = [];
  for (const [name, args] of Object.entries(refusals)) {
    const { answer } = await drive(name, args);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(answer);
    } catch {
      /* a bare sentence */
    }
    const shaped = parsed as { ok?: unknown; error?: unknown } | null;
    if (!(shaped && shaped.ok === false && typeof shaped.error === "string" && shaped.error.length > 0)) {
      bare.push(`${name}: ${answer.slice(0, 80)}`);
    }
  }
  assert.deepEqual(bare, [], "every refusal carries ok: false and the sentence under error");
});

test("a select whose every reference is unknown refuses, and the ticks a person made stand", async () => {
  // An empty list is the documented way to clear the tick. A list in which nothing resolves is a
  // caller's mistake (a stale id, a misread number), and it used to clear the tick all the same:
  // `setPicked([])`, answered with "Ticked 0 of 2 requested" - the person's working set gone on a
  // typo, under a sentence that reads as a count rather than as a refusal.
  const stray = await drive("select", { ids: ["INV-118", "LB-1999-0001"] });
  assert.ok(!stray.moved.includes("view.setPicked"), `the ticks were touched: ${stray.moved.join(", ")}`);
  const parsed = JSON.parse(stray.answer) as { ok?: boolean; error?: string };
  assert.equal(parsed.ok, false, stray.answer);
  assert.match(String(parsed.error), /INV-118|LB-2026-0002/);

  // The two things that do move it still do: a list with one real invoice, and the empty list.
  const mixed = await drive("select", { ids: ["INV-118", chase.number] });
  assert.ok(mixed.moved.includes("view.setPicked"));
  assert.match(mixed.answer, /Ticked 1 of 2 requested; 1 not in the books/);
  const cleared = await drive("select", { ids: [] });
  assert.ok(cleared.moved.includes("view.setPicked"));
  assert.match(cleared.answer, /Ticked 0 of 0/);
});

test("an act that throws still tells the person watching the page, not only the agent", async () => {
  // The door turns a handler's throw into the agent's answer (`tool failed: ...`). The page used
  // to say nothing: `settle` toasted and refreshed only after the action answered, so a write that
  // threw left the person with no toast and a sheet that was never re-read.
  const target = rows.find((r) => r.state === "open")!;
  breaks = "categorizeAction";
  try {
    const crashed = await drive("categorize", { ids: [target.id], category: "design" });
    assert.match(crashed.answer, /"ok":false.*tool failed: database is locked/);
    assert.ok(crashed.moved.includes("toast:error"), `the person saw: ${crashed.moved.join(", ") || "nothing"}`);
    assert.ok(crashed.moved.includes("router.refresh"), "and the sheet is re-read from the books");
  } finally {
    breaks = null;
  }
});

/* ------------------------------------------------- one invoice, one reading (ADR) */

const { companyDomain } = await import("@athena/demo-kit/seed");

/** The demo's one late invoice that is mostly paid: chasing it is the wrong move. */
const QUIET = "LB-2026-0920";

/** The keys every invoice-returning tool carries, with one value per invoice whichever tool says it. */
const CORE = [
  "id", "number", "client", "client_domain", "category", "state", "due_at", "days_overdue",
  "amount", "paid", "balance", "paid_ratio", "mostly_paid", "candidates", "reminders_sent",
  "has_draft_reminder", "contact_name", "contact_email",
] as const;

type Item = Record<string, unknown>;
const json = async (name: string, args: Record<string, unknown>) => JSON.parse((await drive(name, args)).answer);
const coreOf = (item: Item) => Object.fromEntries(CORE.map((k) => [k, item[k]]));

/** Every row read_inbox answers for a filter, page by page, as an agent would walk it. */
async function inbox(filter: string): Promise<{ pages: Item[]; items: Item[] }> {
  const pages: Item[] = [];
  const items: Item[] = [];
  for (let page = 0; page < 20; page += 1) {
    const env = await json("read_inbox", { filter, page });
    pages.push(env);
    items.push(...(env.items as Item[]));
    if (items.length >= env.of) break;
  }
  return { pages, items };
}

/** What the kit's `read_view` verb would answer at a focus. */
function readView(focus: { level: number; group: string | null; item: string | null }): Item {
  (nav.state as { focus: unknown }).focus = focus;
  try {
    return zoomSpec!.detail() as Item;
  } finally {
    (nav.state as { focus: unknown }).focus = { level: 0, group: null, item: null };
  }
}

test("search_invoices for overdue says the mostly-paid late invoice is mostly paid", async () => {
  const found = await json("search_invoices", { state: "overdue", text: QUIET });
  const quiet = (found.items as Item[]).find((i) => i.number === QUIET);
  assert.ok(quiet, `${QUIET} is overdue and found`);
  assert.equal(quiet.mostly_paid, true);
  assert.equal(quiet.paid_ratio, 0.8);
});

test("every invoice-returning tool carries the same core for one invoice", async () => {
  const id = rows.find((r) => r.number === QUIET)!.id;
  const lane = sheet.lanes.find((l) => l.marks.some((m) => m.id === id))!.id;

  const fromInbox = (await inbox("overdue")).items.find((i) => i.id === id)!;
  const fromInvoice = (await json("read_invoice", { id: QUIET })).invoice as Item;
  const fromSearch = ((await json("search_invoices", { state: "overdue", text: QUIET })).items as Item[]).find(
    (i) => i.id === id,
  )!;
  const fromL1 = (readView({ level: 1, group: lane, item: null }).invoices as Item[]).find((i) => i.id === id)!;
  const fromL2 = readView({ level: 2, group: lane, item: id });

  const projections = { read_inbox: fromInbox, read_invoice: fromInvoice, search_invoices: fromSearch, read_view_L1: fromL1, read_view_L2: fromL2 };
  for (const [name, item] of Object.entries(projections)) {
    assert.ok(item, `${name} lists ${QUIET}`);
    const missing = CORE.filter((k) => !(k in item));
    assert.deepEqual(missing, [], `${name} carries every core key`);
    assert.deepStrictEqual(coreOf(item), coreOf(fromInbox), `${name} says what read_inbox says`);
  }
  assert.equal(fromInbox.client_domain, "solstice-partners.example");
});

test("read_inbox carries the cross-app key on every row", async () => {
  const { items } = await inbox("overdue");
  assert.ok(items.length > 0);
  const wrong = items.filter((i) => i.client_domain !== companyDomain(String(i.client))).map((i) => i.number);
  assert.deepEqual(wrong, [], "client_domain is companyDomain(client) on every row");
});

test("guard: read_inbox keeps its envelope and order, search_invoices its area and its refusals", async () => {
  const { pages, items } = await inbox("overdue");
  for (const env of pages) {
    for (const key of ["showing", "of", "page", "filter"]) assert.ok(key in env, `the envelope keeps ${key}`);
  }
  const days = items.map((i) => Number(i.days_overdue));
  assert.deepEqual(days, [...days].sort((a, b) => b - a), "worst first");

  const all = await json("search_invoices", { state: "overdue" });
  for (const item of all.items as Item[]) {
    assert.equal(typeof item.area, "string", `${item.number} names its area`);
    assert.equal(typeof item.area_label, "string", `${item.number} names its area's label`);
  }
  const noState = await json("search_invoices", { state: "settled" });
  assert.equal(noState.ok, false);
  // The enum is in the schema, so the kit's door refuses it before the handler runs, naming the
  // states it would have taken; `searchLanes`' own refusal is pinned in tools.test.ts.
  assert.match(String(noState.error), /settled/);
  assert.match(String(noState.error), /overdue/);
  const noArea = await json("search_invoices", { area: "nowhere" });
  assert.equal(noArea.ok, false);
  assert.match(String(noArea.error), /No area called nowhere/);
  assert.ok(Array.isArray(noArea.areas));
});

/* ------------------------------------------- a send names the draft it was approved on */

test("send_reminder passes reminder_id through when given, and sends as before without it", async () => {
  // Two untouched overdue invoices a draft can be written for (a credit in the statement refuses
  // the draft on some, ADR 0197), each with its draft.
  const used = new Set([chase.id, voidable.id, payable.id, creditFor]);
  const ready: { id: string; draft: { reminder_id: string; subject: string } }[] = [];
  for (const r of rows.filter((r) => r.state === "overdue" && !r.has_draft_reminder && !used.has(r.id)).reverse()) {
    if (ready.length === 2) break;
    const answer = JSON.parse((await drive("draft_reminder", { id: r.id, tone: "gentle" })).answer) as {
      draft?: { reminder_id: string; subject: string };
    };
    if (answer.draft) ready.push({ id: r.id, draft: answer.draft });
  }
  const [withId, without] = ready;
  assert.ok(withId && without, "two chaseable overdue invoices");

  calls = [];
  const named = await drive("send_reminder", { id: withId.id, reminder_id: withId.draft.reminder_id });
  assert.deepEqual(calls, [{ name: "sendReminderAction", args: [withId.id, "athena", withId.draft.reminder_id] }]);
  assert.equal((JSON.parse(named.answer) as { subject: string }).subject, withId.draft.subject);

  calls = [];
  const plain = await drive("send_reminder", { id: without.id });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.args.slice(0, 2), [without.id, "athena"]);
  assert.equal(calls[0]!.args[2], undefined, "no reminder id is invented");
  assert.equal((JSON.parse(plain.answer) as { ok: boolean }).ok, true, plain.answer);
});
