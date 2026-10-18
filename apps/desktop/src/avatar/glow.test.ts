/**
 * Her face on any page ground - ADR 0120: a transparent, premultiplied canvas, and a ground line of
 * light the lower figure dissolves into.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CONTEXT_ATTRIBUTES, createGlowRenderer, groundLine, groundMask, LINE_CORE, LINE_GLOW } from "./glow";
import { checkSpec, type LoadedForm } from "./layers";

const here = path.dirname(fileURLToPath(import.meta.url));
const form = (id: string) =>
  checkSpec(JSON.parse(readFileSync(path.resolve(here, `../../public/avatars/${id}/layers.json`), "utf8")));

describe("the canvas is transparent", () => {
  it("asks for an alpha, premultiplied WebGL2 context", async () => {
    const asked: [string, WebGLContextAttributes | undefined][] = [];
    const canvas = {
      getContext: (kind: string, attrs?: WebGLContextAttributes) => {
        asked.push([kind, attrs]);
        return null;
      },
    } as unknown as HTMLCanvasElement;
    const loaded: LoadedForm = { spec: form("b04-owl"), images: new Map() };
    await expect(createGlowRenderer(canvas, loaded)).rejects.toThrow(/WebGL2 unavailable/);
    expect(asked).toEqual([["webgl2", CONTEXT_ATTRIBUTES]]);
    expect(CONTEXT_ATTRIBUTES.alpha).toBe(true);
    expect(CONTEXT_ATTRIBUTES.premultipliedAlpha).toBe(true);
  });
});

describe("her ground line", () => {
  const forms = ["b04-owl", "d08-origami"].map((id) => [id, form(id)] as const);

  it("each form names a line inside the art, below her face and above the bottom edge", () => {
    for (const [id, spec] of forms) {
      const g = spec.rig.ground;
      expect(g, id).toBeDefined();
      if (!g) continue;
      expect(g.y).toBeGreaterThan(spec.rig.head.center[1] + spec.rig.head.radius[1]);
      expect(g.y + 60).toBeLessThan(spec.height);
      const line = groundLine(g, spec.width, { t: 0, activity: 0, voice: 0 });
      // slightly wider than the base, and still inside the canvas
      expect(line.box[2] / 2).toBeGreaterThan(g.half_width);
      expect(line.box[0]).toBeGreaterThanOrEqual(0);
      expect(line.box[0] + line.box[2]).toBeLessThanOrEqual(spec.width);
      expect(line.box[1]).toBeLessThan(g.y);
      expect(line.box[1] + line.box[3]).toBeGreaterThan(g.y);
    }
  });

  it("the figure dissolves into it: whole above the fade, gone at and below the line, earlier at its ends", () => {
    const g = { y: 880, half_width: 300, fade: 280, curve: 160 };
    expect(groundMask(g, 1024, 512, 500)).toBe(1);
    expect(groundMask(g, 1024, 512, 880 + 0.08 * 280)).toBeCloseTo(0, 5);
    expect(groundMask(g, 1024, 512, 1000)).toBe(0);
    const mid = groundMask(g, 1024, 512, 760);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(groundMask(g, 1024, 512 + 300, 760)).toBeLessThan(mid);
  });

  it("breathes with her idle breath, brightens with her voice, and is still at rest", () => {
    const g = { y: 880, half_width: 300, fade: 280, curve: 160 };
    const rest = (t: number) => groundLine(g, 1024, { t, activity: 0, voice: 0 }).gain;
    expect(rest(0)).toBe(rest(1.7));
    const breathing = [0, 1.3, 2.6, 3.9].map((t) => groundLine(g, 1024, { t, activity: 1, voice: 0 }).gain);
    expect(Math.max(...breathing) - Math.min(...breathing)).toBeGreaterThan(0.05);
    expect(groundLine(g, 1024, { t: 0, activity: 0, voice: 0.8 }).gain).toBeGreaterThan(rest(0) * 1.2);
  });

  it("is house cyan", () => {
    expect(LINE_CORE.map((c) => Math.round(c * 255))).toEqual([0x22, 0xd3, 0xee]);
    expect(LINE_GLOW.map((c) => Math.round(c * 255))).toEqual([0x06, 0xb6, 0xd4]);
  });
});
