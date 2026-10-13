# 0094 — The first act is reshown by a flag, and Calm is a choice in Look

## Context

The module bar's Setup could "show the welcome again" without touching a stored row: a bit of React
state inside its own hook. The console draws the first act on the surface, which does not share that
hook, so the state has to live where the surface can read it. Separately, ADR 0089 made Calm a
stored setting but gave it no control.

## Decision

`scenes/waking/reopen.ts` is a one-flag store: the Mind depth's "Show the welcome again" sets it and
goes to the surface, which then draws the first act (`sceneFor` reads `onboarded && !reopened`), and
Wake her clears it. No stored row changes either way, as before. Calm is a three-way choice
(`system`, `calm`, `full`) in Mind's Look level, next to the theme and the text size; it reaches the
settings through the Setup model's new `setMotion` action, painted before it is written, as the
theme is.

The old list's Page and Voice tiles are not instruments of Mind: the page is the Apps depth and the
voice is the Voice depth. The field links to both and says why.

## Consequences

- A reopened act survives navigating away and back, and a restart forgets it (it is only shown).
- The module bar's own welcome is unchanged; `useSetupModel` takes `onReopen` only when a scene
  passes one.
- The Calm control reads the same row the stage and every scene read through `data-motion`.
