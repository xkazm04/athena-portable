/**
 * Her composer never closes (fleet-surfaces, ADR 0141): what the person types while a turn of the
 * main thread runs either waits in line - visible, in order, removable - or, when it reads as a
 * correction, stops the turn and is sent at once. And the cards a delegated task files share the
 * one stack without ever continuing this window's exchange.
 *
 * The real store against a fake daemon that answers `fetch` with the daemon's own SSE frames, as
 * `run.test.ts` does; a turn is held open on a promise so a message can arrive while it runs.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { DaemonApi, type ExecuteRow } from "@/lib/api";
import type { DecisionRequested } from "@/lib/events";

import { TASK_NO_PICTURE, THREAD_BUSY_WAIT_MS, resetRunForTests, setRunDeps, useRun } from "./run";

type Event = Record<string, unknown>;

function sse(events: Event[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`event: ${String(event.kind)}\ndata: ${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  });
}

/** Frames, then the stream stays open until the request is aborted. */
function held(events: Event[], signal: AbortSignal | undefined): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`event: ${String(event.kind)}\ndata: ${JSON.stringify(event)}\n\n`));
      signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    },
  });
}

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

type Run = Event[] | { hang: Event[] } | { gate: Promise<void>; events: Event[] } | { refuse: string; status: number };

