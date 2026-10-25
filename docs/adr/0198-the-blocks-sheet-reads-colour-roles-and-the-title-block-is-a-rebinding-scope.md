# 0198. The Blocks sheet reads colour roles, and the title block is a rebinding scope

Date: 2026-10-25

## Context

tidycrm's Blocks stylesheet (`examples/tidycrm/components/blocks/style/`) locked its colour values
carefully and its colour meaning not at all. Component sheets read raw steps of the graphite ramp
(124 reads of `--bk-graphite*`, `--bk-sheet`, `--bk-vellum` and `--bk-rule-ink` outside the token
file), so one step meant different things on different grounds. The registry recorded this as a
design-tokens deviation (`level2/foot.css`: graphite-4 used as text on the inverted block).

The consequence was structural. The title block, the inverted region holding the only irreversible
acts, was drawn by nine override rules that reached into it to repaint one component each: the
button four times (rest, hover, armed, armed hover), the focus ring, the lettering, the band note,
the band rule and the scrollbar. Each won only because it came later in the cascade (the focus
ring's comment said so). The contrast test then had to guess a rule's ground from its selector
spelling (`rule.selector.startsWith(".bk-title-block")`), so an inverted control styled under any
other selector would have been measured on the wrong ground. `--bk-label-ink` and
`--bk-goldline-ink` existed as roles already, but nothing used them consistently.

## Decision

1. **Colour roles, declared on the wrapper** in `base/tokens.css`: `--bk-ground`,
   `--bk-ground-raised`, `--bk-ink`, `--bk-ink-quiet`, `--bk-ink-mark`, `--bk-ink-faint`,
   `--bk-ink-on-redline`, `--bk-line`, `--bk-line-strong` and `--bk-focus`, beside the existing
   `--bk-label-ink` and `--bk-goldline-ink`. Each has an obligation: text roles 4.5:1, focus and
   mark 3:1 on both grounds of their scope. `--bk-ink-faint` (a resting scrollbar thumb) has none.
2. **The title block is a scope.** The last rule of the token file,
   `[data-variant="blocks"] .bk-title-block`, rebinds the whole set for the block's subtree, with
   the values the overrides painted. `--bk-label-ink` is re-declared there, not inherited: it is
   computed at the wrapper from graphite-2. The rebinding lives in the token file, not in
   `level2/foot.css`, so a palette or inversion change is one edit in one file and the component
   sheets read no ramp step at all.
3. **Components read roles, and the overrides are deleted.** `.bk-btn`, its hover, its armed
   (`data-fire`) state, the base focus ring, the lettering, the band rule, the arm's frame and the
   scrollbar are written once and draw correctly on either ground. Hover and armed are the same
   "swap ink and ground" expression in both scopes. The armed button's hover is redline, which does
   not invert, so its figure reads `--bk-ink-on-redline`. The block's own background is the scope's
   `--bk-ground`.
4. **The test measures by scope, not by spelling.** `test/tidycrm-style.test.ts` resolves a value
   in the scope it is read in, holds the wrapper's and the block's role sets equal, measures each
   role pair per scope, fails any rule under `.bk-title-block ` that declares a colour, and
   ratchets ramp reads: zero in the eight migrated parts, today's count as a ceiling in six small
   ones, `chrome/toast.css` exempt by name because the toast stack mounts outside the wrapper. Two
   guard tests pin every paint the change could move, on both grounds.

## Consequences

- No paint moves on either ground. The guard tests pin the button (rest, hover, armed, armed
  hover), the ring, the band, the lettering, the arm and the scrollbar in the gate, and the ring,
  the pressed camera pose, the fault stripe, the AUTO stripe and the button on the stock. One
  change is by construction rather than by value: the gate's button at rest is filled with the
  block's own ground instead of `none`. The pixels and the hover's transition are the same.
- A control added to the gate is correct with no new rule, and the contrast test measures it on
  the inverted ground because it reads roles, whatever its selector.
- The AUTO button's greenline stripe now also names its hover state, because the hover's edge
  colour (needed in the gate) would otherwise repaint it graphite.
- The title block's `::-webkit-scrollbar` track and thumb border now follow the scope too (graphite
  instead of vellum). Chromium ignores those pseudo-elements wherever `scrollbar-color` is set,
  which this sheet does on every element, so nothing visible changes there.
- Two roles beyond the ten the change was planned with: `--bk-ink-faint` keeps the resting
  scrollbar thumb at graphite-4 instead of darkening it, and `--bk-ink-on-redline` keeps the armed
  hover's figure the sheet's colour in both scopes. Both are in both sets.
- The six unmigrated parts and the toast stack still read ramp steps. The ratchet keeps that from
  growing, and migrating them is a follow-up that lowers their ceilings to zero.
