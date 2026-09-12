# hirelane `/` — the Board: brief, written before the code

Required by `DESIGN-LAW.md` §4.2 (colour lock), §4.3 (icon inventory), §3 (container model gate)
and §6 (brief inference): each of those must be declared here before a component exists. Nothing
under `components/board/` or `app/page.tsx` was written when this file was.

**Owner's brief.** `/v/caliper` proved that a 3D-dominant model does not work for this domain. So:
a 2D kanban at L0 with a column per stage and, inside it, a row per role carrying that role's
candidates as monogram and name, subtle 3D allowed as material but never as the core. L1 zooms
into one of those rows and spreads it, showing enough to
*compare* — the score dimensions where a candidate was evaluated, and metadata specific to that
stage. L2 lifts one candidate's card with the prose and the full detail, and an action panel
carrying the next step in the pipeline or a rejection.

---

## 1. LAW SIX — brief inference. Seven fields.

| Field | Answer |
|---|---|
| **Domain reading** | Two open roles, 40 applicants, five stages, five weighted criteria per role. Every score is a stored scorecard, 0-4 per criterion, carrying the applicant's own sentences as evidence. Six applicants are deliberately borderline — strong on most criteria with one clear gap — and all six sit in Backend screening. So the interesting question in this database is never "who is best", it is "which of these six is arguable, and on what". |
| **Audience & tone** | A hiring manager with no recruiter, who has to defend each move to the person it affects. Their fear is advancing or rejecting somebody on a number they cannot explain. Tone: specific, quotable, reversible where it can be. |
| **Mood adjective** | **Considered.** |
| **Layout family** | **The pinned board.** A warm bone sheet with five ruled columns; cards pinned into them. Regions in reading order: masthead → role switch and level rail → the columns → the spread, which replaces the columns in place → the card, lifted over both → the capability register in the footer. Nothing is centred. |
| **Motion signature** | **The column opens.** One gesture, used once per level: the column you pick keeps its identity and grows into the spread (shared-layout, matched by id), and the row you pick keeps its identity and grows into the card. Everything else is press feedback at `--hl-dur-1/2`. No fade-up-on-mount as the only motion (§2.1 tell 11), and no perpetual loop anywhere, because a thing that pulses forever reads as work being done and Athena is not connected. |
| **Source direction** | **The pinned assessment board** — a physical hiring board of the kind used before applicant-tracking software: ruled columns on paper stock, one card per person, a coloured tab for the ones still being argued about, and the interviewer's initials written on the card whose time is booked. |
| **Why this source for this app** | Three properties map one-to-one. (a) A physical board makes *position* the primary fact, which is exactly what a stage is, and it cannot show a score without somebody having written one — so an unscored card is visibly blank rather than quietly zero. (b) The tab on an arguable card is the borderline flag, and on a real board it is added by a person, which is the right reading: `borderline` is a stored column, not a model output. (c) A physical board has no undo, so the acts that reach a person were done at a *different place* — a desk, with the letter on it — which is where the gated panel belongs, and gives GATED a structural home rather than a badge (§7.1). |

## 1b. REVISION — the dark rework, written before the second pass

The first build of this direction was reviewed and three things were named: the
type was too small to read and its face did not help, the warm-paper theming did
not fit the domain, and L1 was a ruled table rather than a thing you would want
to look at. The layout family, motion signature and source direction below are
superseded by this section; §§2-8 stand except where this section replaces them.

| Field | Revised answer |
|---|---|
| **Layout family** | **The lit board in a dark room.** Near-black ground with a few soft grey blooms behind the content, and every panel a dull sheet of glass over it — no white paper anywhere. Regions: masthead → level rail and filters → the board → the carousel, which replaces the board in place → the dossier, a near-full-width spread over both. |
| **Motion signature** | **Nothing cuts.** Three gestures and no more. (a) The board zooms into a group: the row you picked is already a line of candidates in the carousel's own order, so each face keeps its identity and grows into its card in place (shared-layout, matched by id) rather than the level being swapped. (b) The role filter THROWS: the candidates that do not survive spin out and drop away while the survivors re-flow into the gaps, so a filter reads as the deck being sorted rather than as the page reloading. (c) A carousel card grows into the dossier and back, matched by id, one object in two states. |
| **Source direction** | **The lit contact sheet.** A dark viewing surface with the frames laid on it, the three under the loupe held at full size and the rest angled away into the dark. What is written on the sheet is written by hand in soft pencil-crayon: annotations are the only place a second voice appears, and they never carry a fact the database does not hold. |
| **Why this source** | A hiring board is a comparison surface, and a contact sheet is the genre built for exactly that: same frame, same size, same light, laid side by side, with the ones you are actually choosing between brought forward and everything else angled off. It also gives the annotation its natural home — on a contact sheet the marks in the margin are a person's, not the machine's, which is precisely the distinction this app exists to make visible. |

