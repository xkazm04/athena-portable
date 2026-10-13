/**
 * Which scene answers to which place — README section 3.5, ADR 0087 and 0090.
 *
 * One function from a depth path to the scene drawn for it. The surface is the first act until the
 * machine has been woken and her bell after; each of the five depths is its own scene
 * (`LIVE_SCENES`, one per root, and a test pins that none is missing). Nothing here knows a store:
 * a scene's `Live` reads what it needs, and the console's root started the stores.
 */
import { createElement, type ReactNode } from "react";

import type { Path, Root } from "@/depth/model";
import { live as accounts } from "@/scenes/accounts/live";
import { live as apps } from "@/scenes/apps/live";
import { live as chores } from "@/scenes/chores/live";
import { live as mind } from "@/scenes/mind/live";
import { Live as Surface } from "@/scenes/surface/live";
import type { LiveScene } from "@/scenes/types";
import { live as voice } from "@/scenes/voice/live";
import { Live as Waking } from "@/scenes/waking/live";

/**
 * Every depth has a scene of its own, and each is its **live part** only: the view is a lazy chunk
 * fetched when the depth is first entered, and no fixture is in the running app (the full scenes
 * are `scenes/registry.ts`, for the preview harness and the tests). The type says so: a new root is
 * a compile error until it has one.
 */
export const LIVE_SCENES: Readonly<Record<Root, LiveScene>> = {
  apps,
  chores,
  accounts,
  voice,
  mind,
};

export interface SceneContext {
  /** The settings have been read: before that the first act and the surface are both unknown. */
  hydrated: boolean;
  onboarded: boolean;
  /** The first act is being shown again from the Mind depth, though the machine is set up. */
  reopened: boolean;
  /** Move, for the scenes that link to a deeper place. */
  go: (to: Path) => void;
}

export function sceneFor(path: Path, ctx: SceneContext): ReactNode {
  if (path.root === null) {
    if (!ctx.hydrated) return null; // a returning person must not see the first act flash by
    return createElement(ctx.onboarded && !ctx.reopened ? Surface : Waking);
  }
  return createElement(LIVE_SCENES[path.root].Live, { path, go: ctx.go });
}
