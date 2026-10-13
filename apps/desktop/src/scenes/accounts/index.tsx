/**
 * The Accounts depth's `DepthScene` — README sections 3.5 and 4, ADR 0087 and 0090.
 *
 * The running app's part (`live.tsx`) plus what only the preview harness and the tests need.
 */
import { createElement } from "react";

import type { DepthScene } from "@/scenes/types";

import { fixtureIds, fixtures } from "./fixtures";
import { labeller, live } from "./live";
import AccountsView from "./view";

export const entry: DepthScene = {
  ...live,
  fixtureIds,
  preview: (fixture, { path, go }) =>
    createElement(AccountsView, { model: fixtures[fixture] ?? fixtures.typical!, path, go }),
  previewLabeller: (fixture) => {
    const rows = (fixtures[fixture] ?? fixtures.typical!).rows;
    return labeller((id) => rows.find((r) => r.id === id)?.label);
  },
};
