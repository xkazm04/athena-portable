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

import { fixtures } from "./fixtures";

vi.mock("@/modules/setup/index", () => ({ useSetupModel: () => fixtures.ready }));

const { Live } = await import("./live");
const { useReopened } = await import("./reopen");
const { useSettings } = await import("@/stores/settings");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
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
