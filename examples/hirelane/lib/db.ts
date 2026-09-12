import "server-only";
import { openDb, type Db } from "@athena/demo-kit/db";
import { createActivityTable, logActivity } from "@athena/demo-kit/activity";
import { rngFor, type Rng, COMPANIES, KESTREL_APPLICANT } from "@athena/demo-kit/seed";

import { APP_ID, TODAY, type Stage } from "./constants";
import { rejectionMail } from "./mail";
import { scoreAgainst, summarise } from "./scoring";
import { EARLIER_LEADS, ROLE_SEEDS, SECTION_LEADS, type RoleSeed } from "./seed-content";
import type { Criterion } from "./types";

export { APP_ID };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS roles (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  team      TEXT NOT NULL,
  brief     TEXT NOT NULL,
  question  TEXT NOT NULL,
  opened_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS criteria (
  id          TEXT PRIMARY KEY,
  role_id     TEXT NOT NULL REFERENCES roles(id),
  ord         INTEGER NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  weight      INTEGER NOT NULL,
  keywords    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS applicants (
  id               TEXT PRIMARY KEY,
  role_id          TEXT NOT NULL REFERENCES roles(id),
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  employer         TEXT NOT NULL,
  headline         TEXT NOT NULL,
  years            INTEGER NOT NULL,
  cv_text          TEXT NOT NULL,
  short_answer     TEXT NOT NULL,
  stage            TEXT NOT NULL CHECK (stage IN ('applied','screening','interview','offer','rejected')),
  applied_at       TEXT NOT NULL,
  borderline       INTEGER NOT NULL DEFAULT 0 CHECK (borderline IN (0,1)),
  gap_criterion_id TEXT
);
CREATE INDEX IF NOT EXISTS applicants_role ON applicants (role_id, stage);
CREATE TABLE IF NOT EXISTS notes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id TEXT NOT NULL REFERENCES applicants(id),
  ts           TEXT NOT NULL,
  author       TEXT NOT NULL CHECK (author IN ('user','athena','system')),
  kind         TEXT NOT NULL CHECK (kind IN ('note','rubric')),
  body         TEXT NOT NULL,
  scores_json  TEXT
);
CREATE INDEX IF NOT EXISTS notes_applicant ON notes (applicant_id, id DESC);
CREATE TABLE IF NOT EXISTS stage_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id TEXT NOT NULL REFERENCES applicants(id),
  ts           TEXT NOT NULL,
  from_stage   TEXT,
  to_stage     TEXT NOT NULL,
  actor        TEXT NOT NULL CHECK (actor IN ('user','athena','system')),
  reason       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stage_events_applicant ON stage_events (applicant_id, id);
CREATE TABLE IF NOT EXISTS slots (
  id           TEXT PRIMARY KEY,
  interviewer  TEXT NOT NULL,
  start_ts     TEXT NOT NULL,
  minutes      INTEGER NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('open','proposed','booked')),
  applicant_id TEXT REFERENCES applicants(id)
);
CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id TEXT NOT NULL REFERENCES applicants(id),
  ts           TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('scheduling','rejection')),
  -- A message row is a complete envelope. The send is carried by a mail connector outside the
  -- page (README section 4), and an address it has to look up is an address it can get wrong.
  to_email     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL
);
`;

/** How many applicants each role gets, and how they are spread across the board. */
const PIPELINE: Record<string, { stage: Stage; count: number }[]> = {
  role_backend: [
    { stage: "applied", count: 11 },
    { stage: "screening", count: 7 },
    { stage: "interview", count: 3 },
    { stage: "offer", count: 1 },
    { stage: "rejected", count: 2 },
  ],
  role_designer: [
    { stage: "applied", count: 9 },
    { stage: "screening", count: 4 },
    { stage: "interview", count: 2 },
    { stage: "rejected", count: 1 },
  ],
};

/** Six borderline applicants, all on the backend role, all sitting in screening. */
const BORDERLINE_PER_ROLE: Record<string, number> = { role_backend: 6, role_designer: 0 };

/**
 * The cross-app thread, pinned rather than drawn.
 *
 * Exactly ONE applicant in this database works at Kestrel Labs, and it is the first of the six
 * borderline backend applicants: the same person Ledgerbox chases an invoice at and TidyCRM files
 * as a Kestrel contact, under the same name and the same address, because
 * `KESTREL_APPLICANT` in `@athena/demo-kit/seed` is where all three read it from. A drawn employer
 * could not be relied on to be there at all, and a second Kestrel applicant would make "the one
 * who works at the client we are chasing" ambiguous — which is the whole beat.
 *
 * Athena may name the relationship as context. Nothing in this app lets it change a score or a
 * stage: the employer is not a rubric criterion, `scoreAgainst` reads only the applicant's own
 * sentences, and no stage-setting action takes an employer at all.
 */
const CROSS_APP_ROLE = "role_backend";
const CROSS_APP_EMPLOYER = "Kestrel Labs";

/**
 * Keep the reserved employer out of every other application, without spending a draw.
 *
 * The draw still happens and still consumes the same value, so the seed stream — and every row
 * after this one — is byte-identical to a seed that did not reserve anything.
 */
function unreserved(name: string): string {
  if (name !== CROSS_APP_EMPLOYER) return name;
  const at = COMPANIES.findIndex((c) => c.name === CROSS_APP_EMPLOYER);
  return COMPANIES[(at + 1) % COMPANIES.length]!.name;
}

/** The smallest step a stage trail takes when its own draw does not move the clock forward. */
const HOUR_MS = 60 * 60 * 1000;

interface Draft {
  cv: string;
  answer: string;
  gap: string | null;
}

/** Assemble one CV out of criterion lines. `hits` decides the scorecard before it is ever run. */
function writeCv(
  rng: Rng,
  role: RoleSeed,
  hits: Record<string, number>,
  years: number,
  employer: string,
): Draft {
  const recent: string[] = [];
  const earlier: string[] = [];
  let answerLine = "";
  let gap: string | null = null;

  role.criteria.forEach((criterion, index) => {
    const n = hits[criterion.id] ?? 0;
    if (n === 0) gap = gap ?? criterion.id;
    const chosen = rng.sample(criterion.lines, n);
    for (const line of chosen) (index < 2 ? recent : earlier).push(line);
    if (!answerLine && n >= 2) {
      const unused = criterion.lines.filter((l) => !chosen.includes(l));
      if (unused.length > 0) answerLine = rng.pick(unused);
    }
  });

  const intro = rng
    .pick(role.intros)
    .replace("{years}", String(years))
    .replace("{company}", employer);
  const paragraphs = [intro];
  if (recent.length > 0) paragraphs.push(`${rng.pick(SECTION_LEADS)} ${recent.join(" ")}`);
  if (earlier.length > 0) paragraphs.push(`${rng.pick(EARLIER_LEADS)} ${earlier.join(" ")}`);
  paragraphs.push(rng.pick(role.closings));

  const answer = [answerLine, rng.pick(role.answerTails)].filter(Boolean).join(" ");
  return { cv: paragraphs.join("\n\n"), answer, gap };
}

/**
 * How much evidence an applicant's CV carries per criterion, biased by how far they have already
 * got. People who reached an interview read stronger on paper than people who were turned down -
 * the pipeline has to look like it was worked by someone, not shuffled.
 */
const EVIDENCE_BY_STAGE: Record<Stage, (readonly [number, number])[]> = {
  applied: [
    [0, 2],
    [1, 3],
    [2, 3],
    [3, 2],
  ],
  screening: [
    [0, 1],
    [1, 3],
    [2, 3],
    [3, 3],
  ],
  interview: [
    [1, 1],
    [2, 3],
    [3, 4],
  ],
  offer: [
    [2, 2],
    [3, 5],
  ],
  rejected: [
    [0, 4],
    [1, 3],
    [2, 1],
  ],
};

function hitsFor(
  rng: Rng,
  role: RoleSeed,
  borderline: boolean,
  stage: Stage,
): Record<string, number> {
  const hits: Record<string, number> = {};
  if (!borderline) {
    for (const c of role.criteria) hits[c.id] = rng.pickWeighted(EVIDENCE_BY_STAGE[stage]);
    return hits;
  }
  // Strong everywhere except one criterion, which the CV never mentions. This is the row the
  // demo's decision card is built from: "no distributed-systems evidence; strong testing".
  const order = rng.shuffle(role.criteria);
  const strengths = [3, 3, 3, 2];
  order.forEach((c, i) => {
    hits[c.id] = i === 0 ? 0 : (strengths[i - 1] ?? 2);
  });
  return hits;
}

function seedRole(db: Db, role: RoleSeed, index: number): void {
  const rng = rngFor(APP_ID, `role:${role.id}`);
  const today = new Date(TODAY);

  db.run(
    "INSERT INTO roles (id, title, team, brief, question, opened_at) VALUES (?, ?, ?, ?, ?, ?)",
    [role.id, role.title, role.team, role.brief, role.question, rng.dateBefore(today, 40)],
  );
  role.criteria.forEach((c, ord) => {
    db.run(
      "INSERT INTO criteria (id, role_id, ord, name, description, weight, keywords) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [c.id, role.id, ord + 1, c.name, c.description, c.weight, JSON.stringify(c.keywords)],
    );
  });

  const criteria: Criterion[] = role.criteria.map((c, ord) => ({
    id: c.id,
    role_id: role.id,
    ord: ord + 1,
    name: c.name,
    description: c.description,
    weight: c.weight,
    keywords: c.keywords,
  }));

  const plan = PIPELINE[role.id] ?? [];
  const slots: Stage[] = plan.flatMap((p) => Array<Stage>(p.count).fill(p.stage));
  const borderlineTarget = BORDERLINE_PER_ROLE[role.id] ?? 0;
  let borderlineLeft = borderlineTarget;

  slots.forEach((stage, i) => {
    const n = i + 1;
    const id = rng.id(`app${index + 1}`, n, 3);
    const drawnName = rng.fullName();
    const years = rng.int(3, 12);
    // Where they work now: one of the studio's own clients. That is the
    // cross-app fact - the same company is invoiced in Ledgerbox and kept in
    // TidyCRM - and the CV says it in words.
    const drawnEmployer = rng.pick(COMPANIES).name;
    const borderline = stage === "screening" && borderlineLeft > 0;
    if (borderline) borderlineLeft -= 1;
    // The FIRST borderline applicant on the backend role is the cross-app one, by construction.
    const crossApp = borderline && role.id === CROSS_APP_ROLE && borderlineLeft === borderlineTarget - 1;
    const name = crossApp ? KESTREL_APPLICANT.name : drawnName;
    const employer = crossApp ? CROSS_APP_EMPLOYER : unreserved(drawnEmployer);
    const draft = writeCv(rng, role, hitsFor(rng, role, borderline, stage), years, employer);

    // Drawn in the order the INSERT used to draw them, so the stream - and every value seeded
    // after this row - is unchanged. The draw is made from the DRAWN name even when the row keeps
    // a pinned one, because `Rng.email` takes one value off the stream whatever it is handed.
    // `appliedAt` is hoisted because the stage trail is dated from it: the arrival event and the
    // applicant row are the same event.
    const drawnEmail = rng.email(drawnName);
    const email = crossApp ? KESTREL_APPLICANT.email : drawnEmail;
    const headline = rng.pick(role.headlines);
    const appliedAt = rng.dateBefore(today, 18);

    db.run(
      `INSERT INTO applicants
       (id, role_id, name, email, employer, headline, years, cv_text, short_answer, stage, applied_at, borderline, gap_criterion_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        role.id,
        name,
        email,
        employer,
        headline,
        years,
        draft.cv,
        `${role.question} - ${draft.answer}`,
        stage,
        appliedAt,
        borderline ? 1 : 0,
        borderline ? draft.gap : null,
      ],
    );
    seedHistory(db, rng, { id, name, email, roleTitle: role.title }, stage, borderline, criteria, draft, appliedAt, today);
  });

  seedSlots(db, rng, role.id, index, today);
}

