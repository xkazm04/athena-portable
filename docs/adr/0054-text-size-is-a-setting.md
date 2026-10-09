# 0054. Text size is a setting, and comfortable is two pixels larger than the original ramp

Date: 2026-10-08

Amends the type ramp in `styles/app.css` (README section 3.1) and the `settings` rows (README
section 3.5).

## Context

The owner found the app's text too small to read. Body text was 14px, captions and data 13px, and
labels 12px; some module sheets went down to 11px. Headings were fine. The person who wants more
on one screen should still be able to keep the original sizes.

## Decision

- One token, `--type-step`, is added to every font size under the heading tiers, which is
  everything under 16px, in every sheet: `calc(<size> + var(--type-step))`. Headings, the display
  figures and SVG drawings keep their sizes.
- The companion window's ramp (`--t-label`, `--t-caption`, `--t-body`, `--t-title`) takes the same
  step, so its title stays above its body. `--t-head` and `--t-display` do not.
- `--type-step` is `2px` by default (*comfortable*). `[data-type-scale="compact"]` sets it to `0px`,
  which is the original ramp.
- The choice is a `settings` row, `type_scale`. It is painted before it is written, as the theme
  is, and both windows re-read it on `store:changed`. Setup → Theme offers it as **Text size**.

## Consequences

- A new rule in a sheet that writes a literal size under 16px has to add the step, or it stays
  small in comfortable. The rule is written beside the token.
- An unknown `type_scale` row reads as comfortable. `stores/settings.test.ts` covers the read,
  the write and the fallback.
