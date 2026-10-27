/**
 * @catalog One delegated task on a line: status, title, app, time, and Kill (two presses) and Ask.
 *
 * Fleet-surfaces, ADR 0141. Athena hands work to background tasks; a person watches them from her
 * window (the strip above the composer) and from Main (under the bell), and both draw the same row
 * so the two windows speak one language about one task. The row is a pure function of its props
 * plus one bit of its own state: whether Kill is armed.
 *
 * Kill takes two presses. The first arms it - the button says "Kill?" for {@link KILL_ARM_MS} - and
 * only a second press inside that time kills. A task is somebody's half-done work in an app, and a
 * click meant for the row beside it must not end it. Unlike Disconnect on Accounts, the question is
 * asked in place, on the same button, because the row is one line and a person who is watching a
 * task go wrong wants it gone fast; unlike Approve on Devices, the delay protects the *second*
 * press, not the first, since stopping work is the safe direction and saying so twice is enough.
 *
 * The status word and its hue come from {@link TASK_WORDS}: the house vocabulary of `StatusDot`
 * tones, where `pending` means asked and not yet answered (in line), and `neutral` means no state
 * worth a colour (killed). The time is the caller's `now`, so the caller decides how often a row
 * ticks and a test renders it at a fixed instant.
 *
 * It renders an `<li>`: the caller holds the list.
 */
import { useEffect, useState } from "react";

import { isActive, type TaskStatus, type TaskView } from "@/lib/tasks";
import { parseStamp, whenAgo } from "@/lib/time";
import { hostOf } from "@/lib/url";

import Badge from "./Badge";
import Button from "./Button";
import type { Tone } from "./StatusDot";
import "./task-row.css";

/** How long the first press on Kill keeps it armed. */
export const KILL_ARM_MS = 3000;
/** How much of a result or an error the row shows; the rest is hers to tell when asked. */
export const RESULT_HEAD_CHARS = 140;

/** The word for each status and the hue beside it. Queued says its place instead, when known. */
export const TASK_WORDS: Record<TaskStatus, { word: string; tone: Tone }> = {
  queued: { word: "in line", tone: "pending" },
  running: { word: "running", tone: "info" },
  done: { word: "done", tone: "success" },
  failed: { word: "failed", tone: "error" },
  killed: { word: "killed", tone: "neutral" },
  interrupted: { word: "interrupted", tone: "warning" },
};

/** The badge's word: "#2 in line" while queued with a place, else the status word. */
export function statusWordOf(task: Pick<TaskView, "status" | "position">): string {
  if (task.status === "queued" && task.position !== null) return `#${task.position} in line`;
  return TASK_WORDS[task.status].word;
}

/** The app a task works in: its origin's host, or the app id, or `null` for a task with no app. */
export function appOf(task: Pick<TaskView, "origin" | "app_id">): string | null {
  return task.origin ? hostOf(task.origin) : task.app_id;
}

/** "12 s", "3 min", "1 h 4 min": a length of time, never negative. */
export function elapsedOf(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${Math.floor(minutes / 60)} h`;
}

/** The time on the row: how long it has run, how long ago it ended, or nothing while it waits. */
export function timeOf(task: TaskView, now: number): string | null {
  if (task.status === "running") {
    const started = parseStamp(task.started_at);
    return started ? elapsedOf(now - started.getTime()) : null;
  }
  if (task.status === "queued") return null;
  return task.finished_at ? whenAgo(task.finished_at, now) : null;
}

/** The first line of what it came back with, or why it did not; `null` when there is nothing to say. */
export function headOf(task: TaskView): string | null {
  const text =
    task.status === "done"
      ? task.result
      : task.status === "failed"
        ? // Stored as `reason: detail` (`stores/task-runner.ts`): the row says the detail, in words.
          task.error?.replace(/^[a-z_]+: /, "")
        : task.status === "interrupted"
          ? "Athena restarted while it ran."
          : null;
  const line = text?.trim().split("\n")[0]?.trim() ?? "";
  if (line === "") return null;
  return line.length > RESULT_HEAD_CHARS ? `${line.slice(0, RESULT_HEAD_CHARS - 1).trimEnd()}…` : line;
}

export default function TaskRow({
  task,
  now,
  onStop,
  onAsk,
}: {
  task: TaskView;
  now: number;
  onStop: () => void;
  onAsk: (() => void) | null;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), KILL_ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  const { tone } = TASK_WORDS[task.status];
  const app = appOf(task);
  const time = timeOf(task, now);
  const head = headOf(task);
  const meta = [app ?? "no app", time].filter(Boolean).join(" · ");
  const kill = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    onStop();
  };

  return (
    <li className="task-row">
      <div className="task-row__line">
        <Badge tone={tone}>{statusWordOf(task)}</Badge>
        <span className="task-row__title" title={task.title}>
          {task.title}
        </span>
        <span className="task-row__meta typo-data">{meta}</span>
        {isActive(task) ? (
          <span className="task-row__acts">
            {onAsk ? (
              <Button size="sm" variant="ghost" onClick={onAsk} aria-label={`Ask how ${task.title} is going`}>
                Ask
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={armed ? "secondary" : "ghost"}
              onClick={kill}
              aria-label={armed ? `Kill ${task.title}? Press again to kill it` : `Kill ${task.title}`}
            >
              {armed ? "Kill?" : "Kill"}
            </Button>
          </span>
        ) : null}
      </div>
      {head ? <p className="task-row__head typo-caption">{head}</p> : null}
    </li>
  );
}