## 1c. REVISION — the readability pass (2026-09)

The dark rework was reviewed again, beside the two sibling tabs, and several of its own answers
were named as the reason this app read worst of the three. §§1b, 2, 3 and 7 stand except where this
section replaces them.

| What was named | What it is now |
|---|---|
| **Eight tracked-out all-caps micro labels at 11px** — `11 SCORED`, `16 DAYS IS THE LONGEST WAIT`, `24 OF 55 CRITERIA EVIDENCED`, `THEIR ANSWER`, `IN THEIR OWN WORDS`, `WORTH A LOOK`, `AUTO — REVERSIBLE, EACH WRITES AN UNDO`, `[ ] GATED — REACHES ADA OKAFOR` | **One label style.** `--bd-label`, 12px, sentence case, the text face, `--bd-ink-3` or better. Capitals and tracking encoded nothing; they were a texture applied to whatever happened to be small. A figure line keeps the mono face for its digits and nothing else. |
| **The handwriting face** on every annotation | Gone, and `Caveat` is no longer loaded. The second voice is still marked — italic, `--bd-mark`, the text face at the reading size, and the only italic on the surface — but the face itself put every note below the legibility floor the rest of the rework raised. See §3. |
| **The L0 pile**, up to fourteen faces with the tuck solved to fit the column | A **cluster**: six faces at a fixed 8px tuck, each showing its whole monogram, and a `+N` counting the rest exactly. |
| **The fit rule**, a 180px tick line under every group | Words. `6 of 7 scored · best 2.6 · 6 arguable` — the three figures the ticks were being scanned for, at the label size. A structural device has to encode something a reader can decode. |
| **Five columns stretched to the tallest**, so Offer's one card sat in four fifths of a dark panel | `align-items: start`. Ragged feet, honest columns. |
| **The capability register**, sixteen tool names in monospace across the page foot | A count and a disclosure — `16 capabilities offered · 3 gated`, with the names one click behind it. See §7 and DESIGN-LAW §4.1. |
| **The masthead**, a slogan headline over a hardcoded "Athena is not connected yet" | The headline states — `40 applicants, 2 open roles, 6 still arguable` — the slogan is the deck under it, and the presence line is a reading. |
| **L1 card bodies overflowing their own track**, printing the criterion rows over the stage fact at the foot | Fixed twice over: the foot gave back the height, and a card in a short rail lays its criteria on one line each with the bar as the row's own underline, so nothing is dropped and nothing is clipped at 1440x900 or at 1024x768. |
| **Seven control shapes** across the chrome | One: `--bd-control` high, `--bd-radius-round`, `--bd-text-sm`, one focus ring. |

The minimum type size on the surface is 12px and every label clears WCAG AA against the panel it
sits on, which is why `--bd-ink-4` moved from `#6b6b77` (3.8:1 on `--bd-void`) to `#83838f`
(5.3:1). Files: `components/board/presence.ts`, `components/board/register.ts`,
`components/board/columns/facts.tsx`, `components/board/columns/stacking.ts`,
`components/board/style/base/tokens.css`.

## 2. LAW FOUR §4.2 — the colour lock

Ground/ink pair plus **four** hue-bearing tokens. Two are spoken for by law and appear nowhere else.

**Revised for the dark rework.** The ground/ink pair inverts, and all four hues
become pastels, because on a near-black ground a saturated hue reads as a
warning light and there are only two things here entitled to read that way.

| Token | Value role | Meaning — locked |
|---|---|---|
| `--bd-ground` / `--bd-ink` | near-black / white | the pair, not counted against the four |
| `--bd-auto` | pastel mint | **AUTO.** A reversible act. Used for nothing else, ever. |
| `--bd-gate` | pastel coral | **GATED.** An irreversible act that reaches a person. Used for nothing else, ever. |
| `--bd-accent` | pastel sky | structure: the open group, the level rail, the rule under a heading |
| `--bd-mark` | pastel butter | the borderline flag and the named gap — the two things a person flagged |

Fit is **not** a hue. Strong, worth-a-look and thin are expressed by bar length and rule weight, so
the surface passes the greyscale test and so no third hue competes with `auto` and `gate`. The
unscored are expressed by absence: no bar at all, and an em dash where a number would be.

