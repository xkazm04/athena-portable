/**
 * README section 1 — "the demo, four acts, under five minutes", run end to end and asserted.
 *
 * One browser, one ledger, one brain, three real applications and the real bridge. Every beat is
 * numbered in the comment that introduces it; every field the apps answer with is read through
 * `src/contracts.ts` and never here, so the acts survive the apps changing shape.
 *
 * What this file is careful about, in order of how easy it is to get wrong:
 *
 *   1. the page is driven only through `athena-webmcp` postMessage (`src/relay.ts`) — never
 *      `document.modelContext` — so the guards the protocol leans on are exercised;
 *   2. the class of every tool comes from `@athena/bridge/gate` and never from this file, and a
 *      GATED tool executes only through an approval that describes exactly that call;
 *   3. both declines actually attempt the call after being declined, and the page is re-read to
 *      prove nothing moved;
 *   4. connectors are fakes (README section 4: the real ones live in another repository), held to
 *      the same gate and to an egress allow-list built from the shared company registry;
 *   5. the three acts are one studio's story — act 3 resolves a conflict with a fact act 1 wrote,
 *      and act 4 prints the facts beside the ledger rows they cite.
 *
 * The acts are ordinary tests in one worker, in file order, rather than a serial group: a beat
 * that fails because an app moved should not hide the state of the other two acts.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { HIRELANE, LEDGERBOX, OUTSIDE, TIDYCRM, urlOf, type AppSpec } from "../src/apps.ts";
import { Approvals } from "../src/approvals.ts";
import { boot, shutdown, type Booted } from "../src/boot.ts";
import { Brain } from "../src/brain.ts";
import { ConnectorSurface } from "../src/connector-surface.ts";
import { FakeMail } from "../src/connectors/fake-mail.ts";
import { FakeNotes } from "../src/connectors/fake-notes.ts";
import { Ledger } from "../src/ledger.ts";
import { Surface } from "../src/surface.ts";
import { STUDIO_NOTES, assertClasses, assertHands, eventually } from "../src/stage.ts";
import {
  BACKEND_ROLE,
  CAMPAIGN_SEGMENT,
  FORBIDDEN_PARAMETERS,
  KESTREL_APPLICANT,
  PINEGROVE_ALIAS,
  QUIET_CLIENT,
  STUDIO,
  aliasFromMatch,
  applicant,
  bodyOf,
  boundsOf,
  candidate,
  companyByName,
  companyDomain,
  conflict,
  contact,
  contactEmailFor,
  refsFrom,
  credit,
  draft,
  invoice,
  isConfidentPair,
  itemsOf,
  outbound,
  pair,
  refusedAnswer,
  safe,
  slotIdFrom,
  toneFor,
  unambiguousMatch,
  type Row,
} from "../src/contracts.ts";

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), "..", "shots");

/** The record, the memory and the approval table, shared by all four acts. */
const ledger = new Ledger();
const approvals = new Approvals();
const brain = new Brain();
const mail = new FakeMail(STUDIO.inbox);
const notes = new FakeNotes();
const mailer = new ConnectorSurface(mail, approvals, ledger);
const notebook = new ConnectorSurface(notes, approvals, ledger);

const booted: Booted[] = [];
let context: BrowserContext;
let page: Page;

