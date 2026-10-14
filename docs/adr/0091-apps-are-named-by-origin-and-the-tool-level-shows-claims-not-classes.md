# 0091. Apps are named by origin, and the tool level shows claims, not classes

## Context

The Apps depth (ADR 0087) needs a path for an app and for a page, and a third level. The
registered-apps table is keyed by origin; a tab can be on an origin nobody registered, or on none
(a blank page). Rust owns which tab is focused, and a page has tools that are claims (README 3.3).

## Decision

`apps/<item>` names an app by its **origin** (the table's own key), and a tab on no origin is
`apps/tab-<id>`; `apps/<item>/page` is the page shape (ADR 0088). Opening an app from a scene
focuses or creates the tab and moves to its page only once the tab exists (`onShown`), so the page
shape is never asked for with nothing to show. `console/follow.ts` keeps the depth with what Rust
does without asking it: a page selected by Rust (the welcome's first app) is followed, a changed
focus under a page renames it, and a last tab closed leaves the page. A tab appearing while the
person is in a scene is **not** followed.

The tool level (`apps/<item>/tool/<name>`) shows what the page said (title, description, its
`readOnlyHint`, its `reversible` and `side_effects`) and the class the person pinned, and says they
are claims. It states no `AUTO`, `READ` or `GATED` of its own: policy lives in the gate (README
invariant 3), and a view that computed a class would be a second policy. It is read-only: no pin
control is added, because the old module had none and a new write is a new decision.

## Consequences

- A deep link to an app survives a restart (the origin is stable); a link to a blank page does not
  (the tab id is not).
- The page's band is the Browser module's own strip, moved not rewritten.
- A pin control, if wanted, is its own decision with its own ADR.
