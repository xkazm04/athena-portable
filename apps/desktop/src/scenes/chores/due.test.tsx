// @vitest-environment jsdom
/**
 * "When it comes due" (ADR 0131): "Open and prepare" makes the chore's tabs through the module's own
 * `open` (which calls `tabsCreate`) with the playbook's or the case's addresses and never an app's
 * name, puts the case's command in her composer and sends nothing; the review reads what to check
 * first first, and asks "pause or slow?" after three unanswered.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DueReview, ReviewLine } from "@/lib/adopt";
import { ChoresApi } from "@/lib/chores-client";
import type { PlaybooksModel } from "@/modules/playbooks/model";
import { DueWatcher } from "@/stores/due-poll";

import { ReviewView } from "./due";
import { openAndPrepare, orderedLines } from "./due-model";

const tabsCreate = vi.fn<(url: string) => Promise<number>>();
const athenaOffer = vi.fn<(text: string, playbook?: unknown) => Promise<void>>();

vi.mock("@/lib/ipc", () => ({ tabsCreate: (url: string) => tabsCreate(url) }));
vi.mock("@/lib/companion", () => ({ athenaOffer: (t: string, p?: unknown) => athenaOffer(t, p) }));

const { usePlaybooksModel } = await import("@/modules/playbooks/index");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function model(): PlaybooksModel {
  let got: PlaybooksModel | null = null;
  function Probe() {
    got = usePlaybooksModel(() => {});
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  act(() => root.unmount());
  return got!;
}

const CASE = "proj_0123456789ab";
const DUE = "2026-10-19T09:00:00+00:00";

function review(over: Partial<DueReview> = {}): DueReview {
  return {
    case_id: CASE,
    playbook_id: "freelancer-receivables",
    title: "Chase the invoices",
    command: "Chase every overdue invoice.",
    enabled: true,
    rule_text: "every Monday at 09:00",
    timezone: "UTC",
    next_run_at: "2026-10-26T09:00:00+00:00",
    review: {
      due_at: DUE,
      opened_at: DUE,
      missed: 2,
      missed_at: ["2026-10-12T09:00:00+00:00", "2026-10-19T09:00:00+00:00"],
      delivered_at: "",
      held_at: "",
      answer: "",
      answered_at: "",
      first_turn_id: "",
    },
    unanswered: 0,
    ask_slow: false,
    last_run_at: "2026-10-05T10:00:00+00:00",
    lines: [],
    lines_total: 0,
    lines_footer: "",
    portals: [
      { name: "Ledgerwren", url: "https://ledgerwren.test/", source: "playbook" },
      { name: "Gmail", url: "https://mail.google.com/", source: "case" },
      { name: "Calcwren", url: "", source: "" },
    ],
    ...over,
  };
}

/** A daemon that answers the review route and records every request. */
function fakeDaemon() {
  const seen: { method: string; path: string; body: unknown }[] = [];
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    const path = input.replace("http://daemon", "");
    seen.push({ method: init?.method ?? "GET", path, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ ok: true, review: null, notices: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { seen, client: new ChoresApi(() => ({ url: "http://daemon", token: "t" }), fetchImpl) };
}

beforeEach(() => {
  tabsCreate.mockReset().mockResolvedValue(7);
  athenaOffer.mockReset().mockResolvedValue();
});

describe("Open and prepare", () => {
  it("makes the tabs with known addresses only, hands over the command, and sends no turn", async () => {
    const daemon = fakeDaemon();
    const { actions } = model();
    const out = await openAndPrepare(review(), {
      open: actions.open,
      hand: actions.hand,
      answer: daemon.client.answer.bind(daemon.client),
    });

    await vi.waitFor(() => expect(tabsCreate).toHaveBeenCalledTimes(2));
    expect(tabsCreate.mock.calls.map((c) => c[0])).toEqual(["https://ledgerwren.test/", "https://mail.google.com/"]);
    // A portal name is never an address.
    for (const name of ["Ledgerwren", "Gmail", "Calcwren"]) {
      expect(tabsCreate).not.toHaveBeenCalledWith(name);
    }
    expect(out.unknown).toEqual(["Calcwren"]);

    // The command only, marked as this run's first send; nothing of the last run goes with it.
    await vi.waitFor(() => expect(athenaOffer).toHaveBeenCalledTimes(1));
    expect(athenaOffer).toHaveBeenCalledWith("Chase every overdue invoice.", {
      id: "freelancer-receivables",
      title: "Chase the invoices",
      caseId: CASE,
      scheduled: true,
      spaceId: "",
    });

    // The one request is the review's answer; no /run until she presses send.
    expect(daemon.seen.map((s) => `${s.method} ${s.path}`)).toEqual([`POST /adopt/cases/${CASE}/review`]);
    expect(daemon.seen[0]!.body).toEqual({ due_at: DUE, answer: "prepare" });
    expect(daemon.seen.some((s) => s.path.startsWith("/run"))).toBe(false);
  });

  it("hands over the Project a linked case runs in, so her window enters it first (ADR 0225)", async () => {
    const daemon = fakeDaemon();
    const { actions } = model();
    await openAndPrepare(review(), { open: actions.open, hand: actions.hand, answer: daemon.client.answer.bind(daemon.client) }, "spc_0123456789ab");
    await vi.waitFor(() => expect(athenaOffer).toHaveBeenCalledTimes(1));
    expect(athenaOffer.mock.calls[0]![1]).toMatchObject({ caseId: CASE, scheduled: true, spaceId: "spc_0123456789ab" });
  });
});

describe("the review", () => {
  const line = (kind: ReviewLine["kind"], action = ""): ReviewLine => ({
    kind,
    action,
    params: action ? { invoice: "7" } : {},
    at: "2026-10-05T09:30:00+00:00",
    text: action ? "" : "host.invoices.pay may have completed",
  });
  const noop = () => {};

  it("lists the expired and the may-have-completed first, whatever order it was given", () => {
    const shuffled = [
      line("declined", "host.invoices.remind"),
      line("approved", "host.invoices.pay"),
      line("may_have_completed"),
      line("expired", "host.invoices.void"),
      line("pending", "host.invoices.wait"),
    ];
    expect(orderedLines(shuffled).map((l) => l.kind)).toEqual([
      "expired",
      "may_have_completed",
      "pending",
      "approved",
      "declined",
    ]);
    const html = renderToStaticMarkup(
      <ReviewView review={review({ lines: shuffled })} said="" onPrepare={noop} onSkip={noop} onPause={noop} onSlow={noop} />,
    );
    const kinds = [...html.matchAll(/data-kind="([a-z_]+)"/g)].map((m) => m[1]);
    expect(kinds).toEqual(["expired", "may_have_completed", "pending", "approved", "declined"]);
    expect(html).toContain("2 more came and went since");
    expect(html).toContain("No address is known for Calcwren");
  });

  it("asks pause or slow after three unanswered, and not before", () => {
    const ask = "Pause or slow this chore?";
    const quiet = renderToStaticMarkup(
      <ReviewView review={review({ unanswered: 2 })} said="" onPrepare={noop} onSkip={noop} onPause={noop} onSlow={noop} />,
    );
    expect(quiet).not.toContain(ask);
    const asked = renderToStaticMarkup(
      <ReviewView
        review={review({ unanswered: 3, ask_slow: true })}
        said=""
        onPrepare={noop}
        onSkip={noop}
        onPause={noop}
        onSlow={noop}
      />,
    );
    expect(asked).toContain(`It came due 3 times without an answer. ${ask}`);
    expect(asked).toContain("Pause it");
    expect(asked).toContain("Slow it");
  });
});

describe("the dock's notice", () => {
  it("is shown once per case and due date, however many polls offer it", async () => {
    const notice = { case_id: CASE, playbook_id: "p", title: "T", due_at: DUE, missed: 0, ask_slow: false };
    const due = vi.fn(async () => ({
      ok: true as const,
      notices: [notice],
      held: 0,
      quiet: { start: "", end: "", timezone: "", now: false, until: "" },
      ticked_at: "",
      showing: 1,
      total: 1,
      footer: "",
    }));
    const answer = vi.fn(async () => null);
    const client = { due, answer } as unknown as ChoresApi;
    const watcher = new DueWatcher(() => client);
    expect(await watcher.poll()).toEqual([notice]);
    expect(await watcher.poll()).toEqual([]);
    await watcher.seen(notice);
    expect(answer).toHaveBeenCalledWith(CASE, DUE, "seen");
  });
});
