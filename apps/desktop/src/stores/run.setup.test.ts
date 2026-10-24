/**
 * The setup conversation in her window — ADR 0140 (WP4, wired in WP5).
 *
 * The real run store against a fake daemon: once "Set up with Athena" hands the session over, the
 * person's turns go to `athena://setup` with no page in them, a card the setup turn files is
 * answered in that session's name, a remote message still runs on the page, and leaving the
 * conversation sends the next message to the focused tab again.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { DaemonApi } from "@/lib/api";
import type { RemoteMessage } from "@/lib/fleet";
import { SETUP_ORIGIN } from "@/lib/setup";

import { resetRunForTests, setRunDeps, useRun } from "./run";

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

function fakeDaemon(runs: Event[][]) {
  const seen: Seen[] = [];
  let turn = 0;
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const path = url.replace("http://daemon", "");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    seen.push({ path, body });
    if (path.endsWith("/accept") || path.endsWith("/end") || path === "/manifest") return json({ ok: true });
    if (path === "/decisions") return json({ ok: true, pending: [], showing: 0, total: 0, footer: "" });
    if (path.startsWith("/decisions/")) {
      return json({
        ok: true,
        id: path.slice("/decisions/".length),
        status: "approved",
        choice: "approve",
        conversation_id: "conv_setup",
        execute: [],
        output: "{}",
        events: [],
      });
    }
    if (path === "/run") {
      const next = runs[turn];
      turn += 1;
      return next ? sse(next) : json({ reason: "unknown", detail: "the script ran out" }, 500);
    }
    return json({ reason: "unknown_ref", detail: path }, 404);
  };
  return { seen, fetchImpl, runs: () => seen.filter((s) => s.path === "/run") };
}

function wire(daemon: ReturnType<typeof fakeDaemon>, captures: number[] = [], page = true) {
  setRunDeps({
    api: () => new DaemonApi({ url: "http://daemon", token: "t" }, daemon.fetchImpl),
    focused: () => (page ? { tabId: 1, origin: "https://ledgerbox.local", appId: "ledgerbox" } : null),
    hostState: () => ({ tabs: ["ledgerbox"] }),
    capture: async (tabId) => {
      captures.push(tabId);
      return { id: "cap_000000000001", why: null };
    },
    call: async () => ({ ok: true, output: "" }),
  });
}

const SESSION = { origin: SETUP_ORIGIN, conversation_id: "conv_setup", phase: "ready" };
const finished = (): Event => ({ kind: "turn.finished", text: "", tts: null });
const said = (text: string): Event => ({ kind: "text.delta", text });
const setupCard = (id: string): Event => ({
  kind: "decision.requested",
  id,
  decision_kind: "approve",
  action: "connector.setup.install_overlay",
  params: {},
  rationale: "",
  options: [
    { id: "approve", label: "Approve" },
    { id: "decline", label: "Decline" },
  ],
  expires_at: "",
  origin: "connector:setup",
  surface: "panel",
  capture_id: null,
  tab_id: null,
  tab_nav: null,
});

beforeEach(() => resetRunForTests());

describe("the setup conversation", () => {
  it("sends the person's turns to the setup session with no page in them", async () => {
    const daemon = fakeDaemon([[said("Let me check."), finished()]]);
    const captures: number[] = [];
    wire(daemon, captures);
    useRun.getState().enterSetup(SESSION);
    await useRun.getState().send("set this computer up");

    const [run] = daemon.runs();
    expect(run!.body).toMatchObject({ origin: SETUP_ORIGIN, message: "set this computer up", host_state: {} });
    for (const key of ["tab_id", "tab_nav", "capture_id", "open_apps", "via", "tainted_by", "gated_origins"]) {
      expect(run!.body).not.toHaveProperty(key);
    }
    // No page is registered and none is photographed for it.
    expect(daemon.seen.some((s) => s.path === "/manifest")).toBe(false);
    expect(captures).toEqual([]);
    expect(useRun.getState().phase).toBe("idle");
  });

  it("needs no open page", async () => {
    const daemon = fakeDaemon([[finished()]]);
    wire(daemon, [], false);
    useRun.getState().enterSetup(SESSION);
    await useRun.getState().send("hello");
    expect(daemon.runs()).toHaveLength(1);
    expect(useRun.getState().error).toBeNull();
  });

  it("shows a gated setup step as a card, answered in the setup session's name", async () => {
    const daemon = fakeDaemon([[said("I will install it."), setupCard("apr_00000000000a"), finished()]]);
    wire(daemon);
    useRun.getState().enterSetup(SESSION);
    await useRun.getState().send("install it");
    expect(useRun.getState().cards.map((c) => [c.id, c.origin])).toEqual([["apr_00000000000a", "connector:setup"]]);

    await useRun.getState().answer("apr_00000000000a", "approve");
    const decided = daemon.seen.find((s) => s.path === "/decisions/apr_00000000000a");
    expect(decided!.body).toMatchObject({ choice: "approve", origin: SETUP_ORIGIN });
    expect(useRun.getState().cards).toEqual([]);
  });

  it("is left: the next message goes to the focused page again", async () => {
    const daemon = fakeDaemon([[finished()], [finished()]]);
    wire(daemon);
    useRun.getState().enterSetup(SESSION);
    await useRun.getState().send("one");
    useRun.getState().leaveSetup();
    await useRun.getState().send("two");
    expect(daemon.runs().map((r) => r.body!.origin)).toEqual([SETUP_ORIGIN, "https://ledgerbox.local"]);
    expect(daemon.runs()[1]!.body!.tab_id).toBe(1);
  });

  it("never carries another device's message: that one runs on the page, with via", async () => {
    const daemon = fakeDaemon([[finished()]]);
    wire(daemon);
    useRun.getState().enterSetup(SESSION);
    const message: RemoteMessage = {
      kind: "remote.message",
      request_id: "job_0000000000d1",
      peer_id: "dev_0000000000a2",
      peer_name: "Laptop",
      text: "which invoices are late?",
      target_app: null,
    };
    await useRun.getState().remote(message);
    const [run] = daemon.runs();
    expect(run!.body!.origin).toBe("https://ledgerbox.local");
    expect(run!.body!.via).toEqual({ peer_id: "dev_0000000000a2", request_id: "job_0000000000d1" });
    expect(useRun.getState().setup).toEqual(SESSION);
  });

  it("takes only the setup session from another window", () => {
    useRun.getState().enterSetup({ origin: "https://ledgerbox.local", conversation_id: "conv_x", phase: null });
    expect(useRun.getState().setup).toBeNull();
    useRun.getState().enterSetup(SESSION);
    expect(useRun.getState().setup).toEqual(SESSION);
  });
});
