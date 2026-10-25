/** Tests for where the first act opens — README section 3.5 and the ADR on its frontier. */
import { afterEach, describe, expect, it } from "vitest";

import { fixtures as setup } from "@/modules/setup/fixtures";
import type { SetupModel } from "@/modules/setup/model";

import { fixtures } from "./fixtures";
import { useReopened } from "./reopen";
import { openingStep } from "./steps";

const granted = (m: SetupModel): SetupModel => ({ ...m, mic: "granted", micDetail: "" });

describe("the act opens on the step she still needs", () => {
  it("an engine done and no page opens on Reach, with the microphone unasked and no voice", () => {
    const m: SetupModel = { ...fixtures["no-page"]!, mic: "unknown", voiceAvailable: false };
    expect(openingStep(m, "halo", null)).toBe(1);
  });
  it("a missing engine opens on Mind", () => {
    expect(openingStep(fixtures["engine-missing"]!, "halo", null)).toBe(0);
  });
  it("an engine and a page done, but no microphone and no voice, opens on Voice", () => {
    const m: SetupModel = { ...setup.onboarding!, mic: "unknown", voiceAvailable: false };
    expect(openingStep(m, "halo", null)).toBe(2);
  });
  it("everything lit opens on Face, where Wake her is", () => {
    expect(openingStep(granted(fixtures.ready!), "b04-owl", null)).toBe(3);
  });
});

describe("a kept position wins over the frontier", () => {
  afterEach(() => useReopened.setState({ on: false, step: null }));

  it("a kept step is where the act opens, even when an earlier step is still owed", () => {
    expect(openingStep(fixtures["engine-missing"]!, "halo", 2)).toBe(2);
  });
  it("showing the welcome again from Mind clears the kept position to Mind", () => {
    useReopened.getState().keep(2);
    expect(useReopened.getState().step).toBe(2);
    useReopened.getState().set(true);
    expect(useReopened.getState().step).toBe(0);
    expect(openingStep(granted(fixtures.ready!), "b04-owl", useReopened.getState().step)).toBe(0);
  });
});
