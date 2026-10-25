/** Shared activity types. No server imports here, so client components can use them freely. */

export type Actor = "user" | "athena" | "system";

export interface ActivityEntry {
  id: number;
  /** ISO-8601 UTC. */
  ts: string;
  actor: Actor;
  /** Tool/mutation name, e.g. `mark_paid`. */
  action: string;
  /** What it acted on, e.g. `invoice:inv_014`. */
  target: string;
  /** One human line for the log row. */
  summary: string;
  reversible: boolean;
  /** Whatever `applyUndo` needs to put the world back; `null` when not reversible. */
  undo: unknown;
  undone: boolean;
}

export interface NewActivity {
  actor: Actor;
  action: string;
  target: string;
  summary: string;
  reversible?: boolean;
  undo?: unknown;
  /** Override the timestamp (deterministic seeds do this). */
  ts?: string;
}

/**
 * What an app's `applyUndo` may answer (ADR 0156). Nothing (`void`) is a clean reversal, as it
 * always was. `refused` means nothing was put back: the kit rolls back any write the call made,
 * leaves the row undoable and logs nothing; `blockedBy` names a later activity row whose own undo
 * would clear the way, which `{ through: true }` then takes. `partial` means some of it was put back:
 * the row reads undone and its one compensating line says what was kept.
 */
export type UndoVerdict = void | undefined | { refused: string; blockedBy?: number } | { partial: string };

export interface UndoOptions {
  /**
   * Undo the rows that block this one first, newest first, then this one: one transaction, all or
   * nothing. A blocker is whatever a refusal names in `blockedBy`.
   */
  through?: boolean;
}

/** An undo's answer as a client renders it: the serialisable half of the kit's `UndoResult`. */
export interface UndoAnswer {
  ok: boolean;
  /** Present when `ok` is false: why nothing was undone. */
  reason?: string;
  /** With a refusal: the later row whose undo would clear the way (`{ through: true }`). */
  blockedBy?: number;
  /** With `ok`: what the undo could not put back. */
  partial?: string;
}