## 3. LAW FOUR §4.3 — the icon inventory

`lucide-react` is **not used**. Four marks, all bespoke inline SVG, all drawn for this app:

1. **The gap** — a ruled line broken in the middle, drawn at the criterion with no evidence.
2. **The stage ladder** — five rungs, the reached ones inked.
3. **The monogram** — initials in a disc. Type, not an icon; there is no photograph in this database
   and nothing standing in for one.

There was a fourth, **the gate** — a two-stroke bracket that closed when the control armed. Removed
in the readability pass (§1c): it rendered as `[ ]` in front of the gated band's sentence, which
reads as an unchecked checkbox, i.e. a control, in front of the one region on the surface whose
whole point is that nothing in it is armed until you arm it. The class band carries its state in
words and in the surface it is drawn on, which is what §7.1 asks for.

**Type, revised twice.** `Sora` for display, `Plus Jakarta Sans` for text, `JetBrains Mono` for
every figure. The reading sizes start at 15px and the board's own names at 17px, which is the first
readability complaint answered directly.

There was a fourth face, `Caveat`, for annotations only, rationed so it could never be mistaken for
a machine-produced fact. The rationing was right and the face was wrong: its drawn size sits well
below its point size and its stroke contrast is low on a near-black ground, so every note on the
surface — the margin note at L1, the band notes and the bench note at L2 — landed under the
legibility floor this whole pairing was chosen to raise. The second voice is kept and re-marked:
the text face, italic, at the reading size, in `--bd-mark`, and the only italic on the surface. The
distinction survives; the illegibility does not (§1c).

## 4. LAW THREE — the container model gate

