/**
 * Athena's sleep cycle, as the windows read it - device-vitals, ADR 0143, `src/athena/core/sleep/`.
 *
 * Each PC sleeps on the episodes it wrote itself: when enough has piled up since the last cycle
 * (pressure), one pass distils them into facts and procedures (compress), a second judges each
 * against what she already knows (merge), and what has gone unused fades. Forgetting and
 * contradictions are never decided by the cycle: they wait as proposals a person keeps or forgets.
 *
 * The shapes are the Python's, field for field, with absent values `null` (never omitted).
 */
import type { SleepState } from "@/lib/vitals";

export type SleepPhase = "compress" | "merge" | "fade";
export type CycleStatus = "running" | "completed" | "partial" | "failed";

/** Why a cycle was or was not admitted. `reason` is the code, `text` the sentence for a person. */
export interface SleepVerdict {
  admit: boolean;
  reason: string;
  text: string;
}

export interface CycleStats {
  episodes_in: number;
  episodes_available: number;
  chars_in: number;
  truncated: boolean;
  facts_written: number;
  facts_dropped: number;
  procedurals_written: number;
  procedurals_dropped: number;
  duplicates: number;
  supersedes: number;
  contradictions: number;
  faded: number;
  forget_proposed: number;
  /** Candidates skipped because a person forgot that key: she wanted them back and did not take them. */
  barred: number;
}

export interface CycleView {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: CycleStatus;
  /** The admission reason it ran under (`pressure`, `first`, `stale`, `forced`), or why it failed. */
  reason: string | null;
  /** Partial while running; `null` for a cycle that recorded none. */
  stats: Partial<CycleStats> | null;
}

export interface SleepView {
  state: SleepState;
  phase: SleepPhase | null;
  pressure_chars: number;
  threshold_chars: number;
  episodes_waiting: number;
  verdict: SleepVerdict;
  last: CycleView | null;
  open_proposals: number;
}

export type ProposalKind = "forget" | "contradiction";
export type ProposalStatus = "open" | "kept" | "forgotten" | "dismissed" | "expired";

export interface ProposalView {
  id: string;
  cycle_id: string;
  kind: ProposalKind;
  node_ids: string[];
  summary: string;
  status: ProposalStatus;
  created_at: string;
}

/** `POST /sleep/run`. */
export interface SleepRunAnswer {
  admitted: boolean;
  reason: string;
  text: string;
  cycle_id: string | null;
}
