/**
 * docs/demo.md section 1 — "the take": the forty-two beats of the script, played on camera.
 *
 * This is the same journey `tests/journey.spec.ts` asserts, through the same bridge, the same
 * gate, the same approvals, the same ledger, the same brain and the same connector fakes — run at
 * the pace of the narration instead of as fast as the apps answer. One beat at a time: the beat's
 * actions fire, the surface strip says what is happening, and the take holds for
 * `max(clip, settle) + breath` before the next beat starts. The video is therefore never faster
 * than the voice, and a re-take after a script change is one command rather than an edit session.
 *
 * It is also a test, and deliberately: a recording that shows a gate being honoured while the gate
 * was not honoured is worse than no recording. The invariants the journey asserts are asserted
 * here as well — exactly the named tools are GATED per app, both declines are `user_denied`, every
 * connector write names an allow-listed target, every fact cites a live ledger row. What is
 * different is the failure mode. A beat that throws is *recorded* in `take/take.json` as `error`
 * and the take carries on, because losing twenty minutes of video to one moved field is the one
 * outcome a recorder must not have; the test then fails at the end if any beat errored.
 *
 * Run it with `pnpm exec playwright test tests/take.spec.ts` (see `playwright.config.ts`: the take
 * is ignored by a bare `playwright test`, so `pnpm test` is still the journey and nothing else).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { HIRELANE, LEDGERBOX, TIDYCRM, urlOf, type AppSpec } from "../src/apps.ts";
import { Approvals } from "../src/approvals.ts";
import { boot, shutdown, type Booted } from "../src/boot.ts";
import { Brain } from "../src/brain.ts";
import { ConnectorSurface } from "../src/connector-surface.ts";
import { FakeMail } from "../src/connectors/fake-mail.ts";
import { FakeNotes } from "../src/connectors/fake-notes.ts";
import { Ledger } from "../src/ledger.ts";
import { recordPage } from "../src/record-page.ts";
import { installBridge } from "../src/relay.ts";
import {
  TAKE_DIR,
  beatsOf,
  captionOf,
  clipMsOf,
  holdMsOf,
  loadDurations,
  loadScript,
  scriptPath,
} from "../src/script.ts";
import { STUDIO_NOTES, assertClasses } from "../src/stage.ts";
import { Strip, argLine } from "../src/strip.ts";
import { Surface } from "../src/surface.ts";
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
  companyByName,
  companyDomain,
  conflict,
  contact,
  contactEmailFor,
  credit,
  draft,
  invoice,
  isConfidentPair,
  itemsOf,
  outbound,
  pair,
  safe,
  slotIdFrom,
  unambiguousMatch,
  type Row,
} from "../src/contracts.ts";

/** Twenty-five minutes: forty-two beats at their held length, plus three cold Next dev boots. */
test.describe.configure({ timeout: 25 * 60 * 1000 });

const script = loadScript();
const durations = loadDurations();
const beats = beatsOf(script);

const VIDEO = join(TAKE_DIR, "journey.webm");
const OFFSETS = join(TAKE_DIR, "take.json");
const WIDTH = 1440;
const HEIGHT = 900;

/**
 * Playwright's video starts when the context is created, and the exact frame it starts on is not
 * observable from Node. Every offset in `take.json` is therefore `Date.now()` at the beat minus
 * `Date.now()` at context creation, and this is the honest error bar on all of them — stated in
 * the file rather than left for the compose step to discover.
 */
const VIDEO_OFFSET_UNCERTAINTY_MS = 300;

/** The record, the memory and the approval table — one of each, shared by all forty-two beats. */
const ledger = new Ledger();
const approvals = new Approvals();
const brain = new Brain();
const mail = new FakeMail(STUDIO.inbox);
const notes = new FakeNotes();
const mailer = new ConnectorSurface(mail, approvals, ledger);
const notebook = new ConnectorSurface(notes, approvals, ledger);

interface Mark {
  id: string;
  start_ms: number;
  end_ms: number;
  caption: string;
  error?: string;
}

const marks: Mark[] = [];
const booted: Booted[] = [];
let context: BrowserContext;
let page: Page;
let strip: Strip;
let contextAt = 0;

/** Everything one beat learned that a later beat needs. The take is one continuous turn. */
const st: {
  books?: Surface;
  board?: Surface;
  crm?: Surface;
  credits: Row[];
  easy: Row[];
  pinegrove: Row | null;
  matchedSeqs: number[];
  overdue: Row[];
  chased: Row[];
  drafts: Map<string, Row>;
  oldest?: Row;
  second?: Row;
  quiet?: Row;
  card: number;
  exported: string;
  applied: Row[];
  band: Row[];
  advancing: Row[];
  slots: Map<string, string>;
  rejected?: Row;
  zone: string;
  pinegroveDomain: string;
  confident: Row[];
  uncertain: Row[];
  campaign: number;
  held: number;
} = {
  credits: [],
  easy: [],
  pinegrove: null,
  matchedSeqs: [],
  overdue: [],
  chased: [],
  drafts: new Map(),
  card: -1,
  exported: "",
  applied: [],
  band: [],
  advancing: [],
  slots: new Map(),
  zone: "A",
  pinegroveDomain: "",
  confident: [],
  uncertain: [],
  campaign: 0,
  held: 0,
};

