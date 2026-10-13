/**
 * The surface's `ModuleEntry` — README section 3.1 and 3.5, ADR 0026 and 0087.
 *
 * The running app's part is `live.tsx`; this adds what only the preview harness and the tests need:
 * the fixtures and the view drawn against one.
 */
import { createElement } from "react";

import type { ModuleEntry } from "@/modules/types";

import { fixtureIds, fixtures } from "./fixtures";
import { Live } from "./live";
import SurfaceView from "./view";

export const entry: ModuleEntry = {
  id: "surface",
  label: "Athena",
  blurb: "The surface: her bell, what she is doing, and the five lights beneath her.",
  fixtureIds,
  preview: (fixture) => createElement(SurfaceView, { model: fixtures[fixture] ?? fixtures.typical! }),
  Live,
};
