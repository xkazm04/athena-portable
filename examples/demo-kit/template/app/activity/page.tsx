import { listActivity } from "@athena/demo-kit/activity";
import { ActivityLog } from "@athena/demo-kit/activity/ui";
import { db } from "@/lib/db";
import { undoAction } from "../actions";

export const dynamic = "force-dynamic";

export default function ActivityPage() {
  const entries = listActivity(db(), 100);
  return (
    <>
      <h1 className="dk-page-title">Activity</h1>
      <p className="dk-page-lede">
        Every mutating action lands here, whoever took it. Archiving or reopening records logs one row
        with its Undo; an undo puts back only the records no later act has moved since, and names any
        it left alone.
      </p>
      <ActivityLog entries={entries} onUndo={undoAction} />
    </>
  );
}
