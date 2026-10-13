/**
 * The first act's fixtures — README section 3.5. The Setup module's own view-models, picked and
 * named for the act: nothing is re-derived here, so what the letter would say is what this says.
 */
import { fixtures as setup } from "@/modules/setup/fixtures";
import type { SetupModel } from "@/modules/setup/model";

const onboarding = setup.onboarding!;

export const fixtures: Record<string, SetupModel> = {
  empty: setup.empty!,
  checking: setup.checking!,
  "engine-missing": setup.notFound!,
  degraded: setup.degraded!,
  "no-page": { ...onboarding, tabs: [] },
  ready: onboarding,
  "no-mic": { ...onboarding, mic: "unsupported", micDetail: "none on this machine" },
};

/** Which step each fixture opens on: the one its story is about. */
export const INITIAL_STEPS: Record<string, 0 | 1 | 2> = {
  "engine-missing": 0,
  "no-page": 1,
  ready: 2,
  "no-mic": 2,
};

export const fixtureIds = Object.keys(fixtures);
