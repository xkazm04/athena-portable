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

import { fixtureIds, fixtures, initialOpenFor } from "./fixtures";
import { selectConnectors, type ConnectorActions, type ConnectorsModel } from "./model";
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

/**
 * The model, built from the stores. A hook so the Connectors module and the Accounts depth share
 * one selector and one set of actions (README 3.5, ADR 0090); the old view and the scene differ
 * only in what they draw. Loading the list belongs here too: it is asked for when a surface that
 * shows it mounts and again whenever the daemon becomes ready.
 */
export function useConnectorsModel(): ConnectorsModel {
  const items = useConnectors((s) => s.items);
  const loaded = useConnectors((s) => s.loaded);
  const problem = useConnectors((s) => s.problem);
  const recordsNotice = useConnectors((s) => s.recordsNotice);
  const busy = useConnectors((s) => s.busy);
  const errors = useConnectors((s) => s.errors);
  const daemon = useDaemon();
  const ready = endpoint(daemon) !== null;

  useEffect(() => {
    if (ready) void useConnectors.getState().load();
  }, [ready]);

  return selectConnectors(items, loaded, problem, ready, busy, errors, ACTIONS, undefined, recordsNotice);
}

function Live() {
  return createElement(ConnectorsView, { model: useConnectorsModel() });
}

export const entry: ModuleEntry = {
  id: "connectors",
  label: "Connectors",
  blurb: "Mail and notes Athena may use from any page, each behind its own switch.",
  fixtureIds,
  preview: (fixture) =>
    createElement(ConnectorsView, {
      model: fixtures[fixture] ?? fixtures.typical,
      initialOpen: initialOpenFor(fixture),
    }),
  Live,
};
