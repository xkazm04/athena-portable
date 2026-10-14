# 0089. Motion is transform and opacity, and speed is a gate, not a hope

## Context

The chosen design wins on animation quality and feel. Read as code, the contest page redraws
thirty SVG paths with `setAttribute` at 30 Hz, animates `filter: blur(10px)` on whole-scene
layers, runs two `requestAnimationFrame` loops, and puts text at 8 to 10 px. It looks fast in a
still and is not a safe base for a shipped WebView2 window.

## Decision

The port holds to budgets that a script checks, set out in `docs/redesign/fathom.md` section 5:
depth transitions of 360 ms at 60 fps that are interruptible and land on their final state under
reduced motion; only `transform` and `opacity` animate; no animated `filter` on a scene-sized
layer; at most one shared animation scheduler, stopped when hidden, calm or settled; no React
render per frame (the bell, tendrils and backdrop are driven imperatively); each depth a lazy
chunk preloaded on hover or focus; a 12 px text floor. `pnpm perf` drives one fixed path through
the depths in a browser and fails the run when a budget is missed. It is built **before** the first
scene (phase 0), and no phase merges red.

`Calm` becomes a stored setting beside the theme and the text scale and defaults to the operating
system's reduced-motion preference.

## Consequences

- Visual richness is bought with pre-baked layers and compositing, not with per-frame work.
- A scene that cannot meet a budget is changed, not given an exception; a budget changes only by a
  later ADR.
- The gate measures a browser, not the shipped WebView2; a hand pass in the real shell is still
  part of the cutover phase.
