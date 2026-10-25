/**
 * The spaces store against a fake daemon — README section 3.5, ADR 0225.
 *
 * The client is the real `SpacesApi` over a fake `fetch`, so the routes and the parsers are under
 * test with the store; the `settings` row is a map behind a mocked `lib/store`, and the shell is
 * there (`hasShell`) so the row is read and written as it is in a window. What is asserted is the
 * contract: the right route for each act, `active_space_id` as the one row, core for an id the
 * list does not name, and a switch held while a turn runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CORE, SpacesApi } from "@/lib/spaces";

const rows = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/lib/store", async (actual) => ({
  ...(await actual<typeof import("@/lib/store")>()),
  settingRead: vi.fn(async (key: string) => (rows.has(key) ? rows.get(key) : null)),
  settingWrite: vi.fn(async (key: string, value: unknown) => {
    rows.set(key, value);
  }),
}));

vi.mock("@/lib/ipc", async (actual) => ({
  ...(await actual<typeof import("@/lib/ipc")>()),
  hasShell: () => true,
  onStoreChanged: vi.fn(async () => () => {}),
}));

import { bindTurn, resetSpacesForTests, useSpaces } from "./spaces";

const ROW = "active_space_id";

const space = (id: string, name: string, hue = 200) => ({
  id,
  name,
  brief: "",
  apps: [],
  hue,
  created: "2026-10-25T10:00:00Z",
  updated: "2026-10-25T10:00:00Z",
  counts: { episodes: 0, facts: 0, procedurals: 0, chores: 0 },
});

const TAXES = space("spc_0123456789ab", "Taxes");
const GARDEN = space("spc_ba9876543210", "Garden", 120);

function fakeDaemon(listed = [TAXES, GARDEN]) {
  const seen: Array<{ method: string; path: string; body: unknown }> = [];
  let spaces = [...listed];
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const path = url.replace("http://daemon", "");
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    seen.push({ method, path, body });
    if (path === "/spaces" && method === "GET") return json({ spaces });
    if (path === "/spaces" && method === "POST") {
      const made = { ...space("spc_00000000000f", body.name), ...body };
      spaces = [made, ...spaces];
      return json(made, 201);
    }
    const one = /^\/spaces\/([^/]+)$/.exec(path);
    if (one && method === "POST") {
      const next = { ...spaces.find((s) => s.id === one[1])!, ...body };
      spaces = [next, ...spaces.filter((s) => s.id !== one[1])];
      return json(next);
    }
    if (one && method === "DELETE") {
      spaces = spaces.filter((s) => s.id !== one[1]);
      return json({ id: one[1], episodes: 3, facts: 1, procedurals: 0, chores_unlinked: 2 });
    }
    if (/^\/spaces\/[^/]+\/memory/.test(path)) return json({ rows: [], showing: 0, total: 0 });
    if (/\/memory\/[^/]+\/core$/.test(path)) return json({ id: "fct_1", kind: "fact" });
    if (/^\/adopt\/cases\/[^/]+\/space$/.test(path)) return json({ case_id: "proj_0123456789ab", space_id: body.space_id });
    return json({ reason: "unknown_ref", detail: path }, 404);
  };
  return { fetchImpl, seen, drop: (id: string) => (spaces = spaces.filter((s) => s.id !== id)) };
}

/** A turn the test starts and ends by hand, the way the run store's phase does. */
function fakeTurn() {
  let busy = false;
  const ends = new Set<() => void>();
  bindTurn({
    busy: () => busy,
    onIdle: (f) => {
      ends.add(f);
      return () => ends.delete(f);
    },
  });
  return {
    start: () => (busy = true),
    end: () => {
      busy = false;
      ends.forEach((f) => f());
    },
  };
}

let daemon: ReturnType<typeof fakeDaemon>;

beforeEach(() => {
  rows.clear();
  daemon = fakeDaemon();
  resetSpacesForTests(new SpacesApi(() => ({ url: "http://daemon", token: "t" }), daemon.fetchImpl));
});

describe("the list", () => {
  it("loads the spaces the daemon answers, with the token", async () => {
    await useSpaces.getState().load();
    const s = useSpaces.getState();
    expect(s.loaded).toBe(true);
    expect(s.problem).toBe("");
    expect(s.spaces.map((x) => x.name)).toEqual(["Taxes", "Garden"]);
    expect(daemon.seen[0]).toMatchObject({ method: "GET", path: "/spaces" });
  });

  it("says why the list could not be read, verbatim, and keeps core", async () => {
    resetSpacesForTests(new SpacesApi(() => null));
    await useSpaces.getState().load();
    expect(useSpaces.getState()).toMatchObject({ loaded: true, problem: "The daemon is not running.", activeId: CORE });
  });
});

