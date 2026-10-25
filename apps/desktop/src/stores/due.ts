/**
 * The due chore Main shows a notice for — ADR 0131.
 *
 * Main's dock is where Athena's presence already asks for the person's attention ("2 waiting"); a
 * chore that came due is one more line there, never a window raised over her work. Pressed, the line
 * opens the case's staged review in place (`dock`): what to check first, then Open and prepare, Skip
 * this one or Later. This is only the notice on show and the acts on it, so the first frame carries no
 * client: the poller that fills it and does the acts (`stores/due-poll.ts`) is loaded after first
 * paint with the dock's notice (`console/due-notice.tsx`).
 */
import { create } from "zustand";

import type { DueNotice, DueReview } from "@/lib/adopt";

/** A notice's identity: its case and its due date. */
export const noticeKey = (n: Pick<DueNotice, "case_id" | "due_at">) => `${n.case_id}|${n.due_at}`;

/** What the dock draws for the notice on show: its line, the review being read, the review, or why not. */
export type DockState =
  | { kind: "line" }
  | { kind: "reading" }
  | { kind: "reviewing"; review: DueReview }
  | { kind: "failed"; detail: string };

const idle = () => {};

interface DueState {
  /** The notice on show in the dock, or null. */
  notice: DueNotice | null;
  /** How many more wait behind it. */
  more: number;
  dock: DockState;
  /** The dock drew `notice`; the poller stamps it seen. A no-op until the poller is loaded. */
  shown: (n: DueNotice) => void;
  /** She opened the chore's page; the next one waiting takes its place. */
  dismiss: () => void;
  /** Read the notice's review into the dock. */
  review: () => void;
  /** Open and prepare: answer the review `prepare`, open its tabs, put its command in her composer. */
  prepare: () => void;
  /** Skip this one: answer the review `skip`. */
  skip: () => void;
  /** Pause the chore's cadence, as the review's "pause or slow?" asks. */
  pause: () => void;
  /** Put it away with no answer: the review stays open on the chore's page. */
  later: () => void;
}

export const useDue = create<DueState>((set) => ({
  notice: null,
  more: 0,
  dock: { kind: "line" },
  shown: idle,
  dismiss: () => set({ notice: null }),
  review: idle,
  prepare: idle,
  skip: idle,
  pause: idle,
  later: () => set({ notice: null }),
}));
