# 0165. The first frame wears the person's appearance

Date: 2026-10-25

Builds on ADR 0026 (two windows, one settings table), 0089 (Calm), 0142 (skins) and README
section 3.5 (the settings table is read once by the app root). Governing standard: design-tokens
(theme-architecture: the follow-the-platform state is stamped before first paint;
cross-language-token-parity: a mirror is gated, never trusted).

## Context

`chrome.html` and `athena.html` hard-code `data-theme="dark"` and set no `data-skin`,
`data-type-scale` or `data-motion`. The person's choices arrive only after `readRows` awaits ten
store reads over IPC, after React has committed a frame. Main is visible at launch on every run
after the first, so a light-theme person sees a dark flash, a Loop Tide person a teal one, a large
or compact text person a reflow, and a person who chose Calm the start of a fade they asked not to
see.

## Decision

1. **A second, cached copy of four settings in webview storage.** `athena.appearance` holds the
   last hydrated `{theme, skin, typeScale, motion}`, as *choices*: `system` is stored as `system`,
   never as its resolution. The settings table stays the authority: `readRows` still applies
   whatever it reads, and the copy follows it. A stale copy costs one frame that is later
   corrected, which is what every launch costs today.
2. **`bootAppearance` (`src/appearance-boot.ts`) stamps the four root attributes before the first
   paint.** It imports nothing, so `vite.config.ts`'s `athena-appearance-boot` plugin can inline its
   source as the first script in the head of `chrome.html` and `athena.html` (`csp` is null, so an
   inline script runs). `preview.html` and `halo.html` are left alone: the harness reads its own
   `?theme=&skin=`, and the halo has no theme. Anything the boot cannot read (no key, corrupt JSON,
   an unknown value, a storage that throws) stamps nothing, and the HTML's own dark is the frame.
3. **The boot is a gated mirror.** Its value lists and its two resolutions copy `THEME_CHOICES`,
   `SKINS`, `TYPE_SCALES`, `MOTION_CHOICES`, `resolveTheme` and `resolveMotion`;
   `appearance-boot.test.ts` runs every value through both and fails on any disagreement, so a third
   skin added to `SKINS` and not to the boot is a red test, not a silent fallback to dark.
4. **One writer of the copy, in her window.** `followAppearance` (`src/appearance-follow.ts`)
   writes only from hydrated state, so a default or a refused first read can never overwrite the
   person's appearance. `athena.tsx` starts it; `chrome.tsx` does not. Both webviews are built with
   the app's default data directory and load the same origin, so they share one storage; her window
   is built at every launch (`companion::build`) and re-reads the table on Main's `store:changed`,
   so a choice made in Main reaches the copy through her. Main's first frame was 7 B under the
   owner's first-paint ceiling when this landed: a follower in `chrome.tsx`, even behind a lazy
   import, would not fit, and the ceiling is the owner's to raise.

## Consequences

- The inline boot adds 476 B gzipped (972 B raw) to each of the two documents; the JavaScript of
  Main's first frame is unchanged (0 B, measured with and without the change on the same tree).
- If her window fails to build, the copy stops following and the next launch paints the last copy
  it held; the store corrects it after hydration, as before. Starting a follower in Main as well
  is the remedy if that case ever matters, at the bytes it costs.
- A second skin is still one sheet and one `SKINS` entry, plus one word in the boot's list, which
  the parity test demands.
- Rollback is a revert: a leftover `athena.appearance` key is inert.
