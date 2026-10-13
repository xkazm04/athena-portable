/**
 * The Voice depth's `DepthScene` — README section 3.5, ADR 0028, 0087 and 0090.
 *
 * The running app's part (`live.tsx`) plus what only the preview harness and the tests need.
 */
import { createElement } from "react";

import type { DepthScene } from "@/scenes/types";

import { fixtureIds, fixtures } from "./fixtures";
import { NAMES, live } from "./live";
import VoiceScene from "./view";

export const entry: DepthScene = {
  ...live,
  fixtureIds,
  preview: (fixture, { path, go }) =>
    createElement(VoiceScene, { model: fixtures[fixture] ?? fixtures.typical!, path, go }),
  previewLabeller: () => NAMES,
};
