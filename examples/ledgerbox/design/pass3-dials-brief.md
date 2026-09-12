# `/v/dials` — the dial brief

Written **before** the direction was built, which is the whole discipline of the method. The
generator is `stitch-utilities/taste-design` as captured in `examples/tidycrm/DESIGN.md` §0: four
dials, each 1–10, that *generate* a direction rather than describe one. You read which corners of
the space are already occupied, you take an empty one, and you let the dial values dictate rules
you would not otherwise have chosen.

---

## 1. Survey — where the four existing directions sit

Every value below is inferred from the built artefact (fonts, CSS, motion configs, node counts),
not from its author's brief. The dials are: **C**reativity (how far the metaphor is pushed past
convention), **D**ensity (how much is on screen at once), **V**ariance (how much layouts differ
region to region), **M**otion (how much of the design's meaning is carried by movement).

| Direction | C | D | V | M | Canvas | Depth from | Motion engine and signature |
|---|---|---|---|---|---|---|---|
| `waterline` | 8 | 4 | 7 | 4 | light, cool blue-green `#c6d6da` | gradient + soft shadow, **no borders at all** | `motion/react`, spring 210/26, 6ms per-disc stagger. One entrance orchestration, then click-response |
| `law` | 8 | 8 | 6 | 7 | light, warm tan `#e6e1d6` | 4-step shadow ladder + hairlines + SVG grain | `motion/react`, 20 `layout`/`layoutId` uses. Signature: the Solari flap — values flip through glyphs |
| `scale` | 7 | 9 | 8 | 5 | **dark**, cool near-black `#0b0a0f` | layered light: 3 radial blooms, glass, 9% hairlines | **no `motion/react`** — CSS keyframes + two rAF loops (hold 900px/s, drift 26px/s) |
| `token` | 7 | 10 | 5 | 3 | light, cool `#e9eff1` | hairlines + grain, the flattest of the four | `AnimatePresence` + one spring 220/26; one 45° `clip-path` wipe. Nothing cross-fades |

### What the survey says

- **Motion is the under-spent dial.** The maximum in the app is 7, and that 7 is one technique
  (`layout` swapping) plus one typographic gimmick. Two directions are at 3–5. Three of the four
  use a *snappy* spring — 210/26, 210/26, 220/26 — which is the same feel three times.
- **Nothing is at 10 on any dial except `token`'s density.** The expressive far corner is empty.
- **Three of four are light.** One dark direction exists and it is cool, violet-inflected and lit
  from behind. **No direction has a coloured ground** — every canvas is a near-white or a
  near-black.
- **Status is encoded as hue in three of four.** `token` is the exception and bans red on
  principle. Hue-as-status is therefore the crowded convention here, not the daring one.
- **Swimlanes are already taken three ways**, so structure cannot be my differentiator: `law` runs
  lanes on a time axis, `scale` on a rank axis, `token` on a money axis. The owner's brief mandates
  swimlanes, so the divergence has to come from the dials, not the diagram.
- **Every direction expands in place preserving its own grammar.** A focused lane in `law`,
  `scale` and `token` is the same kind of object, larger. Nobody changes *kind*.

---

## 2. My dials

| | Creativity | Density | Variance | Motion |
|---|---|---|---|---|
| `dials` | **10** | **8** | **9** | **10** |

The empty far corner. Two of these are the highest in the app and were chosen because they are
the highest; the other two were chosen to make those two survivable.

**Creativity 10** — the metaphor is total, not applied. The board is **lacquerwork**: a dark
oxblood ground, bone ink, one vermilion. Depth comes from *sheen and translucency* — layered
washes and a single specular hairline along the top edge of every raised plane — not from drop
shadow (`law`), not from backlight (`scale`), not from hairline rules (`token`).

**Density 8** — the owner asked for lanes "overflown with data", so density has to be high, but
`token` already owns 10 by putting all 124 invoices on one shared scale with nothing paged. Sitting
at 8 is a deliberate concession of that record in exchange for the type floor: at Density 8 with a
15px control minimum I can still print a client name, an amount and a due date on every mark.

**Variance 9** — above `scale`'s 8, and the claim that makes it real is the one thing no existing
direction does: **a lane changes kind under focus, not size.** A resting lane is a strip of marks
on a rule. A focused lane is a different object — the marks fan out into a ledger with columns,
evidence and the dispatch rail. Nothing else on this board shares that structure, and no two
adjacent regions share a column grid.

**Motion 10** — the highest in the app, and the reason this direction exists. See §4.

### What the dials then force on me (this is the method working)

These are `taste-design`'s own conditional rules, not preferences:

- **Density > 7 ⟹ every number is monospace and tabular.** Binds. All figures, ids, dates and
  counts are set in the mono face.
- **Density > 7 ⟹ no cards.** Binds hard, and it is the most useful thing the method did to me. A
  mark on this board is not a box. Separation is a rule, a gap and a wash.
- **Variance > 4 ⟹ centred entry layouts banned.** Binds. The entry rail is asymmetric.
- **Motion high ⟹ spring physics, `stiffness: 100, damping: 20`, stagger `calc(var(--index) *
  100ms)`, animate `transform` and `opacity` only, perpetual loops only on live agent state.**
  Binds — and 100/20 is a *looser, heavier* spring than the 210–220/26 the other three share, which
  by itself gives this direction a different hand feel before a single colour is chosen.

---

## 3. Colour, and the one rule I am taking from a sibling direction

Exactly **one** accent, per `taste-design` §2. Three colours are reserved for governance and may
not be spent on anything else (the rule `examples/tidycrm/DESIGN.md` §2 adds, adopted here):

| Role | Meaning | Ink |
|---|---|---|
| gated | reaches a person, moves money, cannot be replayed backwards | vermilion — the single accent |
| auto | reversible; every write lands in the books and undo replays it | jade — the single counter |
| ground | everything else | warm oxblood → warm bone |

**Lateness is not a hue.** This is `token`'s discipline arrived at from the opposite direction:
`token` banned red because Aicher's Munich spectrum excludes it, and then had to encode lateness as
length and offset. Here red is *spent entirely on the gate*, so lateness cannot have it either and
is encoded as **length, vertical offset and type weight**. Hue-as-status is the crowded convention
in this app; refusing it is the cheaper way to look unlike the other four.

Never `#000000`: the ground bottoms out at a warm near-black with red in it.

## 4. The motion vocabulary — what Motion 10 actually means

Not "things fade in". Six named behaviours, each addressable:

1. **Momentum.** Lanes are thrown, not scrolled. Pointer drag with velocity carry-over, spring
   rubber-band at both ends. This is the "manipulate like in canvas" the owner asked for, and it is
   the one motion technique no existing direction has — `scale` drifts at a constant 26px/s, which
   is a conveyor, not a canvas.
2. **Autoscroll on command.** `run left` / `run right` per lane, and a board-wide sweep. Named, so
   an agent or a voice can drive it.
3. **Re-form, not re-render.** Changing the cut or the order moves every mark to its new place with
   `layout`, staggered by lane. Nothing is removed from the board when you filter — matches migrate
   to the head of their lane and the rest drift back. `law` animates re-laning; nothing animates
   *re-ordering within* a lane.
4. **Focus changes kind.** A lane opening into its ledger form is a spring, not a height
   transition, and the marks inside it re-target rather than being replaced.
5. **Figures settle.** When the books change under a dispatch, every affected figure springs to its
   new value. (`law` flips glyphs; a spring settle is a different statement — the number is a
   physical thing that moved, not a mechanism that turned.)
6. **The dispatch travels.** Athena's run is a marker that moves along the focused lane stage by
   stage and **stops dead at the gate**, where the arm control has to be held. Per `taste-design`
   §8 as amended in `tidycrm/DESIGN.md`: a perpetual loop runs *only* while a real server action is
   in flight, because a thing that pulses forever reads as "Athena is working" and she is not
   onboarded.

All of it degrades under `prefers-reduced-motion`: momentum becomes a jump, stagger becomes zero,
the travelling marker becomes a static position, loops stop.

## 5. Where I expect the method to fail me

Recorded before building so the report cannot be written after the fact:

- `taste-design` has **no spacing scale and no type scale** — the dials generate a *feel* and a
  conditional rule set, and then leave every actual number to me. Its motion section is the only
  place it ships values.
- The literal `calc(var(--index) * 100ms)` stagger is unusable at 124 marks; it will have to be
  amended and the amendment recorded.
- Dials are a divergence tool. They say nothing about whether the resulting direction is *good*,
  and nothing about the domain — the governance colour lock and the lateness-is-not-a-hue rule are
  both mine, not the method's.
