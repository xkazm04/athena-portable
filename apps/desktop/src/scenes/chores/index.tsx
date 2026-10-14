/**
 * The Chores depth's `DepthScene` — README section 3.5, ADR 0040, 0087 and 0090.
 *
 * The running app's part (`live.tsx`) plus what only the preview harness and the tests need: the
 * fixtures (which read the shipped playbooks eagerly), the view drawn synchronously, the Adopt
 * studio's scripted session for its fixtures, and crumb names for a fixture.
 */
import { createElement } from "react";

import type { PlaybooksModel } from "@/modules/playbooks/model";
import type { FixtureId } from "@/modules/types";
import type { DepthScene, SceneProps } from "@/scenes/types";

import { ADOPT_PLAYBOOK, adoptDepsFor } from "./adopt/fixtures";
import { fixtureIds, fixtures } from "./fixtures";
import { labeller, live } from "./live";
import ChoresView from "./view";

export { labeller };

const titlesOf = (model: PlaybooksModel) => new Map(model.items.map((v) => [v.id, v.playbook.shortTitle]));

export const entry: DepthScene = {
  ...live,
  fixtureIds,
  preview: (fixture: FixtureId, props: SceneProps) => {
    const model = fixtures[fixture] ?? fixtures.typical!;
    const recorded = model.items.find((v) => v.id === ADOPT_PLAYBOOK)?.playbook.bench?.trace ?? [];
    return createElement(ChoresView, { model, ...props, adopt: adoptDepsFor(fixture, recorded) });
  },
  previewLabeller: (fixture: FixtureId) => labeller(titlesOf(fixtures[fixture] ?? fixtures.typical!)),
};