describe("the acts take the contract's routes", () => {
  it("create, update and erase", async () => {
    await useSpaces.getState().load();
    const made = await useSpaces.getState().create({ name: "Move house" });
    expect(daemon.seen.at(-1)).toMatchObject({ method: "POST", path: "/spaces", body: { name: "Move house" } });
    expect(useSpaces.getState().spaces[0]!.id).toBe(made.id);

    await useSpaces.getState().update(GARDEN.id, { apps: ["https://seeds.example"] });
    expect(daemon.seen.at(-1)).toMatchObject({
      method: "POST",
      path: `/spaces/${GARDEN.id}`,
      body: { apps: ["https://seeds.example"] },
    });
    expect(useSpaces.getState().spaces[0]!.apps).toEqual(["https://seeds.example"]);

    const erased = await useSpaces.getState().erase(TAXES.id);
    expect(daemon.seen.at(-1)).toMatchObject({ method: "DELETE", path: `/spaces/${TAXES.id}` });
    expect(erased).toEqual({ id: TAXES.id, episodes: 3, facts: 1, procedurals: 0, chores_unlinked: 2 });
    expect(useSpaces.getState().spaces.map((s) => s.id)).not.toContain(TAXES.id);
  });

  it("memory, promote and linkCase", async () => {
    await useSpaces.getState().memory("core", "fact");
    expect(daemon.seen.at(-1)).toMatchObject({ method: "GET", path: "/spaces/core/memory?kind=fact" });
    await useSpaces.getState().promote(TAXES.id, "fct_1");
    expect(daemon.seen).toContainEqual(
      expect.objectContaining({ method: "POST", path: `/spaces/${TAXES.id}/memory/fct_1/core` }),
    );
    await useSpaces.getState().linkCase("proj_0123456789ab", TAXES.id);
    expect(daemon.seen).toContainEqual({
      method: "POST",
      path: "/adopt/cases/proj_0123456789ab/space",
      body: { space_id: TAXES.id },
    });
  });
});

describe("the active space", () => {
  it("is read from and written to active_space_id", async () => {
    rows.set(ROW, GARDEN.id);
    await useSpaces.getState().load();
    expect(useSpaces.getState().activeId).toBe(GARDEN.id);

    useSpaces.getState().setActive(TAXES.id);
    expect(useSpaces.getState().activeId).toBe(TAXES.id);
    await Promise.resolve();
    expect(rows.get(ROW)).toBe(TAXES.id);

    useSpaces.getState().setActive(CORE);
    await Promise.resolve();
    expect(useSpaces.getState().activeId).toBe(CORE);
    expect(rows.get(ROW)).toBe("");
  });

  it("is core when the row names no loaded space, and the row is put back (fail closed)", async () => {
    rows.set(ROW, "spc_00000000dead");
    await useSpaces.getState().load();
    expect(useSpaces.getState().activeId).toBe(CORE);
    await Promise.resolve();
    expect(rows.get(ROW)).toBe("");
  });

  it("falls to core when the other window erased the active space", async () => {
    rows.set(ROW, TAXES.id);
    await useSpaces.getState().load();
    daemon.drop(TAXES.id);
    await useSpaces.getState().load();
    expect(useSpaces.getState().activeId).toBe(CORE);
  });

  it("is held in pending while a turn runs, and applied when it ends", async () => {
    await useSpaces.getState().load();
    const turn = fakeTurn();
    turn.start();
    useSpaces.getState().setActive(TAXES.id);
    expect(useSpaces.getState()).toMatchObject({ activeId: CORE, pending: TAXES.id });
    expect(rows.has(ROW)).toBe(false);

    turn.end();
    expect(useSpaces.getState()).toMatchObject({ activeId: TAXES.id, pending: null });
    await Promise.resolve();
    expect(rows.get(ROW)).toBe(TAXES.id);
  });

  it("withdraws a waiting switch when the person asks for the space the turn runs in", async () => {
    await useSpaces.getState().load();
    const turn = fakeTurn();
    turn.start();
    useSpaces.getState().setActive(TAXES.id);
    useSpaces.getState().setActive(CORE);
    expect(useSpaces.getState().pending).toBeNull();
    turn.end();
    expect(useSpaces.getState().activeId).toBe(CORE);
  });

  it("returns to core when the active space is erased", async () => {
    rows.set(ROW, TAXES.id);
    await useSpaces.getState().load();
    await useSpaces.getState().erase(TAXES.id);
    expect(useSpaces.getState().activeId).toBe(CORE);
    await Promise.resolve();
    expect(rows.get(ROW)).toBe("");
  });

  it("enters a space made in the other window after reading the list again", async () => {
    await useSpaces.getState().load();
    await useSpaces.getState().create({ name: "Move house" });
    useSpaces.setState({ spaces: [TAXES, GARDEN] });
    useSpaces.getState().setActive("spc_00000000000f");
    await vi.waitFor(() => expect(useSpaces.getState().activeId).toBe("spc_00000000000f"));
  });
});
