/**
 * Athena's state as Main sees it — ADR 0026 (Main keeps a one-line status pill that summons her).
 *
 * A mirror, exactly as `tabs.ts` is: her window owns the turn, the cards and the microphone and
 * reports them to Rust (`athena_report`), and Rust tells this window on `athena:status`. Nothing
 * here decides anything; the status pill reads it.
 */
import { create } from "zustand";

import { hasShell, onAthenaStatus, type AthenaStatus } from "@/lib/ipc";

export type AthenaState = AthenaStatus;

/** The forms that are work on their own: the tape, a held key, and a card waiting on the user. */
const WORKING_FORMS: ReadonlySet<string> = new Set(["tape", "hear", "slip"]);

/**
 * Is she doing nothing? (UAT backlog B8.) She is working only when her form says so (tape, hear,
 * slip) or when a turn is running, which her window reports as a non-empty `line` whatever form
 * she is drawn in. The ledger, the welcome, the seal and the tab with nothing running rest: the
 * old rule counted every state but four as work, so an idle ledger read as "working".
 */
export function isResting(state: string, line = ""): boolean {
  return !WORKING_FORMS.has(state) && line === "";
}

export function pillText(status: Pick<AthenaStatus, "state" | "cards" | "line">): string {
  if (status.cards > 0) return `${status.cards} waiting`;
  if (isResting(status.state, status.line)) return "Athena is resting";
  return status.line || "Athena is working";
}

export const useAthena = create<AthenaState>(() => ({
  state: "rest",
  cards: 0,
  line: "",
  visible: false,
}));

let started = false;

/** Listen for `athena:status`. A no-op without a shell (the preview harness, a plain browser). */
export async function startAthena(): Promise<void> {
  if (started || !hasShell()) return;
  started = true;
  await onAthenaStatus((status) =>
    useAthena.setState({
      state: status.state,
      cards: status.cards,
      line: status.line,
      visible: status.visible,
    }),
  );
}