| Concept | Shape of the data | Required container | Forbidden |
|---|---|---|---|
| 40 applicants across 5 stages and 2 roles | two categorical axes, position is the fact | **a column per stage, and one row per role inside it**, the faces in a single line whose stacking follows the count (1-2 full name, 3-4 first name, 5+ faces overlapping by a distance solved from the line's own width) | a table with a stage column; one flat list per column that loses the role; a wrapped grid of faces, which cannot become the carousel below it |
| One group's candidates, for comparison | 5 comparable 0-4 scores each, plus one stage-specific fact | **a carousel whose three centre cards are held at full size**, each carrying all five criteria on a shared 0-4 baseline | a card grid where every card is equal (nothing is under the loupe); a radar chart; one overall number with the dimensions hidden |
| Two candidates, head to head | same 5 criteria, signed difference | **widest-gap-first diff list**, each side quoting its own evidence | two cards side by side leaving the reader to subtract |
| One candidate | prose plus 5 scored criteria plus history | **lifted card**: identity, prose, then evidence per criterion | a modal with the evidence collapsed behind a disclosure |

## 5. LAW FIVE — divergence from `/v/caliper`

> **SUPERSEDED — see §5b (2026-09).** Everything below this line is the round-3 record: the
> divergence as it was written, before the dark rework, against a direction that has since been
> reviewed out. Three of its `board` positions are the *old* ones — §1b inverted the ground, took
> the depth grammar down to one lift, and replaced the type pairing — so read this table as history
> and §5b as the claim. The `caliper` column describes `/v/caliper`, which has no route and no
> component tree in this working tree; it is in git history.

Seven axes; `board` is opposite on six, which clears the §5 threshold of five.

| Axis | `caliper` | `board` |
|---|---|---|
| Ground | dark room | warm bone sheet |
| Primary object | a bar against a gauge wall | a card pinned in a column |
| Depth grammar | real 3D, WebGL, camera | layered light and a rule ladder; 3D only as card material |
| Primary axis | score, along a wall | stage, across columns |
| Type voice | Archivo / Literata / Martian Mono | Fraunces / Manrope / Space Mono |
| Unscored | a full-length blank bar waiting to be cut | no bar at all, and an em dash |
| Comparison | read two bars against one wall | signed diff list, widest gap first |

## 5b. REVISION — where the direction actually stands (2026-09)

`/v/caliper` was reviewed out of the working tree along with the shipped `prime` design, and for a
while `/` redirected to a direction index listing the one direction that survived. **There is one
direction here, not two**, so the index and its route were removed and the Board became the root
route: `app/page.tsx` renders it and `app/layout.tsx` loads its four faces. The pre-ship gate is
answered on those terms rather than against a column that cannot be opened.

**DESIGN-LAW §9.8 — not applicable to this pass, and that is the answer, not a skip.** §9.8 asks
whether the two variants take opposite positions on ≥5 of §5's seven axes. There is one variant. The
divergence rule is a defence against building one variant twice, and a single-direction pass cannot
fail it; it also cannot pass it. The next direction built in this app inherits the obligation, and
the table it has to clear five of is the one below, not the round-3 one above.

**DESIGN-LAW §9.9 — the same.** A reason to prefer A over B needs a B that renders.

What §5's seven axes say about the direction that does ship, so the next brief has something real
to be opposite to. Each row is checked against the code named beside it:

| Axis | `board`, as shipped | Where it is decided |
|---|---|---|
| Ground | near-black room; every panel a dull sheet of glass, no white paper anywhere | `style/base/tokens.css` — `--bd-void: #060607`, `--bd-ground: #0a0a0c`, `--bd-ink: #ffffff` |
| Primary object | a face in a group, a group in a stage column | `components/board/Columns.tsx` and `components/board/columns/` |
| Depth grammar | one bloom and one lift; hairline rules; no drop shadow on a card, and no WebGL | `tokens.css` ships exactly one elevation, `--bd-elev-lift` |
| Primary axis | stage, across columns | `lib/constants.ts` `STAGES` |
| Type voice | Sora display / Plus Jakarta Sans text / JetBrains Mono figures | `app/layout.tsx` — the three `next/font/google` faces |
| Unscored | no bar at all, and an em dash where a number would be | `components/board/carousel/Slide.tsx:107` |
| Comparison | signed diff list, widest gap first, each side quoting its own evidence | `components/board/model/order.ts` `diff()` |

## 6. LAW FOUR §4.1 — copy allow-list compliance

Above the fold this direction uses only: `Hirelane`; `role.title`, `role.team`, `role.brief`,
`role.question` from the database; `STAGE_LABEL` and `SCORE_LABEL` strings verbatim; counts and
scores from the stored scorecards; the orienting line **"Every score points at the sentence that
earned it."**, now set as the deck under a headline that states rather than as the headline itself;
and the honesty line as a live reading, visible without interaction — **"Athena is not connected.
All 16 capabilities are registered and waiting — 3 of them gated."** when no bridge is in the page,
and the connected form when one is.

The honesty line was a verbatim string and DESIGN-LAW §4.1 required it to be. Both were amended in
the readability pass, and the law carries the reasoning: a sentence that cannot become false is not
an honesty mechanism, it is a caption — and this is the one line on the surface a recorded
walkthrough turns on. `components/board/presence.ts` is the reading and
`components/board/register.ts` is the count the masthead and the foot both read, so the page cannot
claim sixteen capabilities in one place and something else in the other.

## 7. LAW SEVEN — where the gate lives

The four AUTO acts (`score_against_rubric`, `add_note`, `move_stage` to screening or interview,
`propose_slots`) sit in the card's body, at `--hl-rule-1`, on the sheet.

The three GATED acts (`decide_stage` to offer or rejected, `send_scheduling_email`,
`send_rejection`) sit in a physically separate region at the foot of the card — inverted ink,
`--hl-rule-3` — and each arms before it fires, naming the candidate and what cannot be taken back.
Greyscale the page and the three are still the only inverted block on it.

The capability register (§7.4) is in the board's own footer, not only in the kit's drawer — but
the claim on the surface is the COUNT, not the identifiers: `16 capabilities offered · 3 gated`,
visible without interaction, with the names one click behind a disclosure that keeps their two
class bands. Sixteen `snake_case` symbols set in monospace across the page foot is a protocol dump;
it cost the level above it the hundred and eighty pixels its cards needed, and nobody reads it. The
class of every capability is still computed from the manifest's own rule, never typed (§1c).

## 8. LAW EIGHT — data honesty

Every figure is computed in `lib/board/`, a server module, from `lib/queries.ts` and the stored
scorecards. No mock array exists in any component. `lib/` schemas and seeds and
`components/HostCapabilities.tsx` is untouched by this direction's visual work; what changed in it
is the route it mounts on, because there is one route now and both tool sets belong on it. The
capability list both files spread from is `lib/manifest.ts`.

Two derived figures and where they come from, since neither is a raw column:

- **Fit band** — two floors on this app's own weighted 0-4 rubric, `2.8` and `2.2`. Two floors
  rather than one pass mark, because a single threshold throws away the middle, and the middle is
  where all six borderline applicants live.
- **Evidence band** — the share of a candidate's five criteria that carry at least one quoted
  sentence, banded tight / moderate / wide, with the unevidenced criteria named. It is a statement
  about how much of the rubric the application speaks to, never a probability, and it is shown
  beside the score so a thinly evidenced 3.4 cannot be read as the same claim as a well evidenced
  one.
