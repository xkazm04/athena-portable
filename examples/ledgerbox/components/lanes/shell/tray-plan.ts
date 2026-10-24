/**
 * The tick as a working set: what the tray counts, what it would do, and the one batch it runs.
 *
 * `select` rings invoices on the sheet so a person can see which ones a run is about. Until this
 * module the person could see the ring and do nothing with it. The tray turns it into a tool: a
 * count, a plan per act with its refusals known BEFORE the press, and one bounded batch.
 *
 * Pure and client-safe: no React, no `lib/db`. It reads the sheet the server handed down, and the
 * one batch takes its act as an argument, so `test/ledgerbox-lanes-tray.test.ts` drives every rule
 * here against the real server actions on a scratch copy of the books.
 *
 * Only AUTO acts are offered in bulk (`trayActs`). Send, record and void stay one invoice at a
 * time behind the card's Gate, so no consent check is widened by a tick (hitl-approval).
 */
import { SELECT_MAX, type Category } from "@/lib/constants";
import { isAuto } from "@/lib/manifest";
import { TOOL_CLASSES, type ToolName } from "@/lib/tool-classes";
import type { LnSheet } from "../model";
import { actRefusal, NOT_A_DEBT } from "../card/read";

/** One ticked invoice, as the sheet holds it now. */
export interface TrayItem {
  id: string;
  laneId: Category;
}

/** What the tray says about the tick: counted from the sheet, never carried from the id list. */
export interface Tray {
  /** In tick order, deduplicated, and only ids the sheet actually holds. */
  items: TrayItem[];
  count: number;
  /** Open balance of the ticked invoices that are debts - a draft or a void is nobody's debt. */
  owedCents: number;
  /** One entry per lane the tick touches, in the sheet's lane order. */
  lanes: { laneId: Category; label: string; n: number }[];
}

export function trayFor(sheet: LnSheet, ids: readonly string[]): Tray {
  const where = new Map<string, { laneId: Category; balanceCents: number; debt: boolean }>();
  for (const lane of sheet.lanes) {
    for (const mark of lane.marks) {
      where.set(mark.id, { laneId: lane.id, balanceCents: mark.balanceCents, debt: !NOT_A_DEBT.has(mark.state) });
    }
  }
  const seen = new Set<string>();
  const items: TrayItem[] = [];
  let owedCents = 0;
  for (const id of ids) {
    const at = where.get(id);
    if (!at || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, laneId: at.laneId });
    if (at.debt) owedCents += Math.max(0, at.balanceCents);
  }
  const lanes = sheet.lanes
    .map((lane) => ({ laneId: lane.id, label: lane.label, n: items.filter((i) => i.laneId === lane.id).length }))
    .filter((lane) => lane.n > 0);
  return { items, count: items.length, owedCents, lanes };
}

/** What a bulk draft would do: the ids the books take, and the rest grouped by why not. */
export interface DraftPlan {
  eligible: string[];
  /** One group per refusal, each `reason` the row's own line from `actRefusal`. */
  held: { reason: string; ids: string[] }[];
}

export function draftPlan(tray: Tray, sheet: LnSheet): DraftPlan {
  const marks = new Map(sheet.lanes.flatMap((lane) => lane.marks.map((m) => [m.id, m] as const)));
  const eligible: string[] = [];
  const held = new Map<string, string[]>();
  for (const { id } of tray.items) {
    const mark = marks.get(id);
    if (!mark) continue;
    const reason = actRefusal("draft_reminder", mark, sheet.details[id]);
    if (reason === null) eligible.push(id);
    else held.set(reason, [...(held.get(reason) ?? []), id]);
  }
  return { eligible, held: [...held].map(([reason, ids]) => ({ reason, ids })) };
}

/** The ticked ids a refile would move: only those not already filed there. */
export function refilePlan(tray: Tray, category: Category): string[] {
  return tray.items.filter((i) => i.laneId !== category).map((i) => i.id);
}

/** The sentence a person's own tick answers with at the cap `select` already holds an agent to. */
export const TICK_CAP_SAY = `The tick holds at most ${SELECT_MAX} invoices. Untick one first.`;

export type TickResult =
  | { ok: true; list: string[] }
  | { ok: false; reason: string; list: readonly string[] };

/** A person's own tick (Ctrl/Cmd-click, or `x`): one id in or out, under `select`'s cap. */
export function toggleTick(list: readonly string[], id: string): TickResult {
  if (list.includes(id)) return { ok: true, list: list.filter((x) => x !== id) };
  if (list.length >= SELECT_MAX) return { ok: false, reason: TICK_CAP_SAY, list };
  return { ok: true, list: [...list, id] };
}

/**
 * The person's tick gesture on a mark or a node: Ctrl/Cmd-click, or `x` with no modifier. A plain
 * click still opens the invoice, so the gesture adds a path rather than changing the old one.
 */
export function isTickGesture(event: { ctrlKey: boolean; metaKey: boolean; altKey?: boolean; key?: string }): boolean {
  if (event.key !== undefined) return event.key === "x" && !event.ctrlKey && !event.metaKey && !event.altKey;
  return event.ctrlKey || event.metaKey;
}

/** The acts the tray offers over the whole tick. Each must be AUTO by the class table. */
const BULK: readonly ToolName[] = ["categorize", "draft_reminder"];

export function trayActs(): ToolName[] {
  return BULK.filter((tool) => isAuto(TOOL_CLASSES[tool]));
}

export type BatchOutcome =
  | { ok: true; done: string[]; failed: { id: string; message: string }[]; summary: string; next: string[] }
  | { ok: false; summary: string };

export const BATCH_BUSY_SAY = "A batch is already running on the tick. Wait for it to finish.";

export interface BatchRunner {
  (
    ids: readonly string[],
    issue: (id: string) => Promise<{ ok: boolean; message: string }>,
    verb: string,
  ): Promise<BatchOutcome>;
  busy(): boolean;
}

/**
 * One batch at a time over the tick (single-pending-batch-invariant).
 *
 * The guard is a plain flag set synchronously at the door, not React's pending: a second press
 * lands before a transition repaints, and it has to be refused with no call made. The calls are
 * sequential and bounded by SELECT_MAX (bounded-fanout-commit), an act that throws counts as a
 * failure of that one id, and the failed ids come back as the next tick (partial-failure-reselect)
 * so the person's next press is already aimed at what is left.
 */
export function createBatch(): BatchRunner {
  let running = false;
  const run = (async (ids, issue, verb) => {
    if (running) return { ok: false, summary: BATCH_BUSY_SAY };
    running = true;
    try {
      const todo = ids.slice(0, SELECT_MAX);
      const done: string[] = [];
      const failed: { id: string; message: string }[] = [];
      for (const id of todo) {
        try {
          const result = await issue(id);
          if (result.ok) done.push(id);
          else failed.push({ id, message: result.message });
        } catch (error) {
          failed.push({ id, message: error instanceof Error ? error.message : String(error) });
        }
      }
      const first = failed[0];
      const why = first ? ` ${failed.length} refused, first: ${first.message}` : "";
      return {
        ok: true,
        done,
        failed,
        summary: `${verb} ${done.length} of ${todo.length}.${why}`,
        next: failed.map((f) => f.id),
      };
    } finally {
      running = false;
    }
  }) as BatchRunner;
  run.busy = () => running;
  return run;
}
