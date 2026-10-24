/**
 * A PC's vitals, as the windows read them - device-vitals, ADR 0142, `src/athena/vitals/`.
 *
 * Every PC's daemon measures its own room (CPU, RAM, GPU and its memory, power, disk) with the
 * standard library, decides from it how many background tasks may run and whether they must wait,
 * and shares the snapshot with its paired PCs on the hello the presence probe already sends. The
 * same snapshot is what Athena is told in every turn's `frame.fleet` block.
 *
 * The shapes are the Python's, field for field, with absent values `null` (never omitted): `null`
 * is "could not measure", never zero. `gpus` is `[]` when the probe ran and found none.
 */

/** The gate's word for a PC's room: `null` when the figures it needs are unknown. */
export type Room = "ok" | "tight" | "full";

export interface GpuVitals {
  name: string;
  util_pct: number | null;
  vram_total_mb: number | null;
  vram_used_mb: number | null;
}

/** `Ledger.runs_summary(hours=24)`: how this PC's own runs ended. `blank` is no answer, timeout,
 * usage limit and tasks that finished with nothing, together. */
export interface RunsSummary {
  hours: number;
  turns: number;
  blank: number;
  no_answer: number;
  failed: number;
  timeout: number;
  usage_limit: number;
  tasks_empty: number;
}

export type SleepState = "never" | "idle" | "sleeping" | "failed";

/** The sleep summary a PC shares; `pressure` is waiting characters over the threshold (1 = due). */
export interface SleepSummary {
  state: SleepState;
  last_at: string | null;
  pressure: number;
}

export interface Vitals {
  at: string;
  cpu_pct: number | null;
  cores: number | null;
  ram_total_mb: number | null;
  ram_free_mb: number | null;
  ram_pct: number | null;
  gpus: GpuVitals[] | null;
  power: "mains" | "battery" | null;
  battery_pct: number | null;
  disk_free_mb: number | null;
  room: Room | null;
  /** How many background tasks may run at once right now, 0 to `TASKS_RUNNING_CAP`. */
  slots: number;
  /** Why background work is waiting, as a sentence for a person; `null` when nothing waits. */
  held: string | null;
  runs: RunsSummary | null;
  sleep: SleepSummary | null;
}

/** `GET /vitals`. */
export interface VitalsResponse {
  vitals: Vitals;
}
