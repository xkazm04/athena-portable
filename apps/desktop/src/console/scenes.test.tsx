/** Tests for the scene registry — README section 3.5, ADR 0087. */
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ROOTS } from "@/depth/model";
import { Live as Surface } from "@/scenes/surface/live";
import { Live as Waking } from "@/scenes/waking/live";

import { DEPTH_SCENES } from "@/scenes/registry";

import { LIVE_SCENES, sceneFor } from "./scenes";

const noGo = () => {};

describe("the surface", () => {
  it("is the first act until the machine has been woken, and the surface after", () => {
    const first = sceneFor({ root: null }, { hydrated: true, onboarded: false, reopened: false, go: noGo });
    const after = sceneFor({ root: null }, { hydrated: true, onboarded: true, reopened: false, go: noGo });
    expect(isValidElement(first) && first.type).toBe(Waking);
    expect(isValidElement(after) && after.type).toBe(Surface);
  });

  it("shows the first act again when it was reopened, though the machine is set up", () => {
    const again = sceneFor({ root: null }, { hydrated: true, onboarded: true, reopened: true, go: noGo });
    expect(isValidElement(again) && again.type).toBe(Waking);
  });

  it("draws nothing before the settings are read, so a returning person never sees the first act flash", () => {
    expect(sceneFor({ root: null }, { hydrated: false, onboarded: false, reopened: false, go: noGo })).toBeNull();
  });
});

describe("the depths", () => {
  it("has a scene for every root, each registered under its own root, live and in full", () => {
    for (const root of ROOTS) {
      expect(LIVE_SCENES[root], root).toBeDefined();
      expect(LIVE_SCENES[root].root).toBe(root);
      expect(DEPTH_SCENES[root].root).toBe(root);
      expect(DEPTH_SCENES[root].Live, "the full scene carries the same live part").toBe(LIVE_SCENES[root].Live);
    }
    expect(Object.keys(LIVE_SCENES).sort()).toEqual([...ROOTS].sort());
  });

  it("draws a root with its own scene, told where it is and how to move", () => {
    for (const root of ROOTS) {
      const el = sceneFor({ root }, { hydrated: true, onboarded: true, reopened: false, go: noGo });
      expect(isValidElement(el) && el.type, root).toBe(LIVE_SCENES[root].Live);
      expect((el as { props: { path: unknown } }).props.path).toEqual({ root });
    }
  });

  it("ships the four fixtures every scene is checked against, and renders each at its root", () => {
    for (const root of ROOTS) {
      const scene = DEPTH_SCENES[root];
      for (const id of ["empty", "typical", "heavy", "degraded"]) {
        expect(scene.fixtureIds, `${root} lacks ${id}`).toContain(id);
      }
      for (const id of scene.fixtureIds) {
        const html = renderToStaticMarkup(scene.preview(id, { path: { root }, go: noGo }));
        expect(html.length, `${root}/${id} rendered nothing`).toBeGreaterThan(0);
      }
    }
  }, 30_000);
});