/**
 * Stage events for how this applicant got where they are, plus a rubric note for anyone who has
 * been read.
 *
 * "Read" is everyone past screening, and the borderline candidates inside it. The six borderline
 * applicants are the case the comparison levels exist for - `lib/board/index.ts` and
 * `design/board-brief.md` §4 both say so - and a carousel or a head-to-head diff over six blank
 * scorecards compares nothing. The rest of screening stays unscored on purpose, so `score against
 * rubric` still has a batch to do in act 2, and `applied` stays unscored because its own stage copy
 * (`components/board/model/stages.ts`) promises that nothing there has been scored yet.
 */
function seedHistory(
  db: Db,
  rng: Rng,
  who: { id: string; name: string; email: string; roleTitle: string },
  stage: Stage,
  borderline: boolean,
  criteria: Criterion[],
  draft: Draft,
  appliedAt: string,
  today: Date,
): void {
  const applicantId = who.id;
  const path: Stage[] = ["applied", "screening", "interview", "offer"];
  const trail: Stage[] =
    stage === "rejected"
      ? ["applied", "screening", "rejected"]
      : path.slice(0, path.indexOf(stage) + 1);

  // The trail is a history, so it is strictly increasing by construction rather than by luck.
  // Arrival IS the applicant row's `applied_at` - one event, not two dates for the same event - and
  // each later move takes its own draw only when that draw is later than the move before it;
  // otherwise it is recorded an hour on, which keeps `listStageEvents`' ORDER BY id agreeing with
  // time order. The draw happens either way, so the rng stream - and every value seeded after this
  // applicant - is byte-identical to a seed that dated every event independently.
  let at = appliedAt;
  let previous: Stage | null = null;
  for (const to of trail) {
    const drawn = rng.dateBefore(today, 14);
    if (previous !== null) {
      at = drawn > at ? drawn : new Date(Date.parse(at) + HOUR_MS).toISOString();
    }
    db.run(
      "INSERT INTO stage_events (applicant_id, ts, from_stage, to_stage, actor, reason) VALUES (?, ?, ?, ?, ?, ?)",
      [
        applicantId,
        at,
        previous,
        to,
        previous === null ? "system" : "user",
        previous === null ? "Application received." : `Moved to ${to} after review.`,
      ],
    );
    previous = to;
  }

  if (stage === "applied" || (stage === "screening" && !borderline)) return;

  const scores = scoreAgainst(criteria, draft.cv, draft.answer);
  db.run(
    "INSERT INTO notes (applicant_id, ts, author, kind, body, scores_json) VALUES (?, ?, ?, ?, ?, ?)",
    [
      applicantId,
      rng.dateBefore(today, 10),
      "user",
      "rubric",
      `Scored against the rubric: ${summarise(scores)}.`,
      JSON.stringify(scores),
    ],
  );
  if (stage === "rejected") {
    // The same composer the gated action uses, so a seeded letter and a sent one are the same
    // three fields: a mail connector reading this row needs no lookup of its own.
    const mail = rejectionMail({
      applicantName: who.name,
      applicantEmail: who.email,
      roleTitle: who.roleTitle,
      template: "standard",
    });
    db.run(
      "INSERT INTO messages (applicant_id, ts, kind, to_email, subject, body) VALUES (?, ?, ?, ?, ?, ?)",
      [applicantId, rng.dateBefore(today, 8), "rejection", mail.to, mail.subject, mail.body],
    );
  }
}

