/**
 * The Voice depth, as the running app uses it — README section 3.5, ADR 0028, 0087, 0089 and 0090.
 *
 * The one file here that knows a store exists, and it knows only the module's own hook:
 * `useVoiceModel` builds the model (the selector, the connect to the daemon and the module's
 * actions are the module's, shared and not copied). What the scene adds is that the path decides
 * the place, so a studio that was finished is reopened on arrival (once per arrival: finishing it
 * again lands in settings and must not reopen it). The view is a lazy chunk, fetched when the depth
 * is first entered.
 */
import { createElement, lazy, Suspense, useEffect, useRef } from "react";

import type { AvatarId } from "@/avatar/types";
import type { Labeller } from "@/depth/model";
import { useVoiceModel } from "@/modules/voice/index";
import type { LiveScene, SceneProps } from "@/scenes/types";
import { useSettings } from "@/stores/settings";

const VoiceScene = lazy(() => import("./view"));

export const NAMES: Labeller = (path) =>
  path.item === "studio" ? "Studio" : path.item === "settings" ? "Settings" : undefined;

/** Choosing her face writes the `avatar` setting; a refused write keeps the choice on screen and is logged. */
const chooseAvatar = (id: AvatarId) =>
  void useSettings
    .getState()
    .setAvatar(id)
    .catch((e: unknown) => console.warn("[voice] could not store her face:", e));

function Live({ path, go }: SceneProps) {
  const model = useVoiceModel();
  const avatar = useSettings((s) => s.avatar);
  const studio = path.item === "studio";
  // The "studio done" row can be read after the scene is on screen, so the arrival is not judged
  // until the model stops loading. Once reopened for this arrival, the scene leaves it alone.
  const reopened = useRef(false);
  useEffect(() => {
    if (!studio) {
      reopened.current = false;
      return;
    }
    if (reopened.current || model.loading) return;
    reopened.current = true;
    if (model.mode === "settings") model.actions.reopenStudio();
  }, [studio, model.loading, model.mode, model.actions]);
  const waiting = createElement("div", { className: "depth-pending typo-caption", role: "status" }, "Opening…");
  return createElement(Suspense, { fallback: waiting }, createElement(VoiceScene, { model, path, go, avatar, onAvatar: chooseAvatar }));
}

export const live: LiveScene = { root: "voice", Live, useLabeller: () => NAMES };
