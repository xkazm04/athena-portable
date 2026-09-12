# Pass 3 — `token` — Brief Inference

> **STATUS — HISTORY, kept for the record.** The `token` direction was cut in `f9664e6`. Its DTCG
> input survives at `design/tokens/token.tokens.json` and `design/build-tokens.mjs` still points at
> this brief, so the pair is readable together; nothing in the shipping direction depends on either.
> The register of every direction the repo has held is `DESIGN.md` §11 and `design/SITE.md`.

The `plugin87/ux-ui-agent-skills` method, run properly, is two halves. Round 2 measured that half 2
alone — DTCG primitive → semantic → component, built to CSS — reproduces Tailwind gray-plus-blue,
and that **all the direction came from half 1**. So half 1 is written first, in full, before a
single token is chosen.

## First attempt, and why it was thrown away

The first pass of this brief named **Otl Aicher's system for the 1972 Munich Olympics** as the
source direction: silver ground, reserved red, pictograms on a 45°/90° construction grid. It
derived cleanly and it was wrong, because a survey of the two directions being built beside this
one in the same app found:

- `law` had already taken warm paper, graphite ink, **hatch = unexamined**, a reserved redline for
  deviation and a reserved greenline for checked, the 45° drawing convention, and **Archivo**.
- `scale` had already taken **ISOTYPE — the Vienna Method** (Neurath and Arntz), which is the
  direct ancestor Aicher built the Munich pictograms on.

Three directions in one lineage is one direction. This is the strongest argument for the Brief
Inference step that I can offer: **naming a real source is what made the collision visible.** A
mood adjective and a palette would have collided silently, because "forensic, paper, one reserved
red" describes all three. Naming *Aicher* and reading *Neurath* next to it made it a fact.

## The six named things

