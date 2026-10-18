// @vitest-environment jsdom
/**
 * `<Avatar>` without WebGL2 - ADR 0120: it draws nothing (an empty, transparent box), says why once
 * in the console, and leaves the surface's fallback to the surface.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Avatar } from "./Avatar";
import { RESTING, type FaceSource } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const source: FaceSource = {
  subscribe(fn) {
    fn(RESTING);
    return () => {};
  },
};

async function settle() {
  // the runtime arrives by a dynamic import; let it land and run
  for (let i = 0; i < 20; i++) await act(async () => new Promise((r) => setTimeout(r, 5)));
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("<Avatar> where WebGL2 is not there", () => {
  it("renders an empty box with a hidden canvas and warns once for any number of faces", async () => {
    expect(typeof (globalThis as { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext).toBe("undefined");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <>
          <Avatar avatar="b04-owl" size={240} source={source} />
          <Avatar avatar="d08-origami" size={240} source={source} />
        </>,
      );
    });
    await settle();
    const boxes = [...host.querySelectorAll("[data-avatar]")] as HTMLElement[];
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      expect(box.getAttribute("data-face")).toBe("unavailable");
      const canvas = box.querySelector("canvas") as HTMLCanvasElement;
      expect(canvas.style.visibility).toBe("hidden");
      expect(box.style.width).toBe("240px");
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/WebGL2 is unavailable/);
    await act(async () => root.unmount());
  });

  it("server-renders as an empty labelled box (nothing draws before the runtime loads)", () => {
    const html = renderToStaticMarkup(<Avatar avatar="d08-origami" size={120} source={source} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('data-face="loading"');
    expect(html).toContain("visibility:hidden");
    expect(html).toMatch(/aria-label="Athena, an origami figure of light"/);
  });
});
