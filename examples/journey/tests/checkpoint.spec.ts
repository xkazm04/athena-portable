/**
 * The journey's checkpoints, offline: resume at any act on the same invariants as a full run.
 *
 * Nothing here boots an app or opens a page. The cases pin what `JOURNEY_FROM=<n>` leans on: the
 * five state holders round-trip through plain JSON, a restore passes through the same checks as a
 * live write (so a hand-edited checkpoint cannot smuggle a row or a fact the record would refuse),
 * `planRun` boots only the apps the remaining acts touch, and a missing or stale checkpoint is
 * refused with what to do about it.
 *
 * Run it alone: `pnpm --filter @athena/journey exec playwright test tests/checkpoint.spec.ts`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { Approvals } from "../src/approvals.ts";
import { Brain } from "../src/brain.ts";
import {
  CHECKPOINT_FORMAT,
  capture,
  checkpointFile,
  planRun,
  readCheckpoint,
  restoreState,
  seedFingerprint,
  writeCheckpoint,
  type JourneyState,
} from "../src/checkpoint.ts";
import { ConnectorSurface } from "../src/connector-surface.ts";
import { FakeMail } from "../src/connectors/fake-mail.ts";
import { FakeNotes } from "../src/connectors/fake-notes.ts";
import { Ledger, type LedgerRow } from "../src/ledger.ts";

const INBOX = "studio@example.test";
const CLIENT = "kestrel@example.test";
const STRANGER = "stranger@example.test";

function fresh(): JourneyState {
  return {
    ledger: new Ledger(),
    approvals: new Approvals(),
    brain: new Brain(),
    mail: new FakeMail(INBOX),
    notes: new FakeNotes(),
  };
}

const row = (tool: string, extra: Partial<Omit<LedgerRow, "seq">> = {}): Omit<LedgerRow, "seq"> => ({
  app: "ledgerbox",
  tier: 1,
  tool,
  cls: "AUTO",
  outcome: "ok",
  reason: null,
  approval: null,
  target: null,
  ...extra,
});

let dir: string;
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "journey-checkpoint-"));
});
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("case 1: a ledger of 5 rows snapshots and restores deep-equal, and the next write gets seq 6", () => {
  const ledger = new Ledger();
  for (const tool of ["read_books", "read_credits", "match_bank_line", "match_bank_line", "read_inbox"]) {
    ledger.write(row(tool));
  }
  const snapshot = JSON.parse(JSON.stringify(ledger.snapshot())) as ReturnType<Ledger["snapshot"]>;

  const restored = new Ledger();
  restored.restore(snapshot);
  expect(restored.rows).toEqual(ledger.rows);
  expect(restored.write(row("export_summary")).seq).toBe(6);
});

test("case 2: a checkpoint row with a reason outside REFUSAL_REASONS is refused on restore", () => {
  const forged: LedgerRow[] = [{ ...row("send_reminder", { outcome: "refused", reason: "made_up" }), seq: 1 }];
  expect(() => new Ledger().restore(forged)).toThrow(/REFUSAL_REASONS/);
});

test("case 3: brain, approvals, mail and notes round-trip, and the restored mail still refuses an unlisted recipient", async () => {
  const live = fresh();
  const matched = live.ledger.write(row("match_bank_line"));
  live.brain.writeFact("Pinegrove Collective pays as PNGRV COLL", [matched], "ledgerbox");
  const granted = live.approvals.request("ledgerbox", "send_reminder", { id: "inv_1" });
  live.approvals.approve(granted.id);
  live.approvals.prove(granted.id, "ledgerbox", "send_reminder", { id: "inv_1" });
  const declined = live.approvals.request("hirelane", "send_rejection", { applicant_id: "a_9" });
  live.approvals.decline(declined.id);
  live.mail.allow(CLIENT);
  live.mail.seed([{ from: CLIENT, to: INBOX, subject: "Re: availability", body: "Any afternoon.", received_at: "2026-09-01T09:00:00Z" }]);
  live.mail.call("send_mail", { to: CLIENT, subject: "Invoice", body: "A reminder." });
  live.notes.seed([{ id: "page_studio", parent: null, title: "Studio record" }]);
  live.notes.allow("page_studio");
  live.notes.call("append_to_page", { page_id: "page_studio", text: "Shortlist: two." });

  const file = writeCheckpoint(dir, capture(live, 2, { resumedFrom: null }));
  const back = fresh();
  restoreState(back, readCheckpoint(file));

  const fact = back.brain.recall("pinegrove");
  expect(fact).toEqual(live.brain.recall("pinegrove"));
  expect(fact.cites).toEqual([matched.seq]);
  expect(back.approvals.all()).toEqual(live.approvals.all());
  expect(back.approvals.get(granted.id)?.status).toBe("granted");
  expect(back.approvals.get(granted.id)?.consumedAt).toBe(live.approvals.get(granted.id)?.consumedAt);
  expect(back.approvals.get(declined.id)?.describe).toBe(declined.describe);
  expect([...back.mail.allowed]).toEqual([...live.mail.allowed]);
  expect(back.mail.inbox).toEqual(live.mail.inbox);
  expect(back.mail.sent).toEqual(live.mail.sent);
  expect([...back.notes.pages.entries()]).toEqual([...live.notes.pages.entries()]);
  expect([...back.notes.allowed]).toEqual([...live.notes.allowed]);

  const mailer = new ConnectorSurface(back.mail, back.approvals, back.ledger);
  const refusal = await mailer.runUnallowed("send_mail", { to: STRANGER, subject: "Hi", body: "Hello." });
  expect(refusal.reason).toBe("foreign_origin");
  expect(back.mail.sentTo(STRANGER)).toEqual([]);
});

test("case 4: planRun boots only the apps the remaining acts touch and reads the act before them", () => {
  writeCheckpoint(dir, capture(fresh(), 2, { resumedFrom: null }));
  writeCheckpoint(dir, capture(fresh(), 3, { resumedFrom: null }));

  const three = planRun({ from: 3, dir });
  expect(three.apps.map((app) => app.id)).toEqual(["tidycrm"]);
  expect(three.acts).toEqual(["act 3", "act 4"]);
  expect(three.checkpoint).toBe(join(dir, "checkpoint-act2.json"));

  const four = planRun({ from: 4, dir });
  expect(four.apps).toEqual([]);
  expect(four.acts).toEqual(["act 4"]);
  expect(four.checkpoint).toBe(join(dir, "checkpoint-act3.json"));

  const full = planRun({ dir });
  expect(full.apps.map((app) => app.id)).toEqual(["ledgerbox", "kestrel-portal", "hirelane", "tidycrm"]);
  expect(full.acts).toEqual(["act 1", "act 2", "act 3", "act 4"]);
  expect(full.checkpoint).toBeNull();
});

test("case 5: resuming with no checkpoint on disk names the file and the command that writes it", () => {
  expect(() => planRun({ from: 3, dir })).toThrow(/checkpoint-act2\.json/);
  expect(() => planRun({ from: 3, dir })).toThrow(/pnpm --filter @athena\/journey test/);
});

test("case 6: a checkpoint written against another seed is refused, naming both fingerprints", () => {
  const stale = { ...capture(fresh(), 2, { resumedFrom: null }), fingerprint: "0000000000000000" };
  const file = join(dir, checkpointFile(2));
  writeFileSync(file, JSON.stringify(stale));
  const current = seedFingerprint();
  expect(current).not.toBe(stale.fingerprint);
  expect(() => readCheckpoint(file)).toThrow(new RegExp(`0000000000000000[\\s\\S]*${current}`));
  expect(CHECKPOINT_FORMAT).toBeGreaterThan(0);
});

test("case 7 (guard): a fact citing nothing is refused on a fresh brain and on a restored one", () => {
  expect(() => new Brain().writeFact("Kestrel pays late", [], "act 1")).toThrow(/cites no episode/);
  const live = fresh();
  live.brain.writeFact("Kestrel pays late", [live.ledger.write(row("read_credits"))], "act 1");
  const back = fresh();
  restoreState(back, capture(live, 1, { resumedFrom: null }));
  expect(() => back.brain.writeFact("Kestrel pays late", [], "act 1")).toThrow(/cites no episode/);
});

test("case 8 (guard): a fresh ledger still refuses a reason outside REFUSAL_REASONS", () => {
  expect(() => new Ledger().write(row("send_reminder", { outcome: "refused", reason: "made_up" }))).toThrow(
    /REFUSAL_REASONS/,
  );
});
