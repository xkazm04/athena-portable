/**
 * The Mind depth, as the running app uses it — README section 3.5, ADR 0085, 0087, 0089 and 0090.
 *
 * It owns no store and builds no model of its own: the Setup module's hook supplies the view-model,
 * so every rule the module has (readiness, the engine's remedy, the failure to start, the restart
 * notice) is the one this scene shows. Passed in, because the console differs from the old bar:
 * "Show the welcome again" shows the first act on the surface without touching a stored row. The
 * view is a lazy chunk, fetched when the depth is first entered.
 */
import { createElement, lazy, Suspense } from "react";

import type { Labeller, Path } from "@/depth/model";
import { useDepth } from "@/depth/store";
import { useSetupModel } from "@/modules/setup/index";
import type { LiveScene, SceneProps } from "@/scenes/types";
import { useReopened } from "@/scenes/waking/reopen";

const MindView = lazy(() => import("./view"));

const NAMES: Record<string, string> = {
  engine: "Engine",
  brain: "Brain",
  look: "Look",
  data: "Data",
  mic: "Microphone",
};

export const labeller: Labeller = (path: Path) => (path.root === "mind" && path.item ? NAMES[path.item] : undefined);

/** Show the first act again: flag it, then go where it is drawn. The rows stay as they are. */
const reopen = () => {
  useReopened.getState().set(true);
  useDepth.getState().surface();
};

function Live({ path, go }: SceneProps) {
  const model = useSetupModel({ onReopen: reopen });
  const waiting = createElement("div", { className: "depth-pending typo-caption", role: "status" }, "Opening…");
  return createElement(Suspense, { fallback: waiting }, createElement(MindView, { model, path, go }));
}

export const live: LiveScene = { root: "mind", Live, useLabeller: () => labeller };
