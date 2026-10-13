/**
 * Which scene answers to which place — README section 3.5, ADR 0087 and 0090.
 *
 * One function from a depth path to the scene drawn for it. A depth whose own scene has been
 * ported (it is in `DEPTH_SCENES`) is drawn by it; one that has not is drawn by its module's
 * existing view inside the depth (the **bridge**), so every capability of the old app stays
 * reachable at every step of the migration and the parity matrix never has a hole while it is
 * being filled. A port adds one line to `DEPTH_SCENES`; the last port empties the bridge, and the
 * cutover deletes it with the module bar and `registry.ts`.
 *
 * Nothing here knows a store: a scene's `Live` reads what it needs, and the console's root started
 * the stores.
 */
import { createElement, type ReactNode } from "react";

import { ROOT_MODULE, type Path, type Root } from "@/depth/model";
import { moduleFor } from "@/modules/registry";
import { entry as apps } from "@/scenes/apps";
import { entry as surface } from "@/scenes/surface";
import type { DepthScene } from "@/scenes/types";
import { entry as waking } from "@/scenes/waking";

/** The depths with a scene of their own. Each phase adds one. */
export const DEPTH_SCENES: Readonly<Partial<Record<Root, DepthScene>>> = {
  apps,
};

export const PORTED: ReadonlySet<Root> = new Set(Object.keys(DEPTH_SCENES) as Root[]);

export interface SceneContext {
  /** The settings have been read: before that the first act and the surface are both unknown. */
  hydrated: boolean;
  onboarded: boolean;
  /** Move, for the scenes that link to a deeper place. */
  go: (to: Path) => void;
}

export function sceneFor(path: Path, ctx: SceneContext): ReactNode {
  if (path.root === null) {
    if (!ctx.hydrated) return null; // a returning person must not see the first act flash by
    return createElement((ctx.onboarded ? surface : waking).Live);
  }
  const scene = DEPTH_SCENES[path.root];
  if (scene) return createElement(scene.Live, { path, go: ctx.go });
  return bridge(path.root);
}

/** A depth drawn by its module's own view. The depth supplies the frame, the module the contents. */
function bridge(root: Root): ReactNode {
  const module = moduleFor(ROOT_MODULE[root]);
  return createElement("div", { className: "console__bridge app-body", "data-bridge": root }, createElement(module.Live));
}
