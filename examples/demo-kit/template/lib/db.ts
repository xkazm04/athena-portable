import "server-only";
import { openDb, type Db } from "@athena/demo-kit/db";
import { createActivityTable, logActivity } from "@athena/demo-kit/activity";
import { rngFor } from "@athena/demo-kit/seed";

import { APP_ID } from "./constants";
import type { Record_ } from "./types";

export { APP_ID };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('open','archived')),
  owner      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  note       TEXT NOT NULL
);
`;

/** Deterministic: same rows on every machine, every run. Replace with your domain's seed. */
function seed(db: Db): void {
  db.exec(SCHEMA);
  createActivityTable(db);

  const rng = rngFor(APP_ID, "records");
  const now = new Date("2026-09-01T00:00:00Z");
  for (let i = 1; i <= 24; i++) {
    const owner = rng.fullName();
    db.run(
      `INSERT INTO records (id, title, status, owner, updated_at, note) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        rng.id("rec", i),
        `${rng.company()} ${rng.pick(["review", "intake", "renewal", "follow-up"])}`,
        rng.pickWeighted([
          ["open", 4],
          ["archived", 1],
        ]),
        owner,
        rng.dateBefore(now, 60),
        rng.sentence(),
      ],
    );
  }

  logActivity(db, {
    actor: "system",
    action: "seed",
    target: "records",
    summary: "Seeded 24 records.",
    reversible: false,
    ts: now.toISOString(),
  });
}

export function db(): Db {
  return openDb(APP_ID, { seed });
}

export function listRecords(status?: Record_["status"]): Record_[] {
  return status
    ? db().all<Record_>("SELECT * FROM records WHERE status = ? ORDER BY updated_at DESC", [status])
    : db().all<Record_>("SELECT * FROM records ORDER BY updated_at DESC");
}

export function getRecord(id: string): Record_ | undefined {
  return db().get<Record_>("SELECT * FROM records WHERE id = ?", [id]);
}