function fakeDaemon(runs: Run[], resolutions: Record<string, unknown> = {}) {
  const seen: Array<{ path: string; body: Record<string, unknown> | null }> = [];
  const signals: Array<AbortSignal | undefined> = [];
  let turn = 0;
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const path = url.replace("http://daemon", "");
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    seen.push({ path, body });
    if (path === "/decisions") return json({ ok: true, pending: [], showing: 0, total: 0, footer: "" });
    if (path.startsWith("/decisions/")) {
      const answer = resolutions[decodeURIComponent(path.slice("/decisions/".length))];
      return answer ? json(answer) : json({ reason: "unknown_ref", detail: path }, 404);
    }
    if (path === "/manifest") return json({ ok: true });
    if (path === "/run/stop") return json({ ok: true, stopped: true });
    if (path === "/run") {
      const next = runs[turn];
      turn += 1;
      signals.push(init.signal ?? undefined);
      if (!next) return json({ reason: "unknown", detail: "the script ran out" }, 500);
      if (Array.isArray(next)) return new Response(sse(next), { status: 200, headers: { "content-type": "text/event-stream" } });
      // The daemon's refusal shape (ADR 0141): the closed-vocabulary reason, the word beside it.
      if ("refuse" in next) return json({ ok: false, reason: "validator_failed", detail: next.refuse, error: next.refuse }, next.status);
      if ("hang" in next) return new Response(held(next.hang, init.signal ?? undefined), { status: 200, headers: { "content-type": "text/event-stream" } });
      await next.gate;
      return new Response(sse(next.events), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return json({ reason: "unknown_ref", detail: path }, 404);
  };
  return { fetchImpl, seen, signals, runs: () => seen.filter((s) => s.path === "/run") };
}

function wire(daemon: ReturnType<typeof fakeDaemon>, calls: Array<{ tab: number; name: string }> = []) {
  setRunDeps({
    api: () => new DaemonApi({ url: "http://daemon", token: "t" }, daemon.fetchImpl),
    focused: () => ({ tabId: 1, origin: "https://ledgerbox.local", appId: "ledgerbox" }),
    tab: (id) => ({ tabId: id, origin: "https://ledgerbox.local", appId: "ledgerbox" }),
    hostState: () => ({}),
    call: async (tab, name) => {
      calls.push({ tab, name });
      return { ok: true, output: `${name} ran` };
    },
  });
}

const said = (text: string): Event => ({ kind: "text.delta", text });
const finished = (): Event => ({ kind: "turn.finished", text: "", tts: null });

/** A gate a test opens by hand, to keep a turn running while the person types. */
function gate() {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

async function until(test: () => boolean) {
  for (let i = 0; i < 200 && !test(); i += 1) await new Promise((r) => setTimeout(r, 0));
  expect(test()).toBe(true);
}

const users = () => useRun.getState().transcript.filter((e) => e.kind === "user").map((e) => e.text);

beforeEach(() => resetRunForTests());

describe("a message typed while her turn runs", () => {
  it("every main-thread request says it is no task's", async () => {
    const daemon = fakeDaemon([[said("Hi."), finished()]]);
    wire(daemon);
    await useRun.getState().send("hello");
    expect(daemon.runs()[0]!.body).toMatchObject({ message: "hello", task_id: null });
  });

  it("waits in line, visible and out of the transcript, and runs in order when the turn ends", async () => {
    const hold = gate();
    const daemon = fakeDaemon([{ gate: hold.promise, events: [said("Four are late."), finished()] }, [said("Two."), finished()], [said("Sent."), finished()]]);
    wire(daemon);

    const first = useRun.getState().send("which invoices are late?");
    await until(() => daemon.runs().length === 1);
    await useRun.getState().send("and the paid ones?");
    await useRun.getState().send("then email Ana the list");

    // In line, in the order typed; nothing sent beside the turn, nothing written as said yet.
    expect(useRun.getState().queued.map((q) => q.text)).toEqual(["and the paid ones?", "then email Ana the list"]);
    expect(daemon.runs()).toHaveLength(1);
    expect(users()).toEqual(["which invoices are late?"]);

    hold.open();
    await first;
    expect(daemon.runs().map((r) => r.body!.message)).toEqual(["which invoices are late?", "and the paid ones?", "then email Ana the list"]);
    expect(users()).toEqual(["which invoices are late?", "and the paid ones?", "then email Ana the list"]);
    expect(useRun.getState().queued).toEqual([]);
    expect(useRun.getState().phase).toBe("idle");
  });

  it("can be taken back before it runs", async () => {
    const hold = gate();
    const daemon = fakeDaemon([{ gate: hold.promise, events: [said("Four."), finished()] }, [said("Sent."), finished()]]);
    wire(daemon);

    const first = useRun.getState().send("which invoices are late?");
    await until(() => daemon.runs().length === 1);
    await useRun.getState().send("and the paid ones?");
    await useRun.getState().send("then email Ana the list");
    useRun.getState().unqueue(useRun.getState().queued[0]!.id);
    expect(useRun.getState().queued.map((q) => q.text)).toEqual(["then email Ana the list"]);

    hold.open();
    await first;
    expect(daemon.runs().map((r) => r.body!.message)).toEqual(["which invoices are late?", "then email Ana the list"]);
    expect(users()).not.toContain("and the paid ones?");
  });

  it("a correction stops the turn, keeps what she said, marks it interrupted and is sent at once", async () => {
    const daemon = fakeDaemon([{ hang: [said("Looking at January")] }, [said("March, then."), finished()]]);
    wire(daemon);

    const first = useRun.getState().send("chase the late invoices");
    await until(() => useRun.getState().transcript.some((e) => e.kind === "assistant"));
    await useRun.getState().send("no, only the March ones");
    await first;

    expect(daemon.signals[0]?.aborted).toBe(true);
    const stops = daemon.seen.filter((s) => s.path === "/run/stop");
    expect(stops.map((s) => s.body)).toEqual([{ origin: "https://ledgerbox.local", conversation_id: null }]);
    expect(daemon.runs().map((r) => r.body!.message)).toEqual(["chase the late invoices", "no, only the March ones"]);
    const texts = useRun.getState().transcript.map((e) => e.text);
    // Her partial words stay; the line says what happened; the correction follows it.
    expect(texts).toContain("Looking at January");
    const cut = texts.findIndex((t) => t.startsWith("interrupted: "));
    expect(cut).toBeGreaterThan(texts.indexOf("Looking at January"));
    expect(texts.indexOf("no, only the March ones")).toBeGreaterThan(cut);
    expect(useRun.getState().queued).toEqual([]);
    expect(useRun.getState().phase).toBe("idle");
  });

  it("a request refused thread_busy is sent again a moment later, the turn still running there", async () => {
    const daemon = fakeDaemon([{ refuse: "thread_busy", status: 409 }, [said("Here."), finished()]]);
    wire(daemon);
    const started = Date.now();
    await useRun.getState().send("hello");
    expect(daemon.runs()).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(THREAD_BUSY_WAIT_MS - 20);
    expect(useRun.getState().phase).toBe("idle");
    expect(useRun.getState().error).toBeNull();
  });
});

describe("a card a delegated task filed", () => {
  const card: DecisionRequested = {
    kind: "decision.requested",
    id: "apr_0000000000t1",
    decision_kind: "approve",
    action: "host.ledgerbox.send_reminder",
    params: { invoice: "INV-7" },
    rationale: "Overdue by 40 days.",
    options: [
      { id: "approve", label: "approve" },
      { id: "decline", label: "decline" },
    ],
    expires_at: "",
    origin: "host:ledgerbox",
    surface: "panel",
    capture_id: null,
    tab_id: 2,
    tab_nav: null,
  };
  const row: ExecuteRow = { call_id: "c9", name: "host.ledgerbox.send_reminder", params: { invoice: "INV-7" }, origin: "host:ledgerbox", tab_id: 2 };

  it("joins the stack labelled with the task, and its answer goes to the task, never to this thread", async () => {
    const daemon = fakeDaemon([], { [card.id]: { ok: true, id: card.id, status: "approved", choice: "approve", conversation_id: "conv_task_0123456789ab", execute: [row], output: "", events: [] } });
    const calls: Array<{ tab: number; name: string }> = [];
    wire(daemon, calls);
    const released: Array<{ approved: boolean; execute: ExecuteRow[] }> = [];
    useRun.getState().fileTaskCard(card, "Chase March invoices", { origin: "https://ledgerbox.local", release: (o) => released.push(o) });

    expect(useRun.getState().cards.map((c) => c.id)).toEqual([card.id]);
    expect(useRun.getState().taskCards).toEqual({ [card.id]: "Chase March invoices" });
    expect(useRun.getState().captureWhy[card.id]).toBe(TASK_NO_PICTURE);

    await useRun.getState().answer(card.id, "approve");
    const resolve = daemon.seen.find((s) => s.path === `/decisions/${card.id}`);
    expect(resolve!.body).toMatchObject({ choice: "approve", origin: "https://ledgerbox.local" });
    // Released to the task: the page call is not run here and no turn of this thread continues.
    expect(released).toEqual([{ approved: true, execute: [row], results: [] }]);
    expect(calls).toEqual([]);
    expect(daemon.runs()).toHaveLength(0);
    expect(useRun.getState().cards).toEqual([]);
    expect(useRun.getState().taskCards).toEqual({});
    expect(useRun.getState().answered[0]).toMatchObject({ id: card.id, result: "approved" });
  });

  it("a decline is the task's to hear", async () => {
    const daemon = fakeDaemon([], { [card.id]: { ok: true, id: card.id, status: "declined", choice: "decline", conversation_id: "c", execute: [], output: "", events: [] } });
    wire(daemon);
    const released: Array<{ approved: boolean }> = [];
    useRun.getState().fileTaskCard(card, "Chase March invoices", { origin: "https://ledgerbox.local", release: (o) => released.push(o) });
    await useRun.getState().answer(card.id, "decline");
    expect(released).toEqual([{ approved: false, execute: [] }]);
    expect(daemon.runs()).toHaveLength(0);
  });

  it("withdrawn, it leaves the stack and a reconcile does not bring it back", async () => {
    const daemon = fakeDaemon([]);
    // The daemon still lists it as pending until the decline lands.
    const pending = [{ id: card.id, action: card.action, origin: card.origin, params: card.params }];
    const fetchImpl = async (url: string, init?: RequestInit) =>
      url.endsWith("/decisions") ? json({ ok: true, pending, showing: 1, total: 1, footer: "" }) : daemon.fetchImpl(url, init);
    setRunDeps({
      api: () => new DaemonApi({ url: "http://daemon", token: "t" }, fetchImpl),
      focused: () => ({ tabId: 1, origin: "https://ledgerbox.local", appId: "ledgerbox" }),
      hostState: () => ({}),
      call: async () => ({ ok: true, output: "" }),
    });
    useRun.getState().fileTaskCard(card, "Chase March invoices", { origin: "https://ledgerbox.local", release: () => {} });
    useRun.getState().withdrawTaskCard(card.id);
    await useRun.getState().reconcile();
    expect(useRun.getState().cards).toEqual([]);
    expect(useRun.getState().taskCards).toEqual({});
  });
});
