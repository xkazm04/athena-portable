// @vitest-environment jsdom
/**
 * The dock's due notice (ADR 0131): pressed, it opens the case's staged review in place and answers
 * it there (Open and prepare, Skip this one, Later), says how many more wait, re-reads a queued
 * notice's review before drawing it, and stamps a notice seen only once the dock has drawn it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DueNotice } from "@/lib/adopt";

const tabsCreate = vi.fn<(url: string) => Promise<number>>();
const athenaOffer = vi.fn<(text: string, playbook?: unknown) => Promise<void>>();

vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  tabsCreate: (url: string) => tabsCreate(url),
}));
vi.mock("@/lib/companion", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  athenaOffer: (t: string, p?: unknown) => athenaOffer(t, p),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DUE = "2026-10-19T09:00:00+00:00";

/** `vi.waitFor` with room: its 1 s default ran out under the whole workspace suite at once. */
const waitLong = <T,>(check: () => T | Promise<T>) => vi.waitFor(check, { timeout: 5_000 });

const notice = (id: string, over: Partial<DueNotice> = {}): DueNotice => ({
  case_id: id,
  playbook_id: `pb-${id}`,
  title: `Chore ${id}`,
  due_at: DUE,
  missed: 0,
  ask_slow: false,
  ...over,
});

/** The daemon's review of a case: still open unless `answer` is set; `null` when there is none. */
function rawReview(id: string, answer = "", over: Record<string, unknown> = {}) {
  return {
    case_id: id,
    playbook_id: `pb-${id}`,
    title: `Chore ${id}`,
    command: `Do ${id}.`,
    enabled: true,
    rule_text: "every Monday at 09:00",
    timezone: "UTC",
    next_run_at: "2026-10-26T09:00:00+00:00",
    review: { due_at: DUE, opened_at: DUE, missed: 0, missed_at: [], answer },
    unanswered: 0,
    ask_slow: false,
    last_run_at: "2026-10-05T10:00:00+00:00",
    lines: [
      { kind: "declined", action: "host.remind", params: {}, at: "", text: "" },
      { kind: "approved", action: "host.pay", params: {}, at: "", text: "" },
      { kind: "expired", action: "host.void", params: {}, at: "", text: "" },
      { kind: "may_have_completed", action: "", params: {}, at: "", text: "host.pay may have completed" },
    ],
    lines_total: 4,
    lines_footer: "",
    portals: [
      { name: "Ledgerwren", url: "https://ledgerwren.test/", source: "playbook" },
      { name: "Gmail", url: "https://mail.google.com/", source: "case" },
      { name: "Calcwren", url: "", source: "" },
    ],
    ...over,
  };
}

interface Daemon {
  notices: DueNotice[];
  /** case id -> the review the daemon answers, or null for none; a missing case answers an open one. */
  reviews: Record<string, unknown>;
  /** When set, every review read fails as a refused connection. */
  down: boolean;
  /** The saved cases `GET /adopt/cases?playbook_id=` lists (ADR 0225: their `space_id`). */
  cases: { case_id: string; space_id: string }[];
  /** When set, every answer but the seen stamp is refused with a 500. */
  refuse: boolean;
  seen: { method: string; path: string; body: unknown }[];
}

let daemon: Daemon;
let root: Root | null = null;
let host: HTMLElement;
const go = vi.fn();

function serve(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input).replace("http://daemon", "");
      const method = init?.method ?? "GET";
      daemon.seen.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      if (path === "/adopt/chores/due") return json({ ok: true, notices: daemon.notices });
      if (path.startsWith("/adopt/cases?")) return json({ ok: true, cases: daemon.cases });
      const m = /^\/adopt\/cases\/([^/]+)\/review$/.exec(path);
      if (m && method === "GET") {
        if (daemon.down) throw new TypeError("Failed to fetch");
        const id = decodeURIComponent(m[1]!);
        return json({ ok: true, review: id in daemon.reviews ? daemon.reviews[id] : rawReview(id) });
      }
      const answer = (init?.body ? JSON.parse(String(init.body)) : {}) as { answer?: string };
      if (daemon.refuse && method === "POST" && answer.answer !== "seen") return new Response("{}", { status: 500 });
      return json({ ok: true, review: null });
    }),
  );
}

async function mount(notices: DueNotice[]) {
  daemon.notices = notices;
  const { useDaemon } = await import("@/stores/daemon");
  useDaemon.setState({ health: "ready", url: "http://daemon", token: "t" });
  const { default: DueNoticeView } = await import("./due-notice");
  await act(async () => {
    root = createRoot(host);
    root.render(<DueNoticeView go={go} />);
  });
  await settle();
}

async function settle() {
  for (let i = 0; i < 10; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)));
}

const line = () => host.querySelector<HTMLButtonElement>(".due-notice__line, button.due-notice");
const button = (text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
async function press(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => el!.click());
  await settle();
}
const dock = async () => (await import("@/stores/due")).useDue.getState();
const requests = () => daemon.seen.map((s) => `${s.method} ${s.path}`);
const posts = () => daemon.seen.filter((s) => s.method === "POST" && !(s.body as { answer?: string })?.answer?.startsWith("seen"));

