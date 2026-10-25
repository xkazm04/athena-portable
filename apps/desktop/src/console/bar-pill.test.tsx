// @vitest-environment jsdom
/**
 * Main's bar pill starts Main's spaces store and tells it when she works — README section 3.5,
 * ADR 0225.
 *
 * The console hands the pill `working` from her status mirror; a Project switch asked for while
 * she works is held, and lands the moment she rests, so no turn is filed under two Projects.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetSpacesForTests, useSpaces } from "@/stores/spaces";

import BarPill from "./bar-pill";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TAXES = {
  id: "spc_0123456789ab",
  name: "Taxes",
  brief: "",
  apps: [],
  hue: 200,
  created: "",
  updated: "",
  counts: { episodes: 0, facts: 0, procedurals: 0, chores: 0 },
};

let root: Root;
let host: HTMLElement;
const go = () => {};

beforeEach(() => {
  resetSpacesForTests();
  useSpaces.setState({ spaces: [TAXES], loaded: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetSpacesForTests();
});

describe("the bar pill", () => {
  it("holds a switch while she works and applies it when she rests", () => {
    act(() => root.render(<BarPill go={go} working={true} />));
    act(() => useSpaces.getState().setActive(TAXES.id));
    expect(useSpaces.getState()).toMatchObject({ activeId: "", pending: TAXES.id });
    expect(host.textContent).toContain("switches after this turn");
    act(() => root.render(<BarPill go={go} working={false} />));
    expect(useSpaces.getState()).toMatchObject({ activeId: TAXES.id, pending: null });
    expect(host.textContent).toContain("Taxes");
  });

  it("switches at once while she rests", () => {
    act(() => root.render(<BarPill go={go} working={false} />));
    act(() => useSpaces.getState().setActive(TAXES.id));
    expect(useSpaces.getState()).toMatchObject({ activeId: TAXES.id, pending: null });
  });
});
