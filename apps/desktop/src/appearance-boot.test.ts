/**
 * The first frame wears the person's appearance — README section 3.1, ADR 0165.
 *
 * `bootAppearance` is a hand-written mirror of four store rules (it is inlined into the HTML, so
 * it may import nothing). These cases hold it to the rules it mirrors rather than trusting it:
 * every choice is run through the boot and through `resolveTheme`, `resolveMotion`, `isSkin` and
 * `isTypeScale`, and the answers must agree. The vite plugin is driven on the real documents.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { APPEARANCE_KEY, bootAppearance, type BootWindow } from "@/appearance-boot";
import { MOTION_CHOICES, isMotionChoice, resolveMotion } from "@/lib/motion";
import { SKINS, isSkin } from "@/stores/shell";
import { THEME_CHOICES, TYPE_SCALES, isThemeChoice, isTypeScale, resolveTheme } from "@/stores/settings";

import { appearanceBoot } from "../vite.config";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A window with a root that starts as the HTML writes it, a storage and two media answers. */
function win(
  raw: string | null | (() => never),
  prefersLight = false,
  prefersReduced = false,
): { w: BootWindow; attrs: Record<string, string> } {
  const attrs: Record<string, string> = { "data-theme": "dark" };
  const w: BootWindow = {
    document: { documentElement: { setAttribute: (k: string, v: string) => void (attrs[k] = v) } },
    get localStorage() {
      if (typeof raw === "function") return raw();
      return { getItem: (k: string) => (k === APPEARANCE_KEY ? raw : null) };
    },
    matchMedia: (q: string) => ({
      matches: q.includes("prefers-color-scheme: light") ? prefersLight : q.includes("reduce") ? prefersReduced : false,
    }),
  };
  return { w, attrs };
}

const snap = (s: Record<string, unknown>) =>
  JSON.stringify({ theme: "dark", skin: "athena", typeScale: "comfortable", motion: "full", ...s });

afterEach(() => vi.unstubAllGlobals());

describe("bootAppearance", () => {
  it("case 1: stamps the four root attributes from the snapshot", () => {
    const { w, attrs } = win(snap({ theme: "light", skin: "loop-tide", typeScale: "large", motion: "calm" }));
    bootAppearance(w);
    expect(attrs).toEqual({
      "data-theme": "light",
      "data-skin": "loop-tide",
      "data-type-scale": "large",
      "data-motion": "calm",
    });
  });

  it("case 2: three-state theme resolves system against the media query, as resolveTheme does", () => {
    for (const theme of THEME_CHOICES) {
      for (const prefersLight of [false, true]) {
        vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q.includes("light") && prefersLight }) });
        const { w, attrs } = win(snap({ theme }), prefersLight);
        bootAppearance(w);
        expect(attrs["data-theme"], `${theme} / prefersLight=${prefersLight}`).toBe(resolveTheme(theme));
      }
    }
    const { w, attrs } = win(snap({ theme: "system" }), true);
    bootAppearance(w);
    expect(attrs["data-theme"]).toBe("light");
  });

  it("case 3: motion, skin and type-scale parity with resolveMotion, isSkin, isTypeScale and the choice guards", () => {
    for (const motion of MOTION_CHOICES) {
      for (const prefersReduced of [false, true]) {
        const { w, attrs } = win(snap({ motion }), false, prefersReduced);
        bootAppearance(w);
        expect(attrs["data-motion"], `${motion} / reduced=${prefersReduced}`).toBe(resolveMotion(motion, prefersReduced));
      }
    }
    const accepts = (field: string, value: unknown) => {
      const { w, attrs } = win(snap({ [field]: value }));
      bootAppearance(w);
      return "data-skin" in attrs;
    };
    const junk = ["", "Athena", "LOOP-TIDE", "huge", "auto", "reduced", null, 3, true];
    for (const v of [...SKINS, ...TYPE_SCALES, ...THEME_CHOICES, ...MOTION_CHOICES, ...junk]) {
      expect(accepts("skin", v), `skin ${String(v)}`).toBe(isSkin(v));
      expect(accepts("typeScale", v), `typeScale ${String(v)}`).toBe(isTypeScale(v));
      expect(accepts("theme", v), `theme ${String(v)}`).toBe(isThemeChoice(v));
      expect(accepts("motion", v), `motion ${String(v)}`).toBe(isMotionChoice(v));
    }
  });

  it("case 4 (guard): no snapshot, corrupt JSON, an unknown skin or a throwing storage stamps nothing", () => {
    const cases: Array<string | null | (() => never)> = [
      null,
      "{not json",
      "null",
      "[]",
      snap({ skin: "neon" }),
      () => {
        throw new Error("SecurityError: storage is disabled");
      },
    ];
    for (const raw of cases) {
      const { w, attrs } = win(raw);
      expect(() => bootAppearance(w)).not.toThrow();
      expect(attrs).toEqual({ "data-theme": "dark" });
    }
  });
});

describe("the vite plugin", () => {
  const transform = (file: string) => {
    const html = readFileSync(path.join(APP, file), "utf8");
    const hook = appearanceBoot().transformIndexHtml as {
      handler: (html: string, ctx: { filename: string; path: string }) => string;
    };
    return { html, out: hook.handler(html, { filename: path.join(APP, file), path: `/${file}` }) };
  };

  it("case 8: chrome.html and athena.html carry the boot first in <head>; preview and halo are unchanged", () => {
    for (const file of ["chrome.html", "athena.html"]) {
      const { out } = transform(file);
      const head = out.slice(out.indexOf("<head>") + "<head>".length).trimStart();
      expect(head.startsWith("<script>"), file).toBe(true);
      const boot = out.indexOf("<script>");
      for (const later of [/<script\b[^>]*type="module"/, /<link\b[^>]*stylesheet/, /<meta\b/]) {
        const at = out.search(later);
        if (at >= 0) expect(boot, `${file} ${later}`).toBeLessThan(at);
      }
      // The inlined text runs on its own: the function survives being turned into a string.
      const body = head.slice("<script>".length, head.indexOf("</script>"));
      const { w, attrs } = win(snap({ theme: "light", skin: "loop-tide" }));
      new Function("window", body)(w);
      expect(attrs["data-skin"], file).toBe("loop-tide");
      expect(attrs["data-theme"], file).toBe("light");
    }
    for (const file of ["preview.html", "halo.html"]) {
      const { html, out } = transform(file);
      expect(out, file).toBe(html);
    }
  });
});
