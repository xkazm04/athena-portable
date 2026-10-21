import { describe, expect, it } from "vitest";
import { classify, flagsOf, manifestOf } from "@athena/bridge/gate";

// The assertions here are for `pnpm typecheck`: each `@ts-expect-error` becomes an error of its own
// the day the module is `any` again, because the line under it then type-checks. The wrong calls
// sit in a function nobody calls, so they are checked and never run.
function wrongShapes(): void {
  // @ts-expect-error - a string is not a tool
  flagsOf("tool");
  // @ts-expect-error - a name is a string
  flagsOf({ name: 3 });
  // @ts-expect-error - flags are an object
  classify("GATED");
  // @ts-expect-error - tools is a list, not one tool
  manifestOf({ origin: "https://a.example" }, { name: "t" });
  // @ts-expect-error - a tool in the list needs a name
  manifestOf({ origin: "https://a.example" }, [{ description: "no name" }]);
  // @ts-expect-error - origin is a string
  manifestOf({ origin: 3 }, []);
}

describe("@athena/bridge/gate types", () => {
  it("flagsOf returns typed flags", () => {
    const flags = flagsOf({ name: "x", athena: { reversible: true, side_effects: "none" } });
    const effects: "none" | "internal" | "external" = flags.side_effects;
    expect(effects).toBe("none");
  });

  it("classify returns the closed class", () => {
    const cls: "AUTO" | "GATED" = classify({ reversible: true, side_effects: "none" });
    expect(cls).toBe("AUTO");
  });

  it("manifestOf returns a typed manifest", () => {
    const manifest = manifestOf({ origin: "https://a.example", app_id: "a" }, [{ name: "t" }], "now");
    const name: string = manifest.tools[0].name;
    expect(name).toBe("t");
    expect(typeof wrongShapes).toBe("function");
  });
});
