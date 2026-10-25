/**
 * Every depth scene in full, for the preview harness and the tests — README section 3.5, ADR 0090.
 *
 * The running app does not import this: it imports each scene's `live` (`console/scenes.tsx`), whose
 * view is a lazy chunk and which carries no fixtures. Here each scene also has its fixtures, its
 * synchronous preview and its fixture crumb names. The type says every root is covered: a new root
 * is a compile error until it has a scene.
 */
import type { Root } from "@/depth/model";

import { entry as accounts } from "./accounts";
import { entry as apps } from "./apps";
import { entry as chores } from "./chores";
import { entry as mind } from "./mind";
import { entry as projects } from "./projects";
import type { DepthScene } from "./types";
import { entry as voice } from "./voice";

export const DEPTH_SCENES: Readonly<Record<Root, DepthScene>> = {
  projects,
  apps,
  chores,
  accounts,
  voice,
  mind,
};
