/**
 * @vitest-environment jsdom
 *
 * The Mind depth, driven — README section 3.1 and 3.5, ADR 0029, 0085, 0087 and 0089.
 *
 * What a static render cannot prove: that each control reaches the Setup action it names with the
 * value it names. Each action is a spy on the model's own `SetupActions`, so "wired" means the
 * right call with the right arguments. The brain path is a draft until committed; the welcome can
 * be shown again; the restart and the retry both reach `restart`.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Path } from "@/depth/model";
import type { SetupActions, SetupModel } from "@/modules/setup/model";

import { PATHS, fixtures } from "./fixtures";
import MindView from "./view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function spies(): { [K in keyof SetupActions]: ReturnType<typeof vi.fn> } & SetupActions {
  return {
    chooseEngine: vi.fn(),
    checkEngines: vi.fn(),
    restart: vi.fn(),
    setTheme: vi.fn(),
    setTypeScale: vi.fn(),
    setMotion: vi.fn(),
    setBrainPath: vi.fn(),
    openPage: vi.fn(),
    checkMic: vi.fn(),
    finish: vi.fn(),
    reopenOnboarding: vi.fn(),
  } as never;
}

function mount(fixture: string, at: Path, go: (to: Path) => void = () => {}, over: Partial<SetupModel> = {}) {
  const actions = spies();
  const model: SetupModel = { ...fixtures[fixture]!, ...over, actions };
  act(() => root.render(<MindView model={model} path={at} go={go} />));
  return actions;
}

const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const radio = (label: string) =>
  [...host.querySelectorAll('[role="radio"]')].find((r) => r.textContent?.trim() === label) as HTMLElement | undefined;
const click = (el: Element | null | undefined) => {
  expect(el, "the control exists").toBeTruthy();
  act(() => (el as HTMLElement).click());
};

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const key = (el: Element, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });

describe("the field", () => {
  it("dives to the instrument that was pressed, and to the depths that own Page and Voice", () => {
    const go = vi.fn();
    mount("typical", PATHS.field!, go);
    const names = [...host.querySelectorAll(".mind__instrument")];
    click(names[0]);
    expect(go).toHaveBeenLastCalledWith({ root: "mind", item: "engine" });
    click(names[4]);
    expect(go).toHaveBeenLastCalledWith({ root: "mind", item: "mic" });
    click(button("Go to Apps"));
    expect(go).toHaveBeenLastCalledWith({ root: "apps" });
    click(button("Go to Voice"));
    expect(go).toHaveBeenLastCalledWith({ root: "voice" });
  });

  it("puts the instrument under attention at the centre", () => {
    mount("typical", PATHS.field!);
    const first = host.querySelector<HTMLElement>(".mind__instrument")!;
    act(() => first.focus());
    expect(host.querySelector(".mind__marquee")?.textContent).toBe("Engine");
    act(() => first.blur());
    expect(host.querySelector(".mind__marquee")?.textContent).toBe("How Athena is set up");
  });

  it("shows the welcome again", () => {
    const a = mount("typical", PATHS.field!);
    click(button("Show the welcome again"));
    expect(a.reopenOnboarding).toHaveBeenCalledOnce();
  });

  it("restarts on the engine that is pending, from the field", () => {
    const a = mount("heavy", PATHS.field!);
    click([...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Restart on")));
    expect(a.restart).toHaveBeenCalledOnce();
  });
});

describe("the engine", () => {
  it("chooses an engine by its id, and checks again", () => {
    const ready = fixtures.typical!.engines.map((e) => ({
      id: e.id,
      label: e.label,
      probe: { id: e.id, state: "found" as const, detail: "1.0.0" },
    }));
    const a = mount("typical", PATHS.engine!, () => {}, { engines: ready });
    click(button("Use Codex"));
    expect(a.chooseEngine).toHaveBeenCalledExactlyOnceWith("codex");
    click(button("Check again"));
    expect(a.checkEngines).toHaveBeenCalledOnce();
  });

  it("cannot choose an engine that is not installed, and says why on the control", () => {
    const a = mount("typical", PATHS.engine!);
    const why = host.querySelector('[title^="Athena could not find"]');
    expect(why).toBeTruthy();
    expect(host.querySelector('button[disabled]')?.textContent?.trim()).toBe("Use Codex");
    expect(a.chooseEngine).not.toHaveBeenCalled();
  });

  it("retries a start that failed", () => {
    const a = mount("typical", PATHS.engine!, () => {}, {
      startFailure: {
        engine: "claude_code",
        title: "Athena could not start on Claude Code.",
        reason: "spawn failed",
        actionLabel: "Try again on Claude Code",
      },
    });
    click(button("Try again on Claude Code"));
    expect(a.restart).toHaveBeenCalledOnce();
  });
});

describe("the look", () => {
  it("sets the theme, the text size and the motion by the value chosen", () => {
    const a = mount("typical", PATHS.look!);
    click(radio("light"));
    expect(a.setTheme).toHaveBeenCalledExactlyOnceWith("light");
    click(radio("compact"));
    expect(a.setTypeScale).toHaveBeenCalledExactlyOnceWith("compact");
    click(radio("calm"));
    expect(a.setMotion).toHaveBeenCalledExactlyOnceWith("calm");
  });
});

describe("the brain", () => {
  const input = () => host.querySelector<HTMLInputElement>('input[aria-label="Brain directory"]')!;

  it("is a draft until committed: typing writes nothing, Enter writes the trimmed path", () => {
    const a = mount("typical", PATHS.brain!);
    type(input(), "  ~/athena/other  ");
    expect(a.setBrainPath).not.toHaveBeenCalled();
    key(input(), "Enter");
    expect(a.setBrainPath).toHaveBeenCalledExactlyOnceWith("~/athena/other");
  });

  it("drops the draft on Escape, and the button commits it too", () => {
    const a = mount("typical", PATHS.brain!);
    type(input(), "~/elsewhere");
    key(input(), "Escape");
    expect(input().value).toBe("~/athena/brain");
    expect(a.setBrainPath).not.toHaveBeenCalled();
    type(input(), "~/elsewhere");
    click(button("Use this"));
    expect(a.setBrainPath).toHaveBeenCalledExactlyOnceWith("~/elsewhere");
  });
});

describe("the microphone", () => {
  it("asks once, when pressed", () => {
    const a = mount("empty", PATHS.mic!);
    click(button("Check the microphone"));
    expect(a.checkMic).toHaveBeenCalledOnce();
  });
});
