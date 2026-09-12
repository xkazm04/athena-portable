/**
 * Which module the window is showing, and which theme it is painted in — README section 3.1.
 *
 * The selection lives in Rust (`src-tauri/src/layout.rs`) because the window's rectangles depend
 * on it, so this store is a mirror exactly as `tabs.ts` is: `select` is a command and the answer
 * arrives on `layout:changed`. A React state here would be a second opinion about a fact the
 * window has already acted on.
 *
 * The theme is the shell's alone for now — the Settings module takes it over in c21 and writes it
 * to the store table. Until then `applyTheme` is the one place `data-theme` is written, so the
 * app and the preview harness can never disagree about what `light` looks like.
 */
import { create } from "zustand";

import { hasShell, layoutModule, layoutSelect, onLayoutChanged } from "@/lib/ipc";

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
  /** The module id the window is on. `browser` is the launch default (`layout.rs`). */
  module: string;
  theme: Theme;
  select: (module: string) => Promise<void>;
  setTheme: (theme: Theme) => void;
}

export const useShell = create<ShellState>((set) => ({
  module: "browser",
  theme: "dark",
  select: async (module) => {
    await layoutSelect(module);
  },
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));

let started = false;

export async function startShell(): Promise<void> {
  applyTheme(useShell.getState().theme);
  if (started || !hasShell()) return;
  started = true;
  await onLayoutChanged((module) => useShell.setState({ module }));
  useShell.setState({ module: await layoutModule() });
}
