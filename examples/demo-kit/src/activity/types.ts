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
