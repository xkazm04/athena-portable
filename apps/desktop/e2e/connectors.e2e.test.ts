/**
 * `src/stores/connectors.ts` and the Connectors view-model against a real vault — README §4,
 * ADR 0021.
 *
 * The bug in `be6f928` was not the unbound `fetch`; that was its instance. The *class* of mistake
 * was a surface that could not tell "the vault said no" from "we never asked", and reported both
 * as the daemon refusing the user — which sends them to debug the wrong machine. So this file
 * asserts the attribution against the two real cases:
 *
 *  - a daemon started **with** connectors answers `GET /connectors` and every row's health comes
 *    off the record, not off a guess here;
 *  - a daemon started with `--no-connectors` serves no such route at all, and the module has to
 *    degrade to a sentence that says the daemon answered — with the daemon's own words in it;
 *  - a daemon that is **not there** must be attributed to this shell (`from: "client"`), which is
 *    the half `be6f928` got wrong.
 *
 * `--no-connectors` is also why the vault's own scratch `ATHENA_HOME` matters: with connectors on,
 * the vault writes under it, and without the isolation it would write the developer's real one.
 */
import { afterEach, describe, expect, it } from "vitest";

import { DaemonApi } from "@/lib/api";
import { selectConnectors, INERT_ACTIONS } from "@/modules/connectors/model";
import {
  resetConnectorsForTests,
  setConnectorDeps,
  useConnectors,
} from "@/stores/connectors";

import { startDaemon, type Daemon } from "./support/daemon";

let running: Daemon | null = null;

async function live(options: { connectors: boolean }): Promise<Daemon> {
  const daemon = await startDaemon({
    transcript: "e2e/transcripts/quiet.ndjson",
    connectors: options.connectors,
  });
  running = daemon;
  setConnectorDeps({
    api: () => new DaemonApi({ url: daemon.url, token: daemon.token }),
    wait: () => Promise.resolve(),
  });
  return daemon;
}

afterEach(async () => {
  resetConnectorsForTests();
  const daemon = running;
  running = null;
  await daemon?.stop();
});

/** The view-model the module renders, from the store as it stands now. */
function model() {
  const s = useConnectors.getState();
  return selectConnectors(s.items, s.loaded, s.problem, true, s.busy, s.errors, INERT_ACTIONS);
}

describe("a daemon with the vault", () => {
  it("reads GET /connectors and renders each connector's standing from its own record", async () => {
    await live({ connectors: true });

    await useConnectors.getState().load();

    const state = useConnectors.getState();
    expect(state.loaded).toBe(true);
    expect(state.problem).toBeNull();
    expect(state.items.length).toBeGreaterThan(0);

    const view = model();
    expect(view.rows.length).toBe(state.items.length);
    for (const row of view.rows) {
      // Nothing is connected on a fresh scratch home, so every row says exactly that — and says
      // it from `connection.status`, which is the daemon's record and not a default here.
      expect(row.standing).toBe("not-connected");
      expect(row.word).toBe("not connected");
      expect(row.sentence).toContain(row.label);
      // The seal sentence is empty while nothing is sealed: a row that claimed the OS keystore
      // held something would be a surface lying about where a credential is.
      expect(row.seal).toBe("");
      expect(row.error).toBe("");
      expect(row.busy).toBe("");
      // A write is what the spec's own flags make a write, derived by the same rule the catalog
      // uses. Every connector here has at least one read or one write to show.
      expect(row.reads.length + row.writes.length).toBeGreaterThan(0);
    }
    // The one thing a credential store must never do (ADR 0021): the record has no field a
    // value could leak through. Asserted as the exact key set of what `/connectors` answers,
    // because a new field on the Python side has to be a decision here and not a surprise.
    // (The `guide` prose does say the words "client secret" — it is the instructions for getting
    // one, which is why this is a shape assertion and not a search for a word.)
    for (const item of state.items) {
      expect(Object.keys(item.connection).sort()).toEqual(
        [
          "allowlist",
          "connected_at",
          "enabled",
          "expires_at",
          "health",
          "health_at",
          "health_detail",
          "id",
          "identity",
          "last_used_at",
          "seal",
          "status",
          "writes_enabled",
        ].sort(),
      );
      for (const tool of item.tools) {
        expect(Object.keys(tool).sort()).toEqual(
          ["description", "name", "reversible", "side_effects"].sort(),
        );
      }
    }
  });

  it("names the connector a refused act was about, in the daemon's words, and nothing else", async () => {
    await live({ connectors: true });
    await useConnectors.getState().load();
    const id = useConnectors.getState().items[0].id;

    // An empty credential is refused by the vault, which is a 409 in the gate's vocabulary.
    await useConnectors.getState().connect(id, { token: "" });

    const state = useConnectors.getState();
    expect(state.errors[id]).toBeTruthy();
    // The refusal lands on the row it was about and on no other, and the list is still readable.
    expect(Object.keys(state.errors)).toEqual([id]);
    expect(state.problem).toBeNull();
    expect(state.busy[id]).toBeUndefined();
    expect(model().rows.find((r) => r.id === id)?.error).toBe(state.errors[id]);
  });

  it("refuses an act on a connector that does not exist without disturbing the list", async () => {
    await live({ connectors: true });
    await useConnectors.getState().load();
    const before = useConnectors.getState().items.length;

    await useConnectors.getState().probe("not-a-connector");

    expect(useConnectors.getState().errors["not-a-connector"]).toContain("not-a-connector");
    expect(useConnectors.getState().items).toHaveLength(before);
  });
});

describe("a daemon started with --no-connectors", () => {
  it("degrades to one sentence attributed to the daemon, not to an empty list", async () => {
    await live({ connectors: false });

    await useConnectors.getState().load();

    const state = useConnectors.getState();
    // `loaded` is true and the list is empty — which on its own would render as "you have no
    // connectors". `problem` is what keeps the two facts apart.
    expect(state.loaded).toBe(true);
    expect(state.items).toEqual([]);
    expect(state.problem).not.toBeNull();
    expect(state.problem?.from).toBe("daemon");
    // The daemon's own words. The route is not registered at all when the vault is off, so this
    // is a 404 from the route table and the sentence says so.
    expect(state.problem?.reason).toContain("/connectors");

    const view = model();
    expect(view.rows).toEqual([]);
    expect(view.problem?.from).toBe("daemon");
    expect(view.loaded).toBe(true);
  });

  it("still answers every other route, so the panel is not taken down with the vault", async () => {
    const daemon = await live({ connectors: false });

    const health = await new DaemonApi({ url: daemon.url, token: daemon.token }).health();

    expect(health.ok).toBe(true);
  });
});

describe("a daemon that is not there", () => {
  it("is this shell's failure and is attributed to this shell, never to the vault", async () => {
    // The class of mistake `be6f928` fixed. A transport failure is not a refusal, and the note a
    // person reads must not send them to the wrong machine. The port is one the kernel handed
    // back and then let go of, so nothing is listening on it.
    const daemon = await live({ connectors: false });
    const url = daemon.url;
    running = null;
    await daemon.stop();
    setConnectorDeps({
      api: () => new DaemonApi({ url, token: "gone" }),
      wait: () => Promise.resolve(),
    });

    await useConnectors.getState().load();

    const state = useConnectors.getState();
    expect(state.loaded).toBe(true);
    expect(state.problem).not.toBeNull();
    expect(state.problem?.from).toBe("client");
    expect(model().problem?.from).toBe("client");
  });
});
