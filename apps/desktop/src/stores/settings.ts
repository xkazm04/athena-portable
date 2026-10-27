/**
 * What the app is configured to be — the `settings` table (README section 3.5), read once by the
 * app root.
 *
 * The engine the daemon is started on, the theme and its text size, the active project id, and
 * the brain directory. The first build's panel asked for a daemon URL, a token and an API
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

import { hasShell, onStoreChanged } from "@/lib/ipc";
import {
  applyMotion,
  isMotionChoice,
  resolveMotion,
  systemPrefersReduced,
  type MotionChoice,
} from "@/lib/motion";
import { AVATAR_IDS, type AvatarId } from "@/avatar/types";
import { DEFAULT_ENGINE, isEngineId, type EngineId } from "@/lib/engines";
import { SETTING_KEYS, settingRead, settingWrite, storePath, type SettingKey } from "@/lib/store";
import { useDaemon } from "@/stores/daemon";
import { DEFAULT_SKIN, applySkin, applyTheme, isSkin, useShell, type Skin, type Theme } from "@/stores/shell";

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

/** Comfortable adds the reading step (`--type-step` in `styles/app.css`); compact removes it; large doubles it. */
export const TYPE_SCALES = ["compact", "comfortable", "large"] as const;

export type TypeScale = (typeof TYPE_SCALES)[number];

export function isTypeScale(value: unknown): value is TypeScale {
  return typeof value === "string" && (TYPE_SCALES as readonly string[]).includes(value);
}

/** The one writer of `data-type-scale`; `compact` and `large` have rules, comfortable is the sheet's default. */
export function applyTypeScale(scale: TypeScale): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-type-scale", scale);
}

/** Is this one of the forms she can take? */
export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && (AVATAR_IDS as readonly string[]).includes(value);
}

export interface SettingsState {
  /** True once the store has answered. Before that every value below is a default, not a choice. */
  hydrated: boolean;
  engine: EngineId;
  theme: ThemeChoice;
  typeScale: TypeScale;
  /** Calm motion: `system` follows the OS, the others override it (ADR 0089). */
  motion: MotionChoice;
  /** What the OS asks for right now; `motion` resolves against it, so a change reaches the stage. */
  reduced: boolean;
  /** The project every turn is filed under (c25), or null. */
  activeProjectId: string | null;
  /** The brain directory. Empty means the daemon's own default, which is not the same as unset. */
  brainPath: string;
  onboarded: boolean;
  /** How she appears: `halo` (the Bell and the seal, no face) or a rigged face. */
  avatar: AvatarId;
  /** The skin she wears (ADR 0142); `athena` is her own teal. */
  skin: Skin;
  /** Where the store file is, for the read-only line in Settings. `null` until it has answered. */
  storePath: string | null;
  /**
   * Why rows could not be read, in the store's own words, or `null`. Before the first read goes
   * through, a refused row keeps `hydrated` false and the stage shows this with a retry, because
   * a default `onboarded` would show a returning person the first act. After it, a refused row
   * keeps the value already shown and is named here, and the other rows still arrive (README
   * section 3.5).
   */
  problem: string | null;
  setEngine: (engine: EngineId) => Promise<void>;
  setTheme: (theme: ThemeChoice) => Promise<void>;
  setTypeScale: (scale: TypeScale) => Promise<void>;
  setMotion: (motion: MotionChoice) => Promise<void>;
  setActiveProject: (id: string | null) => Promise<void>;
  setBrainPath: (path: string) => Promise<void>;
  setOnboarded: (onboarded: boolean) => Promise<void>;
  setAvatar: (avatar: AvatarId) => Promise<void>;
  setSkin: (skin: Skin) => Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  hydrated: false,
  engine: DEFAULT_ENGINE,
  theme: "system",
  typeScale: "comfortable",
  motion: "system",
  reduced: systemPrefersReduced(),
  activeProjectId: null,
  brainPath: "",
  onboarded: false,
  avatar: "halo",
  skin: DEFAULT_SKIN,
  storePath: null,
  problem: null,

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

  // Painted before the write, for the theme's reason: the person is looking at the result.
  setTypeScale: async (typeScale) => {
    applyTypeScale(typeScale);
    set({ typeScale });
    await settingWrite(SETTING_KEYS.typeScale, typeScale);
  },

  // Painted before the write, for the theme's reason: the person is looking at the result.
  setMotion: async (motion) => {
    applyMotion(resolveMotion(motion, systemPrefersReduced()));
    set({ motion });
    await settingWrite(SETTING_KEYS.motion, motion);
  },

  setActiveProject: async (id) => {
    set({ activeProjectId: id });
    await settingWrite(SETTING_KEYS.activeProjectId, id);
  },

  setBrainPath: async (path) => {
    set({ brainPath: path });
    await settingWrite(SETTING_KEYS.brainPath, path);
  },

  // The row first, unlike the look: this flag closes the first act, and a refused write must leave
  // the person on the act with the reason, not on a surface that forgets them at the next launch.
  setOnboarded: async (onboarded) => {
    if (get().onboarded === onboarded) return;
    await settingWrite(SETTING_KEYS.onboarded, onboarded);
    set({ onboarded });
  },

