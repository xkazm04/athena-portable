/**
 * The Projects depth's `DepthScene` — README section 3.5, ADR 0087, 0090 and 0225.
 *
 * The running app's part (`live.tsx`) plus what only the preview harness and the tests need: the
 * fixtures, the view drawn synchronously, and crumb names for a fixture.
 */
import { createElement } from "react";

import type { DepthScene } from "@/scenes/types";

import { fixtureIds, fixtures } from "./fixtures";
import { labelOf, live } from "./live";
import ProjectsView from "./view";

const pick = (fixture: string) => fixtures[fixture] ?? fixtures.typical!;

export const entry: DepthScene = {
  ...live,
  fixtureIds,
  preview: (fixture, props) => createElement(ProjectsView, { model: pick(fixture), path: props.path, go: props.go }),
  previewLabeller: (fixture) => (path) =>
    labelOf(
      pick(fixture).projects.map((p) => p.space),
      path,
    ),
};
