// @vitest-environment jsdom
/**
 * The value rail's roving focus — README section 3.1, ADR 0087. A radio group has exactly one tab
 * stop, and the arrows walk the options that can take a pick; the WAI-ARIA radio group pattern.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import PillGroup, { type PillOption } from "./PillGroup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(node: ReactNode): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const radios = (h: HTMLElement) => [...h.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const press = (el: Element, key: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });

const THREE: PillOption<"a" | "b" | "c">[] = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
  { value: "c", label: "C" },
];

it("keeps one tab stop when no option carries the value, so the group can still be reached", () => {
  // The Whisper model picker passes "" before a model is chosen (modules/voice/pieces.tsx).
  const h = renderToStaticMarkup(
    <PillGroup<string> ariaLabel="Model" value="" onChange={() => undefined} options={THREE} />,
  );
  expect(h.match(/tabindex="0"/g)).toHaveLength(1);
  expect(h.match(/tabindex="-1"/g)).toHaveLength(2);
  expect(h).not.toContain('aria-checked="true"');
});

it("puts the tab stop on the first option that can be picked when the chosen one cannot", () => {
  const options: PillOption<"a" | "b" | "c">[] = [
    { value: "a", label: "A", disabledReason: "Not installed" },
    { value: "b", label: "B" },
    { value: "c", label: "C" },
  ];
  const h = mount(<PillGroup ariaLabel="Model" value="a" onChange={() => undefined} options={options} />);
  expect(radios(h).map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
});

it("keeps the tab stop on the chosen option", () => {
  const h = mount(<PillGroup ariaLabel="Model" value="b" onChange={() => undefined} options={THREE} />);
  expect(radios(h).map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
});

it("steps over an option that cannot be picked, in both directions, and wraps", () => {
  const options: PillOption<"a" | "b" | "c">[] = [
    { value: "a", label: "A" },
    { value: "b", label: "B", disabledReason: "Not installed" },
    { value: "c", label: "C" },
  ];
  const onChange = vi.fn();
  const h = mount(<PillGroup ariaLabel="Model" value="a" onChange={onChange} options={options} />);
  press(radios(h)[0]!, "ArrowRight");
  expect(onChange).toHaveBeenLastCalledWith("c");
  expect(document.activeElement).toBe(radios(h)[2]);
  press(radios(h)[2]!, "ArrowLeft");
  expect(onChange).toHaveBeenLastCalledWith("a");
  press(radios(h)[0]!, "ArrowLeft");
  expect(onChange).toHaveBeenLastCalledWith("c");
  expect(onChange).not.toHaveBeenCalledWith("b");
});

it("sends Home and End to the first and last option that can be picked", () => {
  const options: PillOption<"a" | "b" | "c">[] = [
    { value: "a", label: "A", disabledReason: "Not installed" },
    { value: "b", label: "B" },
    { value: "c", label: "C", disabledReason: "Not installed" },
  ];
  const onChange = vi.fn();
  const h = mount(<PillGroup ariaLabel="Model" value="b" onChange={onChange} options={options} />);
  press(radios(h)[1]!, "Home");
  press(radios(h)[1]!, "End");
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(onChange).toHaveBeenNthCalledWith(1, "b");
  expect(onChange).toHaveBeenNthCalledWith(2, "b");
});
