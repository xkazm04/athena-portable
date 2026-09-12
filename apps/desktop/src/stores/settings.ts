/**
 * What the app is configured to be — the `settings` table (README section 3.5), read once by the
 * app root.
 *
 * Four rows and nothing else: the engine the daemon is started on, the theme, the active project
 * id, and the brain directory. The first build's panel asked for a daemon URL, a token and an API
 * key as well; the shell mints the token and spawns the sidecar itself, so none of those three
 * are settings here and none ever will be.
 *
 * **Started by the app root, by nothing else.** That is the day-zero rule from README section
 * 3.5: the first build's tray count lived in one page and froze the moment the user left it.
 * The theme in particular has to be right on the first frame of *every* module, not only of the
 * one that owns the control.
 *
 * The theme is written through `stores/shell.ts`'s `applyTheme`, which stays the one writer of
 * `data-theme`. This store adds the third choice — `system` — which is a *choice* and not a
 * third attribute value: it is resolved against `prefers-color-scheme` at apply time and
 * re-resolved when the system flips while the app is open.
 */
import { create } from "zustand";

import { hasShell } from "@/lib/ipc";
import { DEFAULT_ENGINE, isEngineId, type EngineId } from "@/lib/engines";
import { SETTING_KEYS, settingRead, settingWrite, storePath } from "@/lib/store";
import { applyTheme, useShell, type Theme } from "@/stores/shell";

/** The three a person may choose between. `system` is the default, because it is nobody's. */
export const THEME_CHOICES = ["system", "light", "dark"] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && (THEME_CHOICES as readonly string[]).includes(value);
}

/** What the operating system is asking for, or `dark` where nothing is asking. */
export function systemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** The attribute value a choice resolves to *now*. Pure but for the media query it reads. */
export function resolveTheme(choice: ThemeChoice): Theme {
  return choice === "system" ? systemTheme() : choice;
}

export interface SettingsState {
  /** True once the store has answered. Before that every value below is a default, not a choice. */
  hydrated: boolean;
  engine: EngineId;
  theme: ThemeChoice;
  /** The project every turn is filed under (c25), or null. */
  activeProjectId: string | null;
  /** The brain directory. Empty means the daemon's own default, which is not the same as unset. */
  brainPath: string;
  onboarded: boolean;
  /** Where the store file is, for the read-only line in Settings. `null` until it has answered. */
  storePath: string | null;
  setEngine: (engine: EngineId) => Promise<void>;
  setTheme: (theme: ThemeChoice) => Promise<void>;
  setActiveProject: (id: string | null) => Promise<void>;
  setBrainPath: (path: string) => Promise<void>;
  setOnboarded: (onboarded: boolean) => Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  hydrated: false,
  engine: DEFAULT_ENGINE,
  theme: "system",
  activeProjectId: null,
  brainPath: "",
  onboarded: false,
  storePath: null,

  setEngine: async (engine) => {
    set({ engine });
    await settingWrite(SETTING_KEYS.engine, engine);
  },

  // The state moves first and the row is written after, deliberately: the theme is the one
  // setting whose effect the user is *looking at*, and a round trip to SQLite before the paint
  // is a visible lag on a decision the app has already made.
  setTheme: async (theme) => {
    applyTheme(resolveTheme(theme));
    set({ theme });
    useShell.setState({ theme: resolveTheme(theme) });
    await settingWrite(SETTING_KEYS.theme, theme);
  },

  setActiveProject: async (id) => {
    set({ activeProjectId: id });
    await settingWrite(SETTING_KEYS.activeProjectId, id);
  },

  setBrainPath: async (path) => {
    set({ brainPath: path });
    await settingWrite(SETTING_KEYS.brainPath, path);
  },

  setOnboarded: async (onboarded) => {
    if (get().onboarded === onboarded) return;
    set({ onboarded });
    await settingWrite(SETTING_KEYS.onboarded, onboarded);
  },
}));

let started = false;

/**
 * Read the rows, paint the theme, and keep painting it if the system flips.
 *
 * Called by `src/app.tsx` and by nothing else. With no shell — the preview harness, a plain
 * browser — it still applies the default theme and marks itself hydrated, because a module
 * previewed against a fixture must look exactly as it does in the window.
 */
export async function startSettings(): Promise<void> {
  if (started) return;
  started = true;

  watchSystemTheme();

  if (!hasShell()) {
    applyTheme(resolveTheme(useSettings.getState().theme));
    useSettings.setState({ hydrated: true });
    return;
  }

  const [engine, theme, activeProjectId, brainPath, onboarded, path] = await Promise.all([
    settingRead<string>(SETTING_KEYS.engine),
    settingRead<string>(SETTING_KEYS.theme),
    settingRead<string>(SETTING_KEYS.activeProjectId),
    settingRead<string>(SETTING_KEYS.brainPath),
    settingRead<boolean>(SETTING_KEYS.onboarded),
    storePath().catch(() => null),
  ]);

  const choice: ThemeChoice = isThemeChoice(theme) ? theme : "system";
  applyTheme(resolveTheme(choice));
  useShell.setState({ theme: resolveTheme(choice) });
  useSettings.setState({
    hydrated: true,
    engine: isEngineId(engine) ? engine : DEFAULT_ENGINE,
    theme: choice,
    activeProjectId: activeProjectId ?? null,
    brainPath: brainPath ?? "",
    onboarded: onboarded ?? false,
    storePath: path,
  });
}

/**
 * `system` is a standing choice, not a one-time reading: a user who set the OS to switch at dusk
 * expects the app to switch at dusk, and an app that only resolves at launch is the one that
 * does not.
 */
function watchSystemTheme(): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  const query = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => {
    if (useSettings.getState().theme !== "system") return;
    const next = systemTheme();
    applyTheme(next);
    useShell.setState({ theme: next });
  };
  // `addEventListener` on a MediaQueryList is the modern form; WebView2 has had it for years.
  query.addEventListener("change", onChange);
}
