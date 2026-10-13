/** Tests for the stage's view — README section 3.1 and 3.5, ADR 0087 and 0088. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { INITIAL, reduce, type DepthState, type Path } from "@/depth/model";

import Stage, { escapeRises, type StageProps } from "./Stage";

const at = (path: Path): DepthState => ({ ...INITIAL, path });

function render(path: Path, over: Partial<StageProps> = {}): string {
  return renderToStaticMarkup(
    <Stage
      state={at(path)}
      calm
      renderScene={(p) => <p data-scene={JSON.stringify(p)}>scene</p>}
      presence={{ pose: "resting", text: "resting", waiting: 0 }}
      onGo={vi.fn()}
      onRise={vi.fn()}
      onSurface={vi.fn()}
      onSettle={vi.fn()}
      {...over}
    />,
  );
}

describe("the surface", () => {
  const html = render({ root: null });
  it("has no Rise button, no breadcrumb below Athena and no dock", () => {
    expect(html).not.toContain("stage__rise");
    expect(html).not.toContain("stage__crumb ");
    expect(html).not.toContain("stage__dock");
  });
  it("draws the water, the gauge and the scene", () => {
    expect(html).toContain("backdrop");
    expect(html).toContain("stage__gauge");
    expect(html).toContain('data-scene="{&quot;root&quot;:null}"');
  });
});

describe("a depth", () => {
  const path: Path = { root: "apps", item: "host-1" };
  const html = render(path);
  it("says where Rise lands, shows the way down in the breadcrumb and marks where you are", () => {
    expect(html).toContain("Rise to <b>Apps</b>");
    expect(html).toContain(">Apps<");
    expect(html).toMatch(/aria-current="location">host-1</);
  });
  it("keeps Athena one click away with her state, and every root reachable", () => {
    expect(html).toContain("stage__dock");
    expect(html).toContain("resting");
    for (const label of ["Apps", "Chores", "Accounts", "Voice", "Mind"]) expect(html).toContain(`>${label}</button>`);
    expect(html).toMatch(/aria-current="true">Apps</);
  });
  it("says how many cards wait and takes its tone from her", () => {
    const waiting = render(path, { presence: { pose: "asking", text: "1 waiting", waiting: 1 } });
    expect(waiting).toContain("1 waiting");
    expect(waiting).toContain('data-pose="asking"');
    expect(waiting).toContain('class="bell" data-pose="asking"');
  });
  it("records the depth for the gauge and the water", () => {
    expect(html).toContain('data-depth="2"');
    expect(render({ root: "apps" })).toContain('data-depth="1"');
  });
});

describe("the page shape (ADR 0088)", () => {
  const html = render({ root: "apps", item: "host-1", sub: { kind: "page" } });
  it("holds the strip in a band the height layout.rs reserves, only in this shape", () => {
    const strip = <b>strip</b>;
    const withBand = render({ root: "apps", item: "host-1", sub: { kind: "page" } }, { band: strip });
    expect(withBand).toContain('class="stage__band"');
    expect(withBand).toContain("<b>strip</b>");
    expect(render({ root: "apps", item: "host-1" }, { band: strip })).not.toContain("stage__band");
  });
  it("is only the band: Rise and the breadcrumb, no water, no scenes, no dock", () => {
    expect(html).toContain('data-shape="page"');
    expect(html).toContain("Rise to <b>host-1</b>");
    expect(html).not.toContain("backdrop");
    expect(html).not.toContain("stage__scenes");
    expect(html).not.toContain("stage__dock");
    expect(html).not.toContain("stage__gauge");
  });
});

describe("a stage mounted after a move", () => {
  it("draws one layer and records the move for the water and the gauge", () => {
    const from = at({ root: null });
    const moved = reduce(from, { type: "go", to: { root: "apps" } });
    // Two layers on screen at once is `layers.test.ts`'s subject; a stage always starts from the
    // state it is given, at rest.
    const html = renderToStaticMarkup(
      <Stage
        state={moved}
        calm={false}
        renderScene={() => <p>x</p>}
        presence={{ pose: "resting", text: "resting", waiting: 0 }}
        onGo={vi.fn()}
        onRise={vi.fn()}
        onSurface={vi.fn()}
        onSettle={vi.fn()}
      />,
    );
    expect(html).toContain('data-move="down"');
    expect(html.match(/class="stage__layer"/g)).toHaveLength(1);
  });
});

describe("Escape", () => {
  const press = { key: "Escape", defaultPrevented: false, targetIsTyping: false };
  it("rises", () => {
    expect(escapeRises(press)).toBe(true);
  });
  it("leaves a text field its own Escape, and respects a key someone already took", () => {
    expect(escapeRises({ ...press, targetIsTyping: true })).toBe(false);
    expect(escapeRises({ ...press, defaultPrevented: true })).toBe(false);
  });
  it("ignores every other key", () => {
    expect(escapeRises({ ...press, key: "Enter" })).toBe(false);
  });
});
