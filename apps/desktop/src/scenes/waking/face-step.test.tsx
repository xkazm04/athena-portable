// @vitest-environment jsdom
/**
 * The first act's Face step (ADR 0120): a face card speaks the sample line while it has focus or the
 * pointer, so the person chooses her form seeing it speak; a computer that cannot draw a face is
 * offered only the halo, and told why.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AvatarId } from "@/avatar/types";

const stage = vi.hoisted(() => ({
  drawable: true,
  play: [] as string[],
  stops: 0,
}));

vi.mock("@/avatar/support", () => ({ canDrawFace: () => stage.drawable }));

vi.mock("@/avatar/audition", () => {
  const sources = new Map<string, { subscribe: () => () => void; tag: string }>();
  return {
    audition: {
      source: (form: string) => {
        if (!sources.has(form)) sources.set(form, { subscribe: () => () => {}, tag: `audition:${form}` });
        return sources.get(form)!;
      },
      play: (form: string) => void stage.play.push(form),
      stop: () => void stage.stops++,
    },
  };
});

vi.mock("@/avatar/Avatar", () => ({
  Avatar: ({ avatar, source }: { avatar: string; source: { tag?: string } }) => (
    <div data-avatar={avatar} data-source={source.tag ?? "other"} />
  ),
}));

const { default: FaceStep } = await import("./face-step");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  stage.drawable = true;
  stage.play = [];
  stage.stops = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const mount = (avatar: AvatarId) => {
  const onAvatar = vi.fn();
  act(() => root.render(<FaceStep avatar={avatar} onAvatar={onAvatar} />));
  return onAvatar;
};
const card = (id: AvatarId) => host.querySelector<HTMLButtonElement>(`[data-avatar-choice="${id}"]`)!;
const key = (k: string) =>
  act(() => void host.querySelector('[role="radiogroup"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));

describe("a computer that cannot draw her face", () => {
  it("disables both face cards, the arrows skip them, the halo stays chosen and the step says why", () => {
    stage.drawable = false;
    const onAvatar = mount("halo");
    expect(card("b04-owl").getAttribute("aria-disabled")).toBe("true");
    expect(card("d08-origami").getAttribute("aria-disabled")).toBe("true");
    expect(card("halo").getAttribute("aria-disabled")).toBeNull();
    expect(card("halo").getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).toMatch(/this computer cannot draw her face/i);
    act(() => card("halo").focus());
    key("ArrowRight");
    key("ArrowLeft");
    expect(onAvatar).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(card("halo"));
    act(() => void card("d08-origami").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => void card("b04-owl").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onAvatar).not.toHaveBeenCalled();
    expect(card("halo").getAttribute("aria-checked")).toBe("true");
    // a disabled face does not audition either
    act(() => card("d08-origami").dispatchEvent(new FocusEvent("focus")));
    expect(stage.play).toEqual([]);
  });

  it("keeps the halo chosen even when a face was stored", () => {
    stage.drawable = false;
    mount("b04-owl");
    expect(card("halo").getAttribute("aria-checked")).toBe("true");
    expect(card("halo").getAttribute("tabindex")).toBe("0");
    expect(card("b04-owl").getAttribute("aria-checked")).toBe("false");
  });
});

describe("a face card speaks while it has focus or the pointer", () => {
  it("hands each face card's Avatar the audition source; focus plays that form and blur stops it", () => {
    mount("b04-owl");
    expect(card("d08-origami").querySelector("[data-avatar]")!.getAttribute("data-source")).toBe("audition:d08-origami");
    expect(card("b04-owl").querySelector("[data-avatar]")!.getAttribute("data-source")).toBe("audition:b04-owl");
    act(() => card("d08-origami").focus());
    expect(stage.play).toEqual(["d08-origami"]);
    const before = stage.stops;
    act(() => card("d08-origami").blur());
    expect(stage.stops).toBe(before + 1);
  });

  it("pointer-enter plays, pointer-leave stops, and the halo card never auditions", () => {
    mount("halo");
    act(() => void card("b04-owl").dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })));
    expect(stage.play).toEqual(["b04-owl"]);
    const before = stage.stops;
    act(() => void card("b04-owl").dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
    expect(stage.stops).toBe(before + 1);
    act(() => card("halo").focus());
    expect(stage.play).toEqual(["b04-owl"]);
  });

  it("leaving the step stops the audition", () => {
    mount("halo");
    act(() => card("b04-owl").focus());
    const before = stage.stops;
    act(() => root.render(<div />));
    expect(stage.stops).toBeGreaterThan(before);
  });
});
