/**
 * The connectors store against a fake daemon: the list, a token connect, a refusal that never
 * echoes the token, a settings patch, and a consent flow polled until it settles.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { DaemonApi, type ConnectorView } from "@/lib/api";

import { STORE_TABLES, type ConnectorsChanged } from "@/lib/ipc";
import { serversOf } from "@/modules/connectors/depth";

import {
  CONNECTORS_SOURCE,
  followCards,
  reloadOnConnectorsChanged,
  resetConnectorsForTests,
  setConnectorDeps,
  useConnectors,
} from "./connectors";

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
    records_notice: "",
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

describe("a list read that lands late", () => {
  /** A daemon whose GET /connectors answers are held until the test lets each one go. */
  function heldLists(connected: () => boolean) {
    const held: (() => void)[] = [];
    const notion = () =>
      row("notion", {
        connection: { ...row("notion").connection, status: connected() ? "connected" : "disconnected", identity: connected() ? "Test User" : "" },
      });
    const fetchImpl = async (url: string): Promise<Response> => {
      const path = url.replace("http://daemon", "");
      const answer = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (path === "/connectors") {
        // The daemon reads the vault when the request arrives; the answer is only delivered late.
        const snapshot = { ok: true, connectors: [notion()], showing: 1, total: 1, footer: "" };
        await new Promise<void>((resolve) => held.push(resolve));
        return answer(snapshot);
      }
      return answer({ ok: true, connector: notion() });
    };
    setConnectorDeps({ api: () => new DaemonApi({ url: "http://daemon", token: "t" }, fetchImpl), wait: async () => {} });
    return held;
  }

  it("does not put back a row an act answered after the list was asked", async () => {
    let connected = false;
    const held = heldLists(() => connected);
    const listed = useConnectors.getState().load();
    await settle();
    connected = true;
    await useConnectors.getState().connect("notion", { token: "ntn_x" });
    expect(useConnectors.getState().items[0]?.connection.status).toBe("connected");
    held.shift()?.();
    await listed;
    expect(useConnectors.getState().items[0].connection.status).toBe("connected");
    expect(useConnectors.getState().loaded).toBe(true);
  });

  it("an older list answered after a newer one does not overwrite it", async () => {
    let connected = false;
    const held = heldLists(() => connected);
    const older = useConnectors.getState().load();
    await settle();
    connected = true;
    const newer = useConnectors.getState().load();
    await settle();
    held[1]?.();
    await newer;
    expect(useConnectors.getState().items[0].connection.status).toBe("connected");
    held[0]?.();
    await older;
    expect(useConnectors.getState().items[0].connection.status).toBe("connected");
  });
});

describe("a consent flow whose poll fails once", () => {
  const flow = (phase: "awaiting_consent" | "done") => ({ id: "flow_3", connector: "gmail", phase, detail: phase, authorize_url: "" });

  it("rides out a read that did not reach the daemon or a 5xx: it says so, asks again, and settles", async () => {
    let polls = 0;
    const daemon = fakeDaemon((path) => {
      if (path === "/connectors") return { ok: true, connectors: [row("gmail")], showing: 1, total: 1, footer: "" };
      if (path === "/connectors/gmail/connect") {
        return { ok: true, flow: flow("awaiting_consent"), connector: row("gmail", { flow: flow("awaiting_consent") }) };
      }
      polls += 1;
      if (polls === 1) return { status: 503, payload: { ok: false, reason: "engine_error", detail: "the daemon is busy" } };
      if (polls === 2) throw new TypeError("Failed to fetch");
      if (polls === 3) return { ok: true, flow: flow("awaiting_consent"), connector: row("gmail", { flow: flow("awaiting_consent") }) };
      const connection = { ...row("gmail").connection, status: "connected" as const, identity: "me@example.test" };
      return { ok: true, flow: flow("done"), connector: row("gmail", { flow: flow("done"), live: true, connection }) };
    });
    const seenErrors: string[] = [];
    const waits: number[] = [];
    setConnectorDeps({
      api: () => new DaemonApi({ url: "http://daemon", token: "t" }, daemon.fetchImpl),
      wait: async (ms) => {
        waits.push(ms);
        seenErrors.push(useConnectors.getState().errors.gmail ?? "");
      },
    });
    await useConnectors.getState().load();
    await useConnectors.getState().connect("gmail", { client_id: "cid", client_secret: "sec" });
    expect(polls).toBe(4);
    // Each failed read was shown while the poll waited, and the next good read took it down.
    expect(seenErrors).toEqual(["the daemon is busy", "Failed to fetch", ""]);
    const state = useConnectors.getState();
    expect(state.items[0].connection.status).toBe("connected");
    expect(state.errors).toEqual({});
    expect(state.busy).toEqual({});
  });

  it("stops on the daemon's refusal, and when the daemon goes", async () => {
    let polls = 0;
    let gone = false;
    const daemon = fakeDaemon((path) => {
      if (path === "/connectors") return { ok: true, connectors: [row("gmail")], showing: 1, total: 1, footer: "" };
      if (path === "/connectors/gmail/connect") {
        return { ok: true, flow: flow("awaiting_consent"), connector: row("gmail", { flow: flow("awaiting_consent") }) };
      }
      polls += 1;
      return { status: 409, payload: { ok: false, reason: "conflict", detail: "no flow is open for Gmail" } };
    });
    setConnectorDeps({
      api: () => (gone ? null : new DaemonApi({ url: "http://daemon", token: "t" }, daemon.fetchImpl)),
      wait: async () => {},
    });
    await useConnectors.getState().load();
    await useConnectors.getState().connect("gmail", { client_id: "cid", client_secret: "sec" });
    expect(polls).toBe(1);
    expect(useConnectors.getState().errors.gmail).toBe("no flow is open for Gmail");
    expect(useConnectors.getState().busy).toEqual({});

    // A transport failure with the daemon gone ends the poll at once instead of asking nobody.
    polls = 0;
    const unreachable = fakeDaemon((path) => {
      if (path === "/connectors/gmail/connect") {
        return { ok: true, flow: flow("awaiting_consent"), connector: row("gmail", { flow: flow("awaiting_consent") }) };
      }
      polls += 1;
      throw new TypeError("Failed to fetch");
    });
    setConnectorDeps({
      api: () => (gone ? null : new DaemonApi({ url: "http://daemon", token: "t" }, unreachable.fetchImpl)),
      wait: async () => {
        gone = true;
      },
    });
    await useConnectors.getState().connect("gmail", { client_id: "cid", client_secret: "sec" });
    expect(polls).toBe(1);
    expect(useConnectors.getState().errors.gmail).toBe("Failed to fetch");
    expect(useConnectors.getState().busy).toEqual({});
  });
});

