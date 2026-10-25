/**
 * The journey's gate, offline: one pipeline for every tier, at production's approval rules.
 *
 * Nothing here boots an app or opens a page. The connector cases drive `ConnectorSurface` over a
 * `FakeMail`, and the page-tier case drives the pipeline itself with an injected transport, so the
 * rules the four acts lean on (a card is spent once, a changed parameter is `validator_failed` and
 * spends nothing, a connector call is checked against its schema before it leaves, a connector read
 * is capped and fenced) are pinned in seconds rather than behind four cold `next dev` boots.
 *
 * Run it alone: `pnpm --filter @athena/journey exec playwright test tests/gate-pipeline.spec.ts`.
 */
import { expect, test } from "@playwright/test";
import { Approvals } from "../src/approvals.ts";
import { ConnectorSurface } from "../src/connector-surface.ts";
import { FakeMail } from "../src/connectors/fake-mail.ts";
import { runGate } from "../src/gate-pipeline.ts";
import { Ledger } from "../src/ledger.ts";
import { rowOf } from "../src/surface.ts";

const INBOX = "studio@example.test";
const ALLOWED = "kestrel@example.test";
const OTHER = "pinegrove@example.test";
const STRANGER = "stranger@example.test";

function plane() {
  const approvals = new Approvals();
  const ledger = new Ledger();
  const mail = new FakeMail(INBOX);
  mail.allow(ALLOWED, OTHER);
  const mailer = new ConnectorSurface(mail, approvals, ledger);
  return { approvals, ledger, mail, mailer };
}

const letter = (to: string) => ({ to, subject: "Invoice 1042", body: "A gentle reminder." });

/** What a refusal came to: its reason and the row it wrote before it threw. */
async function refusalOf(attempt: Promise<unknown>): Promise<{ reason: string; row: ReturnType<typeof rowOf> }> {
  try {
    await attempt;
  } catch (error) {
    return { reason: (error as Error & { reason: string }).reason, row: rowOf(error as Error) };
  }
  throw new Error("the call ran when it should have been refused");
}

test("case 1: a granted send_mail card cited twice runs once and is refused approval_spent the second time", async () => {
  const { approvals, ledger, mail, mailer } = plane();
  const card = mailer.propose("send_mail", letter(ALLOWED));
  approvals.approve(card.id);

  const first = await mailer.run("send_mail", letter(ALLOWED), card);
  expect(first.row.outcome).toBe("ok");
  const second = await refusalOf(mailer.run("send_mail", letter(ALLOWED), card));
  expect(second.reason).toBe("approval_spent");

  expect(mail.sent.length).toBe(1);
  expect(ledger.rows.map((row) => [row.outcome, row.reason, row.approval])).toEqual([
    ["ok", null, card.id],
    ["refused", "approval_spent", card.id],
  ]);
});

test("case 2: the page tier through the pipeline with a fake transport runs a GATED card once and refuses the replay", async () => {
  const approvals = new Approvals();
  const ledger = new Ledger();
  const origin = "http://books.test";
  const params = { id: "inv_1042" };
  const schema = { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false };
  let invoked = 0;
  const transport = async () => {
    invoked += 1;
    return { ok: true as const, output: "Reminder sent." };
  };
  const card = approvals.request(origin, "send_reminder", params);
  approvals.approve(card.id);
  const nonce = "0123456789abcdef";
  const step = { app: "ledgerbox", origin, tier: 1 as const, name: "send_reminder", cls: "GATED" as const, schema, params, approval: card, transport };

  const first = await runGate({ approvals, ledger, nonce }, step);
  expect(first.row.outcome).toBe("ok");
  expect(first.row.approval).toBe(card.id);
  expect(first.fenced).toContain(`<<<untrusted:${nonce}`);

  const second = await refusalOf(runGate({ approvals, ledger, nonce }, step));
  expect(second.reason).toBe("approval_spent");
  expect(second.row).toMatchObject({ app: "ledgerbox", tier: 1, outcome: "refused", reason: "approval_spent", approval: card.id });
  expect(invoked).toBe(1);
  expect(ledger.rows.length).toBe(2);
});

