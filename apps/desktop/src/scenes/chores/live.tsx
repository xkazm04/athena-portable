/**
 * The Chores depth, as the running app uses it — README section 3.5, ADR 0040, 0087, 0089 and 0090.
 *
 * It owns no store and builds no model of its own: the Playbooks module's hook supplies the
 * view-model, so the verdicts, the map, the arrangement and the actions are the module's. What the
 * scene passes in is one thing: opening a portal makes the Browser tab and does not select the
 * Browser (a Rust `browser` selection shows a page under a scene, ADR 0088). The Apps depth owns the
 * page level, so once the tab exists the scene moves to `apps/<origin>/page`; a page with no origin
 * to name stays where it is, and says so. The view is a lazy chunk, fetched when the depth is first
 * entered, and the shipped playbooks it draws are fetched with it.
 */
import { createElement, lazy, Suspense, useCallback, useMemo } from "react";

import type { Labeller, Path } from "@/depth/model";
import { originOf } from "@/modules/browser/model";
import { usePlaybooksModel } from "@/modules/playbooks/index";
import { pagePath } from "@/scenes/apps/model";
import type { LiveScene, SceneProps } from "@/scenes/types";
import { usePlaybooks } from "@/stores/playbooks";

const ChoresView = lazy(() => import("./view"));

function Live({ path, go }: SceneProps) {
  // The tab exists by the time this runs; the Apps depth names the page it opened by its origin.
  const afterOpen = useCallback(
    (url: string) => {
      const origin = originOf(url);
      if (origin !== "" && origin !== "null") go(pagePath(origin));
    },
    [go],
  );
  const model = usePlaybooksModel(afterOpen);
  const waiting = createElement("div", { className: "depth-pending typo-caption", role: "status" }, "Opening…");
  return createElement(Suspense, { fallback: waiting }, createElement(ChoresView, { model, path, go }));
}

/** Crumb names: a chore is called by its title, a turn by its number. */
export function labeller(titles: ReadonlyMap<string, string>): Labeller {
  return (path: Path) => {
    if (path.root !== "chores" || path.item === undefined) return undefined;
    if (path.sub?.kind === "run") return `Turn ${path.sub.arg ?? ""}`.trim();
    return titles.get(path.item);
  };
}

/** Crumb names from the shipped set, once it has arrived; until then a chore is called by its id. */
function useLabeller(): Labeller {
  const items = usePlaybooks((s) => s.items);
  return useMemo(() => labeller(new Map((items ?? []).map((p) => [p.id, p.shortTitle]))), [items]);
}

export const live: LiveScene = { root: "chores", Live, useLabeller };