describe("reconnect through the kept client (ADR 0117)", () => {
  it("case 6: a reconnect sends only the flag, never a client value, and polls the flow it started", async () => {
    let polls = 0;
    const flow = (phase: "awaiting_consent" | "done") => ({ id: "flow_r", connector: "gmail", phase, detail: phase, authorize_url: "" });
    const lost = row("gmail", { client_kept: true, connection: { ...row("gmail").connection, status: "needs_reauth" } });
    const daemon = fakeDaemon((path) => {
      if (path === "/connectors") return { ok: true, connectors: [lost], showing: 1, total: 1, footer: "" };
      if (path === "/connectors/gmail/connect") return { ok: true, flow: flow("awaiting_consent"), connector: { ...lost, flow: flow("awaiting_consent") } };
      polls += 1;
      const connection = { ...lost.connection, status: "connected" as const, identity: "me@example.test" };
      return { ok: true, flow: flow("done"), connector: { ...lost, flow: flow("done"), live: true, connection } };
    });
    wire(daemon);
    await useConnectors.getState().load();
    await useConnectors.getState().connect("gmail", { reuse_client: true });
    const sent = daemon.seen.find((s) => s.path === "/connectors/gmail/connect");
    expect(sent?.body).toEqual({ reuse_client: true });
    expect(polls).toBe(1);
    expect(useConnectors.getState().items[0].connection.status).toBe("connected");
  });
});

const NOTICE =
  "The connections file could not be read (JSONDecodeError), so no connection is shown. Its bytes are kept as connections.json.unreadable-20261010T120000000000Z. Connect again to start a fresh file.";

describe("the records notice", () => {
  it("is carried verbatim from GET /connectors, and is empty when the list has none", async () => {
    let notice = NOTICE;
    const daemon = fakeDaemon(() => ({
      ok: true,
      connectors: [row("gmail", { records_notice: notice })],
      records_notice: notice,
      showing: 1,
      total: 1,
      footer: "",
    }));
    wire(daemon);
    await useConnectors.getState().load();
    expect(useConnectors.getState().recordsNotice).toBe(NOTICE);
    notice = "";
    await useConnectors.getState().load();
    expect(useConnectors.getState().recordsNotice).toBe("");
  });

  it("is empty when an older daemon's list does not carry one", async () => {
    const daemon = fakeDaemon(() => ({ ok: true, connectors: [row("gmail")], showing: 1, total: 1, footer: "" }));
    wire(daemon);
    useConnectors.setState({ recordsNotice: NOTICE });
    await useConnectors.getState().load();
    expect(useConnectors.getState().recordsNotice).toBe("");
  });

  it("follows the notice a reply's connector view carries", async () => {
    const daemon = fakeDaemon((path) => {
      if (path === "/connectors") {
        return { ok: true, connectors: [row("notion", { records_notice: NOTICE })], records_notice: NOTICE, showing: 1, total: 1, footer: "" };
      }
      return { ok: true, connector: row("notion", { records_notice: "" }) };
    });
    wire(daemon);
    await useConnectors.getState().load();
    expect(useConnectors.getState().recordsNotice).toBe(NOTICE);
    await useConnectors.getState().probe("notion");
    expect(useConnectors.getState().recordsNotice).toBe("");
  });
});

