/**
 * The first frame wears the person's appearance — README section 3.1, ADR 0165.
 *
 * The settings table is the authority on theme, skin, text size and motion, but it answers over
 * IPC after React has committed a frame. So the last hydrated choices are also kept in one
 * webview-storage key (written by `appearance-follow.ts`), and `bootAppearance` reads it and
 * stamps the four root attributes before the first paint: `vite.config.ts` inlines it as the
 * first script in the head of `chrome.html` and `athena.html`.
 *
 * **It imports nothing and names nothing outside itself**, because it runs as the function's own
 * source text. The lists below are a mirror of `THEME_CHOICES`, `SKINS`, `TYPE_SCALES` and
 * `MOTION_CHOICES`, and the two resolutions a mirror of `resolveTheme` and `resolveMotion`; a
 * mirror is gated, never trusted, so `appearance-boot.test.ts` runs every value through both.
 * Anything it cannot read — no key, corrupt JSON, an unknown value, a storage that throws — stamps
 * nothing, and the HTML's own `data-theme="dark"` is the first frame, as it was before.
 */

/** The one storage key. The boot spells it inline; the test holds the two to each other. */
export const APPEARANCE_KEY = "athena.appearance";

/** What the boot touches of a window: enough for a test to hand it a stub. */
export interface BootWindow {
  document: { documentElement: { setAttribute(name: string, value: string): void } };
  localStorage: { getItem(key: string): string | null };
  matchMedia(query: string): { matches: boolean };
}

export function bootAppearance(win: BootWindow): void {
  try {
    const s = JSON.parse(win.localStorage.getItem("athena.appearance") || "null") as Record<string, unknown> | null;
    const ok = (v: unknown, of: string[]) => typeof v === "string" && of.indexOf(v) >= 0;
    if (
      !s ||
      !ok(s.theme, ["system", "light", "dark"]) ||
      !ok(s.skin, ["athena", "loop-tide", "wavefront"]) ||
      !ok(s.typeScale, ["compact", "comfortable", "large"]) ||
      !ok(s.motion, ["system", "calm", "full"])
    )
      return;
    const q = (m: string) => win.matchMedia(m).matches;
    const theme = s.theme === "system" ? (q("(prefers-color-scheme: light)") ? "light" : "dark") : String(s.theme);
    const motion = s.motion === "system" ? (q("(prefers-reduced-motion: reduce)") ? "calm" : "full") : String(s.motion);
    const root = win.document.documentElement;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-skin", String(s.skin));
    root.setAttribute("data-type-scale", String(s.typeScale));
    root.setAttribute("data-motion", motion);
  } catch {
    // A storage the webview refuses costs the head start, never the window.
  }
}

/** The documents whose first frame the boot paints. The harness and the halo read their own. */
export const BOOT_DOCUMENTS = ["chrome.html", "athena.html"];

/** `html` with the boot as the first script in its head when `file` is a boot document. */
export function injectBoot(html: string, file: string): string {
  if (!BOOT_DOCUMENTS.includes(file)) return html;
  if (!html.includes("<head>")) throw new Error(`${file} has no <head> to carry the appearance boot`);
  const script = `<script>(${bootAppearance.toString()})(window)</script>`;
  return html.replace("<head>", () => `<head>\n    ${script}`);
}
