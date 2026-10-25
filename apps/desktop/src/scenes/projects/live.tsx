/**
 * The Projects depth, as the running app uses it — README section 3.5, ADR 0087, 0089, 0090 and 0225.
 *
 * The part of the scene in the first frame, so it is small: the view and the model are a lazy chunk
 * (`live-view.tsx`), fetched when the depth is first entered. What this part does is the one
 * behaviour a place has here: **entering a project is entering it.** A path at `projects/<id>` (or
 * any place under it) asks the spaces store to make that space the active one, and `projects/core`
 * returns Athena to core; the store holds the switch while a turn runs (`pending`). An id the list
 * does not hold is never made active, so a stale link cannot file a turn under a space that is gone.
 * Also the crumb names: a project is called by its name, core "Core", its memory "Memory".
 */
import { createElement, lazy, Suspense, useEffect, useMemo } from "react";

import type { Labeller, Path } from "@/depth/model";
import { CORE, CORE_ITEM, type SpaceSummary } from "@/lib/spaces";
import type { LiveScene, SceneProps } from "@/scenes/types";
import { useSpaces } from "@/stores/spaces";

const ProjectsLiveView = lazy(() => import("./live-view"));

/** The space a path under Projects asks to be in: `CORE` for core, the id, or null for the field. */
export function spaceAsked(path: Path): string | null {
  if (path.root !== "projects" || path.item === undefined || path.item === "") return null;
  return path.item === CORE_ITEM ? CORE : path.item;
}

/** Make the space the path names the active one, once the list says it exists. */
export function useEnterSpace(path: Path): void {
  const asked = spaceAsked(path);
  const loaded = useSpaces((s) => s.loaded);
  const known = useSpaces((s) => asked !== null && (asked === CORE || s.spaces.some((x) => x.id === asked)));
  const setActive = useSpaces((s) => s.setActive);
  useEffect(() => {
    if (asked === null || !known) return;
    if (asked !== CORE && !loaded) return;
    const { activeId, pending } = useSpaces.getState();
    // Already there, with no other switch waiting: asking again would only write the same setting.
    if (activeId === asked && pending === null) return;
    setActive(asked);
  }, [asked, known, loaded, setActive]);
}

function Live({ path, go }: SceneProps) {
  useEnterSpace(path);
  const waiting = createElement("div", { className: "depth-pending typo-caption", role: "status" }, "Opening…");
  return createElement(Suspense, { fallback: waiting }, createElement(ProjectsLiveView, { path, go }));
}

/** What a place under Projects is called in the breadcrumb; `undefined` for one it cannot name. */
export function labelOf(spaces: readonly SpaceSummary[], path: Path): string | undefined {
  if (path.root !== "projects" || path.item === undefined) return undefined;
  if (path.sub?.kind === "memory") return "Memory";
  if (path.item === CORE_ITEM) return "Core";
  return spaces.find((s) => s.id === path.item)?.name || undefined;
}

function useLabeller(): Labeller {
  const spaces = useSpaces((s) => s.spaces);
  return useMemo(() => (path: Path) => labelOf(spaces, path), [spaces]);
}

export const live: LiveScene = { root: "projects", Live, useLabeller };