describe("a connect's own word", () => {
  const DETAIL =
    "Connected as B. The writes switch and the recipient list were set under A, so writes are off and the list was emptied.";

  it("lands on the item from the connect reply, and a later probe's record replaces it", async () => {
    let probed = false;
    const daemon = fakeDaemon((path) => {
      if (path === "/connectors") return { ok: true, connectors: [row("notion")], showing: 1, total: 1, footer: "" };
      const connection = {
        ...row("notion").connection,
        status: "connected" as const,
        identity: "B",
        health: "healthy" as const,
        health_detail: path.endsWith("/probe") ? "" : DETAIL,
      };
      if (path.endsWith("/probe")) probed = true;
      return { ok: true, connector: row("notion", { live: true, connection }) };
    });
    wire(daemon);
    await useConnectors.getState().load();
    await useConnectors.getState().connect("notion", { token: "ntn_b" });
    expect(useConnectors.getState().items[0].connection.health_detail).toBe(DETAIL);
    expect(useConnectors.getState().errors).toEqual({});
    await useConnectors.getState().probe("notion");
    expect(probed).toBe(true);
    expect(useConnectors.getState().items[0].connection.health_detail).toBe("");
  });

  it("lands on the item from the flow's done state after an oauth connect", async () => {
    const flow = (phase: "awaiting_consent" | "done") => ({
      id: "flow_2",
      connector: "gmail",
      phase,
      detail: phase,
      authorize_url: "",
    });
    const daemon = fakeDaemon((path) => {
      if (path === "/connectors") return { ok: true, connectors: [row("gmail")], showing: 1, total: 1, footer: "" };
      if (path === "/connectors/gmail/connect") {
        return { ok: true, flow: flow("awaiting_consent"), connector: row("gmail", { flow: flow("awaiting_consent") }) };
      }
      const connection = { ...row("gmail").connection, status: "connected" as const, identity: "B", health_detail: DETAIL };
      return { ok: true, flow: flow("done"), connector: row("gmail", { flow: flow("done"), live: true, connection }) };
    });
    wire(daemon);
    await useConnectors.getState().load();
    await useConnectors.getState().connect("gmail", { client_id: "cid", client_secret: "sec" });
    const item = useConnectors.getState().items[0];
    expect(item.connection.status).toBe("connected");
    expect(item.connection.health_detail).toBe(DETAIL);
  });
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("connectors:changed (ADR 0116)", () => {
  it("case 6: every successful act announces connectors:changed with its id, and a refused one does not", async () => {
    const announced: ConnectorsChanged[] = [];
    let refuse = false;
    const daemon = fakeDaemon((path) => {
      if (path === "/connectors") return { ok: true, connectors: [row("notion")], showing: 1, total: 1, footer: "" };
      if (refuse) return { status: 409, payload: { ok: false, reason: "validator_failed", detail: "no" } };
      return { ok: true, connector: row("notion") };
    });
    setConnectorDeps({
      api: () => new DaemonApi({ url: "http://daemon", token: "t" }, daemon.fetchImpl),
      wait: async () => {},
      announce: (change) => announced.push(change),
    });
    await useConnectors.getState().load();
    await useConnectors.getState().settings("notion", { enabled: false });
    await useConnectors.getState().connect("notion", { token: "ntn_x" });
    await useConnectors.getState().disconnect("notion");
    await useConnectors.getState().probe("notion");
    expect(announced).toEqual(Array.from({ length: 4 }, () => ({ id: "notion", from: CONNECTORS_SOURCE })));
    refuse = true;
    await useConnectors.getState().probe("notion");
    expect(announced).toHaveLength(4);
  });

  it("case 6: the other window's mirror reloads on hearing it; its own word and an unasked mirror do not", async () => {
    let reads = 0;
    const api = {
      connectors: async () => {
        reads += 1;
        return { connectors: [row("gmail")] };
      },
    } as unknown as DaemonApi;
    setConnectorDeps({ api: () => api, wait: async () => {} });

    // Nobody in this window has asked for the list: hearing about it costs nothing.
    reloadOnConnectorsChanged({ id: "gmail", from: "another-window" });
    await settle();
    expect(reads).toBe(0);

    await useConnectors.getState().load();
    expect(reads).toBe(1);
    reloadOnConnectorsChanged({ id: "gmail", from: CONNECTORS_SOURCE });
    await settle();
    expect(reads).toBe(1);
    reloadOnConnectorsChanged({ id: "gmail", from: "another-window" });
    await settle();
    expect(reads).toBe(2);
  });

  it("case 6: the dead store:changed branch is gone (no store table is named connectors)", async () => {
    const store = await import("./connectors");
    expect("reloadOnStoreChange" in store).toBe(false);
    expect((STORE_TABLES as readonly string[]).includes("connectors")).toBe(false);
  });
});

describe("her window's mirror (ADR 0116)", () => {
  type Card = { id: string; origin: string };

  function feed() {
    let cards: Card[] = [];
    const listeners = new Set<() => void>();
    return {
      read: () => cards,
      subscribe: (f: () => void) => {
        listeners.add(f);
        return () => listeners.delete(f);
      },
      set(next: Card[]) {
        cards = next;
        listeners.forEach((f) => f());
      },
    };
  }

  it("case 5: a connector card arriving reads GET /connectors exactly once; a page's card reads nothing", async () => {
    const daemon = fakeDaemon(() => ({ ok: true, connectors: [row("gmail")], showing: 1, total: 1, footer: "" }));
    wire(daemon);
    const cards = feed();
    const stop = followCards(cards.read, cards.subscribe);
    const lists = () => daemon.seen.filter((s) => s.path === "/connectors").length;

    cards.set([{ id: "apr_host", origin: "host:ledgerbox" }]);
    await settle();
    expect(lists()).toBe(0);

    cards.set([{ id: "apr_host", origin: "host:ledgerbox" }, { id: "apr_mail", origin: "connector:gmail" }]);
    await settle();
    expect(lists()).toBe(1);
    expect(useConnectors.getState().items.map((c) => c.id)).toEqual(["gmail"]);

    // The 30 s re-poll hands the same card back: it is not a new arrival.
    cards.set([{ id: "apr_mail", origin: "connector:gmail" }]);
    await settle();
    expect(lists()).toBe(1);

    stop();
    cards.set([{ id: "apr_mail2", origin: "connector:gmail" }]);
    await settle();
    expect(lists()).toBe(1);
  });
});

describe("the MCP servers the list names (ADR 0144)", () => {
  const GRAVITONE = {
    id: "gravitone",
    origin: "connector:gravitone",
    kind: "mcp",
    url: "https://gt.example/api/mcp",
    token_env: "GT_TOKEN",
    token_set: true,
    live: true,
    health: "healthy",
    health_detail: "",
    tools: [
      { name: "connector.gravitone.gt_read", class: "AUTO" },
      { name: "connector.gravitone.gt_job", class: "GATED" },
    ],
  };
  const page = (servers?: unknown[]) => ({
    ok: true,
    connectors: [row("gmail"), row("notion")],
    ...(servers === undefined ? {} : { mcp_servers: servers }),
    showing: 2,
    total: 2,
    footer: "",
  });

  it("case 1: GET /connectors' mcp_servers reach the store with every field; an older daemon's list has none", async () => {
    let servers: unknown[] | undefined = [GRAVITONE];
    wire(fakeDaemon(() => page(servers)));
    await useConnectors.getState().load();
    expect(serversOf(useConnectors.getState().servers)).toEqual([GRAVITONE]);
    expect(useConnectors.getState().items.map((c) => c.id)).toEqual(["gmail", "notion"]);
    servers = undefined;
    await useConnectors.getState().load();
    expect(serversOf(useConnectors.getState().servers)).toEqual([]);
  });

  it("case 2: a malformed server is kept with no tools and unknown health, and the list still loads", async () => {
    const odd = { ...GRAVITONE, id: "odd", tools: "gt_read", health: "fine" };
    const strays = [
      null,
      7,
      { url: "https://no-id.example" },
      { ...GRAVITONE, tools: [{ name: "connector.gravitone.x", class: "WHATEVER" }, 3] },
    ];
    wire(fakeDaemon(() => page([odd, ...strays])));
    await useConnectors.getState().load();
    const state = useConnectors.getState();
    expect(state.loaded).toBe(true);
    expect(state.problem).toBeNull();
    expect(state.items).toHaveLength(2);
    const read = serversOf(state.servers);
    expect(read).toHaveLength(2);
    expect(read[0]).toMatchObject({ id: "odd", tools: [], health: "unknown", token_env: "GT_TOKEN", token_set: true });
    // An unknown class is never shown as running without a card; a tool that is not one is dropped.
    expect(read[1]!.tools).toEqual([{ name: "connector.gravitone.x", class: "GATED" }]);
    expect(serversOf("not a list")).toEqual([]);
  });
});
