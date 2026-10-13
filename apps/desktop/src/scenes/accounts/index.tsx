/**
 * The Accounts depth's `DepthScene` — README sections 3.5 and 4, ADR 0087 and 0090.
 *
 * The one file here that knows a store exists, and only through the Connectors module's own hook
 * (`useConnectorsModel`): the selector and the actions are shared with the module's old view, so
 * the standing words, the seal sentences and the gate's switches are the ones that view shows. It
 * starts no store; the app root does.
 */
import { createElement } from "react";

import type { Labeller, Path } from "@/depth/model";
import { useConnectorsModel } from "@/modules/connectors";
import type { DepthScene, SceneProps } from "@/scenes/types";
import { useConnectors } from "@/stores/connectors";

import { fixtureIds, fixtures } from "./fixtures";
import AccountsView from "./view";

/** What the breadcrumb calls a place, from the labels a list of connectors carries. */
function labeller(labelOf: (id: string) => string | undefined): Labeller {
  return (path: Path) => {
    if (path.root !== "accounts") return undefined;
    if (path.sub?.kind === "allowlist") return "Allow-list";
    return path.item === undefined ? undefined : labelOf(path.item);
  };
}

function Live({ path, go }: SceneProps) {
  return createElement(AccountsView, { model: useConnectorsModel(), path, go });
}

export const entry: DepthScene = {
  root: "accounts",
  fixtureIds,
  Live,
  preview: (fixture, { path, go }) =>
    createElement(AccountsView, { model: fixtures[fixture] ?? fixtures.typical!, path, go }),
  useLabeller: () => {
    const items = useConnectors((s) => s.items);
    return labeller((id) => items.find((c) => c.id === id)?.label);
  },
  previewLabeller: (fixture) => {
    const rows = (fixtures[fixture] ?? fixtures.typical!).rows;
    return labeller((id) => rows.find((r) => r.id === id)?.label);
  },
};