async function shot(name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

async function open(app: AppSpec, path = "/"): Promise<Surface> {
  return Surface.open(app, page, approvals, ledger, urlOf(app, path));
}

/**
 * The same, in a **second tab**.
 *
 * The four acts share one page because they are one person moving between three applications, and
 * a surface that navigated away would lose the tools it had just listed. The outside page is the
 * one thing opened *beside* the app rather than instead of it: act 1 is mid-reconciliation when it
 * goes to look something up, and coming back to a Ledgerbox that had been navigated away and
 * re-listed would be a different beat than the one the demo shows.
 *
 * The caller closes it. A tab left open is a webview the next act's `page_find` could reach.
 */
async function openBeside(app: AppSpec, path = "/"): Promise<{ surface: Surface; close: () => Promise<void> }> {
  const beside = await context.newPage();
  const surface = await Surface.open(app, beside, approvals, ledger, urlOf(app, path));
  return { surface, close: () => beside.close() };
}

test.beforeAll(async ({ browser }) => {
  notes.seed([{ id: STUDIO_NOTES, parent: null, title: "Halden Studio — weekly record" }]);
  notes.allow(STUDIO_NOTES);
  for (const app of [LEDGERBOX, HIRELANE, TIDYCRM, OUTSIDE]) {
    booted.push(await boot(app, (line) => console.log(`[boot] ${line}`)));
  }
  // JOURNEY_VIDEO=1 records the whole run as one .webm next to the screenshots: a demo asset
  // (README section 5, P9), not evidence, so it is off in the gate.
  context = await browser.newContext(
    process.env.JOURNEY_VIDEO ? { recordVideo: { dir: SHOTS, size: { width: 1440, height: 900 } } } : {},
  );
  page = await context.newPage();
});

test.afterAll(async () => {
  const video = page?.video();
  await context?.close();
  if (video) await video.saveAs(join(SHOTS, "journey.webm"));
  for (const one of booted) await shutdown(one);
});

/**
 * The four acts are one test with four steps rather than four tests, and that is not a style
 * choice: Playwright starts a fresh worker process after a failed test, which would throw away
 * the ledger, the approval table and the brain — the three things act 4 exists to read. One test
 * keeps them. A step that fails is caught and recorded rather than ending the run, so a beat that
 * breaks because an app moved still leaves the other three acts and the record readable; the
 * collected failures are asserted at the very end.
 */
test("the demo journey: four acts, one studio, one record", async () => {
  const failures: string[] = [];
  const act = async (name: string, run: () => Promise<void>): Promise<void> => {
    try {
      await test.step(name, run);
    } catch (error) {
      failures.push(name + ": " + (error as Error).message);
    }
  };

  // --- act 1 ------------------------------------------------------------------------------------

  await act("act 1: Ledgerbox — the credits, the chases and one decline", async () => {
    const books = await open(LEDGERBOX);

    // Beat 1. The manifest, and the class of every tool in it, from the gate and nowhere else.
    assertClasses(books, LEDGERBOX);
    expect(books.manifest().app_id).toBe("ledgerbox");
    expect(books.manifest().tools.length).toBe(books.names().length);

    // Beat 2. The books and the unapplied credits. Both AUTO, both bounded and saying so.
    const summary = await books.read<Row>("read_books");
    expect(itemsOf(summary.periods).length).toBeGreaterThan(0);
    const creditsAnswer = await books.read<Row>("read_credits");
    const credits = itemsOf(creditsAnswer);
    expect(boundsOf(creditsAnswer).of).toBe(credits.length);
    expect(credits.length).toBeGreaterThan(1);

    // Beat 3. Match every credit that settles exactly one invoice. A credit with two candidates and
    // a credit with none are both left alone, for opposite reasons.
    const matched: Array<{ line: string; invoice: string; alias: string | null; seq: number }> = [];
    const left: Row[] = [];
    for (const line of credits) {
      const target = unambiguousMatch(line);
      if (!target) {
        left.push(line);
        continue;
      }
      const result = await books.run("match_bank_line", { invoice_id: target, line_id: credit.id(line) });
      matched.push({
        line: credit.id(line),
        invoice: target,
        alias: aliasFromMatch(result.output) ?? credit.alias(line),
        seq: result.row.seq,
      });
    }
    expect(matched.length, "credits with exactly one candidate").toBeGreaterThan(1);
    expect(left.length, "credits a person has to decide or explain").toBeGreaterThan(0);

    // Beat 4. The one credit that could settle either of two invoices is the Kestrel Labs one,
    // and it is still on the lower lane. Found by its ambiguity rather than by its memo: a beat
    // that searched for "kestrel" would pass on any Kestrel credit, including a matched one.
    const ambiguous = credits.filter((c) => credit.ambiguous(c));
    expect(ambiguous.length, "exactly one credit a person has to decide").toBe(1);
    expect(credit.memo(ambiguous[0]!)).toMatch(/kestrel/i);
    expect(credit.candidates(ambiguous[0]!).length).toBeGreaterThan(1);
    expect(left.map((c) => credit.id(c))).toContain(credit.id(ambiguous[0]!));
    expect(matched.map((m) => m.line)).not.toContain(credit.id(ambiguous[0]!));

    // Beat 4a. The page nobody instrumented (README section 3.4, tier 2).
    //
    // Act 1 has one credit it will not guess at, and a finance person would not guess either —
    // they would look at the customer's own remittance advice, which Kestrel publishes. That page
    // has no WebMCP, no meta tag and no script: eight generic hands are the whole of what Athena
    // has on it, and every one of them is GATED on first sight for an origin nobody has trusted.
    const { surface: portal, close: closePortal } = await openBeside(OUTSIDE, "/remittances.html");
    expect(portal.names().filter((n) => !portal.isHand(n)), "a page that registered nothing").toEqual([]);
    assertHands(portal);
    expect(portal.manifest().tools.length, "the manifest is exactly the hands").toBe(8);

    // Beat 4b. Find the studio's own remittance row and read *that*, not the page.
    //
    // Reading the whole page would be the wrong answer twice over: it is most of a screen of
    // other suppliers' payments, and a footnote further down names the retainer that has *not*
    // been paid yet. The row is the evidence; the page is where it happens to live. Both calls
    // are GATED, because this is an origin nobody has trusted and even looking at it is a
    // decision the user made — which is the whole of what "GATED on first sight" buys.
    const rows = await portal.approveAndRun("page_find", { role: "tr", query: STUDIO.name });
    expect(rows.row.tier, "a hand is tier 2 in the record").toBe(2);
    const ourRow = refsFrom(rows.output);
    expect(ourRow.length, `exactly one remittance row for ${STUDIO.name}`).toBe(1);

    const seen = await portal.approveAndRun("page_read", { ref: ourRow[0]! });
    const remittance = seen.output;
    expect(remittance).toContain(STUDIO.name);
    // The page is a fixture of a real company's portal, and the journey is what keeps it honest:
    // if Ledgerbox renumbers its retainers or the seed renames the client, this fails rather than
    // the demo quietly stopping making sense.
    const twins = credit.candidates(ambiguous[0]!);
    expect(twins.length, "two retainers, identical but for their number").toBe(2);
    // Matched on the number the studio prints on the invoice, which is what a customer quotes
    // back. The id is ours and a third-party page has no reason to know it.
    const settled = twins.filter((row) => remittance.includes(candidate.number(row)));
    expect(settled.length, "the portal names exactly one of the two retainers").toBe(1);

    // Beat 4c. The match itself needs no card, and that is the gate working rather than a gap.
    //
    // Ledgerbox classes `match_bank_line` AUTO because a match is reversible and stays inside the
    // app; what the user was asked about was *the new origin* — twice, before Athena read a word
    // of it. The decision the gate exists for was "may she look at this page at all", and once
    // that is answered the bookkeeping is ordinary. A card on the match as well would be a second
    // question about something the user already settled.
    expect(books.classOf("match_bank_line"), "a reversible internal write").toBe("AUTO");
    const decided = await books.run("match_bank_line", {
      invoice_id: candidate.invoiceId(settled[0]!),
      line_id: credit.id(ambiguous[0]!),
    });
    expect(decided.row.tier, "the match happened in the app, not on the outside page").toBe(1);
    const outsideFact = brain.writeFact(
      `Kestrel Labs settled ${candidate.number(settled[0]!)} on their published remittance advice`,
      [seen.row, decided.row],
      "act 1",
    );
    expect(outsideFact.cites.length, "the fact cites the read and the match").toBe(2);

    await closePortal();

    // And the credit a person had to decide is now decided, so the lane is empty.
    const afterOutside = await eventually(
      async () => itemsOf(await books.read<Row>("read_credits")).filter((c) => credit.ambiguous(c)),
      (rows) => rows.length === 0,
    );
    expect(
      afterOutside.map((c) => `${credit.id(c)} ${credit.memo(c)}`),
      "nothing is left waiting on a person",
    ).toEqual([]);

    // Beat 5. The trading name the bank pays Pinegrove under, learned once, written citing the
    // match that taught it. A fact with no live episode behind it is refused at write.
    const alias = matched.find((m) => (m.alias ?? "").toUpperCase().includes(PINEGROVE_ALIAS.bank));
    expect(alias, `a credit that matched under the alias ${PINEGROVE_ALIAS.bank}`).toBeTruthy();
    const aliasFact = brain.writeFact(
      `Pinegrove Collective pays as ${PINEGROVE_ALIAS.bank}`,
      [ledger.rows[alias!.seq - 1]!],
      "ledgerbox",
    );
    expect(aliasFact.cites).toEqual([alias!.seq]);

    // Beat 6. Scrub the strip to the overdue view and read all of it, page by page.
    await books.run("navigate", { view: "overdue" });
    // A route change re-registers the surface's tools; the manifest is rebuilt, as on `toolchange`.
    await books.settle();
    const overdue: Row[] = [];
    for (let index = 0; index < 6; index += 1) {
      const answer = await books.read<Row>("read_inbox", { filter: "overdue", page: index });
      const bounds = boundsOf(answer);
      overdue.push(...itemsOf(answer));
      if (overdue.length >= bounds.of || bounds.showing === 0) break;
    }
    expect(overdue.length, "invoices on the overdue strip").toBeGreaterThan(2);
    await shot("act1-ledgerbox");

    // Beat 7. A chase for every invoice more than 30 days old — except the client who has paid
    // most of it and gone quiet. That is the runner's decision from `paid_ratio`, not a name list,
    // and the assertion is that the decision lands on Solstice Partners.
    const older = overdue.filter((row) => invoice.daysOverdue(row) > 30);
    expect(older.length).toBeGreaterThan(2);
    // The decision is about the client, not the invoice: an invoice that is 80% paid says the
    // client is paying and has gone quiet, and chasing their other invoices would say the
    // opposite in the same week. So the client is held back once, from `paid_ratio`, and the
    // assertion is that the rule lands on Solstice Partners without naming them.
    const quiet = new Set(older.filter((row) => invoice.mostlyPaid(row)).map((row) => invoice.client(row)));
    expect([...quiet], `${QUIET_CLIENT} is held back`).toContain(QUIET_CLIENT);
    // A disputed invoice is not chased either, and that is the app's rule rather than the
    // runner's: asking for one anyway is answered with the reason, which is asserted below.
    const disputed = older.filter((row) => invoice.state(row) === "disputed");
    const chased = older.filter(
      (row) => !quiet.has(invoice.client(row)) && invoice.state(row) !== "disputed",
    );
    expect(chased.map((row) => invoice.client(row))).not.toContain(QUIET_CLIENT);
    expect(chased.length).toBeGreaterThan(2);
    if (disputed.length > 0) {
      const refused = await books.run("draft_reminder", { id: invoice.id(disputed[0]!), tone: "gentle" });
      expect(refused.output.toLowerCase()).toContain("disput");
    }

    const oldest = [...chased].sort((a, b) => invoice.daysOverdue(b) - invoice.daysOverdue(a))[0]!;
    const drafts = new Map<string, Row>();
    for (const row of chased) {
      const answer = await books.read<Row>("draft_reminder", { id: invoice.id(row), tone: toneFor(row, oldest) });
      drafts.set(invoice.id(row), draft.of(answer));
    }
    expect(drafts.size).toBe(chased.length);

    // The allow-list is exactly the registry contacts of the clients being chased, and the app's own
    // addressing is checked against the same registry.
    for (const row of chased) {
      const composed = drafts.get(invoice.id(row))!;
      expect(draft.to(composed), `${invoice.client(row)} is addressed at its registry contact`).toBe(
        contactEmailFor(invoice.client(row)),
      );
      expect(draft.from(composed)).toBe(STUDIO.inbox);
      mail.allow(draft.to(composed));
    }
    expect(mail.allowed.has(contactEmailFor(QUIET_CLIENT)), `${QUIET_CLIENT} is not allow-listed`).toBe(false);

    // Beat 8. Two chases approved: the mail goes out through the connector, then the page records
    // that it was sent. Both halves are GATED and each carries its own card.
    const [first, second, third] = chased;
    for (const row of [first!, second!]) {
      const composed = drafts.get(invoice.id(row))!;
      const posted = await mailer.approveAndRun("send_mail", {
        to: draft.to(composed),
        subject: draft.subject(composed),
        body: draft.body(composed),
      });
      expect(posted.target).toBe(draft.to(composed));
      const sent = await books.approveAndRun("send_reminder", { id: invoice.id(row) });
      expect(sent.row.approval).toBeTruthy();
      expect(mail.sentTo(draft.to(composed)).length).toBe(1);
      expect(mail.sentTo(draft.to(composed))[0]!.from).toBe(STUDIO.inbox);
    }

    // Beat 9. One declined — and then attempted, because a decline nobody tested against the gate
    // proves the runner's manners rather than the gate. Neither the page nor the mailbox moves.
    const declined = third ?? first!;
    const before = itemsOf(await books.read<Row>("read_inbox", { filter: "overdue" })).find(
      (row) => invoice.id(row) === invoice.id(declined),
    );
    const refusal = await books.declineAndRun("send_reminder", { id: invoice.id(declined) });
    expect(refusal.reason).toBe("user_denied");
    const after = itemsOf(await books.read<Row>("read_inbox", { filter: "overdue" })).find(
      (row) => invoice.id(row) === invoice.id(declined),
    );
    expect(after, "the declined invoice is exactly as it was").toEqual(before);
    expect(mail.sentTo(draft.to(drafts.get(invoice.id(declined))!)).length).toBe(0);
    expect(mail.sentTo(contactEmailFor(QUIET_CLIENT)).length, `${QUIET_CLIENT} received nothing`).toBe(0);

    // Beat 10. The period close, filed on the studio's own page under the allowed parent.
    const exported = await books.read<Row>("export_summary", { period: "2026-08" });
    const filed = await notebook.approveAndRun("create_page", {
      parent_id: STUDIO_NOTES,
      title: "Ledgerbox — August 2026",
      body: bodyOf(exported),
    });
    expect(filed.target).toBe(STUDIO_NOTES);
    expect(notes.childrenOf(STUDIO_NOTES).length).toBe(1);
  });

  // --- act 2 ------------------------------------------------------------------------------------

  await act("act 2: Hirelane — score, read the borderline, schedule two and decline one", async () => {
    const board = await open(HIRELANE);

    // Beat 1. The three consequential tools, and nothing else, are GATED.
    assertClasses(board, HIRELANE);

    // Beat 2. Nothing in this pipeline may be parameterised on who someone is rather than what they
    // did. Asserted over the whole manifest, so a tool added tomorrow cannot smuggle one in.
    const manifestText = JSON.stringify(board.manifest()).toLowerCase();
    for (const word of FORBIDDEN_PARAMETERS) {
      expect(manifestText.includes(`"${word}"`), `no parameter named ${word}`).toBe(false);
    }

    // Beat 3. Score the applied backend applicants against the rubric. Nobody is scored yet.
    const appliedAnswer = await board.read<Row>("read_applicants", { role_id: BACKEND_ROLE, stage: "applied" });
    expect(refusedAnswer(appliedAnswer), "the backend role id is known").toBeNull();
    const applied = itemsOf(appliedAnswer);
    expect(applied.length, "applicants in `applied` on the backend role").toBeGreaterThan(0);
    expect(applied.every((row) => !applicant.scored(row))).toBe(true);
    const scoringRows: number[] = [];
    for (const person of applied) {
      const scored = await board.run("score_against_rubric", { applicant_id: applicant.id(person) });
      scoringRows.push(scored.row.seq);
    }

    // Beat 4. Read the borderline band — the six the rubric does not decide.
    const bandAnswer = await board.read<Row>("read_applicants", { role_id: BACKEND_ROLE, borderline: true });
    const band = itemsOf(bandAnswer);
    expect(band.length, "a borderline band the rubric leaves open").toBeGreaterThan(1);
    expect(band.every((row) => applicant.borderline(row))).toBe(true);
    await shot("act2-hirelane");

    // Beat 5. One of them works at a client act 1 chased. That is context a person may hear and
    // nothing a score may depend on, so the note is written after every scoring call and cites both.
    // Keyed on the address: two other borderline applicants share a name with this one.
    const wren = band.find((row) => safe(() => applicant.email(row), "") === KESTREL_APPLICANT.email);
    expect(wren, `${KESTREL_APPLICANT.email} is one of the borderline applicants`).toBeTruthy();
    expect(applicant.employerDomain(wren!)).toContain("kestrel");
    const kestrelCredit = ledger.byApp("ledgerbox").find((row) => row.tool === "read_credits");
    const note = brain.writeFact(
      `${applicant.name(wren!)} <${KESTREL_APPLICANT.email}> works at Kestrel Labs, the client whose credit act 1 left unmatched`,
      [kestrelCredit!, ledger.rows.at(-1)!],
      "hirelane",
    );
    expect(note.cites.length).toBe(2);
    expect(
      Math.max(...scoringRows),
      "every score was taken before the cross-app note existed",
    ).toBeLessThan(note.cites[1]!);

    // Beat 6. The availability replies, in the studio's inbox, from the applicants themselves.
    mail.seed(
      band.slice(0, 3).map((row, index) => ({
        from: applicant.email(row),
        to: STUDIO.inbox,
        subject: "Re: backend role — availability",
        body: `Any afternoon next week works for me. — ${applicant.name(row)}`,
        received_at: `2026-09-0${index + 1}T09:00:00Z`,
      })),
    );
    const replies = itemsOf(await mailer.read<Row>("search_mail", { query: "availability" }));
    expect(replies.length, "availability replies in the studio inbox").toBeGreaterThan(1);
    for (const reply of replies) {
      expect(String(reply.to)).toBe(STUDIO.inbox);
      expect(band.some((row) => safe(() => applicant.email(row), "") === String(reply.from))).toBe(true);
    }

    // Beat 7. Move the two who are advancing to interview and hold slots for them. Both are
    // reversible pipeline work: AUTO, no card.
    const advancing = band.slice(0, 2);
    const slots = new Map<string, string>();
    for (const person of advancing) {
      await board.run("move_stage", { applicant_id: applicant.id(person), stage: "interview" });
      const proposed = await board.read<Row>("propose_slots", { applicant_id: applicant.id(person) });
      slots.set(applicant.id(person), slotIdFrom(proposed));
    }

    // Beat 8. Two scheduling mails approved: the app composes, the connector sends, both gated.
    for (const person of advancing) {
      const composed = await board.approveAndRun("send_scheduling_email", {
        applicant_id: applicant.id(person),
        slot_id: slots.get(applicant.id(person))!,
      });
      expect(composed.row.approval).toBeTruthy();
      const to = outbound.to(JSON.parse(composed.output) as Row);
      expect(to).toBe(applicant.email(person));
      mail.allow(to);
      const posted = await mailer.approveAndRun("send_mail", {
        to,
        subject: outbound.subject(JSON.parse(composed.output) as Row),
        body: outbound.body(JSON.parse(composed.output) as Row),
      });
      expect(posted.target).toBe(to);
      expect(mail.sentTo(to)[0]!.from).toBe(STUDIO.inbox);
    }

    // Beat 9. One rejection declined, then attempted: refused `user_denied`, and the board is unmoved.
    const rejected = band.at(-1)!;
    const stageOf = async (): Promise<Row | undefined> =>
      itemsOf(await board.read<Row>("read_applicants", { role_id: BACKEND_ROLE, borderline: true })).find(
        (row) => applicant.id(row) === applicant.id(rejected),
      );
    const before = await stageOf();
    const refusal = await board.declineAndRun("send_rejection", {
      applicant_id: applicant.id(rejected),
      template: "standard",
    });
    expect(refusal.reason).toBe("user_denied");
    expect(await stageOf()).toEqual(before);
    expect(mail.sentTo(applicant.email(rejected)).length).toBe(0);

    // Beat 10. The shortlist the app itself writes, appended to the studio's page.
    const shortlist = await board.read<Row>("read_shortlist", { role_id: BACKEND_ROLE });
    const filed = await notebook.approveAndRun("append_to_page", {
      page_id: STUDIO_NOTES,
      text: bodyOf(shortlist),
    });
    expect(filed.target).toBe(STUDIO_NOTES);
    expect(itemsOf(shortlist).length).toBeGreaterThan(0);
  });

  // --- act 3 ------------------------------------------------------------------------------------

  await act("act 3: TidyCRM — normalise, merge what is certain, resolve what act 1 explains", async () => {
    const crm = await open(TIDYCRM);

    // Beat 1. `merge_contacts`, `delete_contacts` and `undo` are the gated three.
    assertClasses(crm, TIDYCRM);

    // Beat 2. Preview the phone normalisation, then run it on exactly what the preview named.
    // `read_view` is the survey sheet — zones and blocks, not rows — so the ids come from the
    // record search, which is the read that answers with contacts.
    const ids = itemsOf(await crm.read<Row>("search_records", { text: "", limit: 500 }))
      .map((row) => safe(() => contact.id(row), ""))
      .filter((id) => id.length > 0)
      .slice(0, 500);
    expect(ids.length, "contact ids to normalise").toBeGreaterThan(0);
    const preview = await crm.read<Row[]>("preview_normalize", { ids, rules: ["phone_e164"] });
    const pending = itemsOf(preview);
    expect(pending.length, "contacts with a phone to reformat").toBeGreaterThan(0);
    await crm.run("normalize_fields", { ids: pending.map((row) => contact.id(row)), rules: ["phone_e164"] });
    expect(itemsOf(await crm.read<Row[]>("preview_normalize", { ids, rules: ["phone_e164"] })).length).toBe(0);
    await shot("act3-tidycrm");

    // Beat 3. The merge queue: the confident duplicates merged one approval each, the uncertain
    // ones closed with a verdict rather than a merge.
    const queue = itemsOf(await crm.read<Row>("read_pairs", { limit: 50 }));
    expect(queue.length).toBeGreaterThan(0);
    const confident = queue.filter(isConfidentPair);
    const uncertain = queue.filter((row) => !isConfidentPair(row));
    expect(confident.length, "confident duplicates").toBeGreaterThan(0);
    for (const row of confident) {
      const merged = await crm.approveAndRun("merge_contacts", { keep_id: pair.keep(row), drop_id: pair.drop(row) });
      expect(merged.row.approval).toBeTruthy();
    }
    for (const row of uncertain) {
      await crm.run("resolve_pair", { pair_id: pair.id(row), verdict: "skipped" });
    }

    // Beat 4. The company-name conflict act 1 already explained. The bank alias says the CRM
    // spelling belongs to Pinegrove Collective, so the fact decides it and the call cites nothing
    // this app could have told the runner on its own.
    const alias = brain.recall("pinegrove");
    expect(alias.cites.length).toBeGreaterThan(0);
    const conflicts = itemsOf(await crm.read<Row>("read_conflicts", { limit: 20 }));
    const pinegrove = conflicts.find((row) => conflict.domain(row) === companyDomain("Pinegrove Collective"));
    expect(pinegrove, "a pinegrove company-name conflict").toBeTruthy();
    expect(conflict.spellings(pinegrove!)).toContain(PINEGROVE_ALIAS.crm);
    // The canonical name comes from the registry act 1 learned the alias against, and it is NOT
    // the app's own consensus: the majority spelling on this domain is a misspelling, so a runner
    // that trusted the app here would file the whole block under the wrong name.
    const canonical = companyByName("Pinegrove Collective")!.name;
    expect(conflict.consensus(pinegrove!)).not.toBe(canonical);
    await crm.read<Row>("preview_company", { domain: conflict.domain(pinegrove!), canonical_name: canonical });
    await crm.run("resolve_company", { domain: conflict.domain(pinegrove!), canonical_name: canonical });
    // What changed is the block's own idea of its name: the spelling the majority of the domain's
    // contacts are filed under is now the registry's, which it was not before the fact was
    // applied. A residual spelling on one or two records is a conflict a person still owns.
    const settled = itemsOf(await crm.read<Row>("read_conflicts", { limit: 20 })).find(
      (row) => conflict.domain(row) === companyDomain("Pinegrove Collective"),
    );
    if (settled) expect(conflict.consensus(settled)).toBe(canonical);

    // Beat 5. The campaign export, minus the client act 1 went quiet on — the runner's own decision,
    // citing the act 1 row that taught it.
    const exported = await crm.read<Row>("export", { segment: CAMPAIGN_SEGMENT });
    const companies = itemsOf(exported);
    expect(companies.length, "companies in the campaign segment").toBeGreaterThan(1);
    // Held back by domain, not by spelling: TidyCRM files this client under four spellings and
    // the domain is the key the three apps share.
    const quiet = companies.filter((row) => contact.domain(row) === companyDomain(QUIET_CLIENT));
    expect(quiet.length, `${QUIET_CLIENT} is in the export the app produced`).toBeGreaterThan(0);
    const campaign = companies.filter((row) => !quiet.includes(row));
    const quietChase = ledger.byApp("ledgerbox").find((row) => row.tool === "draft_reminder");
    const quietFact = brain.writeFact(
      `${QUIET_CLIENT} paid most of the invoice and went quiet; hold them out of the campaign as act 1 held them out of the chases`,
      [quietChase!],
      "tidycrm",
    );
    expect(quietFact.cites.length).toBe(1);
    expect(campaign.every((row) => contact.domain(row) !== companyDomain(QUIET_CLIENT))).toBe(true);

    // Beat 6. The result, appended to the studio's page.
    const filed = await notebook.approveAndRun("append_to_page", {
      page_id: STUDIO_NOTES,
      text: `TidyCRM campaign: ${campaign.length} companies, ${quiet.length} held back (${QUIET_CLIENT}).`,
    });
    expect(filed.target).toBe(STUDIO_NOTES);
  });

  // --- act 4 ------------------------------------------------------------------------------------

  await act("act 4: the record — one row per call, both declines, every gate accounted for", async () => {
    // Beat 1. Three applications, one page that never agreed to anything, and two connectors —
    // all three tiers of README section 3.4 in one ledger. Tier 2 is the one that says the demo is
    // not only about pages that adopted WebMCP.
    const apps = new Set(ledger.rows.map((row) => row.app));
    for (const id of ["ledgerbox", "hirelane", "tidycrm", "kestrel-portal"]) {
      expect(apps.has(id), `${id} in the record`).toBe(true);
    }
    for (const tier of [1, 2, 3] as const) {
      expect(ledger.rows.some((row) => row.tier === tier), `tier ${tier} in the record`).toBe(true);
    }
    // And a hand is only ever tier 2, wherever it ran: the record says where a call happened, and
    // a hand happens on the page rather than in an application that offered it.
    for (const row of ledger.rows.filter((r) => r.tool.startsWith("page_"))) {
      expect(row.tier, `${row.tool} on ${row.app}`).toBe(2);
    }

    // Beat 2. Both declines are in the record, with the one reason the vocabulary has for them.
    const denied = ledger.withReason("user_denied");
    expect(denied.length, "act 1's chase and act 2's rejection").toBe(2);
    expect(denied.map((row) => row.app).sort()).toEqual(["hirelane", "ledgerbox"]);

    // Beat 3. Every GATED execution names the approval that let it through, and that approval was
    // granted for that call.
    for (const row of ledger.gatedExecutions()) {
      expect(row.approval, `${row.app}/${row.tool} executed without an approval id`).toBeTruthy();
      expect(approvals.get(row.approval!)?.status).toBe("granted");
    }

    // Beat 4. Every connector write names an allow-listed target.
    const writes = ledger.connectorWrites().filter((row) => row.outcome === "ok");
    expect(writes.length).toBeGreaterThan(0);
    for (const row of writes) {
      expect(row.target, `${row.tool} named no target`).toBeTruthy();
      const allowed = row.app === "connector:mail" ? mail.allowed : notes.allowed;
      expect(allowed.has(row.target!), `${row.target} is on the allow-list`).toBe(true);
    }

    // Beat 5. Every fact the journey carried cites a live row, and the three apps are one story.
    expect(brain.facts.length, "one fact per cross-act thread").toBeGreaterThanOrEqual(3);
    for (const fact of brain.facts) {
      expect(fact.cites.length).toBeGreaterThan(0);
      for (const seq of fact.cites) expect(ledger.rows[seq - 1]?.seq).toBe(seq);
    }

  });

  console.log(`\n${ledger.table()}\n`);
  console.log(`${brain.table()}\n`);
  expect(failures.join(`\n\n`), `${failures.length} of four acts failed`).toBe("");
});
