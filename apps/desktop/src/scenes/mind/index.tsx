/**
 * The Mind depth's `DepthScene` — README section 3.5, ADR 0085, 0087 and 0090.
 *
 * It owns no store and builds no model of its own: the Setup module's hook supplies the view-model,
 * so every rule the module had (readiness, the engine's remedy, the failure to start, the restart
 * notice) is the one this scene shows. Two things are passed in, because the console differs from
 * the module bar: waking her ends on the surface and stops showing the first act, and "Show the
 * welcome again" shows the first act on the surface without touching a stored row.
 */
import { createElement } from "react";

import type { Labeller, Path } from "@/depth/model";
import { useDepth } from "@/depth/store";
import { useSetupModel } from "@/modules/setup/index";
import type { DepthScene, SceneProps } from "@/scenes/types";
import { useReopened } from "@/scenes/waking/reopen";

import { fixtureIds, fixtures } from "./fixtures";
import MindView from "./view";

const NAMES: Record<string, string> = {
  engine: "Engine",
  brain: "Brain",
  look: "Look",
  data: "Data",
  mic: "Microphone",
};

const labeller: Labeller = (path: Path) => (path.root === "mind" && path.item ? NAMES[path.item] : undefined);

/** Show the first act again: flag it, then go where it is drawn. The rows stay as they are. */
const reopen = () => {
  useReopened.getState().set(true);
  useDepth.getState().surface();
};

function Live({ path, go }: SceneProps) {
  const model = useSetupModel({ onReopen: reopen });
  return createElement(MindView, { model, path, go });
}

export const entry: DepthScene = {
  root: "mind",
  fixtureIds,
  Live,
  preview: (fixture, props) =>
    createElement(MindView, { model: fixtures[fixture] ?? fixtures.typical!, path: props.path, go: props.go }),
  useLabeller: () => labeller,
  previewLabeller: () => labeller,
};
