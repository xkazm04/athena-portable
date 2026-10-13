/** Tests for the scene registry — README section 3.5, ADR 0087. */
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";

import { ROOTS } from "@/depth/model";
import { entry as surface } from "@/scenes/surface";
import { entry as waking } from "@/scenes/waking";

import { DEPTH_SCENES, PORTED, sceneFor } from "./scenes";

const noGo = () => {};

describe("the surface", () => {
  it("is the first act until the machine has been woken, and the surface after", () => {
    const first = sceneFor({ root: null }, { hydrated: true, onboarded: false, reopened: false, go: noGo });
    const after = sceneFor({ root: null }, { hydrated: true, onboarded: true, reopened: false, go: noGo });
    expect(isValidElement(first) && first.type).toBe(waking.Live);
    expect(isValidElement(after) && after.type).toBe(surface.Live);
  });

  it("shows the first act again when it was reopened, though the machine is set up", () => {
    const again = sceneFor({ root: null }, { hydrated: true, onboarded: true, reopened: true, go: noGo });
    expect(isValidElement(again) && again.type).toBe(waking.Live);
  });

  it("draws nothing before the settings are read, so a returning person never sees the first act flash", () => {
    expect(sceneFor({ root: null }, { hydrated: false, onboarded: false, reopened: false, go: noGo })).toBeNull();
  });
});

describe("the bridge", () => {
  it("draws every root that has no scene of its own with its module's view, so no capability is unreachable", () => {
    for (const root of ROOTS) {
      if (PORTED.has(root)) continue;
      const el = sceneFor({ root }, { hydrated: true, onboarded: true, reopened: false, go: noGo });
      expect(isValidElement(el), root).toBe(true);
      expect((el as { props: Record<string, unknown> }).props["data-bridge"]).toBe(root);
    }
  });
});

describe("the registry", () => {
  it("keeps PORTED equal to the roots that have a scene, each under its own root", () => {
    expect([...PORTED].sort()).toEqual(Object.keys(DEPTH_SCENES).sort());
    for (const [root, scene] of Object.entries(DEPTH_SCENES)) expect(scene!.root).toBe(root);
  });
});
