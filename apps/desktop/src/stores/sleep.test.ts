/** Her sleep's mirror against a fake daemon - device-vitals, ADR 0142 (`src/athena/core/sleep/`). */
import { beforeEach, describe, expect, it } from "vitest";

import { DaemonApi } from "@/lib/api";
import type { CycleView, ProposalView, SleepView } from "@/lib/sleep";

import {
  REREAD_MIN_MS,
  decide,
  keptJournals,
  loadSleep,
  nudged,
  readJournal,
  resetSleepForTests,
  setSleepDeps,
  sleepNow,
  startSleep,
  useSleep,
} from "./sleep";

const T0 = Date.parse("2026-10-24T12:00:00Z");

const VIEW: SleepView = {
  state: "idle",
  phase: null,
  pressure_chars: 31_000,
  threshold_chars: 40_000,
  episodes_waiting: 9,
  verdict: { admit: false, reason: "not_yet", text: "Not yet." },
  last: null,
  open_proposals: 1,
};

function cycle(n: number, over: Partial<CycleView> = {}): CycleView {
  return {
    id: `cyc_${n.toString(16).padStart(12, "0")}`,
    started_at: "2026-10-24T07:00:00Z",
    finished_at: "2026-10-24T07:02:00Z",
    status: "completed",
    reason: "pressure",
    stats: null,
    ...over,
  };
}

const PROPOSAL: ProposalView = {
  id: "prp_00000000d001",
  cycle_id: cycle(1).id,
  kind: "contradiction",
  node_ids: ["fct_00000000e001", "fct_00000000e002"],
  summary: "Fridays or Mondays.",
  status: "open",
  created_at: "2026-10-24T07:02:00Z",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

interface Seen {
  method: string;
  path: string;
  body: unknown;
}

/** The daemon: what each route answers is a function the test can change between reads. */
interface Routes {
  sleep: () => Response;
  cycles: () => CycleView[];
  journal: (id: string) => Response;
  run: () => Response;
  decide: (id: string, body: unknown) => Response;
}

let clock = T0;

function wire(over: Partial<Routes> = {}) {
  const routes: Routes = {
    sleep: () => json({ sleep: VIEW }),
    cycles: () => [cycle(1)],
    journal: (id) => json({ cycle: cycle(1, { id }), journal: "# Sleep\n\nRead 12 episodes." }),
    run: () => json({ admitted: true, reason: "forced", text: "She is falling asleep.", cycle_id: "cyc_00000000c009" }),
    decide: () => json({ proposal: { ...PROPOSAL, status: "kept" } }),
    ...over,
  };
  const seen: Seen[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const path = url.replace("http://daemon", "");
    const method = init.method ?? "GET";
    seen.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : null });
    if (method === "GET" && path === "/sleep") return routes.sleep();
    if (method === "GET" && path.startsWith("/sleep/cycles?")) return json({ cycles: routes.cycles() });
    if (method === "GET" && path.startsWith("/sleep/cycles/")) return routes.journal(decodeURIComponent(path.slice("/sleep/cycles/".length)));
    if (method === "GET" && path === "/sleep/proposals") return json({ proposals: [PROPOSAL] });
    if (method === "POST" && path === "/sleep/run") return routes.run();
    if (method === "POST" && path.startsWith("/sleep/proposals/")) {
      return routes.decide(decodeURIComponent(path.slice("/sleep/proposals/".length)), JSON.parse(String(init.body)));
    }
    return json({ ok: false, reason: "unknown_ref", detail: path }, 404);
  };
  const api = new DaemonApi({ url: "http://daemon", token: "t" }, fetchImpl);
  const bus = { onChange: null as (() => void) | null, onConnected: null as (() => void) | null, follows: 0, stops: 0 };
  setSleepDeps({
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
  return { seen, bus, reads: () => seen.filter((s) => s.path === "/sleep").length, routes };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetSleepForTests();
  clock = T0 + 60_000;
});

