/**
 * A message from another device runs in this window as if it were typed — ADR 0140 ("Remote acts").
 *
 * The real run store against a fake daemon: `remote.message` is taken (`/remote/<id>/accept`), the
 * exchange's every `POST /run` carries `via`, a card filed under it continues it when a peer
 * answers (`remote.decided`), and the daemon is told when the exchange ends without a request.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { DaemonApi } from "@/lib/api";
import type { RemoteDecided, RemoteMessage } from "@/lib/fleet";

import { MAX_CONTINUATIONS, resetRunForTests, setRunDeps, useRun } from "./run";

type Event = Record<string, unknown>;

function sse(events: Event[]): Response {
  const body = events.map((e) => `event: ${String(e.kind)}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

interface Seen {
  path: string;
  body: Record<string, unknown> | null;
}

function fakeDaemon(runs: Event[][], accept = true) {
  const seen: Seen[] = [];
  let turn = 0;
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const path = url.replace("http://daemon", "");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    seen.push({ path, body });
    if (path.endsWith("/accept")) return accept ? json({ ok: true }) : json({ reason: "unknown_ref", detail: "" }, 404);
    if (path.endsWith("/end")) return json({ ok: true });
    if (path === "/decisions") return json({ ok: true, pending: [], showing: 0, total: 0, footer: "" });
    if (path === "/manifest") return json({ ok: true });
    if (path === "/run") {
      const next = runs[turn];
      turn += 1;
      return next ? sse(next) : json({ reason: "unknown", detail: "the script ran out" }, 500);
    }
    return json({ reason: "unknown_ref", detail: path }, 404);
  };
  return {
    seen,
    fetchImpl,
    runs: () => seen.filter((s) => s.path === "/run"),
    ends: () => seen.filter((s) => s.path.endsWith("/end")),
  };
}

function wire(daemon: ReturnType<typeof fakeDaemon>, calls: string[] = [], appId = "ledgerbox") {
  setRunDeps({
    api: () => new DaemonApi({ url: "http://daemon", token: "t" }, daemon.fetchImpl),
    focused: () => ({ tabId: 1, origin: "https://ledgerbox.local", appId }),
    hostState: () => ({}),
    call: async (_tab, name) => {
      calls.push(name);
      return { ok: true, output: `${name} ran` };
    },
  });
}

const message = (over: Partial<RemoteMessage> = {}): RemoteMessage => ({
  kind: "remote.message",
  request_id: "job_0000000000d1",
  peer_id: "dev_0000000000a2",
  peer_name: "Laptop",
  text: "which invoices are late?",
  target_app: null,
  ...over,
});
const said = (text: string): Event => ({ kind: "text.delta", text });
const finished = (): Event => ({ kind: "turn.finished", text: "", tts: null });
const hostCall = (id: string, name: string): Event => ({ kind: "tool.call", call_id: id, name, params: {}, origin: "host:ledgerbox", tier: 1 });
const card = (id: string): Event => ({
  kind: "decision.requested",
  id,
  decision_kind: "approve",
  action: "host.ledgerbox.pay",
  params: {},
  rationale: "",
  options: [
    { id: "approve", label: "Approve" },
    { id: "decline", label: "Decline" },
  ],
  expires_at: "",
  origin: "host:ledgerbox",
  surface: "panel",
  capture_id: null,
  tab_id: null,
  tab_nav: null,
});
const VIA = { peer_id: "dev_0000000000a2", request_id: "job_0000000000d1" };

beforeEach(() => resetRunForTests());

describe("a remote message", () => {
  it("is taken, run with via on every request, and attributed to its device", async () => {
    const daemon = fakeDaemon([[hostCall("c1", "host.ledgerbox.list_overdue"), finished()], [said("Three."), finished()]]);
    const calls: string[] = [];
    wire(daemon, calls);

    await useRun.getState().remote(message());

    expect(daemon.seen[0]!.path).toBe("/remote/job_0000000000d1/accept");
    const runs = daemon.runs();
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.body!.via)).toEqual([VIA, VIA]);
    expect(runs[0]!.body!.message).toBe("which invoices are late?");
    expect(calls).toEqual(["list_overdue"]);
    const user = useRun.getState().transcript[0]!;
    expect(user).toMatchObject({ kind: "user", from: "Laptop", text: "From Laptop: which invoices are late?" });
    expect(daemon.ends().map((e) => e.body)).toEqual([{ reason: "finished", detail: "" }]);
    expect(useRun.getState().via).toBeNull();
  });

  it("runs once however often it is offered", async () => {
    const daemon = fakeDaemon([[finished()]]);
    wire(daemon);
    await useRun.getState().remote(message());
    await useRun.getState().remote(message());
    expect(daemon.seen.filter((s) => s.path.endsWith("/accept"))).toHaveLength(1);
    expect(daemon.runs()).toHaveLength(1);
  });

  it("runs nothing when it was no longer offered", async () => {
    const daemon = fakeDaemon([[finished()]], false);
    wire(daemon);
    await useRun.getState().remote(message());
    expect(daemon.runs()).toHaveLength(0);
  });

  it("is not sent with via once its exchange is over: a typed message after it is the window's own", async () => {
    const daemon = fakeDaemon([[finished()], [finished()]]);
    wire(daemon);
    await useRun.getState().remote(message());
    await useRun.getState().send("hello");
    expect(daemon.runs()[1]!.body!.via).toBeUndefined();
  });

  it("names an app this window is not on: nothing runs, and the sender is told why", async () => {
    const daemon = fakeDaemon([[finished()]]);
    wire(daemon);
    await useRun.getState().remote(message({ target_app: "hirelane" }));
    expect(daemon.runs()).toHaveLength(0);
    expect(daemon.ends()[0]!.body!.reason).toBe("foreign_origin");
  });

  it("tells the daemon when the continuation budget ends the exchange", async () => {
    const looping = Array.from({ length: MAX_CONTINUATIONS + 1 }, (_, n) => [hostCall(`c${n}`, "host.ledgerbox.list_overdue"), finished()]);
    const daemon = fakeDaemon(looping);
    wire(daemon);
    await useRun.getState().remote(message());
    expect(daemon.ends()[0]!.body!.reason).toBe("budget_exhausted");
  });
});

describe("a card a remote exchange filed", () => {
  it("keeps the exchange open, and a peer's yes runs the execute here and continues it with via", async () => {
    const daemon = fakeDaemon([[said("Needs you."), card("apr_000000000001"), finished()], [said("Paid."), finished()]]);
    const calls: string[] = [];
    wire(daemon, calls);

    await useRun.getState().remote(message());
    expect(useRun.getState().cards.map((c) => c.id)).toEqual(["apr_000000000001"]);
    expect(daemon.ends()).toHaveLength(0);

    const decided: RemoteDecided = {
      kind: "remote.decided",
      approval_id: "apr_000000000001",
      peer_id: "dev_0000000000a2",
      peer_name: "Laptop",
      status: "approved",
      execute: [{ call_id: "x1", name: "host.ledgerbox.pay", params: {}, origin: "host:ledgerbox", tier: 1 }],
      output: "",
    };
    await useRun.getState().remoteDecided(decided);

    expect(calls).toEqual(["pay"]);
    const runs = daemon.runs();
    expect(runs).toHaveLength(2);
    expect(runs[1]!.body!.via).toEqual(VIA);
    expect((runs[1]!.body!.tool_results as Array<Record<string, unknown>>)[0]!.call_id).toBe("x1");
    expect(useRun.getState().cards).toEqual([]);
    expect(daemon.ends().map((e) => e.body!.reason)).toEqual(["finished"]);
  });

  it("is declined by a peer: nothing runs, and the exchange ends as declined", async () => {
    const daemon = fakeDaemon([[card("apr_000000000002"), finished()]]);
    const calls: string[] = [];
    wire(daemon, calls);
    await useRun.getState().remote(message());
    await useRun.getState().remoteDecided({
      kind: "remote.decided",
      approval_id: "apr_000000000002",
      peer_id: "dev_0000000000a2",
      peer_name: "Laptop",
      status: "declined",
      execute: [],
      output: "",
    });
    expect(calls).toEqual([]);
    expect(daemon.ends().map((e) => e.body!.reason)).toEqual(["user_denied"]);
  });
});

describe("the person typing while a remote exchange runs", () => {
  it("waits for that exchange and then runs as the window's own, never teed with via", async () => {
    const daemon = fakeDaemon([[said("Three."), finished()], [said("Hi."), finished()]]);
    // Hold the remote exchange's request open until the person has typed.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let runs = 0;
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
      if (url.endsWith("/run") && runs++ === 0) await held;
      return daemon.fetchImpl(url, init);
    };
    setRunDeps({
      api: () => new DaemonApi({ url: "http://daemon", token: "t" }, fetchImpl),
      focused: () => ({ tabId: 1, origin: "https://ledgerbox.local", appId: "ledgerbox" }),
      hostState: () => ({}),
      call: async () => ({ ok: true, output: "" }),
    });

    const remote = useRun.getState().remote(message());
    for (let i = 0; i < 50 && useRun.getState().via === null; i += 1) await new Promise((r) => setTimeout(r, 0));
    expect(useRun.getState().via).not.toBeNull();
    await useRun.getState().send("and the paid ones?");
    // Not sent yet: the remote exchange holds the one turn at a time.
    expect(daemon.runs()).toHaveLength(0);
    expect(useRun.getState().transcript.map((e) => e.text)).toContain("waiting: the message from Laptop runs first");
    release();
    await remote;

    const sent = daemon.runs();
    expect(sent.map((r) => r.body!.message)).toEqual(["which invoices are late?", "and the paid ones?"]);
    expect(sent[0]!.body!.via).toEqual(VIA);
    expect(sent[1]!.body!.via).toBeUndefined();
    // The remote device was told its exchange ended before the person's turn ran.
    expect(daemon.ends().map((e) => e.body!.reason)).toEqual(["finished"]);
    expect(useRun.getState().phase).toBe("idle");
  });
});
