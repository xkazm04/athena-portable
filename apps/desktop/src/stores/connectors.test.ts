/**
 * The connectors store against a fake daemon: the list, a token connect, a refusal that never
 * echoes the token, a settings patch, and a consent flow polled until it settles.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { DaemonApi, type ConnectorView } from "@/lib/api";

import { resetConnectorsForTests, setConnectorDeps, useConnectors } from "./connectors";

function row(id: string, over: Partial<ConnectorView> = {}): ConnectorView {
  return {
    id,
    label: id === "gmail" ? "Gmail" : "Notion",
    description: "",
    auth: id === "gmail" ? "oauth" : "token",
    guide: "1. Do the thing.\n\n2. Paste it.",
    api_hosts: [],
    egress: id === "gmail" ? "recipients" : "resources",
    tools: [],
    connection: {
      id,
      status: "disconnected",
      identity: "",
      connected_at: "",
      enabled: true,
      writes_enabled: false,
      allowlist: [],
      health: "unknown",
      health_at: "",
      health_detail: "",
      seal: "",
      expires_at: "",
      last_used_at: "",
    },
    live: false,
    seal_available: true,
    flow: null,
    ...over,
  };
}

interface Seen {
  path: string;
  body: Record<string, unknown> | null;
}

function fakeDaemon(handle: (path: string, body: Record<string, unknown> | null) => unknown) {
  const seen: Seen[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const path = url.replace("http://daemon", "");
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    seen.push({ path, body });
    const answer = handle(path, body);
    const status = typeof answer === "object" && answer !== null && "status" in answer ? Number((answer as { status: number }).status) : 200;
    const payload = typeof answer === "object" && answer !== null && "payload" in answer ? (answer as { payload: unknown }).payload : answer;
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  };
  return { seen, fetchImpl };
}

function wire(daemon: ReturnType<typeof fakeDaemon>, waits: number[] = []) {
  setConnectorDeps({
    api: () => new DaemonApi({ url: "http://daemon", token: "t" }, daemon.fetchImpl),
    wait: async (ms) => {
      waits.push(ms);
    },
  });
}

beforeEach(() => resetConnectorsForTests());

describe("the list", () => {
  it("loads both rows and says so", async () => {
    const daemon = fakeDaemon(() => ({ ok: true, connectors: [row("gmail"), row("notion")], showing: 2, total: 2, footer: "" }));
    wire(daemon);
    await useConnectors.getState().load();
    const state = useConnectors.getState();
    expect(state.loaded).toBe(true);
    expect(state.items.map((c) => c.id)).toEqual(["gmail", "notion"]);
    expect(state.problem).toBeNull();
  });

  it("keeps the reason when the list cannot be read, and is not an empty list", async () => {
    const daemon = fakeDaemon(() => ({ status: 500, payload: { ok: false, reason: "unknown", detail: "boom" } }));
    wire(daemon);
    await useConnectors.getState().load();
    expect(useConnectors.getState().loaded).toBe(true);
    // A 500 with a body IS the daemon answering, so the problem is attributed to it — which is
    // what lets the surface say "the daemon refused" without guessing.
    expect(useConnectors.getState().problem).toEqual({ reason: "boom", from: "daemon" });
  });

  it("attributes a failure that never reached the daemon to this shell, not to the vault", async () => {
    // The shape of the bug that shipped: `lib/api.ts` called the global `fetch` with the client as
    // its receiver, so the request threw in the webview before any socket was opened. Reported as
    // a refusal it sent a reader to debug the daemon; it was never asked.
    setConnectorDeps({
      api: () =>
        new DaemonApi({ url: "http://daemon", token: "t" }, () => {
          throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
        }),
      wait: async () => {},
    });
    await useConnectors.getState().load();
    expect(useConnectors.getState().problem).toEqual({
      reason: "Failed to execute 'fetch' on 'Window': Illegal invocation",
      from: "client",
    });
  });

  it("does not claim to have loaded when the daemon is not ready", async () => {
    setConnectorDeps({ api: () => null, wait: async () => {} });
    await useConnectors.getState().load();
    expect(useConnectors.getState().loaded).toBe(false);
  });
});

describe("a token connect", () => {
  it("refreshes the row from the daemon's answer and keeps no token", async () => {
    const daemon = fakeDaemon((path) => {
      if (path === "/connectors") return { ok: true, connectors: [row("notion")], showing: 1, total: 1, footer: "" };
      return {
        ok: true,
        connector: row("notion", {
          live: true,
          connection: { ...row("notion").connection, status: "connected", identity: "Test User", seal: "dpapi" },
        }),
      };
    });
    wire(daemon);
    await useConnectors.getState().load();
    await useConnectors.getState().connect("notion", { token: "ntn_secret_value" });
    const state = useConnectors.getState();
    expect(daemon.seen[1]).toEqual({ path: "/connectors/notion/connect", body: { token: "ntn_secret_value" } });
    expect(state.items[0].connection.identity).toBe("Test User");
    expect(state.busy).toEqual({});
    expect(JSON.stringify(state)).not.toContain("ntn_secret_value");
  });

  it("lands a refusal on the row, in the daemon's words, without the token", async () => {
    const daemon = fakeDaemon((path) => {
      if (path === "/connectors") return { ok: true, connectors: [row("notion")], showing: 1, total: 1, footer: "" };
      return { status: 409, payload: { ok: false, reason: "validator_failed", detail: "Notion refused the credential with 401" } };
    });
    wire(daemon);
    await useConnectors.getState().load();
    await useConnectors.getState().connect("notion", { token: "ntn_bad" });
    const state = useConnectors.getState();
    expect(state.errors.notion).toBe("Notion refused the credential with 401");
    expect(state.items[0].connection.status).toBe("disconnected");
    expect(JSON.stringify(state)).not.toContain("ntn_bad");
  });
});

describe("the switches", () => {
  it("sends the patch and takes the daemon's row back", async () => {
    const daemon = fakeDaemon((path, body) => {
      if (path === "/connectors") return { ok: true, connectors: [row("notion")], showing: 1, total: 1, footer: "" };
      return {
        ok: true,
        connector: row("notion", {
          connection: {
            ...row("notion").connection,
            writes_enabled: Boolean(body?.writes_enabled),
            allowlist: (body?.allowlist as string[]) ?? [],
          },
        }),
      };
    });
    wire(daemon);
    await useConnectors.getState().load();
    await useConnectors.getState().settings("notion", { writes_enabled: true, allowlist: ["p1", "p2"] });
    expect(daemon.seen[1].body).toEqual({ writes_enabled: true, allowlist: ["p1", "p2"] });
    const conn = useConnectors.getState().items[0].connection;
    expect(conn.writes_enabled).toBe(true);
    expect(conn.allowlist).toEqual(["p1", "p2"]);
  });
});

describe("the consent flow", () => {
  it("polls after an oauth connect until the flow is done", async () => {
    let polls = 0;
    const flow = (phase: "awaiting_consent" | "exchanging" | "done") => ({
      id: "flow_1",
      connector: "gmail",
      phase,
      detail: phase,
      authorize_url: phase === "awaiting_consent" ? "https://accounts.google.com/x" : "",
    });
    const daemon = fakeDaemon((path) => {
      if (path === "/connectors") return { ok: true, connectors: [row("gmail")], showing: 1, total: 1, footer: "" };
      if (path === "/connectors/gmail/connect") {
        return { ok: true, flow: flow("awaiting_consent"), connector: row("gmail", { flow: flow("awaiting_consent") }) };
      }
      polls += 1;
      const phase = polls === 1 ? "awaiting_consent" : polls === 2 ? "exchanging" : "done";
      const connector = row("gmail", {
        flow: flow(phase),
        live: phase === "done",
        connection: { ...row("gmail").connection, status: phase === "done" ? "connected" : "disconnected", identity: phase === "done" ? "me@example.test" : "" },
      });
      return { ok: true, flow: flow(phase), connector };
    });
    const waits: number[] = [];
    wire(daemon, waits);
    await useConnectors.getState().load();
    await useConnectors.getState().connect("gmail", { client_id: "cid", client_secret: "sec" });
    expect(polls).toBe(3);
    expect(waits).toEqual([1500, 1500]);
    const state = useConnectors.getState();
    expect(state.items[0].connection.identity).toBe("me@example.test");
    expect(state.busy).toEqual({});
    expect(JSON.stringify(state)).not.toContain("sec\"");
  });
});
