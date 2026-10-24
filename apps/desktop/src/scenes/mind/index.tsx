/**
 * The Mind depth's `DepthScene` — README section 3.5, ADR 0085, 0087 and 0090.
 *
 * The running app's part (`live.tsx`) plus what only the preview harness and the tests need.
 */
import { createElement } from "react";

import type { DepthScene } from "@/scenes/types";

import { deviceFixtures, fixtureIds, fixtures, sleepFixtures } from "./fixtures";
import { labeller, live } from "./live";
import MindView from "./view";

export const entry: DepthScene = {
  ...live,
  fixtureIds,
  preview: (fixture, props) =>
    createElement(MindView, {
      model: fixtures[fixture] ?? fixtures.typical!,
      path: props.path,
      go: props.go,
      // The Devices level has its own states; the preview shows each under the same fixture name.
      devices: deviceFixtures[fixture] ?? deviceFixtures.typical!,
      sleep: sleepFixtures[fixture] ?? sleepFixtures.typical!,
    }),
  previewLabeller: () => labeller,
};
