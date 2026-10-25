# 0169. The Lanes have one colour authority

Date: 2026-10-25

Builds on ADR 0018 (ledgerbox ships the Lanes).

## Context

`examples/ledgerbox/components/lanes/style/base/tokens.css` holds the Lanes' token block and calls
itself the live value authority, yet 52 colour literals in 13 other parts of the sheet decided
colour on their own. They were hand copies of `--ln-void`, `--ln-ground`, `--ln-faint`, `--ln-auto`
and `--ln-gate` at an alpha (the card and dialog scrims, the vignette, the card foot, the hover tip,
the presence halos, the gated row), four white inks for one intent (62, 78, 80 and 82%), twelve
`color: #fff`, and an unnamed ladder of top-lights and shadows. A retuned token left every copy
behind, and the contrast gate read only the five `--tone-ink` values, so none of these inks was
held to 4.5:1. The registry recorded this as a design-tokens deviation for the context on
2026-10-14. The toast had the same defect and was fixed in e51c4db4; this generalises that fix to
the whole sheet.

## Decision

1. **Colour is decided only in the token block.** Every other part names a role. Roles are minted
   by recurring intent: `--ln-ink-max`, `--ln-ink-held`, `--ln-ink-settled`; the light source
   `--ln-light` with its ladder `--ln-light-1..8` and the shade `--ln-shade` with
   `--ln-shadow-lift`, `--ln-shadow-card` and `--ln-shadow-meter`; `--ln-scrim*`,
   `--ln-tip-ground`, `--ln-halo-faint`, `--ln-halo-auto`, `--ln-gate-tint`; `--ln-bath-1..4`.
2. **An alpha copy is derived, never retyped.** It is written as
   `color-mix(in srgb, var(<base>) N%, transparent)`, which paints exactly the literal it replaced
   (premultiplied mixing with transparent keeps the hue), so retuning the base moves every copy.
3. **A light or shade role spent once says why** in a comment on its own line.
4. **The gate holds it.** `test/ledgerbox-style-design.test.ts` bans a literal in any part but the
   token block and names the role that holds the value; requires every colour custom property to
   be declared in the token block; resolves every `color:` through `var()` and `color-mix()` and
   requires 4.5:1 on each of the five Ground steps (or on the rule's own fill, laid over each), at
   the opacity the sheet gives the element; and retunes five base tokens in memory to prove no
   declaration still paints the old value.

## Consequences

- Rendered pixels are unchanged except two named moves: the body inks at 78% and 82% consolidate
  onto `--ln-ink-held` at 80% (a 2% alpha move), and the card's lead-figure label loses its 0.85
  opacity, because the new contrast gate found it at 3.9:1 (settled) and 4.4:1 (alert) on the
  card's raise ground.
- A token retune is a rebinding, not a hunt. A new colour on the sheet needs a role first.
- A one-glyph separator drawn by a pseudo-element (the crumb's `/`) is exempt from the text
  contrast check as punctuation; anything else that fails is a defect.
