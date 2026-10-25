/**
 * Each reversible act an agent runs on the books toasts its own Undo (ADR 0191).
 *
 * `lib/tool-classes.ts` runs five writes unasked - categorize, match_bank_line, unmatch,
 * draft_reminder, export_summary - because they can be taken back, and `undoAction` could take
 * every one of them back. No surface offered it: `settle` toasted the sentence and nothing else.
 * These cases drive the page's own handlers (the stand-ins of `tool-handlers.test.ts`, with a
 * toaster that keeps the action) against a scratch copy of the books, press the toast's Undo, and
 * read what the books hold afterwards.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { WebMCPToolSpec } from "@athena/demo-kit/webmcp";
import type { ZoomNav } from "@athena/demo-kit/zoom";

import { tempHome } from "./tmp-home";

tempHome("ledgerbox-tools-undo-");

const { db, listInvoices, unappliedCredits } = await import("../lib/db");
const { buildBooks, buildSheet } = await import("../lib/lanes");
const actions = await import("../app/actions");
const { CAPABILITIES } = await import("../lib/manifest");
const { NO_FILTER } = await import("../components/lanes/model");
const { runTool } = await import("../../demo-kit/src/webmcp/door");
const { parametersToJsonSchema } = await import("../../demo-kit/src/webmcp/types");

/* ------------------------------------------------------------------- the stand-ins */

type Toasted = { text: string; tone: string; action?: { label: string; onAction: () => unknown } };

let reached: string[] = [];
let calls: { name: string; args: unknown[] }[] = [];
let toasts: Toasted[] = [];
const registered = new Map<string, WebMCPToolSpec>();

const RECORDER = Symbol.for("ledgerbox.test.recorder");
(globalThis as Record<symbol, unknown>)[RECORDER] = {
  register(spec: WebMCPToolSpec) {
    registered.set(spec.name, spec);
  },
  zoom() {},
  router: { refresh: () => reached.push("router.refresh") },
  toaster: {
    toast: (text: string, tone: string, action?: Toasted["action"]) => {
      reached.push(`toast:${tone}`);
      toasts.push(action ? { text, tone, action } : { text, tone });
    },
  },
  act(name: string, args: unknown[]) {
    reached.push(`act:${name}`);
    calls.push({ name, args });
    return (actions as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args);
  },
};

const moduleOf = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const recorder = `globalThis[Symbol.for("ledgerbox.test.recorder")]`;
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

const nav = {
  state: { focus: { level: 0, group: null, item: null } },
  home: () => {},
  openGroup: () => {},
  openItem: () => {},
  up: () => {},
} as unknown as ZoomNav;

/** Mount the tools on the books as they are NOW - the re-render a refresh would cause. */
function mount(): void {
  registered.clear();
  BooksTools({
    sheet: buildSheet(),
    books: buildBooks(),
    nav,
    filter: NO_FILTER,
    setFilter: () => {},
    picked: [],
    setPicked: () => {},
    period: "2026-08",
    setPeriod: () => {},
  });
}
mount();

async function drive(name: string, args: Record<string, unknown>): Promise<string> {
  const spec = registered.get(name)!;
  const schema = { ...parametersToJsonSchema(spec.parameters ?? []), type: "object" };
  reached = [];
  calls = [];
  toasts = [];
  return runTool(schema, args, spec.handler);
}

/** Press the newest toast's action and wait for what it set going. */
async function press(toast: Toasted | undefined): Promise<void> {
  assert.ok(toast?.action, `the toast carries an action: ${JSON.stringify(toast)}`);
  reached = [];
  calls = [];
  toasts = [];
  await toast.action.onAction();
}

const newest = (action: string) =>
  db().get<{ id: number }>("SELECT id FROM activity WHERE action = ? ORDER BY id DESC LIMIT 1", [action])!.id;
const categoryOf = (id: string) =>
  db().get<{ category: string }>("SELECT category FROM invoices WHERE id = ?", [id])!.category;
const activityCount = () => db().get<{ n: number }>("SELECT COUNT(*) AS n FROM activity")!.n;

/* ------------------------------------------------------------------------ cases */