| | |
|---|---|
| **Domain** | Contact-record data quality. 800 seeded rows, five defect classes, 60 open near-duplicate pairs, grouped into **blocks** by email domain. The work is triage: what has not been examined, what deviates, which agent to send. |
| **Audience** | A RevOps data steward judged on record hygiene. Not a browser of tables — a dispatcher who wants to send work and see it land. |
| **Mood adjective** | **Accrued.** Not clean, not premium, not forensic (that is `law`'s). Accrued: the surface is a record of work that has built up, and the eye reads *how much has been made* before it reads any number. |
| **Motion depth** | **7/10.** The signature is a **shuttle pass** — a dispatch travels across the field left to right, setting each block as it reaches it. Also: filtering re-threads, figures settle, the cloth line advances. No perpetual loop except while a real job runs; Athena is not connected and nothing may imply she is working. |
| **Layout family** | **Loom.** A fixed head-beam (coverage at display size, the agent roster, the live pass) above a **draft matrix**: blocks are warp columns, agent passes are weft rows, and the cloth grows downward as work accrues. Not a sheet with a treemap (`law`), not a ranked register of unit marks (`scale`), not a card grid, not swimlanes. |
| **Named source direction** | **The Bauhaus weaving workshop and Anni Albers' *On Weaving* (1965) — the woven draft.** |

## The source direction, described so it can be checked

The draft (or "point paper") is the weaver's notation, and it is a genuine published design
language with laws, not an aesthetic:

1. **Warp and weft are not interchangeable.** The warp is the fixed set held under tension before
   any work begins. The weft is what passes through it and changes the cloth. The draft records the
   binary state of every intersection: over, or under.
2. **Point-paper is binary, never shaded.** A cell is set or it is not. Quantity is read as area of
   set cells, not as a value ramp.
3. **Unwoven warp is visible.** Above the cloth line the warp threads are bare. You can see, at a
   glance and without a number, exactly how much has not been made yet.
4. **Colour comes from a small set of named dyes.** Albers worked in indigo, madder, weld and
   undyed flax. A dye is a material fact with a name, not a hue chosen for contrast.
5. **The selvedge is the finished edge.** Once bound, it cannot be unpicked without destroying the
   cloth.

## The derivation — why this source, for this app

Each law resolves a stated requirement in the owner's brief. This is what makes it a derivation
rather than a mood board:

- **Warp = blocks, weft = agent passes.** The brief says *"Athena would be able to dispatch in demo
  agents"* — plural, fanning out, reporting back per block. A draft is precisely a record of which
  passes crossed which columns and what happened at each intersection. Both sibling directions show
  **current state only**; this one shows **the history of agent work per block as accumulated
  cloth**. That is the differentiating idea of the whole variant.
- **Unwoven warp = the percentage of not-yet-analysed data.** The brief asks for that figure. Here
  it is not a bar and not a hatch — it is the bare warp standing above the cloth line, occupying
  its true share of the field. One law, read on the head-beam figure and on every column at once.
- **Point-paper binarity** forbids the value-ramp heatmap this matrix would otherwise become. A
  cell is set or bare; the *cause* is carried by dye, not by lightness.
- **Four dyes, named, reserved.** `indigo` is structure and carries no meaning. `weld` (yellow) is
  unexamined. `madder` (red) is deviation and appears **nowhere else**. Undyed `flax` is clear.
  A fifth, `verdigris` (green), means healed by an agent and appears **nowhere else**. This is
  exactly the owner's Standing-ledger constraint — *"black and white color shades, using minimally
  green and red to point out key data nodes"* — with the two reserved hues bound by a law rather
  than by restraint.
- **Selvedge = the gate.** `merge_contacts` and `delete_contacts` destroy identity and cannot be
  replayed backwards. They are drawn as binding the edge: arm, then fire, then the edge is finished.

What this direction is *not*: not gray-plus-blue (an indigo-dyed ground with flax highlights, and
every hue bound to a named state), not the banned AI-neon aesthetic (no glow, no gradient fill, no
purple button), and it shares no face, no ground, no motion signature and no overview container
with `wild`, `signal`, `broadsheet`, `law` or `scale`.

## Typography

The owner rates the typography of `wild` and `signal` and explicitly nothing else about them. Read
across the two, what is being rated is a **three-role system: a distinct display face used at real
size with tight negative tracking, wide-tracked capitals for kickers, and monospace tabular
figures.** That strategy is carried forward. The faces are not, and cannot be — fifteen faces are
already spent across this app.

| Role | Face | Why |
|---|---|---|
| Display | **Familjen Grotesk** | A grotesque with genuine width and a high-waisted `G`/`R`; holds a 56px figure without looking like a default. Variable weight. |
| Body / UI | **Instrument Sans** | Tall x-height, open apertures, reads at 17px inside a 288px container. Variable weight. |
| Figures | **Spline Sans Mono** | Tabular, slightly warm, and not JetBrains/DM/IBM/Azeret/Martian. |

Base body is **17px**, not 16px, and no role in the system sits below 13px. The owner has now
complained twice about default-small type; the ladder starts a rung higher on purpose, and the
ladder is numeric so it can be shifted as a whole (see `design/tokens/token.tokens.json`).

---

# The token-pipeline experiment — measured result

Wave 2's `/v/scale` agent proposed that `build-tokens.mjs` should emit **references**
(`"$value": "{space.5}"` → `var(--space-5)`) rather than literals, with a numeric ladder
underneath, because relational operations are otherwise inexpressible. This direction was built to
test that. Three things were measured.

## 1. One of the premises was wrong

The claim was that these token files emit "50+ colour tokens and **zero spacing tokens**", and a
type ramp of "nine unrelated role names with no neighbours".

Half of that is right and half is not:

| | `signal` | `broadsheet` | `token` |
|---|---|---|---|
| colour | 50 | 55 | 55 |
| **space** | **12** | **12** | **12** |
| size | 11 | 11 | 9 |
| type roles | 9 | 10 | 9 |
| **type ladder** | **0** | **0** | **9** |

`signal` and `broadsheet` already ship `--space-0` … `--space-11`, a numbered ladder with real
neighbours. What they lack is (a) a **type** ladder — the nine roles are unrelated names — and
(b) any **semantic layer above** the space ladder, so components reach for `--space-6` directly and
"loosen the whole surface" means editing every call site rather than one definition. The gap is not
missing spacing tokens; it is a missing *role tier over* the spacing tokens.

## 2. Reference-preserving emit composes — for everything except colour

`--refs` is an opt-in flag. Without it the emitter is byte-identical: `signal` (125 properties) and
`broadsheet` (127) were rebuilt and `diff` reports no change, so nothing kept was disturbed.

With it, on this direction's token file:

```
token: wrote 135 custom properties -> ../components/token/token.tokens.css
  --refs: 38 references preserved as var(); 27 flattened to literals (27 -> primitive.*).
```

**Every single failure is the same failure**, and it is structural rather than incidental. The
emitter deliberately does not name `primitive.*` — that suppression *is* how the three-tier rule is
enforced ("give a component no name to reference"). A reference can only be preserved when its
target has a custom property on the other end. So:

- `font.size.body → {step.2}` becomes `--text-body: var(--step-2)` ✔
- `gap.stack → {space.6}` becomes `--gap-stack: var(--space-6)` ✔
- `shape.control → {radius.2}`, `motion.pace.settle → {motion.duration.3}` ✔
- `shadow.panel` keeps `var(--color-border-hair)` inside the shadow string, so it now follows the
  theme instead of freezing a hex ✔
- `component.cell.set → {semantic.state.healed}` becomes `var(--color-state-healed)` ✔
- `semantic.surface.field → {primitive.indigo.950}` **cannot** be preserved ✘ — 27 of these

**Reference-preserving output and primitive suppression are mutually exclusive for colour.** You
can have the three-tier guarantee or you can have a live semantic→primitive link, not both, unless
primitives are emitted under a private prefix — which hands components exactly the name the rule
exists to withhold. That is a real trade and the reason to reject a blanket "always emit refs".

## 3. The ladder earns its keep on the axis it can reach

`token.css` ends with a `[data-reading]` block: three reading modes that re-point nine `--text-*`
roles and eight `--gap-*` roles one rung along their ladders. Measured in the browser:

| | close | normal | wide |
|---|---|---|---|
| body copy | 13px | 15px | 17px |
| band rhythm | 44px | 60px | 84px |

Seventeen lines of CSS, once, and every component follows without knowing the block exists — because
each role is a `var()` into a numbered ladder rather than a literal. With flattened literals the
same feature is seventeen new values plus a second set of component rules to apply them, and "one
rung" is not a thing anyone can say. This is also the direction's answer to hands-free operation:
`reading` is an enumerated lever, so it is addressable by name.

**Recommendation:** adopt the numeric ladder and the semantic role tier over it; adopt
reference-preserving emit for `step`, `space`, `radius`, `size` and `motion`; leave colour flattened
and keep the primitive suppression. That is the shape the measurement supports.
