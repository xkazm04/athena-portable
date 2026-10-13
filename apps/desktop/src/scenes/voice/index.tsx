/**
 * The Voice depth scene's entry — README section 3.5, ADR 0028, 0087 and 0090.
 *
 * The one file here that knows a store exists, and it knows only the module's own hook:
 * `useVoiceModel` builds the model (the selector, the connect to the daemon and the module's
 * actions are the old view's, shared and not copied). What the scene adds is that the path decides
 * the place, so a studio that was finished is reopened on arrival (once per arrival: finishing it
 * again lands in settings and must not reopen it).
 */
import { createElement, useEffect, useRef } from "react";

import type { Labeller } from "@/depth/model";
import { useVoiceModel } from "@/modules/voice/index";
import type { DepthScene, SceneProps } from "@/scenes/types";

import { fixtureIds, fixtures } from "./fixtures";
import VoiceScene from "./view";

const NAMES: Labeller = (path) =>
  path.item === "studio" ? "Studio" : path.item === "settings" ? "Settings" : undefined;

function Live({ path, go }: SceneProps) {
  const model = useVoiceModel();
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
  return createElement(VoiceScene, { model, path, go });
}

export const entry: DepthScene = {
  root: "voice",
  fixtureIds,
  Live,
  preview: (fixture, { path, go }) =>
    createElement(VoiceScene, { model: fixtures[fixture] ?? fixtures.typical!, path, go }),
  useLabeller: () => NAMES,
  previewLabeller: () => NAMES,
};
