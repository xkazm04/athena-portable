// @vitest-environment jsdom
/**
 * The OpenAI key field — README section 3.1, ADR 0028: Enter and the Save button are one act, and
 * neither saves while a save is in flight.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import { fixtures } from "./fixtures";
import { INERT_ACTIONS, type VoiceModel } from "./model";
import { KeyField } from "./pieces";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function field(keyBusy: boolean): { saved: string[]; input: HTMLInputElement } {
  const saved: string[] = [];
  const model: VoiceModel = {
    ...fixtures.typical!,
    keyBusy,
    actions: { ...INERT_ACTIONS, saveKey: (key) => void saved.push(key) },
  };
  act(() => root.render(<KeyField model={model} />));
  const input = host.querySelector<HTMLInputElement>('input[aria-label="OpenAI API key"]')!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    set?.call(input, "sk-second");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return { saved, input };
}

const enter = (input: HTMLInputElement) =>
  act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));

it("Enter does not send a second key while the first is being saved, as the button does not", () => {
  const { saved, input } = field(true);
  enter(input);
  expect(saved).toEqual([]);
  // The draft is kept, so the key is not lost: it saves once the first answer is in.
  expect(input.value).toBe("sk-second");
});

it("Enter saves the trimmed key when nothing is in flight", () => {
  const { saved, input } = field(false);
  enter(input);
  expect(saved).toEqual(["sk-second"]);
  expect(input.value).toBe("");
});