  // Shown before the write, for the theme's reason: the person is looking at her.
  setAvatar: async (avatar) => {
    set({ avatar });
    await settingWrite(SETTING_KEYS.avatar, avatar);
  },

  // Painted before the write, for the theme's reason: the person is looking at the result.
  setSkin: async (skin) => {
    applySkin(skin);
    set({ skin });
    useShell.setState({ skin });
    await settingWrite(SETTING_KEYS.skin, skin);
  },
}));

/**
 * A first-run engine choice: the row is written, and the running daemon is moved onto the engine
 * at once when it is on another. Once the letter has been read the person decides when to
 * restart, so callers use `setEngine` alone there. A choice made while a restart is in flight
 * waits for it and compares again; one made before the daemon has reported always restarts.
 * Rejects like `setEngine` and `restart` do;
 * the caller reports it.
 */
export async function chooseFirstRunEngine(engine: EngineId): Promise<void> {
  await useSettings.getState().setEngine(engine);
  await useDaemon.getState().ensureEngine(engine);
}

/**
 * Setup's engine choice: before the letter is read the choice moves the daemon too; afterwards the
 * restart notice leaves that to the person.
 */
export function chooseSetupEngine(engine: EngineId): Promise<void> {
  const settings = useSettings.getState();
  return settings.onboarded ? settings.setEngine(engine) : chooseFirstRunEngine(engine);
}

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
    applyTypeScale(useSettings.getState().typeScale);
    applyMotion(resolveMotion(useSettings.getState().motion, systemPrefersReduced()));
    useSettings.setState({ hydrated: true });
    return;
  }

  await readRows();
  // ADR 0026: a second window writes the same table. Re-read on its word, so the theme and the
  // engine cannot disagree between the two webviews.
  await onStoreChanged((change) => {
    if (change.table === "settings") void readRows();
  });
}

/**
 * Read every row, paint the resolved theme and publish. Startup, `store:changed` and the stage's
 * retry share it. A refused read is published as `problem` and never thrown: before the first read
 * `hydrated` stays false, and after it the rows already shown stay (they were true a moment ago).
 */
export async function readRows(): Promise<void> {
  // Each row on its own: one that cannot be read keeps what the store held, and the rest still
  // arrive. A single rejected read used to reject them all.
  const failed: { key: SettingKey; reason: string }[] = [];
  const current = useSettings.getState();
  const row = async <T>(key: SettingKey, held: T | null): Promise<T | null> => {
    try {
      return await settingRead<T>(key);
    } catch (e) {
      failed.push({ key, reason: e instanceof Error ? e.message : String(e) });
      return held;
    }
  };
  const [engine, theme, typeScale, motionRow, activeProjectId, brainPath, onboarded, avatar, skinRow, path] = await Promise.all([
    row<string>(SETTING_KEYS.engine, current.engine),
    row<string>(SETTING_KEYS.theme, current.theme),
    row<string>(SETTING_KEYS.typeScale, current.typeScale),
    row<string>(SETTING_KEYS.motion, current.motion),
    row<string>(SETTING_KEYS.activeProjectId, current.activeProjectId),
    row<string>(SETTING_KEYS.brainPath, current.brainPath),
    row<boolean>(SETTING_KEYS.onboarded, current.onboarded),
    row<string>(SETTING_KEYS.avatar, current.avatar),
    row<string>(SETTING_KEYS.skin, current.skin),
    storePath().catch(() => null),
  ]);
  if (failed.length && !current.hydrated) {
    // Nothing has been read yet, so a held value is only a default: stay unread and say why.
    useSettings.setState({ problem: [...new Set(failed.map((x) => x.reason))].join("; ") });
    return;
  }

  const choice: ThemeChoice = isThemeChoice(theme) ? theme : "system";
  applyTheme(resolveTheme(choice));
  useShell.setState({ theme: resolveTheme(choice) });
  const scale: TypeScale = isTypeScale(typeScale) ? typeScale : "comfortable";
  applyTypeScale(scale);
  const motion: MotionChoice = isMotionChoice(motionRow) ? motionRow : "system";
  applyMotion(resolveMotion(motion, systemPrefersReduced()));
  const skin: Skin = isSkin(skinRow) ? skinRow : DEFAULT_SKIN;
  applySkin(skin);
  useShell.setState({ skin });
  useSettings.setState({
    hydrated: true,
    engine: isEngineId(engine) ? engine : DEFAULT_ENGINE,
    theme: choice,
    typeScale: scale,
    motion,
    activeProjectId: activeProjectId ?? null,
    brainPath: brainPath ?? "",
    onboarded: onboarded ?? false,
    avatar: isAvatarId(avatar) ? avatar : "halo",
    skin,
    storePath: path,
    problem: failed.length ? `could not read ${failed.map((x) => `${x.key}: ${x.reason}`).join("; ")}` : null,
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

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  reduced.addEventListener("change", () => {
    const reduced = systemPrefersReduced();
    useSettings.setState({ reduced });
    applyMotion(resolveMotion(useSettings.getState().motion, reduced));
  });
}
