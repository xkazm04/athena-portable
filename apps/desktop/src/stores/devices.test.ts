/** The devices mirror against a fake daemon — ADR 0140 (`src/athena/peer/devices.py`, `remote.py`). */
import { beforeEach, describe, expect, it } from "vitest";

import { DaemonApi } from "@/lib/api";
import type { DevicesView, PendingView } from "@/lib/fleet";
import { wizardStep } from "@/scenes/mind/wizard";

import {
  ARM_MS,
  CONVERSATION_CAP,
  REREAD_MIN_MS,
  appendLines,
  devicesHandler,
  grantsOf,
  isArmed,
  linesOf,
  resetDevicesForTests,
  sentenceOf,
  setDevicesDeps,
  startDevices,
  stampSeen,
  useDevices,
} from "./devices";

const PENDING: PendingView = {
  pairing_id: "pair_0000000000b1",
  name: "Kitchen phone",
  kind: "phone",
  requested_grants: ["chat", "approve"],
  expires_at: "2026-10-24T12:05:00Z",
  pair_back: false,
};

function view(over: Partial<DevicesView> = {}): DevicesView {
  return {
    ok: true,
    self: { device_id: "dev_0000000000a1", name: "Study PC" },
    peers: [
      {
        peer_id: "dev_0000000000a2",
        name: "Laptop",
        kind: "pc",
        grants: ["chat"],
        created: "2026-10-20T09:00:00Z",
        expires: null,
        last_seen: null,
        memory: null,
      },
    ],
    pending: [PENDING],
    beacon: { on: false, url: null },
    overlay: { state: "up" },
    listener: { up: true, address: "100.64.0.7", port: 17491, error: null },
    joining: [],
    ...over,
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function sse(frames: Array<Record<string, unknown>>): Response {
  const text = frames.map((f, n) => `id: ${n}\nevent: ${String(f.kind)}\ndata: ${JSON.stringify(f)}\n\n`).join("");
  return new Response(`: athena turn\nretry: 1000\n\n${text}`, { status: 200, headers: { "content-type": "text/event-stream" } });
}

interface Seen {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

function fake(routes: (seen: Seen) => Response | undefined) {
  const seen: Seen[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const entry: Seen = {
      method: init.method ?? "GET",
      path: url.replace("http://daemon", ""),
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    };
    seen.push(entry);
    return routes(entry) ?? json({ ok: false, reason: "unknown_ref", detail: entry.path }, 404);
  };
  return { seen, api: new DaemonApi({ url: "http://daemon", token: "t" }, fetchImpl) };
}

let clock = 0;
function wire(routes: (seen: Seen) => Response | undefined) {
  const daemon = fake((s) => (s.path === "/devices" ? json(view()) : routes(s)));
  setDevicesDeps({ api: () => daemon.api, now: () => clock });
  return daemon;
}

beforeEach(() => {
  resetDevicesForTests();
  clock = 100_000;
});

describe("the reducers", () => {
  it("arms a pending request only after the delay", () => {
    expect(isArmed(undefined, 10_000)).toBe(false);
    expect(isArmed(1000, 1000 + ARM_MS - 1)).toBe(false);
    expect(isArmed(1000, 1000 + ARM_MS)).toBe(true);
  });

  it("keeps the first sight of a request across reads, and forgets one no longer listed", () => {
    const first = stampSeen({}, [PENDING], 5);
    expect(first).toEqual({ pair_0000000000b1: 5 });
    expect(stampSeen({ ...first, gone: 1 }, [PENDING], 99)).toEqual({ pair_0000000000b1: 5 });
  });

  it("sends what was asked, less what was unticked", () => {
    expect(grantsOf(PENDING)).toEqual(["chat", "approve"]);
    expect(grantsOf(PENDING, ["approve"])).toEqual(["chat"]);
  });

  it("caps a conversation and counts what it dropped", () => {
    const base = { requestId: null, phase: "done" as const, lines: [], dropped: 0, problem: null };
    const lines = Array.from({ length: CONVERSATION_CAP + 3 }, (_, n) => ({ kind: "athena" as const, text: String(n) }));
    const capped = appendLines(base, lines);
    expect(capped.lines).toHaveLength(CONVERSATION_CAP);
    expect(capped.dropped).toBe(3);
    expect(capped.lines[0]!.text).toBe("3");
  });

  it("says a sleeping computer in plain words, naming it", async () => {
    const { api } = fake(() => json({ ok: false, reason: "unknown", error: "window_closed", name: "Laptop", detail: "" }, 409));
    const error = await api.sendMessage("dev_0000000000a2", "hi").catch((e: unknown) => e);
    expect(sentenceOf(error)).toBe("Athena on Laptop is asleep. Open it there and try again.");
  });

  it("turns a relayed card into a line saying where it waits", () => {
    const lines = linesOf(
      {
        kind: "decision.requested",
        id: "apr_000000000001",
        decision_kind: "approve",
        action: "host.invoices.pay",
        params: {},
        rationale: "",
        options: [],
        expires_at: "",
        origin: "host:invoices",
        surface: "panel",
        capture_id: null,
        tab_id: null,
        tab_nav: null,
      },
      "Laptop",
    );
    expect(lines).toEqual([{ kind: "card", text: "Waiting for an approval on Laptop: host.invoices.pay" }]);
  });
});

describe("the acts", () => {
  it("reads the list and stamps when each request was first shown", async () => {
    wire(() => undefined);
    await useDevices.getState().load();
    const state = useDevices.getState();
    expect(state.loaded).toBe(true);
    expect(state.seenAt).toEqual({ pair_0000000000b1: 100_000 });
  });

  it("says the list could not be read rather than showing an empty one", async () => {
    setDevicesDeps({ api: () => fake(() => json({ reason: "unknown", detail: "boom" }, 500)).api, now: () => clock });
    await useDevices.getState().load();
    expect(useDevices.getState().loaded).toBe(false);
    expect(useDevices.getState().problem).toBe("boom");
  });

  it("does not send an approve before the card has armed, and sends it after", async () => {
    const daemon = wire((s) => (s.path.startsWith("/devices/pending/") ? json({ ok: true, state: "approved", peer: null }) : undefined));
    await useDevices.getState().load();
    await useDevices.getState().answer(PENDING.pairing_id, "approve");
    expect(daemon.seen.filter((s) => s.path.startsWith("/devices/pending/"))).toHaveLength(0);
    clock += ARM_MS;
    await useDevices.getState().answer(PENDING.pairing_id, "approve");
    const sent = daemon.seen.filter((s) => s.path.startsWith("/devices/pending/"));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({ choice: "approve", grants: ["chat", "approve"], expires_days: null });
  });

  it("declines at once, armed or not", async () => {
    const daemon = wire((s) => (s.path.startsWith("/devices/pending/") ? json({ ok: true, state: "declined", peer: null }) : undefined));
    await useDevices.getState().load();
    await useDevices.getState().answer(PENDING.pairing_id, "decline");
    expect(daemon.seen.find((s) => s.path.startsWith("/devices/pending/"))?.body?.choice).toBe("decline");
  });

  it("narrows only: a grant that was not asked cannot be ticked, an asked one can be unticked", async () => {
    const daemon = wire((s) => (s.path.startsWith("/devices/pending/") ? json({ ok: true, state: "approved", peer: null }) : undefined));
    await useDevices.getState().load();
    useDevices.getState().toggleGrant(PENDING.pairing_id, "memory");
    expect(useDevices.getState().unticked[PENDING.pairing_id]).toBeUndefined();
    useDevices.getState().toggleGrant(PENDING.pairing_id, "approve");
    clock += ARM_MS;
    await useDevices.getState().answer(PENDING.pairing_id, "approve");
    expect(daemon.seen.find((s) => s.path.startsWith("/devices/pending/"))?.body?.grants).toEqual(["chat"]);
  });

  it("revokes with no confirmation and reads the list again", async () => {
    const daemon = wire((s) => (s.method === "DELETE" ? json({ ok: true, revoked: "dev_0000000000a2" }) : undefined));
    await useDevices.getState().revoke("dev_0000000000a2");
    expect(daemon.seen.map((s) => `${s.method} ${s.path}`)).toEqual(["DELETE /devices/dev_0000000000a2", "GET /devices"]);
  });

  it("opens the phone's pairing window when the beacon goes on", async () => {
    const opened = { ok: true, pairing_id: "pair_0000000000c1", code: "7Q4", url: "http://100.64.0.7:17491/m/#claim=x", expires_at: "" };
    wire((s) => {
      if (s.path === "/devices/beacon") return json({ ok: true, beacon: { on: true, url: "http://100.64.0.7:17491/m/" } });
      if (s.path === "/devices/pairing") return json(opened);
      return undefined;
    });
    await useDevices.getState().setBeacon(true);
    expect(useDevices.getState().opened.phone?.url).toBe(opened.url);
  });

  it("sends a message and reads the reply back, coming back with `from` after a quiet end", async () => {
    let reads = 0;
    const daemon = wire((s) => {
      if (s.path === "/devices/dev_0000000000a2/message") return json({ ok: true, request_id: "job_0000000000d1" });
      if (s.path.startsWith("/devices/dev_0000000000a2/turns/job_0000000000d1")) {
        reads += 1;
        // The first read ends quietly after one event; the second carries the rest and the close.
        if (reads === 1) return sse([{ kind: "text.delta", text: "Two invoices" }]);
        return sse([
          { kind: "text.delta", text: " are due." },
          { kind: "turn.finished", text: "", tts: null },
          { kind: "remote.closed", request_id: "job_0000000000d1", reason: "finished", showing: 3, total: 3, footer: "" },
        ]);
      }
      return undefined;
    });
    await useDevices.getState().load();
    await useDevices.getState().send("dev_0000000000a2", "what is due?");
    const reads2 = daemon.seen.filter((s) => s.path.includes("/turns/")).map((s) => s.path.split("?")[1]);
    expect(reads2).toEqual(["from=0", "from=1"]);
    const box = useDevices.getState().conversations.dev_0000000000a2!;
    expect(box.phase).toBe("done");
    expect(box.lines.map((l) => l.text)).toEqual(["what is due?", "Two invoices", " are due."]);
  });

  it("says a sleeping computer under the box", async () => {
    wire((s) =>
      s.path.endsWith("/message") ? json({ ok: false, reason: "unknown", error: "window_closed", name: "Laptop", detail: "" }, 409) : undefined,
    );
    await useDevices.getState().load();
    await useDevices.getState().send("dev_0000000000a2", "hello");
    const box = useDevices.getState().conversations.dev_0000000000a2!;
    expect(box.phase).toBe("error");
    expect(box.problem).toContain("asleep");
  });
});

describe("a pairing window Athena opened (pair.opened)", () => {
  const opened = (device_kind: "pc" | "phone", url: string | null = null) =>
    ({
      kind: "pair.opened",
      pairing_id: "pair_0000000000f1",
      device_kind,
      code: "7Q4K2P",
      url,
      expires_at: "2026-10-24T12:05:00Z",
    }) as const;

  it("is kept as this device's own window, and the list is read again", () => {
    let reads = 0;
    const on = devicesHandler(() => (reads += 1));
    on(opened("pc"));
    on(opened("phone", "http://100.64.0.7:17491/m/#claim=pair_0000000000f1.n"));
    const state = useDevices.getState().opened;
    expect(state.pc).toMatchObject({ pairing_id: "pair_0000000000f1", code: "7Q4K2P", url: null });
    expect(state.phone?.url).toBe("http://100.64.0.7:17491/m/#claim=pair_0000000000f1.n");
    expect(reads).toBe(2);
  });

  it("ignores a frame with no device kind it knows", () => {
    devicesHandler(() => {})({ ...opened("pc"), device_kind: "toaster" as "pc" });
    expect(useDevices.getState().opened).toEqual({});
  });

  it("still re-reads on the frames it always followed, and on nothing else", () => {
    let reads = 0;
    const on = devicesHandler(() => (reads += 1));
    on({ kind: "peer.changed", peer_id: null });
    on({ kind: "remote.message", request_id: "job_0000000000d1", peer_id: "dev_0000000000a2", peer_name: "Laptop", text: "x", target_app: null });
    on({ kind: "sleep.changed" });
    expect(reads).toBe(1);
  });

  it("re-reads when this computer's room moves, so the centre node's word follows it (ADR 0143)", () => {
    let reads = 0;
    const on = devicesHandler(() => (reads += 1));
    on({ kind: "vitals.changed", room: "full", held: "Waiting for room: on battery.", slots: 0 });
    expect(reads).toBe(1);
  });
});

describe("the private network's devices, for the join form", () => {
  const overlay = { ok: true, state: "up", self_ip: "100.64.0.9", peers: [{ name: "study", ip: "100.101.7.8", os: "windows", online: true }], showing: 1, total: 1, footer: "" };

  it("is read once when the level opens, not on every nudge", async () => {
    const daemon = wire((s) => (s.path === "/devices/overlay" ? json(overlay) : undefined));
    const stop = startDevices();
    await useDevices.getState().load();
    await new Promise((r) => setTimeout(r, 0));
    stop();
    expect(daemon.seen.filter((s) => s.path === "/devices/overlay")).toHaveLength(1);
    expect(useDevices.getState().overlay?.peers[0]?.ip).toBe("100.101.7.8");
  });

  it("leaves the address to type when the route is not there", async () => {
    wire(() => json({ ok: false, reason: "unknown_ref", detail: "no route" }, 404));
    await useDevices.getState().findPeers();
    expect(useDevices.getState().overlay).toBeNull();
  });
});

describe("one read at a time, and never an older answer over a newer one", () => {
  /** A daemon whose GET /devices answers wait for the test, in any order. */
  function gated(post: (seen: Seen) => Response | undefined = () => undefined) {
    const reads: Array<{ answer: (v: DevicesView) => void }> = [];
    const seen: Seen[] = [];
    const bus = { onChange: null as (() => void) | null, onConnected: null as (() => void) | null, follows: 0, stops: 0 };
    const fetchImpl = (url: string, init: RequestInit = {}) => {
      const entry: Seen = {
        method: init.method ?? "GET",
        path: url.replace("http://daemon", ""),
        body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      };
      seen.push(entry);
      if (entry.method === "GET" && entry.path === "/devices") {
        return new Promise<Response>((resolve) => reads.push({ answer: (v) => resolve(json(v)) }));
      }
      return Promise.resolve(post(entry) ?? json({ ok: false, reason: "unknown_ref", detail: entry.path }, 404));
    };
    const api = new DaemonApi({ url: "http://daemon", token: "t" }, fetchImpl);
    setDevicesDeps({
      api: () => api,
      now: () => clock,
      follow: (onChange, onConnected) => {
        bus.follows += 1;
        bus.onChange = onChange;
        bus.onConnected = onConnected;
        return () => {
          bus.stops += 1;
        };
      },
    });
    return { reads, seen, bus, gets: () => seen.filter((s) => s.method === "GET" && s.path === "/devices").length };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("an answered request does not come back from a read issued before the answer and landing after it", async () => {
    const daemon = gated((s) => (s.path.startsWith("/devices/pending/") ? json({ ok: true, state: "approved", peer: null }) : undefined));
    const first = useDevices.getState().load();
    daemon.reads[0]!.answer(view());
    await first;
    clock += ARM_MS;
    // A read that still lists the request is out when the person answers it.
    const stale = useDevices.getState().load();
    const answered = useDevices.getState().answer(PENDING.pairing_id, "approve");
    await settle();
    await settle();
    expect(daemon.reads).toHaveLength(3);
    daemon.reads[2]!.answer(view({ pending: [] }));
    await settle();
    daemon.reads[1]!.answer(view());
    await Promise.all([stale, answered]);
    const state = useDevices.getState();
    expect(state.view?.pending).toEqual([]);
    expect(state.seenAt).toEqual({});
    const done = { pairingId: PENDING.pairing_id, name: PENDING.name, choice: "approve" as const };
    expect(wizardStep("phone", null, state, done).step).toBe("done");
  });

  it("three bus frames while one read is out cost one read after it, not three", async () => {
    const daemon = gated();
    const stop = startDevices();
    await settle();
    expect(daemon.gets()).toBe(1);
    const on = devicesHandler(daemon.bus.onChange!);
    on({ kind: "pair.requested", pending: { ...PENDING, pairing_id: "pair_0000000000b2" } });
    on({ kind: "peer.changed", peer_id: null });
    on({ kind: "vitals.changed", room: null, held: null, slots: 2 });
    daemon.reads[0]!.answer(view());
    await settle();
    await settle();
    expect(daemon.gets()).toBe(2);
    daemon.reads[1]!.answer(view());
    await settle();
    expect(daemon.gets()).toBe(2);
    stop();
  });

  it("a bus reconnect reads again only once REREAD_MIN_MS has passed since the last read", async () => {
    const daemon = gated();
    const stop = startDevices();
    await settle();
    daemon.reads[0]!.answer(view());
    await settle();
    expect(daemon.gets()).toBe(1);
    clock += REREAD_MIN_MS - 1;
    daemon.bus.onConnected!();
    await settle();
    expect(daemon.gets()).toBe(1);
    clock += 1;
    daemon.bus.onConnected!();
    await settle();
    expect(daemon.gets()).toBe(2);
    stop();
  });

  it("follows the bus once for two holders, and stops only with the last", () => {
    const daemon = gated();
    const a = startDevices();
    const b = startDevices();
    a();
    expect(daemon.bus).toMatchObject({ follows: 1, stops: 0 });
    b();
    expect(daemon.bus).toMatchObject({ follows: 1, stops: 1 });
  });
});
