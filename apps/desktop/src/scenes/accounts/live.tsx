/**
 * The Accounts depth, as the running app uses it — README sections 3.5 and 4, ADR 0087, 0089, 0090.
 *
 * The one file here that knows a store exists, and only through the Connectors module's own hook
 * (`useConnectorsModel`): the selector and the actions are the module's, so the standing words, the
 * seal sentences and the gate's switches are the ones the module states. It starts no store; the app
 * root does. The view is a lazy chunk, fetched when the depth is first entered.
 */
import { createElement, lazy, Suspense } from "react";

import type { Labeller, Path } from "@/depth/model";
import { useConnectorsModel } from "@/modules/connectors";
import type { LiveScene, SceneProps } from "@/scenes/types";
import { useConnectors } from "@/stores/connectors";

const AccountsView = lazy(() => import("./view"));

/** What the breadcrumb calls a place, from the labels a list of connectors carries. */
export function labeller(labelOf: (id: string) => string | undefined): Labeller {
  return (path: Path) => {
    if (path.root !== "accounts") return undefined;
    if (path.sub?.kind === "allowlist") return "Allow-list";
    return path.item === undefined ? undefined : labelOf(path.item);
  };
}

function Live({ path, go }: SceneProps) {
  const model = useConnectorsModel();
  return createElement(Suspense, { fallback: null }, createElement(AccountsView, { model, path, go }));
}

export const live: LiveScene = {
  root: "accounts",
  Live,
  useLabeller: () => {
    const items = useConnectors((s) => s.items);
    return labeller((id) => items.find((c) => c.id === id)?.label);
  },
};
