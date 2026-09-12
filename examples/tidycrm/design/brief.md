# Design brief — tidycrm variants

Produced by following `plugin87/ux-ui-agent-skills`. Its `apply-aesthetic` skill makes **Brief
Inference** step 1 and refuses to let you generate before deciding: "If you can't name the mood and
the layout family, you will regress to the mean." The six fields below are its required fields.

The two directions are the archetype index's own opposite poles for a data-dense, agent-governed
product: archetype 3 (Industrial Brutalism / Tactical, "data-heavy dashboards, dev tools") and
archetype 2 (Editorial Minimalism). Picking from the index rather than deriving a scale is what makes
them arguable against each other instead of two tints of one idea.

---

## Shared domain reading (`docs/design.md` §4.6.4)

- ~800 contacts, seeded defects: 60 near-duplicate pairs, 120 malformed phones, stale records,
  10 conflicting company names.
- **The gate is merge-and-delete.** Those two destroy identity and are the only `GATED`, irreversible
  actions. `normalize_fields` is `AUTO` *because* every field change lands in `revisions` and can be
  replayed backwards. Reversibility buys the AUTO class, not harmlessness.
- **Provenance means the named rule that fired and what it saw** - `Evidence { rule, label, weight,
  detail }` from a hand-weighted table in `lib/matching.ts`. Confidence is the sum of the weights,
  capped at 0.99. It is never a model score. A variant that renders confidence as a bare percentage
  and hides the evidence has lost the domain.
- The design doc names its own risk: *"visually flat; the decision card and the live progress strip
  carry the demo."* Both variants are answers to that sentence.
- Athena is **not onboarded**. Copy must say so. The design shows where she will live and which
  actions would be hers, in the present tense of the manifest, not in the past tense of work done.

---

## Variant A — `signal`

| Field | Decision |
|---|---|
| Industry / domain | Developer-grade data instrument. An agent runtime with a console, not a CRM. |
| Audience & tone | Expert operator, keyboard-first, doing triage at volume. Calm, exacting, unsentimental. |
| Mood adjective | **Instrumented.** The result must feel like a machine you can read the state of. |
| Motion depth | Subtle feedback plus one signature: a slow emerald power-on pulse on the work lane. Nothing bouncy - the source spec forbids fast motion as contradicting "engineering precision". |
| Layout family | Full-bleed instrument header -> asymmetric 7/5 split (lane + evidence) -> dense index table -> gate band. No two adjacent sections share a column structure. |
| Reference anchor | `design-systems/library/voltagent/DESIGN.md` (26.7 KB, Tier B brand-extracted). |

**Why this source for this app.** VoltAgent is literally an AI-agent framework, and its depth system
is the reason it was chosen over the other dark candidates: *"VoltAgent communicates depth primarily
through border weight and color, not shadows"* - a 1px -> 2px -> 3px ladder that shifts
`#3d3a39` -> `#00d992`. That ladder is a free encoding for exactly the distinction this app is about:

- `1px #3d3a39` - a record nobody has touched.
- `2px #00d992` - the agent has an opinion here (evidence, a proposed merge).
- `3px` + amber - a human gate stands in front of this action.

The gated/auto distinction becomes the *structural* property of every surface rather than a badge.

## Variant B — `broadsheet`

| Field | Decision |
|---|---|
| Industry / domain | Editorial / publishing. The contact list as a printed record with an audit trail. |
| Audience & tone | A careful reader signing off on someone else's work. Literate, accountable, unhurried. |
| Mood adjective | **On the record.** Every decision reads as something that will be printed with a byline. |
| Motion depth | Almost none, by doctrine. Hover is a colour swap, ~150ms, on text only. The one exception is the ledger settling when a decision is filed. |
| Layout family | Black section ribbon -> editorial stack with a narrow measure -> hairline-ruled index -> full-bleed inverted footer. Rules and whitespace separate things; there are no cards. |
| Reference anchor | `design-systems/library/wired/DESIGN.md` (22.9 KB, Tier B brand-extracted). |

**Why this source for this app.** Three properties of the spec do real work here:

1. **`border-radius: 0` is law and there is exactly one shadow token in the entire site** (a
   `0 0 0 transparent` placeholder). Depth is hairline rules and inversion. That is a natural grammar
   for a dense table, which is what this app mostly is.
2. **A WiredMono ALL-CAPS kicker sits above every headline.** That is a ready-made provenance
   annotation system: `EMAIL EXACT - WEIGHT 0.45` above the pair it justifies.
3. **Hover is a full inversion** on buttons (white/black to black/white, 150ms, colour only). A merge
   confirmation that inverts to solid black is more physically consequential than any red fill,
   without introducing a colour the palette does not have.

Divergence check: opposite canvas (near-black vs paper), opposite depth grammar (border weight vs
rules and inversion), opposite type (grotesque + mono vs serif display + serif body + mono kicker),
opposite motion budget. A reviewer can prefer either for stateable reasons.

---

## Contrast adjustments the gate forced

Measured with `scripts/contrast.py`, not reasoned. The Library Contract is explicit that a brand hex
which fails contrast must be adjusted, because taste never overrides POUR.

| Variant | Role | Spec value | Measured | Shipped value | Now |
|---|---|---|---|---|---|
| signal | border, essential controls | `#3d3a39` | 1.69:1 on `#101010` | `#6b6764` for `border.strong`; `#3d3a39` kept for decorative card edges only | 3.40:1 |
| broadsheet | feedback.error | `#e53e3e` | 4.13:1 on white | `#c62828` | 5.62:1 |
| broadsheet | link on inverted footer | `#057dbc` | 3.87:1 on `#1a1a1a` | `#4aa8e0` | 6.60:1 |

One value I expected to fail did not: WIRED's Caption Gray `#757575` on white measures **4.61:1** and
passes AA. My own arithmetic had it at 4.48 and failing. This is the reference's "never state a number
you did not measure" rule catching a wrong number in the direction of unnecessary work.

Deficiencies the source specs disclose about themselves, and which are fixed in both variants:
WIRED signals input focus "by the blinking caret only" and its mono nav links are ~32px tall. Both
variants ship a real 2px focus ring and pad every target to >= 44px.

## Font substitution

Both sources use proprietary faces. The specs carry named open-source substitutes plus metric
corrections, which is used here verbatim.

- `signal`: Inter (body/UI) + Inter Tight (display) + JetBrains Mono (code, kickers at 2.52px tracking).
- `broadsheet`: the spec's own substitution note - *"Playfair Display or Libre Caslon ... loosen
  display line-heights by approximately +0.10 to +0.12 (e.g. 0.93 -> 1.05)"*, Apercu -> Work Sans
  "at the token values without adjustment", BreveText -> Source Serif 4 likewise. So: Playfair
  Display at line-height **1.05**, not the spec's 0.93; Source Serif 4 body; Work Sans UI labels;
  IBM Plex Mono kickers. All self-hosted through `next/font`, no runtime font requests.
