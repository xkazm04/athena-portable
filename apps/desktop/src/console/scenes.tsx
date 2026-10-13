/**
 * Which scene answers to which place — README section 3.5, ADR 0087.
 *
 * One function from a depth path to the scene drawn for it. A depth whose own scene has been
 * ported is drawn by it; one that has not is drawn by its module's existing view inside the depth
 * (the **bridge**), so every capability of the old app stays reachable at every step of the
 * migration and the parity matrix never has a hole while it is being filled. The bridge goes away
 * depth by depth, and with the last one the module bar and `registry.ts` go too.
 *
 * Nothing here knows a store: a scene's `Live` reads what it needs, and the console's root started
 * the stores.
 */
import { createElement, type ReactNode } from "react";

import { ROOT_MODULE, type Path, type Root } from "@/depth/model";
import { entry as surface } from "@/scenes/surface";
import { entry as waking } from "@/scenes/waking";
import { moduleFor } from "@/modules/registry";
import type { ModuleEntry } from "@/modules/types";

/** The roots whose own scene exists. Each phase adds one, until the bridge is empty. */
export const PORTED: ReadonlySet<Root> = new Set<Root>();

export interface SceneContext {
  /** The settings have been read: before that the first act and the surface are both unknown. */
  hydrated: boolean;
  onboarded: boolean;
}

export function sceneFor(path: Path, ctx: SceneContext): ReactNode {
  if (path.root === null) {
    if (!ctx.hydrated) return null; // a returning person must not see the first act flash by
    const scene: ModuleEntry = ctx.onboarded ? surface : waking;
    return createElement(scene.Live);
  }
  return bridge(path.root);
}

/** A depth drawn by its module's own view. The depth supplies the frame, the module the contents. */
function bridge(root: Root): ReactNode {
  const module = moduleFor(ROOT_MODULE[root]);
  return createElement("div", { className: "console__bridge app-body", "data-bridge": root }, createElement(module.Live));
}
