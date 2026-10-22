/**
 * The due chore Main shows a notice for — ADR 0131.
 *
 * Main's dock is where Athena's presence already asks for the person's attention ("2 waiting"); a
 * chore that came due is one more line there, never a window raised over her work. This is only
 * the notice on show, so the first frame carries no client: the poller that fills it
 * (`stores/due-poll.ts`) is loaded after first paint with the dock's notice (`console/due-notice.tsx`).
 */
import { create } from "zustand";

import type { DueNotice } from "@/lib/adopt";

/** A notice's identity: its case and its due date. */
export const noticeKey = (n: Pick<DueNotice, "case_id" | "due_at">) => `${n.case_id}|${n.due_at}`;

interface DueState {
  /** The notice on show in the dock, or null. */
  notice: DueNotice | null;
  /** The dock drew `notice`; the poller stamps it seen. A no-op until the poller is loaded. */
  shown: (n: DueNotice) => void;
  /** She opened it, or put it away; the next one waiting takes its place. */
  dismiss: () => void;
}

export const useDue = create<DueState>((set) => ({
  notice: null,
  shown: () => {},
  dismiss: () => set({ notice: null }),
}));
