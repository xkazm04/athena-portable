// @vitest-environment jsdom
/**
 * The OpenAI key field — README section 3.1, ADR 0028: Enter and the Save button are one act, and
 * neither saves while a save is in flight.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fixtures } from "./fixtures";
import { INERT_ACTIONS, type VoiceModel } from "./model";
import { LIVE_MIC, setMicSeam } from "./mic";
import { KeyField, MicPicker } from "./pieces";

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

describe("the microphone picker", () => {
  const picker = async (stored: string | null) => {
    const writes: Array<string | null> = [];
    setMicSeam({
      ...LIVE_MIC,
      read: async () => stored,
      write: async (id) => void writes.push(id),
      list: async () => [
        { id: "a", label: "USB Headset" },
        { id: "b", label: "Realtek Array" },
      ],
    });
    await act(async () => root.render(<MicPicker />));
    return writes;
  };
  const option = (name: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent?.includes(name))!;

  it("lists the system default and every input, and one tap chooses and stores one", async () => {
    const writes = await picker(null);
    expect(option("System default").getAttribute("aria-checked")).toBe("true");
    await act(async () => option("Realtek Array").click());
    expect(option("Realtek Array").getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).toContain("Every take and every press opens Realtek Array.");
    await act(async () => option("System default").click());
    expect(writes).toEqual(["b", null]);
  });

  it("an unplugged choice reads as the default and says why", async () => {
    await picker("z");
    expect(option("System default").getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).toContain("The microphone you chose is not connected; using the system default.");
  });
});
