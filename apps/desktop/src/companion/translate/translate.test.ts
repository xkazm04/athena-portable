/**
 * The translator, pinned on the six recorded sessions the athena-mini-window contest was built on
 * (`sessions.fixture.json`: the run store's own entry shape, tool output as raw JSON, `OP:` and
 * `TTS:` lines in her text). The port was checked line for line against the winner's `translator.js`
 * before these sentences were written down.
 */
import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import type { TranscriptEntry } from "@/stores/run";

import { describeDecision } from "./decision";
import { EMPTY_CONTEXT, buildContext, describeRunning, prettyRaw, translate, translateAll, type PlainMessage } from "./index";
import { parseTool } from "./words";
import data from "./sessions.fixture.json";

interface Session {
  id: string;
  entries: Omit<TranscriptEntry, "id">[];
  cards: { action: string; params: Record<string, unknown>; identity?: string }[];
}

const sessions = (data as { sessions: Session[] }).sessions;
const entriesOf = (s: Session): TranscriptEntry[] => s.entries.map((e, i) => ({ ...e, id: `${s.id}-${i}` }));
const session = (id: string) => {
  const s = sessions.find((x) => x.id === id);
  if (!s) throw new Error(`no session ${id}`);
  return { s, entries: entriesOf(s), messages: translateAll(entriesOf(s)) };
};
const shown = (m: PlainMessage) => [m.title, m.sub, JSON.stringify(m.detail)].join(" ");

