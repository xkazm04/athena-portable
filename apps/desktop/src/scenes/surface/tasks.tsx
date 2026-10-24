/**
 * Her tasks on the main page, under the bell - fleet-surfaces (ADR 0141), mounted by `view.tsx`.
 *
 * The background tasks Athena delegated run in her small window; this is how a person on Main sees
 * them without opening it. The same `TaskRow`s her strip draws, in the same order and the same
 * words (`stores/tasks.ts`), at most {@link SURFACE_ROWS} at a time with "N more" to open the rest,
 * so a full queue does not push the surface out of its frame. Nothing at all while there is nothing
 * to show; a read that failed is one quiet line.
 *
 * Ask hands "How is <title> going?" to her window with `athenaOffer`, as the ask box beside it
 * does: the words land in her composer, her window comes forward, and the person sends them there.
 * Kill is the row's two presses, then `stopTask`.
 *
 * This file and the store are in Main's first frame (the surface is), so it stays a few rows of
 * markup over the store; the rows' own rules are in `components/task-row.css`.
 */
import { useEffect, useId, useState } from "react";

import TaskRow from "@/components/TaskRow";
import { athenaOffer } from "@/lib/companion";
import type { TaskView } from "@/lib/tasks";
import { askAbout, shownTasks, startTasks, stopTask, summaryOf, useTasks, useTasksNow } from "@/stores/tasks";

import "./tasks.css";

/** How many rows Main shows before "N more". */
export const SURFACE_ROWS = 4;

export interface SurfaceTasksProps {
  shown: readonly TaskView[];
  problem: string | null;
  now: number;
  all: boolean;
  onMore: () => void;
  onStop: (task: TaskView) => void;
  onAsk: (task: TaskView) => void;
}

/** The rows as a function of what they show: the testable half. */
export function SurfaceTasksView({ shown, problem, now, all, onMore, onStop, onAsk }: SurfaceTasksProps) {
  const list = useId();
  if (shown.length === 0) {
    return problem ? (
      <p className="surface-tasks__problem" role="status">
        {problem}
      </p>
    ) : null;
  }
  const rows = all ? shown : shown.slice(0, SURFACE_ROWS);
  const more = shown.length - SURFACE_ROWS;
  return (
    <section className="surface-tasks" aria-label="Her tasks">
      <p className="surface-tasks__head">
        <span className="surface-tasks__label">Her tasks</span>
        <span className="surface-tasks__count">{summaryOf(shown)}</span>
      </p>
      <ul id={list} className="surface-tasks__list">
        {rows.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            now={now}
            onStop={() => onStop(task)}
            onAsk={task.status === "running" || task.status === "queued" ? () => onAsk(task) : null}
          />
        ))}
      </ul>
      {more > 0 ? (
        <button type="button" className="surface-tasks__more focus-ring" aria-expanded={all} aria-controls={list} onClick={onMore}>
          {all ? "Fewer" : `${more} more`}
        </button>
      ) : null}
      {problem ? (
        <p className="surface-tasks__problem" role="status">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

export function SurfaceTasks() {
  const { tasks, problem } = useTasks();
  const [all, setAll] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const now = useTasksNow(tasks.some((t) => t.status === "running"));
  useEffect(() => startTasks(), []);
  const ask = (task: TaskView) => {
    setRefused(null);
    athenaOffer(askAbout(task)).catch((err: unknown) =>
      setRefused(`Her window did not come forward: ${err instanceof Error ? err.message : String(err)}`),
    );
  };
  return (
    <SurfaceTasksView
      shown={shownTasks(tasks, now)}
      problem={refused ?? problem}
      now={now}
      all={all}
      onMore={() => setAll((a) => !a)}
      onStop={(task) => void stopTask(task.id)}
      onAsk={ask}
    />
  );
}
