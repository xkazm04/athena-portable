// @vitest-environment jsdom
/**
 * The first act as the running app draws it, on the reshow path — ADR 0094 (the act is reshown by a
 * flag, no stored row changes) and the ADR on Athena's face (the Face step writes `avatar`).
 *
 * A person who woke her long ago and chose a face opens the act again from Mind: the Face step shows
 * the face they chose, a new choice is the setting at once, and choosing does not close the act.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// The face cards are offered only where WebGL2 can draw; this suite is about the act, not the machine.
vi.mock("@/avatar/support", () => ({ canDrawFace: () => true }));

import type { SetupModel } from "@/modules/setup/model";

import { fixtures } from "./fixtures";

const current = vi.hoisted(() => ({ model: null as SetupModel | null }));
vi.mock("@/modules/setup/index", () => ({ useSetupModel: () => current.model ?? fixtures.ready }));

const { Live } = await import("./live");
const { useReopened } = await import("./reopen");
const { useSettings } = await import("@/stores/settings");
const { useDepth } = await import("@/depth/store");
const { INITIAL } = await import("@/depth/model");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  current.model = null;
  useReopened.setState({ on: false, step: null });
  useDepth.setState({ ...INITIAL });
  // No shell here, so the row write rejects; the choice is still shown and the refusal is logged.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

test("a reshown act shows the face already chosen, and a new choice is stored without closing the act", async () => {
  useSettings.setState({ hydrated: true, onboarded: true, avatar: "b04-owl" });
  useReopened.getState().set(true);
  act(() => root.render(<Live />));

  const face = [...host.querySelectorAll(".waking__step")].find((b) => b.textContent?.includes("Face"))!;
  click(face);
  await act(async () => {
    await import("./face-step");
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(host.querySelector('[data-avatar-choice="b04-owl"]')!.getAttribute("aria-checked")).toBe("true");

  click(host.querySelector('[data-avatar-choice="d08-origami"]')!);
  await act(async () => {});
  expect(useSettings.getState().avatar).toBe("d08-origami");
  expect(host.querySelector('[data-avatar-choice="d08-origami"]')!.getAttribute("aria-checked")).toBe("true");
  expect(useReopened.getState().on).toBe(true);
  expect(useSettings.getState().onboarded).toBe(true);
});

const ask = () => host.querySelector("#waking-ask")!.textContent;
const stepNamed = (name: string) =>
  [...host.querySelectorAll(".waking__step")].find((b) => b.textContent?.includes(name))!;
const remount = () => {
  act(() => root.unmount());
  root = createRoot(host);
  act(() => root.render(<Live />));
};

test("the act opens on the step still owed, and keeps the step the person was on across Later", () => {
  useSettings.setState({ hydrated: true, onboarded: false, avatar: "halo" });
  current.model = fixtures["no-page"]!;
  act(() => root.render(<Live />));
  expect(ask()).toBe("Where will she work?");

  click(stepNamed("Voice"));
  expect(ask()).toBe("Do you want to talk to her?");
  click([...host.querySelectorAll("button")].find((b) => b.textContent === "Later")!);
  expect(useDepth.getState().path).toEqual({ root: "apps" });

  remount();
  expect(ask()).toBe("Do you want to talk to her?");
});

test("the Voice step's door to the studio keeps the step and goes to the voice studio; coming back lands on Voice", () => {
  useSettings.setState({ hydrated: true, onboarded: false, avatar: "halo" });
  current.model = { ...fixtures.ready!, voiceAvailable: false };
  act(() => root.render(<Live />));
  click(stepNamed("Voice"));
  useReopened.setState({ step: null }); // the door, not the step click, must keep the place
  click([...host.querySelectorAll("button")].find((b) => b.textContent === "Set up her voice in the studio")!);
  expect(useReopened.getState().step).toBe(2);
  expect(useDepth.getState().path).toEqual({ root: "voice", item: "studio" });

  remount();
  expect(ask()).toBe("Do you want to talk to her?");
});
