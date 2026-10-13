/**
 * The Chores depth's `DepthScene` — README section 3.5, ADR 0040, 0087 and 0090.
 *
 * It owns no store and builds no model of its own: the Playbooks module's hook supplies the
 * view-model, so the verdicts, the map, the arrangement and the actions are the ones the module bar
 * shows. What differs here is one thing, and it is passed in: opening a portal makes the Browser
 * tab and does not select the Browser module (a Rust `browser` selection shows a page under a scene,
 * ADR 0088). The Apps depth owns the page level, so once the tab exists the scene moves to
 * `apps/<origin>/page`; a page with no origin to name stays where it is, and says so.
 */
import { createElement, useCallback } from "react";

import type { Labeller, Path } from "@/depth/model";
import { PLAYBOOKS } from "@/lib/playbooks";
import { originOf } from "@/modules/browser/model";
import { usePlaybooksModel } from "@/modules/playbooks/index";
import type { PlaybooksModel } from "@/modules/playbooks/model";
import type { FixtureId } from "@/modules/types";
import { pagePath } from "@/scenes/apps/model";
import type { DepthScene, SceneProps } from "@/scenes/types";

import { facetFor, fixtureIds, fixtures } from "./fixtures";
import ChoresView from "./view";

function Live({ path, go }: SceneProps) {
  // The tab exists by the time this runs; the Apps depth names the page it opened by its origin.
  const afterOpen = useCallback(
    (url: string) => {
      const origin = originOf(url);
      if (origin !== "" && origin !== "null") go(pagePath(origin));
    },
    [go],
  );
  const model = usePlaybooksModel({ afterOpen });
  return createElement(ChoresView, { model, path, go });
}

/** Crumb names: a chore is called by its title, a turn by its number. */
export function labeller(titles: ReadonlyMap<string, string>): Labeller {
  return (path: Path) => {
    if (path.root !== "chores" || path.item === undefined) return undefined;
    if (path.sub?.kind === "run") return `Turn ${path.sub.arg ?? ""}`.trim();
    return titles.get(path.item);
  };
}

const LIVE = labeller(new Map(PLAYBOOKS.map((p) => [p.id, p.title])));
const titlesOf = (model: PlaybooksModel) => new Map(model.items.map((v) => [v.id, v.title]));

export const entry: DepthScene = {
  root: "chores",
  fixtureIds,
  Live,
  preview: (fixture: FixtureId, props: SceneProps) =>
    createElement(ChoresView, {
      model: fixtures[fixture] ?? fixtures.typical!,
      initialFacet: facetFor(fixture),
      ...props,
    }),
  useLabeller: () => LIVE,
  previewLabeller: (fixture: FixtureId) => labeller(titlesOf(fixtures[fixture] ?? fixtures.typical!)),
};
