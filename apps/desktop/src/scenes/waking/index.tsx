/**
 * The first act's `ModuleEntry` — README section 3.5, ADR 0087.
 *
 * The running app's part is `live.tsx`; this adds what only the preview harness and the tests need:
 * the fixtures and the view drawn against one, opening on the step its story is about.
 */
import { createElement } from "react";

import { fixtures as setupFixtures } from "@/modules/setup/fixtures";
import type { ModuleEntry } from "@/modules/types";

import { INITIAL_STEPS, fixtureIds, fixtures } from "./fixtures";
import { Live } from "./live";
import WakingView from "./view";

export const entry: ModuleEntry = {
  id: "waking",
  label: "Waking her",
  blurb: "The first act: a mind, a reach, a voice. The letter's rules, in the scene she lives in.",
  fixtureIds,
  preview: (fixture) =>
    createElement(WakingView, {
      model: fixtures[fixture] ?? setupFixtures.onboarding!,
      onLater: () => {},
      initialStep: INITIAL_STEPS[fixture] ?? 0,
    }),
  Live,
};
