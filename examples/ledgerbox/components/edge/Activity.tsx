"use client";

/** The trail: every change to the books, with Undo where it was reversible. */
import { ActivityLog } from "@athena/demo-kit/activity/ui";
import type { ActivityProps } from "./types";

export function EdgeActivity({ entries, onUndo }: ActivityProps) {
  return (
    <div className="ed-wrap" style={{ display: "grid", gap: 16 }}>
      <h1 className="ed-display ed-h1">Trail</h1>
      <p className="ed-mute" style={{ margin: 0, maxInlineSize: "56ch", fontSize: 15 }}>
        Every change lands here, whoever made it. Athena is not onboarded yet, so every row says You or System.
      </p>
      <ActivityLog entries={entries} onUndo={onUndo} emptyLabel="Nothing has changed yet." />
    </div>
  );
}
