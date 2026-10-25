/**
 * The letter is read before the gate: `preview_message` against the real sends, byte for byte.
 *
 * The two acts that reach a person and cannot be taken back were approved on a label - a wording
 * name in the dossier's gate, `template: "encouraging"` in Athena's approval card. These cases hold
 * the preview to the actions on a scratch database (the parity cases call the real `sendRejection`
 * and `sendSchedulingEmail` and compare their `mail` with what was shown), refuse where the actions
 * refuse in the actions' words, write nothing, and keep the encouraging label from promising what
 * the letter does not say.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tempHome } from "./tmp-home";

tempHome("hirelane-preview-test-");

const { db } = await import("../lib/db");
const { buildBoard } = await import("../lib/board");
const { REFUSAL, actsFor, canBook } = await import("../lib/acts");
const { REJECTION_TEMPLATES, REJECTION_TEMPLATE_LABEL } = await import("../lib/constants");
const { rejectionMail } = await import("../lib/mail");
const { CAPABILITIES, isAuto } = await import("../lib/manifest");
const { CAPABILITY_COUNTS } = await import("../components/board/register");
const { annotationsFor } = await import("@athena/demo-kit/webmcp");
const { proposeSlots, sendRejection, sendSchedulingEmail } = await import("../app/actions");

type Board = ReturnType<typeof buildBoard>;
type Preview = typeof import("../components/board/tools/preview");

/** Loaded per case, so each case fails on its own when the module is missing. */
const load = (): Promise<Preview> => import("../components/board/tools/preview");

function find(board: Board, id: string) {
  for (const role of board.roles) {
    for (const column of role.columns) {
      const candidate = column.candidates.find((c) => c.id === id);
      if (candidate) return { role, candidate };
    }
  }
  throw new Error(`no candidate ${id} on the board`);
}

const ids = (sql: string, params: string[] = []): string[] =>
  db()
    .all<{ id: string }>(sql, params)
    .map((r) => r.id);

const count = (table: string): number => db().get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;

const letter = (p: { to?: string; subject?: string; body?: string }) => ({ to: p.to, subject: p.subject, body: p.body });

/*
 * Run in order on one database: the cases that write nothing first, then the parity cases, which
 * really send and so consume the applicants they send to.
 */

test("case 6: no wording label claims what its letter does not say (strengths, or a criterion)", () => {
  const criterionWords = db()
    .all<{ name: string }>("SELECT name FROM criteria")
    .flatMap((c) => c.name.toLowerCase().split(/[^a-z]+/))
    .filter((w) => w.length >= 4);
  assert.ok(criterionWords.length >= 10, "the rubric was read, or this asserts nothing");
  const claims = new Set(["strength", "strengths", "strong", "strongest", ...criterionWords]);
  for (const template of REJECTION_TEMPLATES) {
    const body = rejectionMail({
      applicantName: "Ada Example",
      applicantEmail: "ada@example.test",
      roleTitle: "Backend Engineer",
      template,
    }).body.toLowerCase();
    const label = REJECTION_TEMPLATE_LABEL[template].toLowerCase().split(/[^a-z]+/);
    for (const word of label) {
      if (!claims.has(word)) continue;
      assert.ok(
        body.includes(word),
        `${template}: the label says "${word}" and the letter never does - "${REJECTION_TEMPLATE_LABEL[template]}"`,
      );
    }
  }
});

test("case 8 (guard): the standard rejection to the Kestrel applicant is byte-identical to the base tree's", () => {
  const kestrel = db().get<{ name: string; email: string; title: string }>(
    "SELECT a.name, a.email, r.title FROM applicants a JOIN roles r ON r.id = a.role_id WHERE a.employer = 'Kestrel Labs'",
  )!;
  const mail = rejectionMail({
    applicantName: kestrel.name,
    applicantEmail: kestrel.email,
    roleTitle: kestrel.title,
    template: "standard",
  });
  assert.equal(
    mail.body,
    "Hi Wren,\n\nThank you for applying for the Backend Engineer role at Halden Studio. We have read your application carefully and we are not taking it forward.\n\nWe appreciate the time you put into it, and we wish you well.\n\nMira Halden\nFounder, Halden Studio\nhello@halden.example",
  );
});

test("case 5: preview_message is an AUTO read with enums for kind and template, and the register counts it", async () => {
  const { MESSAGE_KINDS } = await load();
  const all: readonly import("../lib/manifest").Capability[] = CAPABILITIES;
  const capability = all.find((c) => c.name === "preview_message");
  assert.ok(capability, "preview_message is on the manifest");
  assert.equal(capability.reversible, true);
  assert.equal(capability.sideEffects, "none");
  assert.equal(isAuto(capability), true);
  const annotations = annotationsFor(capability);
  assert.equal(annotations.readOnlyHint, true, "readOnlyHint");
  assert.equal(annotations.consequentialHint, false, "not consequential");
  const params = Object.fromEntries(capability.parameters.map((p) => [p.name, p]));
  assert.deepEqual([...(params.kind?.enum ?? [])], ["rejection", "scheduling"]);
  assert.deepEqual([...MESSAGE_KINDS], ["rejection", "scheduling"]);
  assert.deepEqual([...(params.template?.enum ?? [])], [...REJECTION_TEMPLATES]);
  assert.equal(CAPABILITY_COUNTS.all, CAPABILITIES.length);
  assert.equal(CAPABILITY_COUNTS.autoReads, CAPABILITIES.filter((c) => isAuto(c) && c.sideEffects === "none").length);
});

