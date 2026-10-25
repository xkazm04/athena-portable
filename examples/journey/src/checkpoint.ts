/**
 * Resume the journey at any act (`JOURNEY_FROM=<n>`) from a checkpoint instead of a full re-run.
 *
 * The four acts share five state holders, all in memory: the ledger, the approval table, the
 * brain and the two connector fakes. What a later act needs from an earlier one is exactly that
 * state (act 3 recalls a fact act 1 wrote; act 4 reads the whole record), and each app's database
 * is touched only by its own act, in its own scratch directory, so an app no remaining act touches
 * need not boot and an app a remaining act touches boots fresh. A checkpoint is therefore plain
 * JSON with no database copy: the five snapshots, a format version and a fingerprint of the seed
 * the apps were built from.
 *
 * Restoring goes through the same doors as a live write (`Ledger.restore` calls `write`,
 * `Brain.restore` refuses a fact that cites nothing), so a hand-edited checkpoint cannot put
 * anything in the record the live run would refuse. A checkpoint written against another seed or
 * another format is refused with both fingerprints named. A full run writes one after each act
 * that passes with every earlier act passing; a resumed run says so in its record and carries the
 * act it resumed from forward, so a chain of resumes never reads as a full run.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { HIRELANE, LEDGERBOX, OUTSIDE, TIDYCRM, type AppSpec } from "./apps.ts";
import type { Approvals, Card } from "./approvals.ts";
import type { Brain, Fact } from "./brain.ts";
import type { FakeMail, MailSnapshot } from "./connectors/fake-mail.ts";
import type { FakeNotes, NotesSnapshot } from "./connectors/fake-notes.ts";
import { COMPANIES } from "./contracts.ts";
import type { Ledger, LedgerRow } from "./ledger.ts";

/** Bumped whenever the shape of a checkpoint changes; part of the fingerprint as well. */
export const CHECKPOINT_FORMAT = 1;

/** The command that writes every checkpoint from scratch. */
export const FULL_RUN = "pnpm --filter @athena/journey test";

export type ActNumber = 1 | 2 | 3 | 4;

/** Which apps each act boots and drives. Act 4 reads the record and boots nothing. */
export const ACTS: ReadonlyArray<{ readonly n: ActNumber; readonly label: string; readonly apps: readonly AppSpec[] }> = [
  { n: 1, label: "act 1", apps: [LEDGERBOX, OUTSIDE] },
  { n: 2, label: "act 2", apps: [HIRELANE] },
  { n: 3, label: "act 3", apps: [TIDYCRM] },
  { n: 4, label: "act 4", apps: [] },
];

export interface JourneyState {
  readonly ledger: Ledger;
  readonly approvals: Approvals;
  readonly brain: Brain;
  readonly mail: FakeMail;
  readonly notes: FakeNotes;
}

export interface Checkpoint {
  readonly format: number;
  readonly fingerprint: string;
  /** The last act this checkpoint holds the state after. */
  readonly act: ActNumber;
  readonly writtenAt: string;
  /** `null` when written by a full run; otherwise the earliest act a chain of resumes started at. */
  readonly resumedFrom: number | null;
  readonly ledger: LedgerRow[];
  readonly approvals: Card[];
  readonly brain: Fact[];
  readonly mail: MailSnapshot;
  readonly notes: NotesSnapshot;
}

/** The seed the apps were built from, plus the checkpoint format: a checkpoint from another seed is stale. */
export function seedFingerprint(): string {
  return createHash("sha256")
    .update(JSON.stringify(COMPANIES))
    .update(`|checkpoint-format=${CHECKPOINT_FORMAT}`)
    .digest("hex")
    .slice(0, 16);
}

export function checkpointFile(act: number): string {
  return `checkpoint-act${act}.json`;
}

