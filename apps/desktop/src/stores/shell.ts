/**
 * Which theme the window is painted in — README section 3.1.
 *
 * The window's shape is not here: the depth path decides it and `depth/shape.ts` tells Rust. What
 * is left is the theme, which `applyTheme` writes as `data-theme`; that is the one place the
 * attribute is written, so the app and the preview harness can never disagree about what `light`
 * looks like. The settings store resolves a person's choice (including `system`) and keeps this in
 * step.
 */
import { create } from "zustand";

export type Theme = "dark" | "light";

export const THEMES: readonly Theme[] = ["dark", "light"];

export function isTheme(value: string | null): value is Theme {
  return value === "dark" || value === "light";
}

/** The one writer of `data-theme`. Every token in `styles/app.css` hangs off this attribute. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * The skin the window wears (ADR 0142): a layer of tokens and decorative layers over the same
 * markup, chosen in Mind > Look. `athena` is the product's own teal and has no rules of its own
 * (`BASE_SKIN`); every other skin is one sheet in `styles/skins/` whose every selector starts at
 * `:root[data-skin="<id>"]`. A skin never changes a size, a position or a word.
 */
export const SKINS = ["athena", "loop-tide", "wavefront"] as const;

export type Skin = (typeof SKINS)[number];

/** The skin bound by `app.css` itself, which needs no sheet. */
export const BASE_SKIN: Skin = "athena";

/** What a person wears until they choose in Look (ADR 0142, addendum 2026-10-27). The HTML entries
 *  carry it too, so a first frame before any choice is already in it. */
export const DEFAULT_SKIN: Skin = "wavefront";

export function isSkin(value: unknown): value is Skin {
  return typeof value === "string" && (SKINS as readonly string[]).includes(value);
}

/** The one writer of `data-skin`. */
export function applySkin(skin: Skin): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-skin", skin);
}

export interface ShellState {
  theme: Theme;
  skin: Skin;
  setTheme: (theme: Theme) => void;
}

export const useShell = create<ShellState>((set) => ({
  theme: "dark",
  skin: DEFAULT_SKIN,
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));

/** Paint the theme and skin the store holds, so the first frame is right in every window. */
export function startShell(): void {
  applyTheme(useShell.getState().theme);
  applySkin(useShell.getState().skin);
}