function seedSlots(db: Db, rng: Rng, roleId: string, index: number, today: Date): void {
  const interviewers = [rng.fullName(), rng.fullName(), rng.fullName()];
  const booked = db.all<{ id: string }>(
    "SELECT id FROM applicants WHERE role_id = ? AND stage = 'interview' ORDER BY id",
    [roleId],
  );
  let bookedLeft = booked.length;

  interviewers.forEach((interviewer, i) => {
    for (let n = 1; n <= 6; n++) {
      const day = new Date(today);
      day.setUTCDate(day.getUTCDate() + 1 + i + (n - 1) * 2);
      if (day.getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1);
      if (day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 2);
      day.setUTCHours(rng.int(9, 16), rng.pick([0, 30]), 0, 0);
      const takeBooking = bookedLeft > 0 && n === 2;
      if (takeBooking) bookedLeft -= 1;
      db.run(
        "INSERT INTO slots (id, interviewer, start_ts, minutes, status, applicant_id) VALUES (?, ?, ?, ?, ?, ?)",
        [
          `slot_${index + 1}${i + 1}${n}`,
          interviewer,
          day.toISOString(),
          rng.pick([30, 45, 60]),
          takeBooking ? "booked" : "open",
          takeBooking ? (booked[bookedLeft]?.id ?? null) : null,
        ],
      );
    }
  });
}

function seed(db: Db): void {
  db.exec(SCHEMA);
  createActivityTable(db);
  ROLE_SEEDS.forEach((role, i) => seedRole(db, role, i));

  const total = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM applicants")?.n ?? 0;
  logActivity(db, {
    actor: "system",
    action: "seed",
    target: "pipeline",
    summary: `Seeded ${ROLE_SEEDS.length} open roles and ${total} applicants. No demographic fields exist in this database.`,
    reversible: false,
    ts: TODAY,
  });
}

export function db(): Db {
  return openDb(APP_ID, { seed });
}