test("case 1: categorize toasts Undo, and the press undoes its own row and refreshes the tree", async () => {
  const pair = listInvoices()
    .filter((r) => r.category !== "retainer")
    .slice(0, 2);
  const prior = pair.map((r) => r.category);
  const answer = await drive("categorize", { ids: pair.map((r) => r.id), category: "retainer" });
  assert.ok(!answer.startsWith('{"ok":false'), answer);
  const row = newest("categorize");
  const toast = toasts.at(-1);
  assert.equal(toast?.action?.label, "Undo", `the toast: ${JSON.stringify(toast)}`);

  await press(toast);
  assert.deepEqual(calls, [{ name: "undoAction", args: [row] }], "the press undoes the categorize row");
  assert.deepEqual(
    pair.map((r) => categoryOf(r.id)),
    prior,
    "both invoices are back in their prior categories",
  );
  assert.ok(reached.includes("router.refresh"), `the press refreshes: ${reached.join(", ")}`);
});

test("case 2: match_bank_line toasts Undo, and the press lifts the match and its payment", async () => {
  mount();
  const credit = unappliedCredits().find((c) => !c.ambiguous && c.suggestions.length > 0)!;
  const invoiceId = credit.suggestions[0]!.invoice_id;
  const answer = await drive("match_bank_line", { invoice_id: invoiceId, line_id: credit.line.id });
  assert.ok(!answer.startsWith('{"ok":false'), answer);
  await press(toasts.at(-1));

  const match = db().get("SELECT 1 FROM matches WHERE line_id = ?", [credit.line.id]);
  assert.equal(match, undefined, "the match is gone");
  const payment = db().get("SELECT 1 FROM payments WHERE id = ?", [`pay_match_${credit.line.id}`]);
  assert.equal(payment, undefined, "its payment row is gone");

  mount();
  const read = JSON.parse(await drive("read_credits", { only: "unambiguous" })) as {
    items: { line_id: string }[];
  };
  assert.ok(
    read.items.some((c) => c.line_id === credit.line.id),
    "read_credits lists the line again",
  );
});

test("case 3: every AUTO write answers its undoId, the activity row it logged; the gated acts none", async () => {
  const rows = listInvoices();
  const chase = rows.find((r) => r.state === "overdue" && !r.has_draft_reminder)!;
  const voidable = rows.find((r) => r.state === "overdue" && r.paid_cents === 0 && r.id !== chase.id)!;
  const payable = rows.find((r) => r.state === "partial")!;
  const credit = unappliedCredits().find((c) => !c.ambiguous && c.suggestions.length > 0)!;
  const seeded = db().get<{ invoice_id: string; line_id: string }>(
    `SELECT m.invoice_id, m.line_id FROM matches m JOIN invoices i ON i.id = m.invoice_id
     WHERE i.status = 'sent' ORDER BY m.line_id LIMIT 1`,
  )!;

  const auto: [string, () => Promise<{ ok: boolean; message: string; undoId?: number }>][] = [
    ["categorize", () => actions.categorizeAction([chase.id], "consulting")],
    ["match_bank_line", () => actions.matchAction(credit.suggestions[0]!.invoice_id, credit.line.id)],
    ["unmatch", () => actions.unmatchAction(seeded.invoice_id, seeded.line_id)],
    ["draft_reminder", () => actions.draftReminderAction(chase.id, "gentle")],
    ["export_summary", () => actions.exportSummaryAction("2026-08")],
  ];
  for (const [action, act] of auto) {
    const result = await act();
    assert.equal(result.ok, true, `${action}: ${result.message}`);
    assert.equal(result.undoId, newest(action), `${action} answers the id of the row it logged`);
  }

  const gated: [string, () => Promise<{ ok: boolean; message: string; undoId?: number }>][] = [
    ["mark_paid", () => actions.markPaidAction(payable.id, 100)],
    ["send_reminder", () => actions.sendReminderAction(chase.id)],
    ["void_invoice", () => actions.voidInvoiceAction(voidable.id)],
  ];
  for (const [action, act] of gated) {
    const result = await act();
    assert.equal(result.ok, true, `${action}: ${result.message}`);
    assert.equal(result.undoId, undefined, `${action} carries no undo`);
  }
});