/** Navigate, put the strip back, and list what the new page offers — the surface's whole arrival. */
async function openApp(app: AppSpec): Promise<Surface> {
  await page.goto(urlOf(app), { waitUntil: "domcontentloaded" });
  await strip.reattach();
  await strip.set({ app: app.id, presence: "attaching…" });
  const surface = new Surface(app, page, approvals, ledger);
  await surface.settle();
  await strip.set({ app: app.id, presence: presenceOf(surface) });
  return surface;
}

/**
 * The presence line, counting the *page's* own capabilities.
 *
 * The eight generic hands are on every surface and every one of them is GATED on first sight, so
 * counting them here would print "11 gated" on all three apps and say nothing about any of them.
 * What the audience is being told is what this application offered and which of those it declared
 * consequential, which is the number docs/demo.md section 2 quotes.
 */
function presenceOf(surface: Surface): string {
  const own = surface.names().filter((name) => !surface.isHand(name));
  const gated = own.filter((name) => surface.classOf(name) === "GATED");
  return `${own.length} offered · ${gated.length} gated`;
}

/** One AUTO read, with the strip saying what is being called before it is called. */
async function shown<T>(surface: Surface, name: string, params: Record<string, unknown> = {}): Promise<T> {
  await strip.call(name, argLine(params));
  return surface.read<T>(name, params);
}

/** One AUTO write, announced the same way. Never more than one of these per beat on camera. */
async function act(surface: Surface, name: string, params: Record<string, unknown> = {}): Promise<string> {
  await strip.call(name, argLine(params));
  return (await surface.run(name, params)).output;
}

/** A decision card, raised and left waiting: the next beat is the person answering it. */
async function ask(title: string, question: string, detail: string): Promise<void> {
  await strip.clearCards();
  st.card = await strip.decision({ title, question, detail });
}

test.beforeAll(async ({ browser }) => {
  notes.seed([{ id: STUDIO_NOTES, parent: null, title: "Halden Studio — weekly record" }]);
  notes.allow(STUDIO_NOTES);
  for (const app of [LEDGERBOX, HIRELANE, TIDYCRM]) {
    booted.push(await boot(app, (line) => console.log(`[boot] ${line}`)));
  }
  mkdirSync(TAKE_DIR, { recursive: true });
  // The video is what this spec is *for*, so it is not behind an environment variable the way the
  // journey's is. One context, one page, one file: recordVideo writes a video per page, and a
  // second tab would be a second video the compose step has no offsets for.
  context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: TAKE_DIR, size: { width: WIDTH, height: HEIGHT } },
  });
  contextAt = Date.now();
  page = await context.newPage();
  await installBridge(page);
  strip = await Strip.install(page);
  // Pre-roll, before beat 0.1: walk all three apps once so Next has compiled them. A first
  // navigation to a cold route costs seconds, and a beat that spends its hold compiling is a beat
  // whose picture arrives after its line. The pre-roll is on the video; every beat carries its own
  // measured offset, so the compose step lays the audio after it rather than over it.
  for (const app of [HIRELANE, TIDYCRM, LEDGERBOX]) {
    await page.goto(urlOf(app), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_500);
  }
  await strip.reattach();
});

test.afterAll(async () => {
  const video = page?.video();
  await context?.close();
  if (video) {
    await video.saveAs(VIDEO);
    // `saveAs` copies; the hashed original beside it would be a second nine-megabyte file with no
    // offsets and nothing to say which of the two the compose step should use.
    rmSync(await video.path(), { force: true });
  }
  writeFileSync(
    OFFSETS,
    `${JSON.stringify(
      {
        video: "journey.webm",
        width: WIDTH,
        height: HEIGHT,
        script: scriptPath(),
        video_offset_uncertainty_ms: VIDEO_OFFSET_UNCERTAINTY_MS,
        beats: marks,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\ntake: ${VIDEO}\noffsets: ${OFFSETS}\n`);
  for (const one of booted) await shutdown(one);
});

/**
 * What each beat does on screen, keyed by the script's own beat id.
 *
 * One entry per row of docs/demo.md section 2. A beat that is only a person speaking has an entry
 * too, because "the strip shows Mira typing and nothing else happens" is a thing the take has to
 * do rather than a thing it may skip.
 */
