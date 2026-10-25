/**
 * Keep the first frame's snapshot in step with the settings store — README section 3.5, ADR 0165.
 *
 * Writes `{theme, skin, typeScale, motion}` (the *choices*: `system` stays `system`) under
 * `APPEARANCE_KEY` whenever the hydrated store moves. Never before hydration, so a default can
 * never overwrite the person's appearance, and a refused first read (still unhydrated) leaves the
 * last snapshot alone. Started by her window only (`athena.tsx`): both webviews share one storage
 * origin, her window re-reads the table on Main's `store:changed`, and Main's first frame has no
 * bytes to spare (ADR 0165 says why).
 */
import { APPEARANCE_KEY } from "@/appearance-boot";
import { useSettings, type SettingsState } from "@/stores/settings";

type Storage = { setItem(key: string, value: string): void };

export function followAppearance(storage?: Storage): () => void {
  let last = "";
  const write = (s: SettingsState) => {
    if (!s.hydrated) return;
    const next = JSON.stringify({ theme: s.theme, skin: s.skin, typeScale: s.typeScale, motion: s.motion });
    if (next === last) return;
    try {
      (storage ?? globalThis.localStorage).setItem(APPEARANCE_KEY, next);
      last = next;
    } catch {
      // A storage that refuses costs the next launch's head start, nothing else.
    }
  };
  write(useSettings.getState());
  return useSettings.subscribe(write);
}
