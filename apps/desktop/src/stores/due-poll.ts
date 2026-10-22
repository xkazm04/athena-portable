/**
 * Asking the daemon which chores came due — ADR 0131.
 *
 * The daemon holds the notices (`GET /adopt/chores/due`): it offers each (case, due date) until the
 * desktop stamps it seen, and offers none in quiet hours, which it checks when asked. This polls,
 * puts one notice at a time in `useDue`, and stamps a notice seen only once the dock has drawn it,
 * so a notice delivered into a hidden window costs nothing. A key it has shown is never shown again
 * in this window, whatever the daemon says.
 */
import { CHORE_ROUTES, type DueNotice } from "@/lib/adopt";
import type { ChoresClient } from "@/lib/chores-client";
import { endpoint, useDaemon } from "@/stores/daemon";

import { noticeKey, useDue } from "./due";

/** How often Main asks. The daemon's loop ticks every 30 s, so a notice is at most this late. */
export const DUE_POLL_MS = 60_000;

/** The two calls the watcher makes, as a `ChoresClient` has them. */
type Watched = Pick<ChoresClient, "due" | "answer">;

/** One notice per (case, due date), across polls: `poll` answers the ones not shown before. */
export class DueWatcher {
  private readonly shown = new Set<string>();

  constructor(private readonly client: () => Watched | null) {}

  async poll(): Promise<DueNotice[]> {
    const c = this.client();
    if (!c) return [];
    const reply = await c.due();
    const fresh = reply.notices.filter((n) => !this.shown.has(noticeKey(n)));
    for (const n of fresh) this.shown.add(noticeKey(n));
    return fresh;
  }

  /** The dock drew it: stamp it seen, so the daemon offers it to no window again. */
  async seen(n: DueNotice): Promise<void> {
    await this.client()?.answer(n.case_id, n.due_at, "seen");
  }
}

/**
 * The daemon's two answers, fetched directly: `lib/chores-client.ts` pulls the shared API module into
 * a chunk of its own, which the first-paint budget would pay for. A refusal throws; `poll` waits.
 */
function client(): Watched | null {
  const at = endpoint(useDaemon.getState());
  if (!at) return null;
  const ask = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${at.url}${path}`, {
      method,
      headers: { "X-Athena-Token": at.token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  };
  return {
    due: async () => {
      const r = await ask("GET", CHORE_ROUTES.due);
      const notices = (Array.isArray(r.notices) ? r.notices : []) as DueNotice[];
      return { ...(r as object), notices } as Awaited<ReturnType<Watched["due"]>>;
    },
    answer: async (caseId, dueAt, answer) => {
      await ask("POST", CHORE_ROUTES.review(caseId), { due_at: dueAt, answer });
      return null;
    },
  };
}

const watcher = new DueWatcher(client);
const queue: DueNotice[] = [];
const stamped = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;

async function poll(): Promise<void> {
  try {
    queue.push(...(await watcher.poll()));
  } catch {
    return; // no daemon yet, or it refused: the next poll asks again
  }
  if (useDue.getState().notice === null && queue.length) useDue.setState({ notice: queue.shift() ?? null });
}

/** Start asking. Idempotent; the dock's notice calls it when it mounts, after first paint. */
export function startDue(): () => void {
  if (timer === null) {
    useDue.setState({
      shown: (n) => {
        if (stamped.has(noticeKey(n))) return;
        stamped.add(noticeKey(n));
        watcher.seen(n).catch((e: unknown) => console.error(`[due] seen: ${String(e)}`));
      },
      dismiss: () => useDue.setState({ notice: queue.shift() ?? null }),
    });
    void poll();
    timer = setInterval(() => void poll(), DUE_POLL_MS);
  }
  return () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
}