const ACTIONS: Record<string, () => Promise<void>> = {
  // --- act 0 --------------------------------------------------------------------------------
  "0.1": async () => {
    // The books, with nothing attached: the presence line is grey because no surface has listed
    // this page yet. The bridge is installed — it is an init script — but nobody has asked.
    await strip.set({ app: "ledgerbox", presence: "not connected", command: "", tool: "", args: "" });
  },

  "0.2": async () => {
    st.books = await openApp(LEDGERBOX);
    // The class of every tool comes from the gate, here as in the journey, and the strip prints
    // the count rather than a claim: 3 gated is `decide`'s answer, not the page's preference.
    assertClasses(st.books, LEDGERBOX);
  },

  "0.3": async () => {
    const board = await openApp(HIRELANE);
    assertClasses(board, HIRELANE);
    await page.waitForTimeout(600);
    const crm = await openApp(TIDYCRM);
    assertClasses(crm, TIDYCRM);
    await page.waitForTimeout(600);
    st.books = await openApp(LEDGERBOX);
  },

  // --- act 1, the books ---------------------------------------------------------------------
  "1.1": async () => {
    /* Mira's line types itself into the strip; the beat loop does that for every mira beat. */
  },

  "1.2": async () => {
    const books = st.books!;
    await shown<Row>(books, "read_books");
    const answer = await shown<Row>(books, "read_credits");
    st.credits = itemsOf(answer);
    st.easy = st.credits.filter((row) => unambiguousMatch(row) !== null);
    // The credit that arrived under a trading name is held back for beat 1.6: it is the one the
    // demo stops on, and matching it with the rest would spend it off camera.
    st.pinegrove =
      st.easy.find((row) =>
        `${safe(() => credit.alias(row) ?? "", "")} ${safe(() => credit.memo(row), "")}`
          .toUpperCase()
          .includes(PINEGROVE_ALIAS.bank),
      ) ?? null;
    await strip.call("read_credits", `${st.credits.length} unapplied · ${st.easy.length} fit exactly one invoice`);
  },

  "1.3": async () => {
    const books = st.books!;
    const view = await shown<Row>(books, "read_view");
    const areas = safe(() => itemsOf(view.areas), [] as Row[]);
    if (areas.length > 0) await act(books, "open_group", { id: String(areas[0]!.id) });
    const line = st.easy.find((row) => row !== st.pinegrove)!;
    const target = unambiguousMatch(line)!;
    await act(books, "open_item", { id: target });
    const result = await books.run("match_bank_line", { invoice_id: target, line_id: credit.id(line) });
    await strip.call("match_bank_line", `${target} ← ${credit.id(line)}`);
    st.matchedSeqs.push(result.row.seq);
  },

  "1.4": async () => {
    const books = st.books!;
    const rest = st.easy.filter((row) => row !== st.pinegrove).slice(1);
    const [next, ...batch] = rest;
    if (next) {
      const target = unambiguousMatch(next)!;
      await act(books, "open_item", { id: target });
      const result = await books.run("match_bank_line", { invoice_id: target, line_id: credit.id(next) });
      await strip.call("match_bank_line", `${target} ← ${credit.id(next)}`);
      st.matchedSeqs.push(result.row.seq);
    }
    // The rest are the same reversible call over and over, and a demo that filmed all of them
    // would be filming the same second eleven times. They still run, and they are still rows.
    for (const row of batch) {
      const result = await books.run("match_bank_line", {
        invoice_id: unambiguousMatch(row)!,
        line_id: credit.id(row),
      });
      st.matchedSeqs.push(result.row.seq);
    }
    await strip.call("match_bank_line", `and ${batch.length} more · ${st.matchedSeqs.length} matched`);
  },

  "1.5": async () => {
    const books = st.books!;
    const answer = await shown<Row>(books, "read_credits", { only: "ambiguous" });
    const open = itemsOf(answer);
    expect(open.length, "exactly one credit a person has to decide").toBe(1);
    expect(credit.memo(open[0]!)).toMatch(/kestrel/i);
    await strip.call(
      "read_credits",
      `only=ambiguous · ${credit.id(open[0]!)} fits ${credit.candidates(open[0]!).length} identical retainers — left for a person`,
    );
  },

  "1.6": async () => {
    const books = st.books!;
    const line = st.pinegrove!;
    const target = unambiguousMatch(line)!;
    await act(books, "open_item", { id: target });
    const result = await books.run("match_bank_line", { invoice_id: target, line_id: credit.id(line) });
    const alias = aliasFromMatch(result.output) ?? credit.alias(line) ?? PINEGROVE_ALIAS.bank;
    await strip.call("match_bank_line", `${target} ← ${credit.id(line)} · counterparty: ${alias}`);
    // Invariant 2: the citation is a precondition of the write, not a column somebody may leave
    // empty. The row this cites is the match that just happened, one line above.
    const fact = brain.writeFact(`Pinegrove Collective pays as ${PINEGROVE_ALIAS.bank}`, [result.row], "ledgerbox");
    expect(fact.cites).toEqual([result.row.seq]);
    await strip.fact(fact.claim, `cites ledger #${result.row.seq} match_bank_line`);
  },

  "1.7": async () => {
    const books = st.books!;
    await act(books, "navigate", { view: "overdue" });
    await books.settle();
    st.overdue = [];
    for (let index = 0; index < 6; index += 1) {
      const answer = await books.read<Row>("read_inbox", { filter: "overdue", page: index });
      const bounds = safe(() => Number((answer as Row).of ?? 0), 0);
      st.overdue.push(...itemsOf(answer));
      if (st.overdue.length >= bounds || itemsOf(answer).length === 0) break;
    }
    const older = st.overdue.filter((row) => invoice.daysOverdue(row) > 30);
    await strip.call("read_inbox", `filter=overdue · ${st.overdue.length} past due, ${older.length} over thirty days`);
  },

  "1.8": async () => {
    const books = st.books!;
    // The same decision the journey takes, from the same signal: a client who has paid most of an
    // invoice and gone quiet is not chased, and the rule is `paid_ratio` rather than a name list.
    const older = st.overdue.filter((row) => invoice.daysOverdue(row) > 30);
    const quietClients = new Set(older.filter((row) => invoice.mostlyPaid(row)).map((row) => invoice.client(row)));
    expect([...quietClients], `${QUIET_CLIENT} is held back`).toContain(QUIET_CLIENT);
    st.quiet = older.find((row) => invoice.client(row) === QUIET_CLIENT);
    st.chased = older.filter(
      (row) => !quietClients.has(invoice.client(row)) && invoice.state(row) !== "disputed",
    );
    expect(st.chased.length, "invoices to chase").toBeGreaterThan(1);
    const sorted = [...st.chased].sort((a, b) => invoice.daysOverdue(b) - invoice.daysOverdue(a));
    st.oldest = sorted[0]!;
    st.second = sorted[1]!;
    await act(books, "open_item", { id: invoice.id(st.oldest) });
    const answer = await shown<Row>(books, "draft_reminder", { id: invoice.id(st.oldest), tone: "firm" });
    const composed = draft.of(answer);
    st.drafts.set(invoice.id(st.oldest), composed);
    expect(draft.to(composed)).toBe(contactEmailFor(invoice.client(st.oldest)));
    expect(draft.from(composed)).toBe(STUDIO.inbox);
    await strip.call("draft_reminder", `tone=firm · to ${draft.to(composed)} · ${invoice.daysOverdue(st.oldest)} days`);
  },

  "1.9": async () => {
    const composed = st.drafts.get(invoice.id(st.oldest!))!;
    await ask(
      "send_reminder",
      `Ready to send to ${draft.to(composed)} at ${invoice.client(st.oldest!)}. Shall I?`,
      `host:ledgerbox / send_reminder id=${invoice.id(st.oldest!)}`,
    );
    await strip.call("send_reminder", `${invoice.id(st.oldest!)} · waiting for a decision`);
  },

  "1.10": async () => {
    const composed = st.drafts.get(invoice.id(st.oldest!))!;
    await strip.answer(st.card, "approve");
    const to = draft.to(composed);
    // The allow-list is built from the registry contact of exactly the client being chased, which
    // is why the quiet one cannot receive mail even by accident (README section 4).
    mail.allow(to);
    await strip.call("send_mail", `to ${to}`, "mail");
    const posted = await mailer.approveAndRun("send_mail", {
      to,
      subject: draft.subject(composed),
      body: draft.body(composed),
    });
    expect(posted.target).toBe(to);
    await strip.call("send_reminder", `${invoice.id(st.oldest!)} · sent`);
    const sent = await st.books!.approveAndRun("send_reminder", { id: invoice.id(st.oldest!) });
    expect(sent.row.approval).toBeTruthy();
    expect(mail.sentTo(to).length).toBe(1);
  },

  "1.11": async () => {
    const books = st.books!;
    const row = st.second!;
    const answer = await shown<Row>(books, "draft_reminder", { id: invoice.id(row), tone: "gentle" });
    const composed = draft.of(answer);
    st.drafts.set(invoice.id(row), composed);
    const to = draft.to(composed);
    await ask(
      "send_reminder",
      `${invoice.client(row)}, ${invoice.daysOverdue(row)} days, gentle tone. Send it?`,
      `host:ledgerbox / send_reminder id=${invoice.id(row)}`,
    );
    await page.waitForTimeout(600);
    await strip.answer(st.card, "approve");
    mail.allow(to);
    await strip.call("send_mail", `to ${to}`, "mail");
    const posted = await mailer.approveAndRun("send_mail", {
      to,
      subject: draft.subject(composed),
      body: draft.body(composed),
    });
    expect(posted.target).toBe(to);
    const sent = await books.approveAndRun("send_reminder", { id: invoice.id(row) });
    expect(sent.row.approval).toBeTruthy();
  },

  "1.12": async () => {
    const row = st.quiet!;
    await strip.call(
      "read_invoice",
      `${invoice.client(row)} · paid_ratio ${safe(() => invoice.paidRatio(row), 0).toFixed(2)} · quiet since August`,
    );
    await ask(
      "send_reminder",
      `${invoice.client(row)} paid most of theirs in August and went quiet. Chase them anyway?`,
      `host:ledgerbox / send_reminder id=${invoice.id(row)}`,
    );
  },

  "1.13": async () => {
    const books = st.books!;
    const row = st.quiet!;
    await strip.answer(st.card, "decline");
    // Declined *and then attempted*: a decline that is only "the runner did not call it" proves
    // the runner's manners rather than the gate's. Nothing moves, and the row says why.
    const refusal = await books.declineAndRun("send_reminder", { id: invoice.id(row) });
    expect(refusal.reason).toBe("user_denied");
    expect(mail.sentTo(contactEmailFor(QUIET_CLIENT)).length, `${QUIET_CLIENT} received nothing`).toBe(0);
    await strip.call("send_reminder", `refused · user_denied · ledger #${refusal.row.seq}`);
  },

  "1.14": async () => {
    const books = st.books!;
    const exported = await shown<Row>(books, "export_summary", { period: "2026-08" });
    st.exported = bodyOf(exported);
    await ask(
      "create_page",
      "August is closed. File the summary on your notes page?",
      `connector:notes / create_page parent_id=${STUDIO_NOTES}`,
    );
    await strip.call("create_page", `“Ledgerbox — August 2026” under ${STUDIO_NOTES}`, "notes");
  },

  "1.15": async () => {
    await strip.answer(st.card, "approve");
    const filed = await notebook.approveAndRun("create_page", {
      parent_id: STUDIO_NOTES,
      title: "Ledgerbox — August 2026",
      body: st.exported,
    });
    expect(filed.target).toBe(STUDIO_NOTES);
    expect(notes.childrenOf(STUDIO_NOTES).length).toBe(1);
    await strip.call("create_page", `filed · ${notes.childrenOf(STUDIO_NOTES).length} page under ${STUDIO_NOTES}`, "notes");
  },

  // --- act 2, the pipeline ------------------------------------------------------------------
  "2.1": async () => {
    st.board = await openApp(HIRELANE);
    assertClasses(st.board, HIRELANE);
    // Nothing in this pipeline may be parameterised on who someone is rather than what they did,
    // asserted over the whole manifest so a tool added tomorrow cannot smuggle one in.
    const manifestText = JSON.stringify(st.board.manifest()).toLowerCase();
    for (const word of FORBIDDEN_PARAMETERS) {
      expect(manifestText.includes(`"${word}"`), `no parameter named ${word}`).toBe(false);
    }
  },

  "2.2": async () => {
    const board = st.board!;
    await act(board, "set_filter", { arguable: true });
    const view = await board.read<Row>("read_view");
    const groups = safe(() => itemsOf(view.groups), [] as Row[]);
    const wanted =
      groups.find((row) => String(row.id).includes(`screening::${BACKEND_ROLE}`)) ??
      groups.find((row) => String(row.id).includes(BACKEND_ROLE));
    if (wanted) await act(board, "open_group", { id: String(wanted.id) });
    const answer = await shown<Row>(board, "read_applicants", { role_id: BACKEND_ROLE, stage: "applied" });
    st.applied = itemsOf(answer);
    expect(st.applied.length, "applicants in `applied` on the backend role").toBeGreaterThan(0);
    await strip.call("read_applicants", `${st.applied.length} applied on ${BACKEND_ROLE}`);
  },

  "2.3": async () => {
    const board = st.board!;
    const first = st.applied[0]!;
    await act(board, "open_item", { id: applicant.id(first) });
    await act(board, "score_against_rubric", { applicant_id: applicant.id(first) });
    for (const person of st.applied.slice(1)) {
      await board.run("score_against_rubric", { applicant_id: applicant.id(person) });
    }
    await strip.call("score_against_rubric", `${st.applied.length} scored · five criteria, every one quoting a sentence`);
  },

  "2.4": async () => {
    const board = st.board!;
    const answer = await shown<Row>(board, "read_applicants", { role_id: BACKEND_ROLE, borderline: true });
    st.band = itemsOf(answer);
    expect(st.band.length, "a borderline band the rubric leaves open").toBeGreaterThan(1);
    // Keyed on the address: two other borderline applicants share a name with this one, so a beat
    // that matched on the name would match the wrong person and still pass.
    const wren = st.band.find((row) => safe(() => applicant.email(row), "") === KESTREL_APPLICANT.email);
    expect(wren, `${KESTREL_APPLICANT.email} is one of the borderline applicants`).toBeTruthy();
    await act(board, "open_item", { id: applicant.id(wren!) });
    const kestrelCredit = ledger.byApp("ledgerbox").find((row) => row.tool === "read_credits")!;
    const fact = brain.writeFact(
      `${applicant.name(wren!)} <${KESTREL_APPLICANT.email}> works at Kestrel Labs, the client whose credit act 1 left unmatched`,
      [kestrelCredit, ledger.rows.at(-1)!],
      "hirelane",
    );
    await strip.call("open_item", `employer: ${applicant.employer(wren!)} · context only, the score does not move`);
    await strip.fact(fact.claim, `cites ledger #${fact.cites.join(", #")}`);
  },

  "2.5": async () => {
    mail.seed(
      st.band.slice(0, 3).map((row, index) => ({
        from: applicant.email(row),
        to: STUDIO.inbox,
        subject: "Re: backend role — availability",
        body: `Any afternoon next week works for me. — ${applicant.name(row)}`,
        received_at: `2026-09-0${index + 1}T09:00:00Z`,
      })),
    );
    await strip.call("search_mail", "query=availability", "mail");
    const replies = itemsOf(await mailer.read<Row>("search_mail", { query: "availability" }));
    expect(replies.length, "availability replies in the studio inbox").toBeGreaterThan(1);
    await strip.call("search_mail", `${replies.length} replies from the applicants themselves`, "mail");
  },

  "2.6": async () => {
    const board = st.board!;
    st.advancing = st.band.slice(0, 2);
    for (const person of st.advancing) {
      await act(board, "move_stage", { applicant_id: applicant.id(person), stage: "interview" });
      const proposed = await shown<Row>(board, "propose_slots", { applicant_id: applicant.id(person) });
      st.slots.set(applicant.id(person), slotIdFrom(proposed));
    }
    await strip.call("propose_slots", `${st.slots.size} slots held`);
  },

  "2.7": async () => {
    await ask(
      "send_scheduling_email",
      `Two invitations to send — ${st.advancing.map((row) => applicant.name(row)).join(" and ")}. From your inbox, signed by you.`,
      `host:hirelane / send_scheduling_email ×2`,
    );
    await strip.call("send_scheduling_email", "waiting for a decision");
  },

  "2.8": async () => {
    const board = st.board!;
    await strip.answer(st.card, "approve");
    for (const person of st.advancing) {
      const composed = await board.approveAndRun("send_scheduling_email", {
        applicant_id: applicant.id(person),
        slot_id: st.slots.get(applicant.id(person))!,
      });
      const to = outbound.to(JSON.parse(composed.output) as Row);
      expect(to).toBe(applicant.email(person));
      mail.allow(to);
      await strip.call("send_mail", `to ${to}`, "mail");
      const posted = await mailer.approveAndRun("send_mail", {
        to,
        subject: outbound.subject(JSON.parse(composed.output) as Row),
        body: outbound.body(JSON.parse(composed.output) as Row),
      });
      expect(posted.target).toBe(to);
    }
    await strip.call("send_scheduling_email", "2 invitations recorded");
  },

  "2.9": async () => {
    st.rejected = st.band.at(-1)!;
    await ask(
      "send_rejection",
      `One rejection, encouraging wording — ${applicant.name(st.rejected)}. Send it?`,
      `host:hirelane / send_rejection template=encouraging`,
    );
    await strip.call("send_rejection", "template=encouraging · waiting for a decision");
  },

  "2.10": async () => {
    const board = st.board!;
    const rejected = st.rejected!;
    const stageOf = async (): Promise<Row | undefined> =>
      itemsOf(await board.read<Row>("read_applicants", { role_id: BACKEND_ROLE, borderline: true })).find(
        (row) => applicant.id(row) === applicant.id(rejected),
      );
    const before = await stageOf();
    await strip.answer(st.card, "decline");
    const refusal = await board.declineAndRun("send_rejection", {
      applicant_id: applicant.id(rejected),
      template: "encouraging",
    });
    expect(refusal.reason).toBe("user_denied");
    expect(await stageOf(), "the board is exactly as it was").toEqual(before);
    expect(mail.sentTo(applicant.email(rejected)).length).toBe(0);
    await strip.call("send_rejection", `refused · user_denied · ledger #${refusal.row.seq}`);
  },

  "2.11": async () => {
    const board = st.board!;
    const shortlist = await shown<Row>(board, "read_shortlist", { role_id: BACKEND_ROLE });
    expect(itemsOf(shortlist).length).toBeGreaterThan(0);
    await strip.call("append_to_page", `Backend Engineer shortlist → ${STUDIO_NOTES}`, "notes");
    const filed = await notebook.approveAndRun("append_to_page", { page_id: STUDIO_NOTES, text: bodyOf(shortlist) });
    expect(filed.target).toBe(STUDIO_NOTES);
  },

  // --- act 3, the contact list --------------------------------------------------------------
  "3.1": async () => {
    st.crm = await openApp(TIDYCRM);
    assertClasses(st.crm, TIDYCRM);
  },

  "3.2": async () => {
    const crm = st.crm!;
    const ids = itemsOf(await crm.read<Row>("search_records", { text: "" }))
      .map((row) => safe(() => contact.id(row), ""))
      .filter((id) => id.length > 0);
    expect(ids.length, "contact ids to normalise").toBeGreaterThan(0);
    const preview = await shown<Row[]>(crm, "preview_normalize", { ids, rules: ["phone_e164"] });
    const pending = itemsOf(preview);
    expect(pending.length, "contacts with a phone to reformat").toBeGreaterThan(0);
    await act(crm, "normalize_fields", { ids: pending.map((row) => contact.id(row)), rules: ["phone_e164"] });
    const left = itemsOf(await crm.read<Row[]>("preview_normalize", { ids, rules: ["phone_e164"] }));
    expect(left.length, "nothing left to reformat").toBe(0);
    await strip.call("normalize_fields", `phone_e164 · ${pending.length} numbers fixed, every change in the revisions log`);
  },

  "3.3": async () => {
    const crm = st.crm!;
    const view = await crm.read<Row>("read_view");
    const zones = safe(() => itemsOf(view.zones), [] as Row[]);
    st.zone = zones.length > 0 ? String(zones[0]!.id) : "A";
    await act(crm, "open_group", { id: st.zone });
    // The cube spends about three seconds turning its records into the grid, and the tool says so;
    // the beat's settle is that number, from the script.
    await page.waitForTimeout(2_900);
  },

  "3.4": async () => {
    const crm = st.crm!;
    const conflicts = itemsOf(await shown<Row>(crm, "read_conflicts", { limit: 20 }));
    const domain = companyDomain("Pinegrove Collective");
    const pinegrove = conflicts.find((row) => safe(() => conflict.domain(row), "") === domain);
    expect(pinegrove, "a pinegrove company-name conflict").toBeTruthy();
    st.pinegroveDomain = conflict.domain(pinegrove!);
    expect(conflict.spellings(pinegrove!)).toContain(PINEGROVE_ALIAS.crm);
    // Searched by the *domain* and not by the word: this sheet also carries a "Pinegrove Labs"
    // on a different domain, and a block picked by its spelling would be the wrong company —
    // which is the mistake this whole thread exists to avoid.
    const blocks = itemsOf(await crm.read<Row>("search_blocks", { text: st.pinegroveDomain }));
    const block =
      blocks.find((row) => String(row.domain ?? "").toLowerCase() === st.pinegroveDomain) ?? blocks[0];
    if (block) {
      await act(crm, "open_item", { id: String(block.ident ?? block.id), group: String(block.zone ?? st.zone) });
    }
    await strip.call(
      "open_item",
      `${st.pinegroveDomain} · ${conflict.spellings(pinegrove!).length} spellings, including ${PINEGROVE_ALIAS.crm}`,
    );
  },

  "3.5": async () => {
    const crm = st.crm!;
    // The fact act 1 wrote is what decides this, and the canonical name comes from the registry it
    // was learned against — deliberately NOT the app's own consensus, which is a misspelling.
    const learned = brain.recall("pinegrove");
    const canonical = companyByName("Pinegrove Collective")!.name;
    await shown<Row>(crm, "preview_company", { domain: st.pinegroveDomain, canonical_name: canonical });
    await act(crm, "resolve_company", { domain: st.pinegroveDomain, canonical_name: canonical });
    await strip.call("resolve_company", `→ ${canonical} · from ${learned.id}, cites ledger #${learned.cites.join(", #")}`);
    const settled = itemsOf(await crm.read<Row>("read_conflicts", { limit: 20 })).find(
      (row) => safe(() => conflict.domain(row), "") === st.pinegroveDomain,
    );
    if (settled) expect(conflict.consensus(settled)).toBe(canonical);
  },

  "3.6": async () => {
    const crm = st.crm!;
    const queue = itemsOf(await shown<Row>(crm, "read_pairs", { limit: 50 }));
    expect(queue.length).toBeGreaterThan(0);
    st.confident = queue.filter(isConfidentPair);
    st.uncertain = queue.filter((row) => !isConfidentPair(row));
    await strip.call("read_pairs", `${queue.length} near-duplicates · ${st.confident.length} confident, ${st.uncertain.length} for a person`);
  },

  "3.7": async () => {
    const crm = st.crm!;
    const [first, second, ...batch] = st.confident;
    for (const row of [first, second]) {
      if (!row) continue;
      await ask(
        "merge_contacts",
        `Merge ${pair.drop(row)} into ${pair.keep(row)}? A merge destroys a record.`,
        `host:tidycrm / merge_contacts keep_id=${pair.keep(row)} drop_id=${pair.drop(row)}`,
      );
      await page.waitForTimeout(700);
      await strip.answer(st.card, "approve");
      await strip.call("merge_contacts", `${pair.drop(row)} → ${pair.keep(row)}`);
      const merged = await crm.approveAndRun("merge_contacts", { keep_id: pair.keep(row), drop_id: pair.drop(row) });
      expect(merged.row.approval).toBeTruthy();
    }
    // The rest carry a card each as well — they are approved as a batch rather than on camera,
    // which is a decision about the film and not about the gate.
    for (const row of batch) {
      await crm.approveAndRun("merge_contacts", { keep_id: pair.keep(row), drop_id: pair.drop(row) });
    }
    for (const row of st.uncertain) {
      await crm.run("resolve_pair", { pair_id: pair.id(row), verdict: "skipped" });
    }
    await strip.call("merge_contacts", `and ${batch.length} more, approved as a batch · ${st.uncertain.length} left to a person`);
  },

  "3.8": async () => {
    const crm = st.crm!;
    const exported = await shown<Row>(crm, "export", { segment: CAMPAIGN_SEGMENT });
    const companies = itemsOf(exported);
    expect(companies.length, "companies in the campaign segment").toBeGreaterThan(1);
    // Held back by domain, not by spelling: this client is filed under four spellings and the
    // domain is the key the three apps share.
    const quiet = companies.filter((row) => safe(() => contact.domain(row), "") === companyDomain(QUIET_CLIENT));
    const campaign = companies.filter((row) => !quiet.includes(row));
    st.campaign = campaign.length;
    st.held = quiet.length;
    const quietChase = ledger.byApp("ledgerbox").find((row) => row.tool === "draft_reminder")!;
    const fact = brain.writeFact(
      `${QUIET_CLIENT} paid most of the invoice and went quiet; hold them out of the campaign as act 1 held them out of the chases`,
      [quietChase],
      "tidycrm",
    );
    expect(campaign.every((row) => safe(() => contact.domain(row), "") !== companyDomain(QUIET_CLIENT))).toBe(true);
    await strip.call("export", `segment=clients · ${campaign.length} companies · ${QUIET_CLIENT} held out`);
    await strip.fact(fact.claim, `cites ledger #${fact.cites.join(", #")}`);
  },

  "3.9": async () => {
    await ask(
      "append_to_page",
      "Append the campaign result to the close page?",
      `connector:notes / append_to_page page_id=${STUDIO_NOTES}`,
    );
    await page.waitForTimeout(600);
    await strip.answer(st.card, "approve");
    await strip.call("append_to_page", `${st.campaign} companies, ${st.held} held back`, "notes");
    const filed = await notebook.approveAndRun("append_to_page", {
      page_id: STUDIO_NOTES,
      text: `TidyCRM campaign: ${st.campaign} companies, ${st.held} held back (${QUIET_CLIENT}).`,
    });
    expect(filed.target).toBe(STUDIO_NOTES);
  },

  // --- act 4, the record --------------------------------------------------------------------
  "4.1": async () => {
    await strip.clearCards();
    await page.setContent(recordPage("ledger", ledger, brain));
    await strip.reattach();
    await strip.set({ app: "the record", presence: `${ledger.rows.length} rows`, say: null, command: "", tool: "", args: "" });
  },

  "4.2": async () => {
    await page.setContent(recordPage("declines", ledger, brain));
    await strip.reattach();
    await strip.set({ app: "the record", presence: `${ledger.withReason("user_denied").length} declined` });
  },

  "4.3": async () => {
    await page.setContent(recordPage("facts", ledger, brain));
    await strip.reattach();
    await strip.set({ app: "the record", presence: `${brain.facts.length} facts, every one citing a row` });
  },

  "4.4": async () => {
    await page.setContent(recordPage("title", ledger, brain));
    await strip.reattach();
    await strip.set({ app: "", presence: "", command: "", tool: "", args: "", say: null });
  },
};