describe("the mirror", () => {
  it("reads the sleep, the cycles and the proposals together, and marks it loaded", async () => {
    const daemon = wire();
    await loadSleep();
    const s = useSleep.getState();
    expect(s).toMatchObject({ loaded: true, missing: false, problem: null });
    expect(s.view?.pressure_chars).toBe(31_000);
    expect(s.cycles.map((c) => c.id)).toEqual([cycle(1).id]);
    expect(s.proposals.map((p) => p.id)).toEqual([PROPOSAL.id]);
    expect(daemon.seen.map((r) => r.path).sort()).toEqual(["/sleep", "/sleep/cycles?limit=20", "/sleep/proposals"]);
  });

  it("reads an older daemon's 404 as no sleep at all, not as a problem", async () => {
    wire({ sleep: () => json({ ok: false, reason: "unknown_ref", detail: "/sleep" }, 404) });
    await loadSleep();
    expect(useSleep.getState()).toMatchObject({ loaded: true, missing: true, problem: null, view: null });
  });

  it("says a failed read in one sentence and keeps what it had", async () => {
    let fail = false;
    wire({ sleep: () => (fail ? json({ ok: false, reason: "internal", detail: "the ledger is locked" }, 500) : json({ sleep: VIEW })) });
    await loadSleep();
    fail = true;
    await loadSleep();
    const s = useSleep.getState();
    expect(s.problem).toBe("Could not read her sleep: the ledger is locked");
    expect(s.view?.state).toBe("idle");
  });

  it("says she is not running yet when there is no daemon to ask", async () => {
    setSleepDeps({ api: () => null, now: () => clock });
    await loadSleep();
    expect(useSleep.getState()).toMatchObject({ loaded: false, problem: "Could not read her sleep: Athena is not running here yet." });
  });

  it("reads again on each sleep.changed, once more for one that lands mid-read, and on a reconnect at most every 5 s", async () => {
    const daemon = wire();
    const stop = startSleep();
    await settle();
    expect(daemon.reads()).toBe(1);
    daemon.bus.onChange!();
    await settle();
    expect(daemon.reads()).toBe(2);
    // A nudge while a read is out: the read is shared, then read once more.
    const out = loadSleep();
    nudged();
    await out;
    await settle();
    expect(daemon.reads()).toBe(4);
    daemon.bus.onConnected!();
    await settle();
    expect(daemon.reads()).toBe(4);
    clock += REREAD_MIN_MS;
    daemon.bus.onConnected!();
    await settle();
    expect(daemon.reads()).toBe(5);
    stop();
    expect(daemon.bus.stops).toBe(1);
  });

  it("follows the bus once for any number of holders, and stops with the last", () => {
    const daemon = wire();
    const a = startSleep();
    const b = startSleep();
    expect(daemon.bus.follows).toBe(1);
    a();
    a();
    expect(daemon.bus.stops).toBe(0);
    b();
    expect(daemon.bus.stops).toBe(1);
  });
});

