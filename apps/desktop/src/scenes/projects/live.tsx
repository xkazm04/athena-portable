/**
 * The Projects depth, as the running app uses it — README section 3.5, ADR 0087, 0089, 0090 and 0225.
 *
 * The part of the scene in the first frame, so it is small: the view, the model and the one
 * behaviour a place has here (entering a project is entering it, `useEnterSpace`) are a lazy chunk
 * (`live-view.tsx`), fetched when the depth is first entered. What stays here is the crumb names (a
 * project is called by its name, core "Core", its memory "Memory"), read from the spaces store's
 * first-frame mirror (`stores/spaces-glance.ts`), and the registered apps the moons are drawn from:
 * the Browser module's hook is first-frame code already, and a lazy chunk reading it itself would
 * pull the modules it shares with the first frame out into small chunks of their own, each one
 * more file on the first frame.
 */
import { createElement, lazy, Suspense, useMemo } from "react";

import type { Labeller, Path } from "@/depth/model";
import { CORE_ITEM } from "@/lib/space-core";
import { useBrowserModel } from "@/modules/browser";
import type { LiveScene, SceneProps } from "@/scenes/types";
import { useSpacesGlance } from "@/stores/spaces-glance";

const ProjectsLiveView = lazy(() => import("./live-view"));

function Live({ path, go }: SceneProps) {
  const { apps } = useBrowserModel();
  const waiting = createElement("div", { className: "depth-pending typo-caption", role: "status" }, "Opening…");
  return createElement(Suspense, { fallback: waiting }, createElement(ProjectsLiveView, { path, go, registered: apps }));
}

/** What a place under Projects is called in the breadcrumb; `undefined` for one it cannot name. */
export function labelOf(spaces: readonly { id: string; name: string }[], path: Path): string | undefined {
  if (path.root !== "projects" || path.item === undefined) return undefined;
  if (path.sub?.kind === "memory") return "Memory";
  if (path.item === CORE_ITEM) return "Core";
  return spaces.find((s) => s.id === path.item)?.name || undefined;
}

function useLabeller(): Labeller {
  const spaces = useSpacesGlance((s) => s.names);
  return useMemo(() => (path: Path) => labelOf(spaces, path), [spaces]);
}

export const live: LiveScene = { root: "projects", Live, useLabeller };
