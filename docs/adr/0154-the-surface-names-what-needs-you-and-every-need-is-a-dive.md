# 0154. The surface names what needs you, and every need is a dive

Date: 2026-10-25

Relies on [0087](0087-the-main-window-is-one-scene-with-depths-and-fathom-is-the-chosen-design.md)
(one scene with depths below it; the surface is a mirror, decision D1) and the path grammar of
`depth/model.ts` (root, item, sub).

## Context

The surface said that something needed the person - a warning dot and "needs you" in a light's
name - but not what, and a light's press could only take a `Root`, so it dropped the person at a
depth's field to hunt for the item. The facts to say more were already in hand: the live model
computed every connector's standing (`standingOf`: word and sentence) and the whole setup model
(`engineFact`, `pendingEngine`), then kept only a boolean. A pending engine restart was not on the
surface at all.

## Decision

1. **`SurfaceModel.needs`**: one entry per thing that needs the person - `{key, label, word, line,
   to}` - in a fixed order: the engine when it cannot run (missing, or a check that failed), a
   pending restart, then each account under attention. The words are the owning module's own:
   the connectors module's word and sentence verbatim, the engine fact's summary, the restart
   notice's title.
2. **Every need is a dive.** `to` is a `Path` into the depth grammar (`accounts/<id>`,
   `mind/engine`); `SurfaceActions.dive` widens from `Root` to `Path`. The list never answers,
   connects or restarts anything itself, so the mirror stays a mirror.
3. **A light under attention dives to its first need**; a light without attention dives to its
   root exactly as before.
4. **At most three are drawn**; a `+N more` press dives to the depth of the first one not drawn.
5. **Cards waiting are not needs.** They stay the summon button and are answered in her window
   (D1): a need that opened a card here would answer one outside the window that owns it.

## Consequences

- The first screen is a to-do with reasons: which account, why, one press to its level.
- The first frame carries the list and its model: +430 B gzipped (164,982 B -> 165,412 B), and the
  first-paint ceiling was raised to that measured figure.
- A new attention fact on the surface must come with a need and a path, or its light dives to the
  field with nothing named, which the tests that pin `Light.to` against `needs` will show.
