/**
 * The engine probe mirror — README section 3.1, UAT backlog B4: "Check again" while a check is
 * still running must neither read as done early nor let the older answer win.
 *
 * The daemon is a stubbed global `fetch` behind the real `DaemonApi`; each `GET /engines` waits
 * for the test to release it, so the two answers can be made to land in either order.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useDaemon } from "@/stores/daemon";
import { useEngines } from "@/stores/engines";

type Probe = { id: string; state: string; detail: string };

/** Each pending `GET /engines`, in the order it was asked. */
let pending: Array<(engines: Probe[]) => void> = [];

beforeEach(() => {
  pending = [];
  vi.stubGlobal("fetch", () =>
    new Promise<Response>((resolve) => {
      pending.push((engines) =>
        resolve(new Response(JSON.stringify({ engines }), { status: 200, headers: { "content-type": "application/json" } })),
      );
    }),
  );
  useDaemon.setState({ url: "http://daemon", token: "t", health: "ready", loaded: true });
  useEngines.setState({ probes: null, checking: false, problem: null });
});

afterEach(() => vi.unstubAllGlobals());

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a second check while the first is running: still checking until the last answers, and the last ask wins", async () => {
  const first = useEngines.getState().check();
  await settle();
  const second = useEngines.getState().check();
  await settle();
  expect(pending).toHaveLength(2);

  // The newer ask answers first: claude_code was just installed.
  pending[1]([{ id: "claude_code", state: "found", detail: "2.1" }]);
  await second;
  // The older ask answers last, with what was true before the install.
  pending[0]([{ id: "claude_code", state: "not_found", detail: "`claude` was not found" }]);
  await first;

  expect(useEngines.getState().probes?.map((p) => p.state)).toEqual(["found"]);
  expect(useEngines.getState().checking).toBe(false);
});

test("the button reads Checking for as long as any check is in flight", async () => {
  const first = useEngines.getState().check();
  await settle();
  const second = useEngines.getState().check();
  await settle();

  pending[0]([{ id: "claude_code", state: "found", detail: "2.1" }]);
  await first;
  // The first finished; the second has not. The probe is still running.
  expect(useEngines.getState().checking).toBe(true);

  pending[1]([{ id: "claude_code", state: "found", detail: "2.1" }]);
  await second;
  expect(useEngines.getState().checking).toBe(false);
});
