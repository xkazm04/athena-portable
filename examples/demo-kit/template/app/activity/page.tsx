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
        Every mutating action lands here, whoever took it. Athena is not onboarded yet, so every row
        below says <code>You</code> or <code>System</code>.
      </p>
      <ActivityLog entries={entries} onUndo={undoAction} />
    </>
  );
}
