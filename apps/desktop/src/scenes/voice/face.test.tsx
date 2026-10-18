// @vitest-environment jsdom
/**
 * Her face in the Voice depth (the ADR on Athena's face): the Avatar replaces the Bell exactly when a
 * face is chosen, at the Bell's size, on the field and on the studio's rail; the studio's face follows
 * the preview while one plays and her live face otherwise; settings carry the picker.
 *
 * The Avatar and the face sources are stood in for, so the test sees which source each face was
 * handed: the real ones are other packages' and are tested there.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AvatarId } from "@/avatar/types";
import type { Path } from "@/depth/model";

const sources = vi.hoisted(() => ({
  main: { subscribe: () => () => {}, tag: "main" },
  preview: { subscribe: () => () => {}, tag: "preview" },
  players: [] as { level(): number; playing(): boolean }[],
}));

vi.mock("@/lib/face", () => ({
  mainFaceSource: () => sources.main,
  previewFaceSource: (player: { level(): number; playing(): boolean }) => {
    sources.players.push(player);
    return sources.preview;
  },
}));

vi.mock("@/avatar/Avatar", () => ({
  Avatar: ({ avatar, size, source }: { avatar: string; size: number; source: { tag: string } }) => (
    <div data-avatar={avatar} data-size={size} data-source={source.tag} />
  ),
}));

const { fixtures } = await import("./fixtures");
const { default: VoiceScene, SETTINGS, STUDIO } = await import("./view");

const ROOT: Path = { root: "voice" };
const go = () => {};
const draw = (fixture: string, path: Path, avatar?: AvatarId) =>
  renderToStaticMarkup(<VoiceScene model={fixtures[fixture]!} path={path} go={go} avatar={avatar} />);

describe("the Avatar replaces the Bell exactly when a face is chosen", () => {
  it("on the field, at the Bell's 400, fed by her live face", () => {
    const halo = draw("typical", ROOT);
    expect(halo).toContain('class="bell"');
    expect(halo).not.toContain("data-avatar");
    expect(draw("typical", ROOT, "halo")).toBe(halo);

    const owl = draw("typical", ROOT, "b04-owl");
    expect(owl).not.toContain('class="bell"');
    expect(owl).toContain('data-avatar="b04-owl"');
    expect(owl).toContain('data-size="400"');
    expect(owl).toContain('data-source="main"');
    expect(owl.match(/data-avatar=/g)).toHaveLength(1);
  });

  it("on the studio's rail, at the Bell's 104, and nowhere else in the studio", () => {
    const halo = draw("typical", STUDIO);
    expect(halo).not.toContain("data-avatar");
    expect(halo).toContain('class="bell"');
    const origami = draw("typical", STUDIO, "d08-origami");
    expect(origami).toContain('data-avatar="d08-origami"');
    expect(origami).toContain('data-size="104"');
    expect(origami.match(/data-avatar=/g)).toHaveLength(1);
    expect(origami).not.toContain('class="bell"');
  });

  it("settings draw no figure, only the picker", () => {
    const out = draw("typical", SETTINGS, "b04-owl");
    expect(out).not.toContain("data-avatar");
    expect(out).toContain('aria-label="How she appears"');
    for (const name of ["Owl of light", "Origami", "Just the halo"]) expect(out).toContain(name);
  });
});

describe("the studio's face follows the preview while one plays", () => {
  it("is her live face at rest and the preview's while her voice plays, reading the model's own meters", () => {
    expect(draw("typical", STUDIO, "b04-owl")).toContain('data-source="main"');
    sources.players.length = 0;
    const bins = new Uint8Array(4);
    const meters = { ...fixtures.speaking!.meters, level: () => 0.42, spectrum: () => bins };
    const out = renderToStaticMarkup(
      <VoiceScene model={{ ...fixtures.speaking!, meters }} path={STUDIO} go={go} avatar="b04-owl" />,
    );
    expect(out).toContain('data-source="preview"');
    const player = sources.players.at(-1)!;
    expect(player.playing()).toBe(true);
    expect(player.level()).toBe(0.42);
    // a player with nothing to give is not playing
    sources.players.length = 0;
    draw("speaking", STUDIO, "b04-owl");
    expect(sources.players.at(-1)!.playing()).toBe(false);
  });
});

describe("the picker in settings", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows the stored choice and hands a new one to the setting", () => {
    const onAvatar = vi.fn();
    act(() =>
      root.render(
        (<VoiceScene model={fixtures.typical!} path={SETTINGS} go={go} avatar="d08-origami" onAvatar={onAvatar} />) as ReactElement,
      ),
    );
    const group = host.querySelector('[role="radiogroup"][aria-label="How she appears"]')!;
    const radios = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map((r) => r.textContent)).toEqual(["Owl of light", "Origami", "Just the halo"]);
    expect(radios.find((r) => r.getAttribute("aria-checked") === "true")?.textContent).toBe("Origami");
    act(() => void radios[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onAvatar).toHaveBeenCalledWith("b04-owl");
  });
});
