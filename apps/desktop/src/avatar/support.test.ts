// @vitest-environment jsdom
/**
 * `canDrawFace()` - ADR 0120 decision 6 (no WebGL2: the surface shows what it shows today), measured
 * rather than declared: a picker asks the machine once whether it can draw a face at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const g = globalThis as { WebGL2RenderingContext?: unknown };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete g.WebGL2RenderingContext;
});

describe("canDrawFace()", () => {
  it("is false where there is no WebGL2RenderingContext (jsdom)", async () => {
    expect(typeof g.WebGL2RenderingContext).toBe("undefined");
    const { canDrawFace } = await import("./support");
    expect(canDrawFace()).toBe(false);
  });

  it("is true where getContext('webgl2') gives a context, probed once per window and the probe released", async () => {
    g.WebGL2RenderingContext = function WebGL2RenderingContext() {};
    const loseContext = vi.fn();
    const getExtension = vi.fn((name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null));
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(((kind: string) => (kind === "webgl2" ? { getExtension } : null)) as never);
    const { canDrawFace } = await import("./support");
    expect(canDrawFace()).toBe(true);
    expect(canDrawFace()).toBe(true);
    expect(canDrawFace()).toBe(true);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext.mock.calls[0]![0]).toBe("webgl2");
    expect(getExtension).toHaveBeenCalledWith("WEBGL_lose_context");
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("is false where the constructor exists but no context can be made", async () => {
    g.WebGL2RenderingContext = function WebGL2RenderingContext() {};
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => null) as never);
    const { canDrawFace } = await import("./support");
    expect(canDrawFace()).toBe(false);
  });
});
