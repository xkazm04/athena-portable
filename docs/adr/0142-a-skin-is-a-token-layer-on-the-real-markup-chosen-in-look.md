# 0142. A skin is a token layer on the real markup, chosen in Look

Date: 2026-10-24 (contest athena-meta-theme, winner B/1 "Loop Tide")

Builds on [0087](0087-the-main-window-is-one-scene-with-depths-and-fathom-is-the-chosen-design.md)
(the depths), [0089](0089-motion-is-transform-and-opacity-and-speed-is-a-gate-not-a-hope.md) (motion
and its gate) and [0139](0139-her-window-is-bell-with-tidelines-seal-and-speaks-plain-words.md) (her
window). Changes none of their rules.

## Context
For the Meta hackathon the owner wanted Athena dressed in a brand derived from Meta's and the Muse
family's identity - blue tones, new background motion, a new coat for her small window - while the
product's UI and UX stay exactly as they are. A theme contest was run on static snapshots of this
app's own preview harness, so every entry re-skinned the real markup. The owner chose **Loop Tide**
(Meta's loop read as Athena's current: cobalt tokens, a particle current in the water that is never
drawn as a closed shape, a bloom behind the bell, an arc of light round her window's rim and the
seal) and asked for it to be switchable in the appearance settings.

## Decision
- **A skin is an attribute, a stylesheet and nothing else.** `data-skin` on the root, written only by
  `applySkin` (`stores/shell.ts`, beside `applyTheme`). `athena` is the product's own teal and has no
  rules; `loop-tide` is `styles/skins/loop-tide.css`, loaded by every window's entry. Every selector
  in it starts at `:root[data-skin="loop-tide"]`, so the skin cannot leak.
- **Tokens on real elements, layers on pseudo-elements.** The sheet re-declares the existing tokens
  (dark and light, and her window's `.aw` tokens) and adds three decorative layers: the bloom
  (`.backdrop::before`), the rim arc (`.aw-water::before/::after`) and the seal's orbit
  (`.seal::before`). A real element may take only tokens, `opacity` or `isolation`
  (`loop-tide.css.test.ts`): a skin never changes a size, a position or a word. The person's pink and
  the success, warning and error colours are never re-declared.
- **A setting like the theme.** `skin` is a `settings` row, painted before it is written, re-read by
  every window on `store:changed`, and chosen in **Mind > Look > Style** beside Theme, Text size and
  Motion. An unknown row reads as `athena`. The default stays `athena`.
- **The current keeps the water's rule.** The prototype's current asked for a frame forever. Ported,
  it runs on the window's one clock (`stage/LoopCurrent.tsx`, `stage/loop-current.ts`) and only while
  there is a reason: while she works, hears or asks (at the bell's pace for that pose) and for 1.6 s
  after a move. Then it slows and cross-fades into its long exposure - the prototype's own still - and
  lets the clock go. A settled scene asks for no frames, as before. Under Calm the exposure is all
  there is. It is fetched lazily, only when the skin is worn, so the first paint keeps its ceiling.

## Consequences
- The port was held to the winner: 0 computed-style deviations across 56 role checks (surface and her
  window's slip, dark and light) against the winner's screens, and the same check against the
  unskinned app shows 33 and 19 - the instrument sees the difference.
- `pnpm perf:skin` drives the stage's fixed path in the skin; the gate passes with no long task,
  one loop per frame and 0 idle frame requests.
- One visible departure from the winner, made for 0089's gate: at rest the current is a still
  photograph, where the prototype kept it flowing. Letting it flow at rest would need an idle frame
  budget for it, which is a later ADR's call, not this one's.
- Not skinned: the halo window (`halo.css`), which the contest had no state for. A second skin is one
  more sheet in `styles/skins/` and one more entry in `SKINS`.
