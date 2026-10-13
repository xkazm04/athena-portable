/** Tests for the bell's view — README section 3.1, ADR 0087 and 0089. */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Bell, { rootX, type Reach } from "./Bell";
import { POSES } from "./pose";

const reach: Reach[] = [
  { id: "a", lit: true },
  { id: "b", lit: false },
  { id: "c", lit: true },
];

describe("the bell", () => {
  it("draws one tendril for each thing she may touch, lit when it is on", () => {
    const html = renderToStaticMarkup(<Bell pose="resting" reach={reach} />);
    expect(html.match(/class="bell__tendril"/g)).toHaveLength(3);
    expect(html.match(/data-lit="true"/g)).toHaveLength(2);
    expect(html.match(/data-lit="false"/g)).toHaveLength(1);
  });

  it("draws no tendrils for no reach, which is the dock's small bell", () => {
    expect(renderToStaticMarkup(<Bell pose="resting" reach={[]} />)).not.toContain('class="bell__tendril"');
  });

  it("wears its pose, and names her with it only when asked to", () => {
    for (const pose of POSES) {
      expect(renderToStaticMarkup(<Bell pose={pose} reach={[]} />)).toContain(`data-pose="${pose}"`);
    }
    const named = renderToStaticMarkup(<Bell pose="asking" reach={[]} label="Athena" />);
    expect(named).toContain('aria-label="Athena, waiting on you"');
    expect(renderToStaticMarkup(<Bell pose="asking" reach={[]} />)).toContain('aria-hidden="true"');
  });

  it("clamps where the person is looking", () => {
    expect(renderToStaticMarkup(<Bell pose="resting" reach={[]} lean={9} />)).toContain("--lean:1");
    expect(renderToStaticMarkup(<Bell pose="resting" reach={[]} lean={-9} />)).toContain("--lean:-1");
  });

  it("gives two bells on one page gradients of their own, or the first pose's colour wins", () => {
    const html = renderToStaticMarkup(
      <>
        <Bell pose="resting" reach={[]} />
        <Bell pose="asking" reach={[]} />
      </>,
    );
    const ids = [...html.matchAll(/<(?:radial|linear)Gradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it("roots its tendrils in order across the skirt", () => {
    const xs = [0, 1, 2, 3].map((i) => rootX(i, 4));
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(rootX(0, 1)).toBe(200);
  });
});

describe("the animation rule (ADR 0089)", () => {
  const source = readFileSync(new URL("./Bell.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./bell.css", import.meta.url), "utf8");

  it("runs no script per frame: no frame loop, no timer", () => {
    expect(source).not.toMatch(/requestAnimationFrame|frames\(\)|setInterval|setTimeout/);
  });

  it("animates transform, rotate and opacity only, and never a filter", () => {
    expect(css).not.toMatch(/filter\s*:/);
    const keyframes = css.match(/@keyframes[^{]+\{([\s\S]*?\n\})/g) ?? [];
    expect(keyframes.length).toBeGreaterThan(0);
    for (const k of keyframes) {
      const props = [...k.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(["transform", "opacity"], `${p} in ${k.slice(0, 30)}`).toContain(p);
    }
  });

  it("eases a tendril lighting up: a lit overlay and its dot fade on opacity, on the settle clock", () => {
    const html = renderToStaticMarkup(<Bell pose="resting" reach={reach} />);
    expect(html.match(/class="bell__lit"/g)).toHaveLength(3);
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(bare).toMatch(/\.bell__lit\s*\{[^}]*transition:\s*opacity var\(--dur-settle\) var\(--ease-depth\)/);
    expect(bare).toMatch(/\.bell__tendril circle\s*\{[^}]*transition:\s*opacity var\(--dur-settle\) var\(--ease-depth\)/);
    expect(bare).toMatch(/\.bell__tendril\s*\{[^}]*transition:\s*rotate var\(--dur-settle\) var\(--ease-depth\)/);
    expect(bare).not.toMatch(/data-lit="true"\]\s*\{[^}]*stroke-/);
    expect(bare).not.toMatch(/transition:[^;]*\b\d+ms/);
  });

  it("turns every animation off under Calm", () => {
    expect(css).toMatch(/\[data-motion="calm"\] \.bell[\s\S]*animation: none/);
  });
});
