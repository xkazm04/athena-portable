/**
 * The Connectors module's `ModuleEntry` — the one file here that knows a store exists.
 *
 * The list is asked for when this surface mounts and again whenever the daemon becomes ready,
 * and never from the app root: what is connected matters only on this surface and to the daemon,
 * which is the one that reads the vault on every call.
 */
import { createElement, useEffect } from "react";

import type { ModuleEntry } from "@/modules/types";
import { useConnectors } from "@/stores/connectors";
import { endpoint, useDaemon } from "@/stores/daemon";

import { fixtureIds, fixtures } from "./fixtures";
import { selectConnectors, type ConnectorActions } from "./model";
import ConnectorsView from "./view";

const ACTIONS: ConnectorActions = {
  connect: (id, body) => void useConnectors.getState().connect(id, body),
  disconnect: (id) => void useConnectors.getState().disconnect(id),
  probe: (id) => void useConnectors.getState().probe(id),
  setEnabled: (id, enabled) => void useConnectors.getState().settings(id, { enabled }),
  setWrites: (id, enabled) => void useConnectors.getState().settings(id, { writes_enabled: enabled }),
  setAllowlist: (id, entries) =>
    void useConnectors.getState().settings(id, { allowlist: [...entries] }),
};

function Live() {
  const items = useConnectors((s) => s.items);
  const loaded = useConnectors((s) => s.loaded);
  const problem = useConnectors((s) => s.problem);
  const busy = useConnectors((s) => s.busy);
  const errors = useConnectors((s) => s.errors);
  const daemon = useDaemon();
  const ready = endpoint(daemon) !== null;

  useEffect(() => {
    if (ready) void useConnectors.getState().load();
  }, [ready]);

  return createElement(ConnectorsView, {
    model: selectConnectors(items, loaded, problem, ready, busy, errors, ACTIONS),
  });
}

export const entry: ModuleEntry = {
  id: "connectors",
  label: "Connectors",
  blurb: "Mail and notes Athena may use from any page, each behind its own switch.",
  fixtureIds,
  preview: (fixture) =>
    createElement(ConnectorsView, { model: fixtures[fixture] ?? fixtures.typical }),
  Live,
};