test("case 3: a card cited with changed parameters is refused validator_failed and is not spent", async () => {
  const { approvals, mail, mailer } = plane();
  const card = mailer.propose("send_mail", letter(ALLOWED));
  approvals.approve(card.id);

  const wrong = await refusalOf(mailer.run("send_mail", letter(OTHER), card));
  expect(wrong.reason).toBe("validator_failed");
  expect(mail.sent.length).toBe(0);

  const right = await mailer.run("send_mail", letter(ALLOWED), card);
  expect(right.row.outcome).toBe("ok");
  expect(mail.sentTo(ALLOWED).length).toBe(1);
});

test("case 4: a misspelled connector argument is refused validator_failed before port.call, with one row", async () => {
  const { approvals, ledger, mail, mailer } = plane();
  const misspelled = { to: ALLOWED, subj: "Invoice 1042", body: "A gentle reminder." };
  const card = mailer.propose("send_mail", misspelled);
  approvals.approve(card.id);

  const refused = await refusalOf(mailer.run("send_mail", misspelled, card));
  expect(refused.reason).toBe("validator_failed");
  expect(mail.calls.length).toBe(0);
  expect(ledger.rows.length).toBe(1);
  expect(ledger.rows[0]).toMatchObject({ outcome: "refused", reason: "validator_failed", approval: card.id });
});

test("case 5: a 5000-character connector read is fenced with the surface nonce and cut at READ_CAP inside the fence", async () => {
  const { mail, mailer } = plane();
  mail.seed([{ from: OTHER, to: INBOX, subject: "availability", body: "x".repeat(5000), received_at: "2026-08-01T09:00:00Z" }]);

  const result = await mailer.run("search_mail", { query: "availability" });
  expect(result.output.length).toBeGreaterThan(5000);
  expect(JSON.parse(result.output).messages[0].body).toBe("x".repeat(5000));

  const nonce = mailer.nonce;
  const fenced = result.fenced;
  const open = `<<<mail:${nonce}`;
  const close = `mail:${nonce}>>>`;
  expect(fenced.startsWith(open)).toBe(true);
  expect(fenced.endsWith(close)).toBe(true);
  const announced = fenced.indexOf(`(showing 1600 of ${result.output.length})`);
  expect(announced).toBeGreaterThan(fenced.indexOf(open));
  expect(announced).toBeLessThan(fenced.indexOf(close));
  expect(fenced).toContain(result.output.slice(0, 1600));
  expect(fenced).not.toContain(result.output.slice(0, 1601));
});

test("case 6: an approved send to a recipient off the allow-list is refused foreign_origin and the card is spent", async () => {
  const { approvals, mail, mailer } = plane();
  const card = mailer.propose("send_mail", letter(STRANGER));
  approvals.approve(card.id);

  const egress = await refusalOf(mailer.run("send_mail", letter(STRANGER), card));
  expect(egress.reason).toBe("foreign_origin");
  expect(egress.row.target).toBe(STRANGER);

  const again = await refusalOf(mailer.run("send_mail", letter(STRANGER), card));
  expect(again.reason).toBe("approval_spent");
  expect(mail.sent.length).toBe(0);
});

test("case 7 (guard): declineAndRun(send_mail) is user_denied, sends nothing and writes one row with the card", async () => {
  const { ledger, mail, mailer } = plane();
  const refusal = await mailer.declineAndRun("send_mail", letter(ALLOWED));
  expect(refusal.reason).toBe("user_denied");
  expect(mail.sent).toEqual([]);
  expect(ledger.rows.length).toBe(1);
  expect(ledger.rows[0]!.approval).not.toBeNull();
  expect(ledger.rows[0]).toMatchObject({ outcome: "refused", reason: "user_denied", approval: refusal.row.approval });
});

test("case 8 (guard): approveAndRun(send_mail) to an allow-listed recipient is ok with its target and a granted card", async () => {
  const { approvals, mailer } = plane();
  const posted = await mailer.approveAndRun("send_mail", letter(ALLOWED));
  expect(posted.row.outcome).toBe("ok");
  expect(posted.row.target).toBe(ALLOWED);
  expect(posted.row.approval).toBe(posted.approval!.id);
  expect(approvals.get(posted.approval!.id)!.status).toBe("granted");
});
