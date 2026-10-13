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

export interface ShellState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useShell = create<ShellState>((set) => ({
  theme: "dark",
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));

/** Paint the theme the store holds, so the first frame is right in every window. */
export function startShell(): void {
  applyTheme(useShell.getState().theme);
}
