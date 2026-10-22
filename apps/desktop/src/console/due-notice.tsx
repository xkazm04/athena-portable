/**
 * The dock's notice of a chore that came due — ADR 0131.
 *
 * One line beside Athena in the dock, pressed to open the chore's page and its review; never a
 * window raised over the person's work. Drawn means shown: the seen stamp is sent from here, once
 * the dock has drawn it, not when the notice arrived. A lazy chunk, so the first frame carries none;
 * it starts the poller (`stores/due-poll.ts`) when it mounts.
 */
import { useEffect } from "react";

import type { Path } from "@/depth/model";
import { useDue } from "@/stores/due";
import { startDue } from "@/stores/due-poll";
import "./due-notice.css";

export default function DueNotice({ go }: { go: (to: Path) => void }) {
  // The poller lives with the one view that draws what it finds, so the console root starts nothing
  // more and the first frame carries neither.
  useEffect(() => startDue(), []);
  const notice = useDue((s) => s.notice);
  const shown = useDue((s) => s.shown);
  const dismiss = useDue((s) => s.dismiss);
  useEffect(() => {
    if (notice) shown(notice);
  }, [notice, shown]);
  if (!notice) return null;
  const more = notice.missed ? ` (and ${notice.missed} more since)` : "";
  return (
    <button
      type="button"
      className="due-notice focus-ring"
      onClick={() => {
        dismiss();
        go({ root: "chores", item: notice.playbook_id });
      }}
    >
      {notice.ask_slow ? `${notice.title} is due again: pause or slow it?` : `${notice.title} is due${more}`}
    </button>
  );
}
