/**
 * The first act, as the running app uses it — README section 3.5, ADR 0087.
 *
 * It owns no store and builds no model of its own: the Setup module's own hook supplies the
 * view-model, so the letter's rules (readiness, the engine's remedy, the failure to start) are the
 * ones this scene shows. What is new is only that finishing wakes her on the surface, that
 * "Later" lets the person look around first, and that the step they were on is kept for the
 * session (ADR 0223).
 */
import { createElement, useState } from "react";

import type { AvatarId } from "@/avatar/types";
import { useDepth } from "@/depth/store";
import { useSetupModel } from "@/modules/setup/index";
import { useSettings } from "@/stores/settings";

import { useReopened } from "./reopen";
import type { Step } from "./steps";
import WakingView from "./view";

const later = () => useDepth.getState().go({ root: "apps" });
/** The step the person moves to is kept for the session (ADR 0223), so Later and back lands there. */
const keep = (step: Step) => useReopened.getState().keep(step);
/** The Voice step's door: keep the Voice step, and go to the studio where her voice is set up. */
const toStudio = () => {
  keep(2);
  useDepth.getState().go({ root: "voice", item: "studio" });
};
/**
 * Waking her ends on the surface, where the scene is already. It selects no module (ADR 0088); it
 * only stops showing the act, which matters when it was shown again from the Mind depth.
 */
const done = () => useReopened.getState().set(false);

/** Choosing her face writes the `avatar` setting; a refused write keeps the choice on screen and is logged. */
const chooseAvatar = (id: AvatarId) => void useSettings.getState().setAvatar(id).catch(console.warn);

export function Live() {
  const model = useSetupModel({ afterFinish: done });
  const avatar = useSettings((s) => s.avatar);
  // Read once: the act holds its own place while it is drawn, and the store only remembers it.
  const [kept] = useState(() => useReopened.getState().step);
  return createElement(WakingView, {
    model,
    onLater: later,
    kept,
    onStep: keep,
    onVoice: toStudio,
    avatar,
    onAvatar: chooseAvatar,
  });
}