test("case 7: previewing every seeded applicant, every kind and every choice writes nothing", async () => {
  const { previewMessage } = await load();
  const board = buildBoard();
  const before = { messages: count("messages"), activity: count("activity") };
  let shown = 0;
  for (const role of board.roles) {
    for (const column of role.columns) {
      for (const candidate of column.candidates) {
        for (const template of REJECTION_TEMPLATES) {
          if (previewMessage(board, { applicant_id: candidate.id, kind: "rejection", template }).ok) shown += 1;
        }
        const slot = actsFor(candidate, board.slots).schedule.slots[0] ?? board.slots[0];
        if (previewMessage(board, { applicant_id: candidate.id, kind: "scheduling", slot_id: slot?.id ?? "" }).ok) {
          shown += 1;
        }
      }
    }
  }
  assert.ok(shown > 0, "some letters were composed, or this asserts nothing");
  assert.deepEqual({ messages: count("messages"), activity: count("activity") }, before);
});

test("case 3: a decided applicant gets the action's own refusal and no letter", async () => {
  const { previewMessage } = await load();
  const board = buildBoard();
  const [rejected] = ids("SELECT id FROM applicants WHERE stage = 'rejected' ORDER BY id LIMIT 1");
  const { candidate } = find(board, rejected!);
  const result = previewMessage(board, { applicant_id: candidate.id, kind: "rejection", template: "standard" });
  assert.deepEqual(result, { ok: false, reason: "decided", why: REFUSAL.decided(candidate) });
  const sent = await sendRejection(candidate.id, "standard");
  assert.equal(sent.ok, false);
  assert.equal(sent.message, result.ok ? "" : result.why, "the same words the action refuses with");
});

test("case 4: a slot held for someone else refuses as slot_taken, and Applied is too early", async () => {
  const { previewMessage } = await load();
  const [mine, other] = ids("SELECT id FROM applicants WHERE stage = 'interview' ORDER BY id LIMIT 2");
  const held = await proposeSlots(other!);
  assert.equal(held.ok, true, held.message);
  const board = buildBoard();
  const theirs = board.slots.find((s) => s.applicantId === other && s.status === "proposed");
  assert.ok(theirs && !canBook(theirs, mine!), "a slot held for the other candidate");
  assert.deepEqual(previewMessage(board, { applicant_id: mine!, kind: "scheduling", slot_id: theirs.id }), {
    ok: false,
    reason: "slot_taken",
    why: REFUSAL.slot_taken(),
  });

  const [applied] = ids("SELECT id FROM applicants WHERE stage = 'applied' ORDER BY id LIMIT 1");
  const { candidate } = find(board, applied!);
  const early = previewMessage(board, { applicant_id: applied!, kind: "scheduling", slot_id: board.slots[0]!.id });
  assert.equal(early.ok, false);
  assert.equal(early.ok ? "" : early.reason, "too_early");
  assert.equal(early.ok ? "" : early.why, REFUSAL.too_early(candidate));
});

test("case 1: each rejection preview is the letter sendRejection really sends", async () => {
  const { previewMessage } = await load();
  const board = buildBoard();
  const unscored = board.roles
    .flatMap((r) => r.columns)
    .filter((c) => c.id === "screening")
    .flatMap((c) => c.candidates)
    .filter((c) => !c.scored);
  assert.ok(unscored.length >= REJECTION_TEMPLATES.length, "an unscored screening applicant per wording");
  for (const [i, template] of REJECTION_TEMPLATES.entries()) {
    const person = unscored[i]!;
    const shown = previewMessage(board, { applicant_id: person.id, kind: "rejection", template });
    assert.equal(shown.ok, true, shown.ok ? "" : shown.why);
    const sent = await sendRejection(person.id, template);
    assert.equal(sent.ok, true, sent.message);
    assert.deepEqual(letter(shown.ok ? shown : {}), sent.mail, `${template}: the preview is the sent letter`);
  }
});

test("case 2: a scheduling preview is the letter sendSchedulingEmail really sends", async () => {
  const { previewMessage } = await load();
  const board = buildBoard();
  const [id] = ids("SELECT id FROM applicants WHERE stage = 'interview' ORDER BY id DESC LIMIT 1");
  const { candidate } = find(board, id!);
  const slot = actsFor(candidate, board.slots).schedule.slots[0];
  assert.ok(slot, "the interview applicant has a bookable slot");
  const shown = previewMessage(board, { applicant_id: candidate.id, kind: "scheduling", slot_id: slot.id });
  assert.equal(shown.ok, true, shown.ok ? "" : shown.why);
  const sent = await sendSchedulingEmail(candidate.id, slot.id);
  assert.equal(sent.ok, true, sent.message);
  assert.deepEqual(letter(shown.ok ? shown : {}), sent.mail);
});