// Transform the dock's module graph once, before any case: under the whole workspace suite at once
// the first case otherwise paid the cold transform and timed out. Later imports (after
// resetModules) re-evaluate the cached transforms.
beforeAll(async () => {
  await import("@/stores/daemon");
  await import("@/stores/due");
  await import("./due-notice");
}, 120_000);

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  daemon = { notices: [], reviews: {}, down: false, refuse: false, seen: [], cases: [] };
  serve();
  host = document.createElement("div");
  document.body.appendChild(host);
  go.mockReset();
  tabsCreate.mockReset().mockResolvedValue(7);
  athenaOffer.mockReset().mockResolvedValue();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

// Each case mounts the dock and reads a review over the fake daemon; under the whole workspace
// suite at once that ran past the 5 s default, so the block gets the room it needs.
describe("the dock's due notice opens the staged review in place", { timeout: 15_000 }, () => {
  it("pressed: reads the review once, draws it with its lines in reading order, and posts nothing", async () => {
    await mount([notice("a")]);
    const before = daemon.seen.length;
    await press(line());
    const after = daemon.seen.slice(before);
    expect(after.map((s) => `${s.method} ${s.path}`)).toEqual(["GET /adopt/cases/a/review"]);
    // The review read resolves after the press; under a loaded suite the dock can still be
    // "reading" on the first look, so wait for it rather than sample it once.
    await waitLong(async () => expect((await dock()).dock.kind).toBe("reviewing"));
    const state = await dock();
    if (state.dock.kind !== "reviewing") return;
    expect(state.dock.review.lines.map((l) => l.kind)).toEqual(["expired", "may_have_completed", "approved", "declined"]);
    await waitLong(() => expect(button("Open and prepare")).toBeTruthy());
    expect(go).not.toHaveBeenCalled();
  });

  it("Open and prepare: answers prepare once, opens each web portal, hands the command over, no /run, next notice takes the dock", async () => {
    await mount([notice("a"), notice("b")]);
    await press(line());
    await waitLong(() => expect(button("Open and prepare")).toBeTruthy());
    await press(button("Open and prepare"));
    const prepares = daemon.seen.filter((s) => s.method === "POST" && (s.body as { answer?: string }).answer === "prepare");
    expect(prepares).toEqual([{ method: "POST", path: "/adopt/cases/a/review", body: { due_at: DUE, answer: "prepare" } }]);
    expect(tabsCreate.mock.calls.map((c) => c[0])).toEqual(["https://ledgerwren.test/", "https://mail.google.com/"]);
    // A case in core (none listed with a space) is handed over to core (ADR 0225).
    expect(athenaOffer).toHaveBeenCalledWith("Do a.", { id: "pb-a", title: "Chore a", caseId: "a", scheduled: true, spaceId: "" });
    expect(requests().some((r) => r.includes("/run"))).toBe(false);
    expect((await dock()).notice?.case_id).toBe("b");
    expect(go).not.toHaveBeenCalled();
  });

  it("Open and prepare on a case linked to a Project hands the run over in that Project (ADR 0225)", async () => {
    daemon.cases = [{ case_id: "a", space_id: "spc_0123456789ab" }];
    await mount([notice("a")]);
    await press(line());
    await waitLong(() => expect(button("Open and prepare")).toBeTruthy());
    await press(button("Open and prepare"));
    expect(requests()).toContain("GET /adopt/cases?playbook_id=pb-a");
    expect(athenaOffer).toHaveBeenCalledWith("Do a.", {
      id: "pb-a",
      title: "Chore a",
      caseId: "a",
      scheduled: true,
      spaceId: "spc_0123456789ab",
    });
  });

  it("Skip this one: answers skip, and the next notice takes the dock", async () => {
    await mount([notice("a"), notice("b")]);
    await press(line());
    await waitLong(() => expect(button("Skip this one")).toBeTruthy());
    await press(button("Skip this one"));
    expect(posts()).toEqual([{ method: "POST", path: "/adopt/cases/a/review", body: { due_at: DUE, answer: "skip" } }]);
    expect((await dock()).notice?.case_id).toBe("b");
  });

  it("Later: posts no answer, the next notice takes the dock, and the same one is not shown again", async () => {
    await mount([notice("a"), notice("b")]);
    await press(line());
    await press(button("Later"));
    expect(posts()).toEqual([]);
    expect((await dock()).notice?.case_id).toBe("b");
    // The daemon offers both again on the next poll (a remount polls at once): this window shows neither.
    await act(async () => root!.render(<div />));
    const { default: DueNoticeView } = await import("./due-notice");
    await act(async () => root!.render(<DueNoticeView go={go} />));
    await settle();
    expect(daemon.seen.filter((s) => s.path === "/adopt/chores/due")).toHaveLength(2);
    expect((await dock()).notice?.case_id).toBe("b");
    expect(posts()).toEqual([]);
  });

  it("a queued notice answered elsewhere meanwhile is dropped before it is drawn, never stamped, and the next takes its place", async () => {
    daemon.reviews = { b: rawReview("b", "prepare"), c: null };
    await mount([notice("a"), notice("b"), notice("c"), notice("d")]);
    await press(line());
    await press(button("Later"));
    expect((await dock()).notice?.case_id).toBe("d");
    const stamps = daemon.seen.filter((s) => s.method === "POST" && (s.body as { answer?: string }).answer === "seen");
    expect(stamps.map((s) => s.path)).not.toContain("/adopt/cases/b/review");
    expect(stamps.map((s) => s.path)).not.toContain("/adopt/cases/c/review");
  });

  it("says how many more are due, and the count falls as each is handled", async () => {
    await mount([notice("a"), notice("b"), notice("c")]);
    expect(line()?.textContent).toBe("Chore a is due · 2 more due");
    await press(line());
    await press(button("Later"));
    expect(line()?.textContent).toBe("Chore b is due · 1 more due");
    await press(line());
    await press(button("Later"));
    expect(line()?.textContent).toBe("Chore c is due");
  });

  it("a review that cannot be read: one sentence, the notice stays, and Open the chore still goes to the chore's page", async () => {
    await mount([notice("a")]);
    daemon.down = true;
    await press(line());
    const state = await dock();
    expect(state.dock.kind).toBe("failed");
    if (state.dock.kind === "failed") expect(state.dock.detail).toBe("The review could not be read: the daemon is not running.");
    expect(state.notice?.case_id).toBe("a");
    await press(button("Open the chore"));
    expect(go).toHaveBeenCalledWith({ root: "chores", item: "pb-a" });
  });

  it("stamps a notice seen once per case and due date, and only after the dock drew it", async () => {
    await mount([notice("a"), notice("b")]);
    const stamps = () =>
      daemon.seen.filter((s) => s.method === "POST" && (s.body as { answer?: string }).answer === "seen").map((s) => s.path);
    expect(stamps()).toEqual(["/adopt/cases/a/review"]);
    expect(host.textContent).toContain("Chore a is due");
    await act(async () => root!.render(<div />));
    const { default: DueNoticeView } = await import("./due-notice");
    await act(async () => root!.render(<DueNoticeView go={go} />));
    await settle();
    expect(stamps()).toEqual(["/adopt/cases/a/review"]);
  });

  it("an ask-slow notice keeps its 'is due again: pause or slow it?' line and still reaches the pause or slow choice", async () => {
    daemon.reviews = { a: rawReview("a", "", { ask_slow: true, unanswered: 3 }) };
    await mount([notice("a", { ask_slow: true })]);
    expect(host.textContent).toContain("Chore a is due again: pause or slow it?");
    await press(line());
    const inPlace = async () => {
      await waitLong(() => expect(button("Pause it")).toBeTruthy());
      expect(button("Slow it")).toBeTruthy();
    };
    if (go.mock.calls.length) expect(go).toHaveBeenCalledWith({ root: "chores", item: "pb-a" });
    else await inPlace();
  });
});