test("the take: forty-two beats, on camera, at the pace of the narration", async () => {
  console.log(`script: ${scriptPath()} — ${beats.length} beats, ${Object.keys(durations).length} measured clips`);

  for (const beat of beats) {
    const clipMs = clipMsOf(beat, script, durations);
    const holdMs = holdMsOf(beat, script, durations);
    const startedAt = Date.now();
    let error: string | undefined;

    try {
      // The voice and the strip are one gesture: Mira types her line into the command field, and
      // Athena's line stands where the command was. The narrator is not a person in the room, so
      // nothing on screen claims to be speaking for them.
      //
      // A mira beat does its action *first* and types afterwards, and that ordering is load
      // bearing rather than cosmetic: the three commands that open an act are also the three
      // navigations, and a typing animation still running in the old document when the new one
      // loads is an evaluate against a destroyed execution context. The typing then takes 80% of
      // what is left of the clip, so it still finishes inside the beat.
      if (beat.voice === "athena") await strip.say(beat.line);
      if (beat.voice === "mira") await strip.set({ say: null, tool: "", args: "", connector: null });
      await (ACTIONS[beat.id] ?? (async () => {}))();
      if (beat.voice === "mira") {
        await strip.typeCommand(beat.line, Math.max(600, clipMs - (Date.now() - startedAt)));
      }
    } catch (caught) {
      // A beat that breaks must not cost the recording: it is written into take.json as an error
      // and the take carries on. The test fails at the end, with every failed beat named.
      error = (caught as Error).message;
      console.error(`beat ${beat.id} failed: ${error}`);
    }

    const remaining = holdMs - (Date.now() - startedAt);
    if (remaining > 0) await page.waitForTimeout(remaining);
    marks.push({
      id: beat.id,
      start_ms: startedAt - contextAt,
      end_ms: Date.now() - contextAt,
      caption: captionOf(beat),
      ...(error === undefined ? {} : { error }),
    });
  }

  // --- the record, asserted exactly as the journey asserts it --------------------------------

  // Both declines, with the one reason the closed vocabulary has for them.
  const denied = ledger.withReason("user_denied");
  expect(denied.length, "act 1's chase and act 2's rejection").toBe(2);
  expect(denied.map((row) => row.app).sort()).toEqual(["hirelane", "ledgerbox"]);

  // Every GATED execution names an approval, and that approval was granted for that call.
  for (const row of ledger.gatedExecutions()) {
    expect(row.approval, `${row.app}/${row.tool} executed without an approval id`).toBeTruthy();
    expect(approvals.get(row.approval!)?.status).toBe("granted");
  }

  // Every connector write names an allow-listed target.
  const writes = ledger.connectorWrites().filter((row) => row.outcome === "ok");
  expect(writes.length).toBeGreaterThan(0);
  for (const row of writes) {
    expect(row.target, `${row.tool} named no target`).toBeTruthy();
    const allowed = row.app === "connector:mail" ? mail.allowed : notes.allowed;
    expect(allowed.has(row.target!), `${row.target} is on the allow-list`).toBe(true);
  }

  // Every fact cites a live ledger row — invariant 2, checked against the record it cites.
  expect(brain.facts.length, "one fact per cross-act thread").toBeGreaterThanOrEqual(3);
  for (const fact of brain.facts) {
    expect(fact.cites.length).toBeGreaterThan(0);
    for (const seq of fact.cites) expect(ledger.rows[seq - 1]?.seq).toBe(seq);
  }

  console.log(`\n${ledger.table()}\n`);
  console.log(`${brain.table()}\n`);

  const broken = marks.filter((mark) => mark.error !== undefined);
  expect(
    broken.map((mark) => `${mark.id}: ${mark.error ?? ""}`).join("\n"),
    `${broken.length} of ${marks.length} beats errored (the take was still recorded)`,
  ).toBe("");
});
