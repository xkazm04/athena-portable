/**
 * Asking the daemon which chores came due, and answering them from the dock — ADR 0131.
 *
 * The daemon holds the notices (`GET /adopt/chores/due`): it offers each (case, due date) until the
 * desktop stamps it seen, and offers none in quiet hours, which it checks when asked. This polls,
 * queues what it finds, and puts one notice at a time in `useDue`, re-reading its review just before
 * it is drawn: a review answered elsewhere meanwhile (on the chore's page, in another window) is
 * dropped unstamped rather than announced as news. A notice is stamped seen only once the dock has
 * drawn it, so one delivered into a hidden window costs nothing. A key it has shown is never shown
 * again in this window, whatever the daemon says.
 *
 * The dock's acts on the notice live here too: read the review (`GET .../review`, no model call),
 * then Open and prepare, Skip this one, Pause, or Later. What "Open and prepare" needs (the pure
 * `openAndPrepare` and the review parser) is loaded on the press.
 */
import { CHORE_ROUTES, type DueNotice, type DueReview } from "@/lib/adopt";
import type { ChoresClient } from "@/lib/chores-client";
import { athenaOffer } from "@/lib/companion";
import { tabsCreate } from "@/lib/ipc";
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

const OFFLINE = "the daemon is not running";

/**
 * The daemon, asked directly: `lib/chores-client.ts` pulls the shared API module into a chunk of its
 * own, which the first-paint budget would pay for. A refusal throws, in words the dock can say.
 */
async function ask(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const at = endpoint(useDaemon.getState());
  if (!at) throw new Error(OFFLINE);
  let response: Response;
  try {
    response = await fetch(`${at.url}${path}`, {
      method,
      headers: { "X-Athena-Token": at.token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(OFFLINE);
  }
  if (!response.ok) throw new Error(`the daemon answered ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

function client(): Watched | null {
  if (!endpoint(useDaemon.getState())) return null;
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
let advancing = false;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The review's occurrence is still open: not gone, not answered elsewhere. */
function stillOpen(raw: Record<string, unknown>): boolean {
  const review = raw.review as { review?: { answer?: unknown } | null } | null | undefined;
  return !!review && typeof review === "object" && !!review.review && !review.review.answer;
}

/**
 * Put the next notice on show, once nothing is. Its review is re-read first, and one answered
 * elsewhere meanwhile is dropped, never stamped. A read that fails says nothing either way, so the
 * notice the daemon offered is drawn.
 */
async function advance(): Promise<void> {
  if (advancing) return;
  advancing = true;
  try {
    while (useDue.getState().notice === null && queue.length) {
      const next = queue.shift()!;
      const open = await ask("GET", CHORE_ROUTES.review(next.case_id)).then(stillOpen, () => true);
      if (open) useDue.setState({ notice: next, more: queue.length, dock: { kind: "line" } });
    }
  } finally {
    advancing = false;
  }
}

/** The one on show is done with (answered, opened or put away): the next one waiting takes the dock. */
function done(): void {
  useDue.setState({ notice: null, more: queue.length, dock: { kind: "line" } });
  void advance();
}

async function poll(): Promise<void> {
  try {
    queue.push(...(await watcher.poll()));
  } catch {
    return; // no daemon yet, or it refused: the next poll asks again
  }
  if (useDue.getState().notice !== null) useDue.setState({ more: queue.length });
  await advance();
}

/** Read the notice's review into the dock, its lines in reading order; one answered meanwhile is let go. */
async function review(): Promise<void> {
  const n = useDue.getState().notice;
  if (!n) return;
  useDue.setState({ dock: { kind: "reading" } });
  try {
    const [raw, { dueReviewOf }, { orderedLines }] = await Promise.all([
      ask("GET", CHORE_ROUTES.review(n.case_id)),
      import("@/lib/chores-client"),
      import("@/scenes/chores/due-model"),
    ]);
    if (useDue.getState().notice !== n) return;
    const r = stillOpen(raw) ? dueReviewOf(raw.review) : null;
    if (!r) return done();
    useDue.setState({ dock: { kind: "reviewing", review: { ...r, lines: orderedLines(r.lines) } } });
  } catch (error) {
    if (useDue.getState().notice === n)
      useDue.setState({ dock: { kind: "failed", detail: `The review could not be read: ${reason(error)}.` } });
  }
}

/** One act on the review on show; a refusal is said and the notice stays. */
async function act(what: string, run: (review: DueReview) => Promise<unknown>): Promise<void> {
  const d = useDue.getState().dock;
  if (d.kind !== "reviewing") return;
  try {
    await run(d.review);
    done();
  } catch (error) {
    useDue.setState({ dock: { kind: "failed", detail: `${what}: ${reason(error)}.` } });
  }
}

/** Open and prepare, with the Browser's tabs and her composer; nothing is sent until she presses send. */
const prepare = () =>
  act("Nothing was prepared", async (r) => {
    const { openAndPrepare } = await import("@/scenes/chores/due-model");
    await openAndPrepare(r, {
      open: (url) => void tabsCreate(url).catch((e: unknown) => console.error(`[due] open: ${String(e)}`)),
      hand: (text, playbook) =>
        void athenaOffer(text, playbook).catch((e: unknown) => console.error(`[due] hand: ${String(e)}`)),
      answer: (caseId, dueAt, answer) => ask("POST", CHORE_ROUTES.review(caseId), { due_at: dueAt, answer }),
    });
  });

const skip = () =>
  act("That was not saved", (r) =>
    ask("POST", CHORE_ROUTES.review(r.case_id), { due_at: r.review?.due_at ?? "", answer: "skip" }),
  );

const pause = () => act("That was not saved", (r) => ask("POST", CHORE_ROUTES.cadence(r.case_id), { enabled: false }));

/** Start asking. Idempotent; the dock's notice calls it when it mounts, after first paint. */
export function startDue(): () => void {
  if (timer === null) {
    useDue.setState({
      shown: (n) => {
        if (stamped.has(noticeKey(n))) return;
        stamped.add(noticeKey(n));
        watcher.seen(n).catch((e: unknown) => console.error(`[due] seen: ${String(e)}`));
      },
      dismiss: done,
      later: done,
      review: () => void review(),
      prepare: () => void prepare(),
      skip: () => void skip(),
      pause: () => void pause(),
    });
    void poll();
    timer = setInterval(() => void poll(), DUE_POLL_MS);
  }
  return () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
}