describe("the dock's notice, held to its own words", { timeout: 15_000 }, () => {
  let hidden = false;
  beforeEach(() => {
    hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  });
  afterEach(() => {
    Reflect.deleteProperty(document, "hidden");
    Reflect.deleteProperty(document, "visibilityState");
  });
  const stamps = () =>
    daemon.seen.filter((s) => s.method === "POST" && (s.body as { answer?: string }).answer === "seen").map((s) => s.path);

  it("Escape closes the review from the line that opened it, where the focus is", async () => {
    await mount([notice("a")]);
    await press(line());
    await waitLong(() => expect(button("Open and prepare")).toBeTruthy());
    line()!.focus();
    await act(async () => {
      line()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect((await dock()).dock.kind).toBe("line");
    expect(line()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("the line names the review it opens, so a reader can follow it there", async () => {
    await mount([notice("a")]);
    expect(line()?.hasAttribute("aria-controls")).toBe(false);
    await press(line());
    const id = line()?.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    expect(host.querySelector(".due-notice__panel")?.id).toBe(id);
  });

  it("an answer the daemon refused is said beside the review, which stays on show to be answered again", async () => {
    await mount([notice("a")]);
    await press(line());
    await waitLong(() => expect(button("Skip this one")).toBeTruthy());
    daemon.refuse = true;
    await press(button("Skip this one"));
    await waitLong(() => expect(host.textContent).toContain("That was not saved: the daemon answered 500."));
    expect(button("Skip this one")).toBeTruthy();
    expect((await dock()).notice?.case_id).toBe("a");
    daemon.refuse = false;
    await press(button("Skip this one"));
    expect(posts().filter((p) => (p.body as { answer?: string }).answer === "skip")).toHaveLength(2);
    expect((await dock()).notice).toBeNull();
  });

  it("is not stamped seen while the window is hidden, and is stamped once it is shown", async () => {
    hidden = true;
    await mount([notice("a")]);
    expect(host.textContent).toContain("Chore a is due");
    expect(stamps()).toEqual([]);
    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    expect(stamps()).toEqual(["/adopt/cases/a/review"]);
  });
});