test("no message a person reads carries JSON, a proposal line, a spoken line or a tool's arrow", () => {
  let n = 0;
  for (const s of sessions) {
    for (const m of translateAll(entriesOf(s))) {
      expect(m.title + " " + m.sub).not.toMatch(/\{"|"op"|^OP:|^TTS:|→|host\.\w+\.\w+/m);
      n++;
    }
  }
  expect(n).toBe(31);
});

test("a list reads as a count, a sum and the worst one, with the rows one level down", () => {
  const read = session("chase-overdue").messages.find((m) => m.role === "step")!;
  expect(read.title).toBe("Read 4 overdue invoices in Ledgerbox");
  expect(read.sub).toBe("$7,460 balance · longest: Northwind Traders, 41 days overdue · 1 with a note");
  expect(read.where).toBe("Ledgerbox's own tool");
  expect(read.detail.kind).toBe("table");
  if (read.detail.kind === "table") {
    expect(read.detail.rows.map((r) => r.label)).toEqual(["Northwind Traders", "Kestrel & Co", "Pinegrove Studio", "Halden Ferry"]);
    expect(read.detail.rows[3]!.note).toEqual({ k: "dispute", v: "Client says the second revision was out of scope." });
  }
});

test("her text loses its OP and TTS lines and keeps what she wrote", () => {
  const her = session("chase-overdue").messages.filter((m) => m.role === "her");
  expect(her[0]!.title).toBe("Let me read the inbox first.");
  expect(her[1]!.title).not.toContain("TTS");
  expect(her[1]!.title.startsWith("Three invoices are over 30 days")).toBe(true);
});

test("a draft is a letter one level down, addressed by the name the turn already showed", () => {
  const draft = session("chase-overdue").messages.find((m) => m.title.startsWith("Draft saved on INV-118"))!;
  expect(draft.sub).toBe("To Northwind Traders (ap@northwind.example): “INV-118 is 41 days past due”");
  expect(draft.detail).toMatchObject({ kind: "letter", subject: "INV-118 is 41 days past due", cut: false });
});

test("two periods read as a comparison with the biggest moves first", () => {
  const books = session("books-glance").messages.find((m) => m.role === "step")!;
  expect(books.title).toBe("Read the books in Ledgerbox, 2026-Q3 against 2026-Q2");
  expect(books.sub).toBe("Biggest moves: overdue $9,260 (was $0), outstanding $13,650 (+469%), invoiced $61,850 (+14%).");
  expect(books.detail.kind).toBe("compare");
});

test("a failure says what could not be done in words, and a later success of the same tool marks it recovered", () => {
  const crm = session("crm-followup").messages.filter((m) => m.role === "step");
  const failed = crm.find((m) => m.tone === "fail")!;
  expect(failed.title).toBe("Could not create a task in TidyCRM");
  expect(failed.sub).toBe('Due date must be an ISO date (got "Monday")');
  expect(failed.recovered).toBe(true);
  expect(crm.find((m) => m.title === "Created a task in TidyCRM")!.sub).toBe("“Check INV-118 payment from Northwind” · due date 2 Nov");
});

test("a decline, a call that was not run, and another tab each say what happened and where", () => {
  const wrong = session("refused-and-failed").messages;
  expect(wrong.find((m) => m.role === "declined")!.title).toBe("You declined to void invoice INV-109");
  const held = wrong.find((m) => m.tone === "blocked" && m.role === "step")!;
  expect(held.title).toBe("Did not mark paid in Ledgerbox");
  expect(held.sub).toBe("The tab this was proposed on reloaded or moved to another page since. Nothing was changed.");
  const tab = session("browser-tabs").messages.find((m) => m.lane === "tab")!;
  expect(tab.title).toBe("Read your “Gmail - Inbox” tab");
  expect(tab.where).toBe("Read from another tab");
  expect(tab.detail.kind).toBe("quote");
});

test("a tool nobody wrote words for still reads as a humanised verb and what its JSON carries", () => {
  const m = translate({ id: "x", kind: "tool", tier: 1, ok: true, text: 'host.atlas.archive_board → {"archived": 3, "board": "Q4 roadmap", "ok": true}' });
  expect(m.title).toBe("Archived board in Atlas");
  expect(m.sub).toBe("archived 3 · board Q4 roadmap");
  expect(m.detail).toEqual({ kind: "facts", rows: [{ k: "archived", v: "3" }, { k: "board", v: "Q4 roadmap" }] });
  const text = translate({ id: "y", kind: "tool", tier: 1, ok: true, text: "host.atlas.ping → pong" });
  expect(text.title).toBe("Pinged in Atlas");
  expect(text.sub).toBe("pong");
});

test("a decision says what happens to whom, and whether it can be taken back", () => {
  const { s, entries } = session("chase-overdue");
  const d = describeDecision(s.cards[0]!, buildContext(entries), "", { reversible: false, side_effects: "external" });
  expect(d.title).toBe("Send a reminder for INV-118 to Northwind Traders");
  expect(d.effect).toBe("Northwind Traders will receive “INV-118 is 41 days past due”. Once it is sent it cannot be taken back.");
  expect(d.risk).toBe("outbound");
  expect(d.letter?.body.startsWith("Hello Ana,")).toBe(true);
  const mail = session("mail-connector");
  const m = describeDecision(mail.s.cards[0]!, buildContext(mail.entries), "mira@example.com");
  expect(m.effect).toContain("from mira@example.com");
  const permanent = { reversible: false, side_effects: "internal" };
  expect(describeDecision({ action: "host.ledgerbox.void_invoice", params: { id: "inv_109" } }, buildContext([]), "", permanent).effect).toBe(
    "INV-109 is changed for good in Ledgerbox. It cannot be undone.",
  );
});

test("the technical record keeps the raw text, with the JSON laid out", () => {
  const read = session("chase-overdue").messages.find((m) => m.role === "step")!;
  expect(read.raw.startsWith("host.ledgerbox.read_inbox → {")).toBe(true);
  expect(prettyRaw(read.raw).split("\n")[0]).toBe("host.ledgerbox.read_inbox →");
  expect(shown(read)).not.toContain("host.ledgerbox");
});

// ADR 0189: the take-back promise is the tool's declared flags; the verb only chooses the sentence.
test("case 0: a declared-irreversible tool whose verb reads mild says it cannot be undone", () => {
  const { entries } = session("chase-overdue");
  const d = describeDecision({ action: "host.ledgerbox.mark_paid", params: { id: "inv_118" } }, buildContext(entries), "", {
    reversible: false,
    side_effects: "internal",
  });
  expect(d.risk).toBe("destructive");
  expect(d.declared).toBe(true);
  expect(d.effect.endsWith("It cannot be undone.")).toBe(true);
});

test("case 1: a declared-external tool whose verb is not a send warns that it cannot be taken back", () => {
  const d = describeDecision({ action: "connector.notion.create_page", params: {} }, EMPTY_CONTEXT, "mira@example.com", {
    reversible: false,
    side_effects: "external",
  });
  expect(d.risk).toBe("outbound");
  expect(d.effect).toContain("cannot be taken back");
});

test("case 2: a declared-reversible tool whose verb is archive is not told it cannot be undone", () => {
  const d = describeDecision({ action: "host.crm.archive_board", params: { id: "brd_4" } }, EMPTY_CONTEXT, "", {
    reversible: true,
    side_effects: "internal",
  });
  expect(d.risk).toBe("change");
  expect(d.effect).not.toContain("cannot be undone");
});

test("case 3: an undeclared tool reads as the severe bucket and says the app did not declare", () => {
  const d = describeDecision({ action: "host.tidycrm.merge_contacts", params: {} }, EMPTY_CONTEXT);
  expect(d.declared).toBe(false);
  expect(d.risk).toBe("destructive");
  expect(d.effect).toContain("did not declare whether this can be undone");
});

test("guard 4: a declared send keeps its sentence word for word", () => {
  const { s, entries } = session("chase-overdue");
  const d = describeDecision(s.cards[0]!, buildContext(entries), "", { reversible: false, side_effects: "external" });
  expect(d.effect).toBe("Northwind Traders will receive “INV-118 is 41 days past due”. Once it is sent it cannot be taken back.");
});

test("guard 5: a declared void keeps its sentence word for word", () => {
  const d = describeDecision({ action: "host.ledgerbox.void_invoice", params: { id: "inv_109" } }, buildContext([]), "", {
    reversible: false,
    side_effects: "internal",
  });
  expect(d.effect).toBe("INV-109 is changed for good in Ledgerbox. It cannot be undone.");
});

// A card shows what the turn already read about its target: the note, the age, and when.
const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
};
const disputed = { action: "host.ledgerbox.send_reminder", params: { id: "inv_137" } };

test("standing case 0: a card about a record the turn read carries the record's note", () => {
  const { entries } = session("chase-overdue");
  const d = describeDecision(disputed, buildContext(entries));
  expect(d.standing?.notes).toEqual([{ k: "dispute", v: "Client says the second revision was out of scope." }]);
});

test("standing case 1: the record's age reads as the table reads it", () => {
  const { entries } = session("chase-overdue");
  expect(describeDecision(disputed, buildContext(entries)).standing?.facts).toContainEqual({ k: "days overdue", v: "12 days" });
});

test("standing case 2: the standing says which step read it, and at what clock", () => {
  const { entries } = session("chase-overdue");
  const s = describeDecision(disputed, buildContext(entries)).standing;
  expect(s?.readAt).toBe("09:41");
  expect(s?.readBy).toBe("Read the inbox in Ledgerbox");
});

test("standing case 3: a card about a record the turn never read has no standing", () => {
  const { entries } = session("chase-overdue");
  const d = describeDecision({ action: "host.ledgerbox.void_invoice", params: { id: "inv_999" } }, buildContext(entries));
  expect(d.standing).toBeNull();
});

test("standing case 4: of two reads of one record, the latest is the one it stands on", () => {
  const read = (at: string, days: number): TranscriptEntry => ({
    id: at,
    kind: "tool",
    tier: 1,
    ok: true,
    at: `2026-10-23 ${at}:00`,
    text: `host.ledgerbox.read_inbox → {"items":[{"id":"inv_137","days_overdue":${days},"dispute":"Out of scope."}]}`,
  });
  const s = describeDecision(disputed, buildContext([read("09:41", 12), read("09:50", 13)])).standing;
  expect(s?.readAt).toBe("09:50");
  expect(s?.facts).toContainEqual({ k: "days overdue", v: "13 days" });
});

test("standing guard 7: every fixture message reads byte for byte as it did (provenance is context, never text)", () => {
  const all = sessions.flatMap((s) => translateAll(entriesOf(s))).map((m) => [m.title, m.sub, m.detail]);
  expect(all).toHaveLength(31);
  expect(fnv(JSON.stringify(all))).toBe("324f76fe");
});

// The kit's page shape with nothing in it (`{items: [], showing: 0, of: 0}`) is an ordinary answer.
test("an empty list reads as a read that found nothing, and never throws", () => {
  const m = translate({ id: "e", kind: "tool", tier: 1, ok: true, text: 'host.ledgerbox.list_overdue → {"items":[],"showing":0,"of":0}' });
  expect(m.tone).toBe("ok");
  expect(m.title).toBe("Listed the overdue in Ledgerbox");
  expect(m.sub).toBe("Nothing found.");
  expect(m.detail).toEqual({ kind: "none" });
});

// The run store writes some tool entries in its own words, with no tool arrow (`stores/run.ts`).
const own = (text: string, ok = false) => translate({ id: "o", kind: "tool", ok, text });

test("the run store's own lines say what happened: a stop, a remote message, a sheet, a card answered on a phone", () => {
  expect(own("stopped: you stopped her. Nothing more runs until your next message.")).toMatchObject({
    tone: "blocked",
    title: "You stopped her",
    sub: "Nothing more runs until your next message.",
  });
  expect(own("interrupted: you said something new, so she stopped.").title).toBe("You said something new, so she stopped");
  expect(own("not run: open ledgerbox on this computer first")).toMatchObject({
    tone: "blocked",
    title: "Did not run",
    sub: "Open ledgerbox on this computer first. Nothing was changed.",
  });
  expect(own("waiting: the message from Pixel 8 runs first", true)).toMatchObject({ tone: "info", title: "The message from Pixel 8 runs first" });
  expect(own("sheet of 3: ran 3 of 3", true)).toMatchObject({ title: "Ran 3 of 3", where: "From a sheet of 3" });
  const stopped = own("sheet of 3: ran 1 of 3; stopped at row 2: host.ledgerbox.send_reminder did not run: tab closed. The rows after it are still waiting.");
  expect(stopped.title).toBe("Ran 1 of 3");
  expect(stopped.sub).toBe("Stopped at row 2: send reminder in Ledgerbox did not run: tab closed. The rows after it are still waiting.");
  const declined = own("declined on Pixel 8: host.ledgerbox.void_invoice");
  expect(declined).toMatchObject({ role: "declined", tone: "blocked", title: "Declined on Pixel 8: void invoice in Ledgerbox", sub: "Nothing was changed." });
  expect(own("approved on Pixel 8: host.ledgerbox.void_invoice", true)).toMatchObject({ role: "step", tone: "ok", title: "Approved on Pixel 8: void invoice in Ledgerbox" });
});

test("every arrowless line the run store writes is read as its own line, never as a tool call", () => {
  const src = readFileSync(new URL("../../stores/run.ts", import.meta.url), "utf8");
  const written = [
    ...[...src.matchAll(/kind: "tool", text: `([^`]*)`/g)].map((m) => m[1]!),
    ...[...src.matchAll(/"((?:interrupted|stopped): [^"]*)"/g)].map((m) => m[1]!),
  ].filter((t) => !t.startsWith("${row.name} →") && !t.startsWith("declined: "));
  expect(written.length).toBeGreaterThanOrEqual(7);
  for (const shape of written) {
    const line = shape.replace(/\$\{verb\}/g, "declined").replace(/\$\{n\}/g, "2").replace(/\$\{[^}]*\.action\}/g, "host.ledgerbox.void_invoice").replace(/\$\{[^}]*\}/g, "Pixel 8");
    const m = own(line);
    // Read as a call, these said "Ran", "Voided invoice in Ledgerbox" or "...firsted".
    expect(m.title, line).not.toMatch(/^(Ran|Voided)\b|(first|\d)ed$/);
  }
});

test("a call that failed in words never reads as done", () => {
  const thrown = translate({ id: "f", kind: "tool", tier: 1, ok: false, text: "host.ledgerbox.send_reminder → Error: the tab closed" });
  expect(thrown).toMatchObject({ tone: "fail", title: "Could not send a reminder in Ledgerbox", sub: "Error: the tab closed" });
  const refused = translate({ id: "g", kind: "tool", tier: 1, ok: false, text: "host.ledgerbox.void_invoice → refused" });
  expect(refused).toMatchObject({ tone: "fail", title: "Could not void invoice in Ledgerbox", sub: "Refused" });
});

// Her own tools are named by the daemon's catalog; each must read as a verb and an object.
test("every core tool the daemon's catalog names reads as a verb and an object, done and running", () => {
  const catalog = readFileSync(new URL("../../../../../src/athena/core/catalog.py", import.meta.url), "utf8");
  const names = [...new Set([...catalog.matchAll(/name="(core\.[a-z_]+)"/g)].map((m) => m[1]!))];
  expect(names.length).toBeGreaterThanOrEqual(7);
  const verbs = new Set(["recall", "write", "save", "delegate", "list", "stop"]);
  for (const name of names) expect(verbs.has(parseTool(name).verb), `${name} reads as "${describeRunning(name)}"`).toBe(true);
  const done = (text: string) => translate({ id: "c", kind: "tool", tier: 1, ok: true, text }).title;
  expect(done('core.tasks → {"tasks":[{"id":"task_1","title":"x","status":"running"}]}')).toBe("Listed 1 task");
  expect(done('core.devices → {"devices":[{"name":"kaziho"}]}')).toBe("Listed 1 device");
  expect(done('core.task_stop → {"ok":true}')).toBe("Stopped a task");
  expect(done('core.delegate → {"ok":true}')).toBe("Delegated a task");
  expect(done('core.checkpoint → {"ok":true}')).toBe("Saved a note");
  expect(describeRunning("core.tasks")).toBe("Listing the tasks");
});