export function capture(state: JourneyState, act: ActNumber, options: { resumedFrom: number | null }): Checkpoint {
  return {
    format: CHECKPOINT_FORMAT,
    fingerprint: seedFingerprint(),
    act,
    writtenAt: new Date().toISOString(),
    resumedFrom: options.resumedFrom,
    ledger: state.ledger.snapshot(),
    approvals: state.approvals.snapshot(),
    brain: state.brain.snapshot(),
    mail: state.mail.snapshot(),
    notes: state.notes.snapshot(),
  };
}

export function writeCheckpoint(dir: string, checkpoint: Checkpoint): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, checkpointFile(checkpoint.act));
  writeFileSync(file, `${JSON.stringify(checkpoint, null, 2)}\n`);
  return file;
}

/** Read a checkpoint, refusing one written in another format or against another seed. */
export function readCheckpoint(file: string): Checkpoint {
  const checkpoint = JSON.parse(readFileSync(file, "utf8")) as Checkpoint;
  if (checkpoint.format !== CHECKPOINT_FORMAT) {
    throw new Error(
      `checkpoint ${file} is format ${String(checkpoint.format)}; this runner reads format ${CHECKPOINT_FORMAT}. Write a fresh one: ${FULL_RUN}`,
    );
  }
  const current = seedFingerprint();
  if (checkpoint.fingerprint !== current) {
    throw new Error(
      `checkpoint ${file} was written against seed ${String(checkpoint.fingerprint)}; the seed is now ${current}. Write a fresh one: ${FULL_RUN}`,
    );
  }
  return checkpoint;
}

/**
 * Put a checkpoint into fresh state holders. Every holder restores through its own invariants, and
 * a fact that cites a row the restored record does not hold is refused here, the one check that
 * spans two holders.
 */
export function restoreState(state: JourneyState, checkpoint: Checkpoint): void {
  state.ledger.restore(checkpoint.ledger);
  state.approvals.restore(checkpoint.approvals);
  state.brain.restore(checkpoint.brain);
  for (const fact of state.brain.facts) {
    for (const seq of fact.cites) {
      if (state.ledger.rows[seq - 1]?.seq !== seq) {
        throw new Error(`checkpoint fact ${fact.id} cites row ${seq}, which the restored record does not hold`);
      }
    }
  }
  state.mail.restore(checkpoint.mail);
  state.notes.restore(checkpoint.notes);
}

export interface RunPlan {
  /** The first act this run plays; 1 for a full run. */
  readonly from: ActNumber;
  /** The apps to boot, in boot order. */
  readonly apps: readonly AppSpec[];
  /** The labels of the acts to play, in order. */
  readonly acts: readonly string[];
  /** The checkpoint to restore before the first act, or `null` for a full run. */
  readonly checkpoint: string | null;
}

/** `JOURNEY_FROM` as given: unset or empty is a full run, anything else is checked by `planRun`. */
export function fromEnv(raw: string | undefined): number | undefined {
  return raw === undefined || raw.trim() === "" ? undefined : Number(raw);
}

/** What a run starting at `from` boots, plays and reads. A missing checkpoint is refused here. */
export function planRun(options: { from?: number; dir: string }): RunPlan {
  const from = options.from ?? 1;
  if (!Number.isInteger(from) || from < 1 || from > 4) {
    throw new Error(`JOURNEY_FROM must be 1, 2, 3 or 4, not ${String(options.from)}`);
  }
  const remaining = ACTS.filter((act) => act.n >= from);
  let checkpoint: string | null = null;
  if (from > 1) {
    checkpoint = join(options.dir, checkpointFile(from - 1));
    if (!existsSync(checkpoint)) {
      throw new Error(
        `JOURNEY_FROM=${from} resumes from ${checkpoint}, which does not exist. A full run writes it once act ${from - 1} passes: ${FULL_RUN}`,
      );
    }
  }
  return {
    from: from as ActNumber,
    apps: remaining.flatMap((act) => act.apps),
    acts: remaining.map((act) => act.label),
    checkpoint,
  };
}