describe("the journal", () => {
  it("is read when a row opens, and kept: a second opening does not read it again", async () => {
    const daemon = wire();
    await loadSleep();
    await readJournal(cycle(1).id);
    await readJournal(cycle(1).id);
    expect(useSleep.getState().journals[cycle(1).id]).toMatchObject({ loading: false, text: "# Sleep\n\nRead 12 episodes.", problem: null });
    expect(daemon.seen.filter((s) => s.path.startsWith("/sleep/cycles/"))).toHaveLength(1);
  });

  it("is read again once its cycle has moved on: a running cycle's journal is not the finished one's", async () => {
    let status: CycleView["status"] = "running";
    const daemon = wire({
      cycles: () => [cycle(1, { status, finished_at: status === "running" ? null : "2026-10-24T07:02:00Z" })],
      journal: (id) => json({ cycle: cycle(1, { id, status }), journal: status === "running" ? null : "# Done" }),
    });
    await loadSleep();
    await readJournal(cycle(1).id);
    expect(useSleep.getState().journals[cycle(1).id]?.text).toBeNull();
    status = "completed";
    await loadSleep();
    expect(useSleep.getState().journals[cycle(1).id]).toBeUndefined();
    await readJournal(cycle(1).id);
    expect(useSleep.getState().journals[cycle(1).id]?.text).toBe("# Done");
    expect(daemon.seen.filter((s) => s.path.startsWith("/sleep/cycles/"))).toHaveLength(2);
  });

  it("says why it could not be read, and is read again on the next try", async () => {
    let fail = true;
    wire({ journal: (id) => (fail ? json({ ok: false, reason: "unknown_ref", detail: "no such journal" }, 404) : json({ cycle: cycle(1, { id }), journal: "ok" })) });
    await loadSleep();
    await readJournal(cycle(1).id);
    expect(useSleep.getState().journals[cycle(1).id]?.problem).toBe("Could not read the journal: no such journal");
    fail = false;
    await readJournal(cycle(1).id);
    expect(useSleep.getState().journals[cycle(1).id]).toMatchObject({ text: "ok", problem: null });
  });

  it("keeps only the journals whose cycle is still listed with the status it was read under", () => {
    const journals = {
      a: { status: "completed" as const, loading: false, text: "x", problem: null },
      b: { status: "running" as const, loading: false, text: null, problem: null },
      c: { status: "completed" as const, loading: false, text: "y", problem: null },
    };
    const kept = keptJournals(journals, [cycle(1, { id: "a" }), cycle(2, { id: "b", status: "completed" })]);
    expect(Object.keys(kept)).toEqual(["a"]);
  });
});

describe("the acts", () => {
  it("Sleep now asks with force, keeps the answer, and reads again", async () => {
    const daemon = wire({ run: () => json({ admitted: false, reason: "on_battery", text: "Not on battery.", cycle_id: null }) });
    await sleepNow();
    const run = daemon.seen.find((s) => s.path === "/sleep/run");
    expect(run).toMatchObject({ method: "POST", body: { force: true } });
    expect(useSleep.getState().answer).toMatchObject({ admitted: false, text: "Not on battery." });
    expect(useSleep.getState().busy.run).toBeUndefined();
    expect(daemon.reads()).toBe(1);
  });

  it("Sleep now says a refusal of the request itself in one sentence", async () => {
    wire({ run: () => json({ ok: false, reason: "internal", detail: "the scheduler is not running" }, 500) });
    await sleepNow();
    expect(useSleep.getState().errors.run).toBe("Could not ask her to sleep: the scheduler is not running");
    expect(useSleep.getState().answer).toBeNull();
  });

  it("keeps a contradiction whole, or forgets the one memory named, then reads again", async () => {
    const daemon = wire();
    await decide(PROPOSAL.id, "keep");
    await decide(PROPOSAL.id, "forget", "fct_00000000e002");
    const posts = daemon.seen.filter((s) => s.method === "POST");
    expect(posts.map((p) => [p.path, p.body])).toEqual([
      [`/sleep/proposals/${PROPOSAL.id}`, { action: "keep", node_id: null }],
      [`/sleep/proposals/${PROPOSAL.id}`, { action: "forget", node_id: "fct_00000000e002" }],
    ]);
    expect(daemon.reads()).toBe(2);
  });

  it("puts a refused answer under its proposal, after the read that follows it", async () => {
    wire({ decide: () => json({ ok: false, reason: "bad_request", detail: "name the memory to forget" }, 400) });
    await decide(PROPOSAL.id, "forget");
    const s = useSleep.getState();
    expect(s.errors[PROPOSAL.id]).toBe("Could not forget it: name the memory to forget");
    expect(s.busy[PROPOSAL.id]).toBeUndefined();
    expect(s.loaded).toBe(true);
  });
});
