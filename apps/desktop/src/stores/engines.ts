/**
 * What the engine probe found, as the shell holds it: README section 3.1 (engine probes), UAT backlog B4.
 *
 * A mirror of `GET /engines` and nothing more. The daemon owns the probe; this store asks once when the
 * daemon becomes ready, and again on `check()` (the "Check again" button) without a restart. `null` means
 * "nobody has answered yet", which is different from "not found" and is rendered differently.
 *
 * Started by both roots (Main and the Athena window): the welcome names the engine in her window and Setup
 * names it in Main, and both read this one shape, so they cannot disagree.
 */
import { create } from "zustand";

import { DaemonApi } from "@/lib/api";
import type { EngineProbe } from "@/lib/engines";
import { endpoint, useDaemon } from "@/stores/daemon";

export interface EnginesState {
  /** `null` until the daemon has answered at least once. */
  probes: readonly EngineProbe[] | null;
  /** A probe is in flight (the button reads "Checking...", not "Check again"). */
  checking: boolean;
  /** The daemon's own words when the probe could not run at all; `null` otherwise. */
  problem: string | null;
  /** Ask the daemon again. Safe at any time; never throws. */
  check: () => Promise<void>;
}

export const useEngines = create<EnginesState>((set) => ({
  probes: null,
  checking: false,
  problem: null,
  check: async () => {
    const found = endpoint(useDaemon.getState());
    if (!found) {
      set({ problem: "The daemon is not ready yet." });
      return;
    }
    set({ checking: true });
    try {
      const page = await new DaemonApi(found).engines();
      set({ probes: page.engines.map((e) => ({ id: e.id, state: e.state, detail: e.detail })), problem: null });
    } catch (e) {
      set({ problem: String(e instanceof Error ? e.message : e) });
    } finally {
      set({ checking: false });
    }
  },
}));

let started = false;

/** Probe when the daemon first becomes ready. Called by each root; idempotent. */
export function startEngines(): void {
  if (started) return;
  started = true;
  const run = () => void useEngines.getState().check();
  if (endpoint(useDaemon.getState())) run();
  useDaemon.subscribe((state, prev) => {
    if (endpoint(state) && !endpoint(prev)) run();
  });
}
