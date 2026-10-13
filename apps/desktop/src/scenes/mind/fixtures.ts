/**
 * The Mind depth's fixtures — README section 3.5. The Setup module's own view-models, named for the
 * depth, with nothing re-derived: what the module would say is what this says.
 */
import type { Path } from "@/depth/model";
import { fixtures as setup } from "@/modules/setup/fixtures";
import type { SetupModel } from "@/modules/setup/model";
import type { FixtureId } from "@/modules/types";

export const fixtures: Record<string, SetupModel> = {
  empty: setup.empty!,
  typical: setup.typical!,
  heavy: setup.heavy!,
  degraded: setup.degraded!,
  "engine-missing": setup.notFound!,
  checking: setup.checking!,
  calm: { ...setup.typical!, motion: "calm" },
};

export const fixtureIds: readonly FixtureId[] = Object.keys(fixtures);

/** The place each story is about. */
export const PATHS: Record<string, Path> = {
  field: { root: "mind" },
  engine: { root: "mind", item: "engine" },
  brain: { root: "mind", item: "brain" },
  look: { root: "mind", item: "look" },
  data: { root: "mind", item: "data" },
  mic: { root: "mind", item: "mic" },
  missing: { root: "mind", item: "nowhere" },
};
