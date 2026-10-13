/**
 * The first act, as the running app uses it — README section 3.5, ADR 0087.
 *
 * It owns no store and builds no model of its own: the Setup module's own hook supplies the
 * view-model, so the letter's rules (readiness, the engine's remedy, the failure to start) are the
 * ones this scene shows. What is new is only that finishing wakes her on the surface, and that
 * "Later" lets the person look around first.
 */
import { createElement } from "react";

import { useDepth } from "@/depth/store";
import { useSetupModel } from "@/modules/setup/index";

import { useReopened } from "./reopen";
import WakingView from "./view";

const later = () => useDepth.getState().go({ root: "apps" });
/**
 * Waking her ends on the surface, where the scene is already. It selects no module (ADR 0088); it
 * only stops showing the act, which matters when it was shown again from the Mind depth.
 */
const done = () => useReopened.getState().set(false);

export function Live() {
  const model = useSetupModel({ afterFinish: done });
  return createElement(WakingView, { model, onLater: later });
}