test("case 4: the undo of a draft since sent refuses, writes nothing, and the press toasts the reason", async () => {
  mount();
  const chase = listInvoices().find((r) => r.state === "overdue" && !r.has_draft_reminder && r.balance_cents > 0)!;
  await drive("draft_reminder", { id: chase.id, tone: "firm" });
  const draftToast = toasts.at(-1);
  const draftRow = newest("draft_reminder");
  const sent = await drive("send_reminder", { id: chase.id });
  assert.ok(!sent.startsWith('{"ok":false'), sent);
  const reminder = db().get<{ id: string }>(
    "SELECT id FROM reminders WHERE invoice_id = ? AND sent_at IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    [chase.id],
  )!;

  const before = activityCount();
  const answer = await actions.undoAction(draftRow);
  assert.equal(answer.ok, false, JSON.stringify(answer));
  assert.match(String(answer.reason), /already sent/);
  const still = db().get<{ sent_at: string | null }>("SELECT sent_at FROM reminders WHERE id = ?", [reminder.id]);
  assert.ok(still?.sent_at, "the reminder stays sent");
  assert.equal(activityCount(), before, "no 'Undid' row is written");

  await press(draftToast);
  const said = toasts.at(-1);
  assert.equal(said?.tone, "error", `the press says: ${JSON.stringify(said)}`);
  assert.match(String(said?.text), /already sent/);
  assert.equal(said?.action, undefined, "a refusal carries no action");
  assert.equal(activityCount(), before, "and the press wrote nothing either");
});

test("case 5: toastFor is decided by the class table, not by the presence of an id", async () => {
  const { toastFor } = await import("../components/lanes/tools/undo");
  for (const tool of ["mark_paid", "void_invoice", "send_reminder"]) {
    const spec = toastFor(tool, { ok: true, message: "Done.", undoId: 7 });
    assert.equal(spec.action, undefined, `${tool} earns no Undo`);
    assert.equal(spec.tone, "success");
  }
  for (const tool of ["categorize", "match_bank_line", "unmatch", "draft_reminder", "export_summary"]) {
    assert.deepEqual(toastFor(tool, { ok: true, message: "Done.", undoId: 7 }).action, { label: "Undo", id: 7 }, tool);
    assert.equal(toastFor(tool, { ok: true, message: "Done." }).action, undefined, `${tool} with no id`);
  }
});

test("case 6 (guard): a refused write toasts an error with no action", async () => {
  mount();
  const target = listInvoices().find((r) => r.state === "overdue")!;
  const answer = await drive("match_bank_line", { invoice_id: target.id, line_id: "no_such_line" });
  assert.match(answer, /"ok":false/);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0]!.tone, "error");
  assert.equal(toasts[0]!.action, undefined);
});

test("case 7 (guard): the agent's answers carry no undo id, and the model gains no undo verb", async () => {
  mount();
  const rows = listInvoices();
  const chase = rows.find((r) => r.state === "overdue" && !r.has_draft_reminder && r.balance_cents > 0)!;
  const credit = unappliedCredits().find((c) => !c.ambiguous && c.suggestions.length > 0)!;
  const answers = [
    await drive("categorize", { ids: [chase.id], category: "design" }),
    await drive("match_bank_line", { invoice_id: credit.suggestions[0]!.invoice_id, line_id: credit.line.id }),
    await drive("draft_reminder", { id: chase.id, tone: "gentle" }),
    await drive("export_summary", { period: "2026-08" }),
  ];
  for (const answer of answers) {
    assert.ok(!answer.startsWith('{"ok":false'), answer);
    assert.ok(!/undo/i.test(answer), `the answer names no undo: ${answer.slice(0, 160)}`);
  }
  assert.deepEqual(
    CAPABILITIES.map((c) => c.name).filter((n) => /undo/i.test(n)),
    [],
    "no undo verb in the manifest",
  );
  assert.ok(![...registered.keys()].some((n) => /undo/i.test(n)), "and none registered");
});

test("case 8 (guard): an undo of a row already undone refuses", async () => {
  const target = listInvoices().find((r) => r.category !== "reimbursable")!;
  await actions.categorizeAction([target.id], "reimbursable");
  const row = newest("categorize");
  assert.equal((await actions.undoAction(row)).ok, true);
  const again = await actions.undoAction(row);
  assert.equal(again.ok, false);
  assert.match(String(again.reason), /already undone/);
});
