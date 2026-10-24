# 0150. A lane run opens to its note, its cite and the turn stops it carries

Date: 2026-10-25

Concerns the atlas example's lane drawing (`examples/atlas/components/atlas/variants/archify-lanes`).

## Context

The lane sheet's fourteen runs are its claims. `workflow.ts` gives each one a sentence (`note`)
and a source (`cite`), but nothing read either. The runs were aria-hidden SVG on a plate that took
no pointer events. `read_turn` sent only each run's label. A node's spoken name said where the node
stood and nothing about what it connected to. A reader could not question a line, and a keyboard or
screen-reader user did not get the edges at all. One finding stayed hidden: `e-approval`, a main
run, carries no stop of the turn's script, because the script goes catalog -> contracts -> record.
During the story it was dimmed and nothing said why.

## Decision

1. **A run is a press target, and the plate stays what it was.** The plate keeps
   `pointer-events: none`. Each run gets one transparent hit stroke (`.al-run-hit`) along its own
   path. The stroke opts back in with `pointer-events: stroke` and uses `vector-effect:
   non-scaling-stroke` at a token width (`--al-run-hit`, 8 screen units), so it is equally easy to
   hit at every zoom. The plate stays `aria-hidden`.
2. **The keyboard reaches runs from nodes, not from SVG.** On a focused node, `[` and `]` move
   through the runs it touches, in `EDGES` order, and wrap. Escape closes the open run, and so does
   opening a node. No focusable element is added to the plate.
3. **The rules live in one pure module.** `inspect.ts` builds `runReadout`, `runsTouching`,
   `cycleRun`, `runKey` and `selectRun` from `EDGES`, the nodes, `ROLE_LABEL` and the story's
   `HOPS`. Nothing is typed a second time, and `node --test` reaches every rule.
4. **The readout is one compact card in the story bar's slot.** It shows the role, from -> to, the
   label, the note, the cite, and either "carries stop(s) N" or "no stop of the turn travels this
   run". It sits in an always-mounted `aria-live="polite"` region. An opened run is never dimmed
   by the story.
5. **With the story on, opening a run moves the story** to the first stop the run carries. A run
   that no stop travels leaves the story where it is.
6. **The other surfaces carry the same facts.** `nodeName` adds the node's outgoing and incoming
   runs, by node label. `read_turn`'s `edges` carry `note` and `cite` beside `label`, and the list
   is cut at `READ_CAP`.

## Consequences

- A reader can check every line against its README section without leaving the canvas, and the
  one main run the turn never walks now says so. Whether the script or the edge is wrong is still
  a content decision, recorded separately.
- The selection is a `useState` in `Drawing.tsx`. It moves the stop through the same `setStop`
  the other story doors use. If the story becomes a reducer, opening a run becomes one more action
  for it.
- Tests: `test/lanes.inspect.test.ts` covers the pure rules. `lanes.model.test.ts` covers the
  node name, `lanes.poses.test.ts` covers `read_turn`, and `lanes.drawing.test.ts` and
  `lanes.css.test.ts` cover the wiring and the hit stroke.
