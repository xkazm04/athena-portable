"use client";

/**
 * `@athena/demo-kit/activity/ui` - the shared activity log view.
 *
 * The Undo button calls a server action the app passes in, because only the app knows how to
 * reverse its own domain writes (`undoActivity(db, id, applyUndo)`).
 */
import { useMemo, useState, useTransition } from "react";
import { clsx } from "clsx";
import type { ActivityEntry, Actor } from "./types";

const ACTOR_LABEL: Record<Actor, string> = {
  user: "You",
  athena: "Athena",
  system: "System",
};

/** Actor chips are themable per app through `--dk-*` custom properties. */
const ACTOR_CLASS: Record<Actor, string> = {
  user: "dk-chip-user",
  athena: "dk-chip-athena",
  system: "dk-chip-system",
};

export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const secs = Math.round((now - then) / 1000);
  if (secs < 45) return "just now";
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2629800, "week"],
    [31557600, "month"],
  ];
  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  let prev = 1;
  for (const [limit, unit] of units) {
    if (Math.abs(secs) < limit) return fmt.format(-Math.round(secs / prev), unit);
    prev = limit;
  }
  return fmt.format(-Math.round(secs / 31557600), "year");
}

export interface ActivityLogProps {
  entries: ActivityEntry[];
  /**
   * Server action bound by the app. Return `{ ok: false, reason }` and the row shows the reason
   * instead of silently doing nothing.
   */
  onUndo?: (id: number) => Promise<{ ok: boolean; reason?: string }>;
  emptyLabel?: string;
  className?: string;
}

export function ActivityLog({
  entries,
  onUndo,
  emptyLabel = "Nothing has happened yet.",
  className,
}: ActivityLogProps) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const now = useMemo(() => Date.now(), [entries]);

  if (entries.length === 0) {
    return <p className="dk-activity-empty">{emptyLabel}</p>;
  }

  const undo = (id: number) => {
    if (!onUndo) return;
    setBusy(id);
    startTransition(async () => {
      // A server action rejects for any unhandled throw, and none of the apps' undo actions catch.
      // Without the finally the row would stay disabled at "Undoing…" for the life of the page
      // with no reason shown - the silence this prop's own contract promises to prevent.
      try {
        const res = await onUndo(id);
        setErrors((e) => (res.ok ? { ...e, [id]: "" } : { ...e, [id]: res.reason ?? "Undo failed" }));
      } catch (err) {
        setErrors((e) => ({ ...e, [id]: err instanceof Error ? err.message : "Undo failed" }));
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <ol className={clsx("dk-activity", className)}>
      {entries.map((entry) => (
        <li
          key={entry.id}
          className={clsx("dk-activity-row", entry.undone && "dk-activity-row-undone")}
          data-actor={entry.actor}
        >
          <span className={clsx("dk-chip", ACTOR_CLASS[entry.actor])}>
            {ACTOR_LABEL[entry.actor]}
          </span>
          <div className="dk-activity-body">
            <p className="dk-activity-summary">{entry.summary}</p>
            <p className="dk-activity-meta">
              <code>{entry.action}</code>
              <span aria-hidden="true"> · </span>
              <span>{entry.target}</span>
              <span aria-hidden="true"> · </span>
              <time dateTime={entry.ts} title={entry.ts}>
                {relativeTime(entry.ts, now)}
              </time>
            </p>
            {errors[entry.id] ? <p className="dk-activity-error">{errors[entry.id]}</p> : null}
          </div>
          <div className="dk-activity-actions">
            {entry.reversible ? (
              <span className="dk-badge dk-badge-reversible">reversible</span>
            ) : (
              <span className="dk-badge dk-badge-final">final</span>
            )}
            {entry.reversible && !entry.undone && onUndo ? (
              <button
                type="button"
                className="dk-btn dk-btn-ghost"
                onClick={() => undo(entry.id)}
                disabled={pending && busy === entry.id}
              >
                {pending && busy === entry.id ? "Undoing…" : "Undo"}
              </button>
            ) : null}
            {entry.undone ? <span className="dk-badge dk-badge-undone">undone</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default ActivityLog;
