/**
 * The dock's notice of a chore that came due — ADR 0131.
 *
 * One line beside Athena in the dock, never a window raised over the person's work. The line says
 * how many more wait behind it; pressed, it opens the case's staged review in place: what to check
 * first, then Open and prepare, Skip this one, or Later (put away with no answer; the review stays
 * open on the chore's page), and "Open the chore" for the whole page. Drawn means shown: the seen
 * stamp is sent from here, once the dock has drawn the line, not when the notice arrived. A lazy
 * chunk, so the first frame carries none; it starts the poller (`stores/due-poll.ts`) when it
 * mounts, and the review's view is fetched only when a line is first pressed.
 */
import { lazy, Suspense, useEffect } from "react";

import Button from "@/components/Button";
import type { Path } from "@/depth/model";
import { useDue } from "@/stores/due";
import { startDue } from "@/stores/due-poll";
import "./due-notice.css";

const ReviewView = lazy(() => import("@/scenes/chores/due").then((m) => ({ default: m.ReviewView })));

const close = () => useDue.setState({ dock: { kind: "line" } });

export default function DueNotice({ go }: { go: (to: Path) => void }) {
  // The poller lives with the one view that draws what it finds, so the console root starts nothing
  // more and the first frame carries neither.
  useEffect(() => startDue(), []);
  const { notice, more, dock, shown, dismiss, review, prepare, skip, pause, later } = useDue();
  useEffect(() => {
    if (notice) shown(notice);
  }, [notice, shown]);
  if (!notice) return null;
  const since = notice.missed ? ` (and ${notice.missed} more since)` : "";
  const line = notice.ask_slow ? `${notice.title} is due again: pause or slow it?` : `${notice.title} is due${since}`;
  const queued = more ? ` · ${more} more due` : "";
  const openChore = () => {
    dismiss();
    go({ root: "chores", item: notice.playbook_id });
  };
  const open = dock.kind !== "line";
  const reading = (
    <p className="due-notice__said" role="status">
      Reading what to check first…
    </p>
  );
  return (
    // Escape is heard on the whole notice: the focus is on the line that opened the panel, not in it.
    <div
      className="due-notice"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) close();
      }}
    >
      {open ? (
        <section className="due-notice__panel" aria-label={`${notice.title}: the review`}>
          {dock.kind === "reading" ? reading : null}
          {dock.kind === "failed" ? (
            <p className="due-notice__said" role="status">
              {dock.detail}
            </p>
          ) : null}
          {dock.kind === "reviewing" ? (
            <Suspense fallback={reading}>
              <ReviewView review={dock.review} said="" onPrepare={prepare} onSkip={skip} onPause={pause} onSlow={openChore} />
            </Suspense>
          ) : null}
          <div className="due-notice__row">
            <Button size="sm" variant="ghost" onClick={later}>
              Later
            </Button>
            <Button size="sm" variant="ghost" onClick={openChore}>
              Open the chore
            </Button>
          </div>
        </section>
      ) : null}
      <button
        type="button"
        className="due-notice__line focus-ring"
        aria-expanded={open}
        onClick={() => (open ? close() : review())}
      >
        {`${line}${queued}`}
      </button>
    </div>
  );
}
