"use client";

/**
 * `EmptyState` - shown when a list has nothing in it. Say what would put something there.
 *
 * Real consumer set: `examples/demo-kit/template/components/RecordsTable.tsx` only.
 */
import type { ReactNode } from "react";
import { clsx } from "clsx";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div className={clsx("dk-empty", className)} role="status">
      {icon ? <div className="dk-empty-icon">{icon}</div> : null}
      <p className="dk-empty-title">{title}</p>
      {description ? <p className="dk-empty-desc">{description}</p> : null}
      {action ? <div className="dk-empty-action">{action}</div> : null}
    </div>
  );
}
