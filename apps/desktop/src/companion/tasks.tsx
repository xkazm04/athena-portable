/**
 * The task strip above her composer - fleet-surfaces (ADR 0141), mounted by `ledger.tsx`.
 *
 * Athena delegates work to background tasks and her window runs them; this is where the person
 * sees them without leaving the conversation. It is quiet by design: nothing at all while no task
 * is running or waiting and none ended in the last ten minutes (`stores/tasks.ts` `shownTasks`),
 * and otherwise one line - "2 running · 1 in line" - that opens into the rows. The rows are the
 * catalog's `TaskRow`, the same ones Main draws under the bell, so both windows say the same thing
 * about the same task.
 *
 * Ask sends "How is <title> going?" into her main thread as the person's own message, through the
 * composer's own entry point (`useRun.send`): while a turn of hers runs, that entry point puts it in
 * line behind the turn (`lib/midturn.ts` reads a question as "queue"), so the strip never starts a
 * second turn beside the first. Kill is the row's two presses, then `stopTask`.
 */
import { useEffect, useId, useState } from "react";

import TaskRow from "@/components/TaskRow";
import type { TaskView } from "@/lib/tasks";
import { useRun } from "@/stores/run";
import { askAbout, shownTasks, startTasks, stopTask, summaryOf, useTasks, useTasksNow } from "@/stores/tasks";

import "./tasks.css";

/** Ask her about a task, as if the person had typed it: now when she is free, in line when not. */
export function askHer(task: Pick<TaskView, "title">): void {
  void useRun.getState().send(askAbout(task));
}

export interface TaskStripProps {
  shown: readonly TaskView[];
  problem: string | null;
  /** The gate's sentence for why queued tasks wait for room (ADR 0142), said only while one waits. */
  held?: string | null;
  now: number;
  open: boolean;
  onToggle: () => void;
  onStop: (task: TaskView) => void;
  onAsk: (task: TaskView) => void;
}

/** The strip as a function of what it shows: the testable half. */
export function TaskStripView({ shown, problem, held, now, open, onToggle, onStop, onAsk }: TaskStripProps) {
  const list = useId();
  if (shown.length === 0) {
    return problem ? (
      <p className="aw-tasks aw-tasks__problem" role="status">
        {problem}
      </p>
    ) : null;
  }
  return (
    <section className="aw-tasks" aria-label="Her tasks">
      <button type="button" className="aw-tasks__summary" aria-expanded={open} aria-controls={open ? list : undefined} onClick={onToggle}>
        <span className="eyebrow">Tasks</span>
        <span className="aw-tasks__count">{summaryOf(shown)}</span>
        <span className="aw-tasks__hint">{open ? "Hide" : "Show"}</span>
      </button>
      {held && shown.some((t) => t.status === "queued") ? <p className="aw-tasks__held">{held}</p> : null}
      {open ? (
        <ul id={list} className="aw-tasks__list">
          {shown.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              now={now}
              onStop={() => onStop(task)}
              onAsk={task.status === "running" || task.status === "queued" ? () => onAsk(task) : null}
            />
          ))}
        </ul>
      ) : null}
      {problem ? (
        <p className="aw-tasks__problem" role="status">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

export function TaskStrip() {
  const { tasks, problem, held } = useTasks();
  const [open, setOpen] = useState(false);
  const now = useTasksNow(tasks.some((t) => t.status === "running"));
  useEffect(() => startTasks(), []);
  return (
    <TaskStripView
      shown={shownTasks(tasks, now)}
      problem={problem}
      held={held}
      now={now}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      onStop={(task) => void stopTask(task.id)}
      onAsk={askHer}
    />
  );
}
