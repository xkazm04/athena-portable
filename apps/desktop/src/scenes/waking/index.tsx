/**
 * The first act's `ModuleEntry` — README section 3.5, ADR 0087.
 *
 * It owns no store and builds no model of its own: the Setup module's own hook supplies the
 * view-model, so the letter's rules (readiness, the engine's remedy, the failure to start) are the
 * ones this scene shows. What is new is only that finishing wakes her on the surface, and that
 * "Later" lets the person look around first.
 */
import { createElement } from "react";

import { useDepth } from "@/depth/store";
import { fixtures as setupFixtures } from "@/modules/setup/fixtures";
import { useSetupModel } from "@/modules/setup/index";
import type { ModuleEntry } from "@/modules/types";

import { useReopened } from "./reopen";

import { INITIAL_STEPS, fixtureIds, fixtures } from "./fixtures";
import WakingView from "./view";

const later = () => useDepth.getState().go({ root: "apps" });
/**
 * Waking her ends on the surface, where the scene is already. It selects no module (ADR 0088); it
 * only stops showing the act, which matters when it was shown again from the Mind depth.
 */
const done = () => useReopened.getState().set(false);

function Live() {
  const model = useSetupModel({ afterFinish: done });
  return createElement(WakingView, { model, onLater: later });
}

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
