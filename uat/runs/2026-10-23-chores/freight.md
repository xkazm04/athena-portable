# Chores UAT, freight area walk (L1 + LC evidence)

- **Category:** freight · **chores:** 12 (carrier-accessorials, customs-protests, denied-party-screening,
  driver-qualification-files, duty-drawback, freight-claims, ifta-quarterly, isf-filings, lease-operator-escrow,
  ocean-demurrage-disputes, oversize-permits, parcel-guarantee-refunds)
- **Characters:** dario (three-truck owner-operator, English is his second language) and lorna (importer's office
  and compliance manager, 22 years). All 12 chores x 2 Characters = 24 pairs.
- **Pairs:** 24 complete, 0 failed (`proving-runs/chores-uat/2026-10-23-chores/pairs/*--{dario,lorna}.json`).
  Every onboarding ended `clear` in 1 to 3 rounds and every brief was approved. Every rehearsal finished (`done`): 18 with
  a dollar figure, 6 `shaped` (no figure claimed).
- **Cost of these pairs:** $50.36 total (sum of `cost_usd`), $2.10 a pair on average.
- **Journeys:** J7 (catalogue -> topic -> studio -> brief) and J8 (showcase/rehearsal -> Start for real -> Due/Runs).
- **Verdicts:** J7 **L1-conditional**. It completes, but major trust findings remain open. J8 **L1-conditional**.
- **Severity rule** (derived, not picked): the impact levels score low=1, med=2, high=3, summed over frequency,
  reachability and trust erosion. 9 = blocker, 7-8 = major, 5-6 = minor, 4 or less = polish.

## How the judge evidence was weighed

The blind judge never saw the rendered UI. It saw what `src/athena/proving/chores_uat/judge.py:176-217` and
`numbers.py:301-321` built for it. Three of its most repeated complaints therefore describe the harness, not the
product. I checked each one against the code:

| Judge claim (how often it came up) | What the code renders | Verdict |
|---|---|---|
| "it found $X" carries no invented-data label (Dario C4 fails 8/11; Lorna C3 fails 11/11) | `showcase.tsx:113-119` puts "found in the rehearsal, on invented data" right beside the figure. The judge got "it found $X" (`judge.py:156-159`) | **refuted** for the showcase. **Stands** for the topic page's "Filed on the bench" figure, because "bench" is not a word Dario can decode (freight-09) |
| "Verdict: Exceeds (n=1)" sits on the page (most pairs) | `verdictOf()` (`modules/playbooks/model.ts:112-152`) is not rendered by any chores scene (grep for `.sentence`, `.sample` and `verdict` under `scenes/chores`: 0 renders) | **refuted**. The hidden n=1 makes "33x faster" look more certain (freight-05) |
| "The page promise is one long jargon sentence" (Dario C1, 12/12) | `topic.tsx:160-164` renders `p.brief` (short bullets) and shows `promise` only when the brief is empty. All 12 freight briefs are set. The catalogue tooltip is `lead(brief)` too (`catalogue.tsx:87`) | **refuted**. What does stand is that the brief describes the persona's business and outcomes with no "example" label (freight-23) |
| "She asked what she could read from my accounts" | At adopt time she has no access to the person's accounts, and the interview prompt forbids asking what public rules answer (`adopt/prompts.py:66-67`). Asking which apps they use is legitimate | **refuted**. The real defect is that the options she offered were the playbook's invented app names (freight-06) |

The judge's pass rate is still reported (it is the LC evidence), but read it as a lower bound biased by these artifacts.

## Scorecard

Honest numbers are counted with the rubric's units over every NUMBER a first-time Character meets on the J7 and J8
path: the catalogue row (3), the topic brief's figures, the KPI tiles (5), the flow note and result (3), "Worth $X" (1),
and each Character's showcase result (1 + 1). Turn counters and slot counters are navigation, so they are not counted.
Jargon is the distinct rubric words per screen, given as catalogue / topic / studio. "claim" is exempt where it is
the chore's own field term.

| Chore | Honest (h/n) | Jargon met | Onboarding ended (D / L) | Rehearsal (D / L) | Adopt (D / L) | Judge pass (both, n) | Field reliability |
|---|---|---|---|---|---|---|---|
| carrier-accessorials | 6/16 | 4/6/7 | clear r1 / clear r1 | $1,580 / $1,580 | maybe / maybe | 2/12 | sound |
| customs-protests | 6/18 | 4/7/7 | clear r2 / clear r3 | $10,998 / $10,998 | maybe / maybe | 1/10 | sound (one citation unverifiable offline) |
| denied-party-screening | 4/19 | 4/7/7-8 | clear r1 / clear r1 | **$10** / shaped | maybe / maybe | 2/10 | issues (economics shown as $0 and $10) |
| driver-qualification-files | 3/18 | 4/7/7 | clear r3 / clear r2 | **$540** / **$540** | maybe / maybe | 1/10 | sound rules, value over-scaled |
| duty-drawback | 5/18 | 4/6/8 | clear r3 / clear r2 | shaped / shaped | maybe / maybe | 3/9 | issues |
| freight-claims | 6/18 | 4/6/7 | clear r2 / clear r2 | $6,920 / $6,920 | maybe / **no** | 1/11 | sound (brief-level deadline error) |
| ifta-quarterly | 4/16 | 4/7/7-8 | clear r1 / clear r2 | shaped / **$1,844.83** | maybe / maybe | 2/11 | issues (value model wrong) |
| isf-filings | 4/15 | 4/7/7-8 | clear r2 / clear r1 | shaped / **$25,000** | maybe / maybe | 3/11 | issues (value and "found") |
| lease-operator-escrow | 5/24 | 4/6/7 | clear r2 / clear r1 | $1,538.77 / $1,538.77 | maybe / maybe | 1/11 | issues (value = whole escrow) |
| ocean-demurrage-disputes | 6/18 | 4/7/7 | clear r2 / clear r1 | $5,475 / $5,475 | maybe / maybe | 2/10 | sound |
| oversize-permits | 4/16 | 4/7/7-8 | clear r1 / clear r1 | **$392.50** / shaped | maybe / maybe | 1/10 | sound rules, weight shown as filed money |
| parcel-guarantee-refunds | 6/17 | 4/6/7 | clear r1 / clear r1 | $269.85 / $269.85 | maybe / maybe | 2/12 | sound |
| **Category** | **59/213 = 27.7%** | | 24/24 clear | 18 $, 6 shaped | 23 maybe, 1 no, 0 yes | **21/127 = 16.5%** | 6 sound, 6 issues, 0 wrong |

A figure in bold is a rehearsal "found" figure that is not money at all: a count weight ($1 per order), a protection
weight ($5,000 per ISF), a price-avoided weight, or tax credits.

**What counts as honest in every chore.** The "Traps avoided x/y on the bench" tile, the flow's "walked past x of y
traps" note, and the result line "N of M claims right": each names its source (in jargon) and agrees with the others.
The showcase's "found ... on invented data" and the shaped "N cards proposed ... no dollar figure is claimed" are honest
where the unit is real money.

**What is dishonest in every chore.** The catalogue's time and value cells. The Value tile ("for the persona" is not a
source). The three Time-saved figures. "Worth $X ..." in Make it yours. Every figure inside the topic brief, which are
the persona's bench outcomes and law figures (180 days, 30 days, 45 days, 99%), shown with no label and no source.

**Time saved once review is counted** (`numbers.json`; the review line is computed but not rendered, freight-05). The figure
shown against the honest one: carrier 33x/16.7x, customs 99x/59.6x, denied 24x/8.4x, DQ 40x/17.2x, drawback 91x/62.8x,
freight-claims 34x/25.3x, IFTA 92x/42.7x, ISF 45x/23.2x, lease 48x/26.7x, ocean 57x/29.1x, oversize 30x/18.5x,
parcel 20x/11.2x. Against the Characters' own expectation of time with the app (Dario 25 min, Lorna 40 min), the
honest ratios fall to roughly 2x-12x.

## Character reviews

### Dario Mendes (12 chores)

> I tried twelve chores, at night, with my translator. First the good part: every time, she asks me before she
> files. She said it in the brief, and she listened. When I said "do not file the brake drums, my helper packed them
> bad" and "the CRVU container is my driver's fault, pay it", she put it in the "Left alone" list. That is what a good
> dispatcher does. The questions were short. Nothing went past three cards.
>
> But the page is not for me. The list of chores says "benched", "exceed the bar", "Best edge". The chore page says
> "$12,000 a year, for the persona". Whose money is this? I think not mine, but it does not say. It says "2.5 h to
> 5 min, 33x faster". Five minutes is her time on made-up loads. My time is not there. With my checking, it is more
> like twenty-five minutes. Still good, but say the true number.
>
> The cards gave me apps I never heard of: Ledgerwren, Sheafbox, Postwren. I had to write "not this" again and again.
> One card asked about my fuel return "with Texas". My base is Illinois. Most cards had two, three, four questions
> together. One at a time, please.
>
> The brief worries me most. It says "you have 45 days (my guess)", "24 hours before loading (my guess)", "nine months
> (my guess)". If she does not know the deadline, I cannot trust her with my money. The law knows the deadline. Say it,
> and say where it comes from.
>
> The practice run says "found $1,580, on invented data". Good, it says made-up. But for the screening chore it said I
> "found $10", and for the permits "$392.50". Screening finds no money. That is a trick number, even if nobody meant it.
>
> Would I adopt? Detention and the escrow chore, maybe yes. My wife asks every month where the detention money went,
> and the page said the right thing: which load, how much, when I lose it. Customs, drawback and ISF are not my world.
> Would I tell another owner-operator? Not yet. First, numbers that say where they come from, deadlines that are not
> guesses, and one question at a time.

Scored criteria (designed experience, L1): C1 partial (the brief bullets are readable, but "persona", "bench" and
"traps" are not). C2 fails (14 to 15 rubric jargon words across three screens). C3 fails (every value and time figure
is unsourced). C4 passes on the showcase for 6 of 12 chores where the figure is real money and fails where it is a
weight (denied, DQ, oversize). C5 fails (multi-question cards 29/39 across both Characters, invented options). C6
partial: approval is promised and the gate is drawn ("Athena asks you first", `flow.tsx:106-112`), but no
load/amount/deadline preview is promised.

### Lorna Pike (12 chores)

> I came in expecting a vendor pitch, and the first page I saw was one: "$30,000 a year", "99x faster", "for the
> persona", and not a line of basis next to any of it. I am told the basis exists, and that it is careful work, with
> 19 U.S.C. 1514 and 46 CFR 541.7 cited and dated. It just isn't on the screen. That is the worst of both worlds: the
> work was done and I get the pitch.
>
> The conversations were short and mostly fair. But she offered me "Ledgerline", "Forwarden", "Docshelf" and
> "Portline Entries" in turn after turn. None of them are ours, so I typed Dynamics, SharePoint, ACE and Outlook into
> free text, twelve times over. The briefs were where my patience ran out: "180 days from liquidation to protest (my
> guess)", "file 24 hours before loading abroad (my guess)", "45 days after final settlement (my guess)". The first
> two are the law, not a guess. The third has the wrong anchor: the regulation counts from termination. In the freight
> claim she put "nine months from delivery" on a pallet that was never delivered. A licensed broker would bounce every
> one of those lines.
>
> On the same page the drawback brief says "$13,747 claimed" and the result box says "$11,033 filed". The escrow
> brief says $1,515 and the result says $1,539. The IFTA brief says we pay $56.15, and then the practice run says it
> "found $1,844.83". That is our own tax credit, not money anyone recovered. The ISF run said "$25,000 found". That is
> five liquidated-damages claims that never happened, at full face, before mitigation.
>
> What I liked: she never acts without approval, and she wrote that plainly in every brief (12 of 12). She told me my
> permit week had already passed instead of carrying on. When the case changed, the shaped rehearsal said "no dollar
> figure is claimed", which is the most honest sentence in the product. What is missing for my job: the list of what
> she left alone, and why, in the run itself. It is counted ("traps avoided 13/13") and never shown.
>
> Adopt? Not for anything the owner signs, not yet. Freight claims, no: the deadline rule is the one thing I cannot
> have guessed. Tell a peer? I'd tell them the playbooks are better researched than the screens let on.

Scored criteria (L1): C1 fails (no figure has its source). C2 fails: the topic brief against the result disagrees for
drawback and lease, and the value against the rehearsal is unreconciled everywhere. C3 passes on the showcase label
and fails where the "found" unit is not money (IFTA, ISF). C4 passes (12/12 in LC as well). C5 fails (the rule is
"(my guess)" with no citation in 22/24 briefs). C6 mostly passes: no documents were given, so this is refuted as a
defect (freight-25). C7 fails by construction (freight-08).

## Findings, ranked by impact

Category-wide themes first, then chore-specific. Full rows in `findings-freight.json`.

1. **freight-01 [blocker] Law is filed under "(my guess)" in the brief, with no citation.** 23/24 briefs carry "(my guess)",
   and only 2/24 cite any rule. The cause is in the daemon. A slot has only open/guessed/confirmed, and only the
   person's own words confirm (`adopt/slots.py:65`, `:231`). `_setup_lines` and `fitted_command` append "(my guess)"
   to every unconfirmed value (`adopt/loop.py:467`, `:479-486`). Yet the interview is told never to ask what public
   rules answer, because "research does that" (`adopt/prompts.py:66-67`). The playbook already holds the cited rule
   (basis and caveat). The result: the rule research knows ends up looking less certain than the person's guess about
   their own bond holder. *Acceptance:* a rule slot filled from the playbook or a research lane renders as "rule: <text>
   (<citation>)", never as "(my guess)", and at least one deadline in every freight brief names its CFR or U.S.C. section.
2. **freight-02 [blocker] Every value figure is unsourced.** The catalogue cell (`catalogue.tsx:121-134`), the Value tile
   ("..., for the persona", `topic.tsx:189-191`) and "Worth $X" (`topic.tsx:246`) carry no source. `economics.basis` is
   not even parsed (`lib/playbooks.ts:494-505` reads value, per, manual minutes, incumbent and sources, but not
   basis). 10/12 freight bases say "an estimate" (numbers.json `basis_says_estimate`), and carrier-accessorials' basis
   is a range derived from ATRI. *Acceptance:* each value rendering carries "author's estimate" or "measured on invented
   data", plus a one-line basis, and the basis text is reachable from the tile.
3. **freight-23 [major] The topic brief tells the persona's story as if it were the reader's.** It covers a light-fixture
   maker's chandelier, a kitchenware importer, an El Paso carrier's Texas return, with money outcomes ("Collected —
   $1,580") and no "example case, invented data" label. The only invented-data line sits two sections lower
   (`topic.tsx:220`). Dario (freight-claims, ocean, parcel, IFTA) and Lorna (customs, DQ) read it as describing someone
   else's company. *Acceptance:* the brief carries "An example: <persona>, on invented data" above it, and every money
   figure inside it carries that label.
4. **freight-05 [major] "Time saved" leaves out the person's review and hides the sample size.** The ratio is manual minutes
   against bench wall-clock only (`lib/playbooks.ts:591-595`). `beforeAfterOf` builds "your review X min · N turns ·
   $Y of model time" (`scenes/chores/model.ts:152-158`), but `topic.tsx:194-202` renders only the figures and the
   ratio, so the line has 0 readers. The shown figures are 1.4x to 2.9x the with-review ones (above), and every one
   rests on runs.n = 1 or 3, which is not shown. *Acceptance:* the tile renders the review line, the ratio includes
   review time, and the run count shows beside it.
5. **freight-11 [major] The catalogue total adds weights to "found" money.** `totalsLine` prints "$X found on the bench"
   (`scenes/chores/model.ts:105`) from the sum of `valueFoundUsd` (`modules/playbooks/model.ts:224`). Freight puts
   $65,601.51 into it. Of that, $25,942.50 (39.5%) is non-money weights: ISF $25,000, DQ $540, oversize $392.50 and
   denied $10. With IFTA's $1,844.83 in tax credits, the share is $27,787.33 (42.4%). *Acceptance:* the total sums only
   `value_kind == recovered`, and the weights show as counts.
6. **freight-03 [major] Price-avoided and protection weights are shown as dollars filed and found.** The flow result prints
   `usd(valueFoundUsd)` under "Filed on the bench" (`scenes/chores/model.ts:129`, `flow.tsx:121-122`). The showcase
   prints `usd(found_usd)` "found in the rehearsal" (`showcase.tsx:113-119`). The turn cards print `usd(c.valueUsd)`
   (`turn.tsx:74`), so each screened order shows "$1" and each ISF "$5,000" (`playbooks/denied-party-screening/bench.json`
   trace cards, value_usd 1.0; ISF 5000.0). In LC, 5 pairs saw it: denied-dario $10, DQ x2 $540, oversize-dario
   $392.50, ISF-lorna $25,000 (Lorna's judge rated it a blocker). *Acceptance:* a weight-valued truth renders as "N of M
   done right", never with a $ sign.
7. **freight-08 [major] What she left alone, and why, is counted but never listed.** `trapLedger` (every trap, its why, and
   whether it was filed; `lib/playbooks.ts` Bench) only feeds the count in `blueprintOf` (`scenes/chores/model.ts:122-124`).
   No chores view lists it (grep for `trapLedger` under scenes: 0 renders). Lorna C7 had 0 passes in 12 pairs (11
   not evaluable), and J8's DoD requires it. *Acceptance:* the topic and the showcase list each left-alone item with
   its reason.
8. **freight-06 [major] The interview offers the playbook's invented app names as answers.** Options name Ledgerline,
   Forwarden, Sheafbox, Postwren, Ledgerwren and others in 11/12 chores (carrier-accessorials uses real brands).
   20/24 pairs had to correct at least one. *Acceptance:* options come from a public catalogue of real products for
   that portal role, or say "an ERP / a forwarder portal" plus free text, and never use an invented brand.
9. **freight-09 [major] Jargon on every screen.** The catalogue has 4 (benched, exceed the bar, bench, edge:
   `scenes/chores/model.ts:104-105`, `catalogue.tsx:38`). The topic has 6-7 (persona, traps, bench, world, claim,
   turn, brief: `topic.tsx:191`, `:205-207`, `:286`, `topic.tsx:83`, `flow.tsx:118`, `:121`, `:130`). The studio has
   7-8 (lanes, slot, brief, draft, world, rehearsal, card, turn: `adopt/state.ts:333`, `casepanel.tsx:163`, `:267-271`,
   `:299-300`, `showcase.tsx:85`, `:104`, `:190`). Runs adds "ledger row", "gate" and "daemon" (`runs.tsx:52`, `:70`,
   `:90`).
10. **freight-07 [major] Several questions to a card.** 29/39 cards across the 24 pairs had 2 to 4 questions, because the
    prompt allows 4 (`adopt/prompts.py:43`, `:55`). This fails Dario's C5 in 12/12.
11. **freight-04 [major] One page, two answers.** The drawback brief says "$13,747" and the result says $11,033 (bench 3 of 4,
    `playbooks/duty-drawback/bench.json`). The lease brief says "$1,515" and the result says $1,539. The IFTA brief says
    "$56.15 net tax" and the result says "$1,845 filed".
12. **freight-17 [major] The brief gets the deadline anchor wrong.** lease-lorna has "45 days after final settlement"
    (376.12(k) counts from termination; offline knowledge, consistent with the playbook's own basis). freight-claims-lorna
    has "nine months from delivery" on a pallet that was never delivered. Both are LC.
13. **freight-13 [major] IFTA counts tax-paid credits as value** (`playbooks/ifta-quarterly/playbook.json` economics.basis). The
    credits only offset tax owed; the net is $56.15. Lorna was shown "$1,844.83 found".
14. **freight-14 [major] ISF is valued at two full $5,000 liquidated damages a year**, while its own basis says mitigation
    cancels a first violation for $1,000-2,000.
15. **freight-15 [major] The lease escrow is valued at the whole $2,500 escrow per episode.** The chore's real increment is
    $945 in disputed deductions plus $24.12 interest.
16. **freight-19 [major] J8: "Start for real" does not say what happens next.** It says only "Hands the brief's command to
    Athena ..." (`showcase.tsx:128-143`). It does not say what she will do on real accounts, which acts need approval,
    or where Due and Runs will show it.
17. **freight-10 [minor] The quarter and episode units sort wrong.** Enumerating `PER` (`modules/playbooks/model.ts:104-110`):
    year, month, week, run and claim are clean, while quarter and episode fall to "per quarter" and "per episode". In
    `annualValue` (`:191-201`) month x12 and week x52 are clean, quarter is not x4 (IFTA sorts as $1,200, but is $4,800 a
    year by its own times_per_year = 4), and episode, run and claim are not annualised. In freight, topic.tsx:191 and
    :246 agree for all three units used here (year, quarter, episode), so the scouts' month mismatch does not reach
    freight.
18. **freight-12 [minor] denied-party shows "$0 a year".** It reads as worthless. The value is about 60 hours a year
    (basis).
19. **freight-16 [minor] Duty drawback has no substitution path** (offline knowledge: 19 U.S.C. 1313(b), (j)(2)). Dario has
    no part-to-kit list, and substitution at the 8-digit HTS level would not need one.
20. **freight-18 [minor] Persona and other-chore leaks.** The studio composer placeholder says "My airline is Skylindle ..."
    in every freight chore (`adopt/conversation.tsx:39`, and studio.tsx passes no words). IFTA-dario was asked to file
    "with Texas". Customs-dario was offered "skewers, grills, knives".
21. **freight-20 [minor] Rehearsal spend is not shown.** It cost $1.22-3.16 a pair, adopt included. The studio shows only
    "N model calls · s" (`adopt/studio.tsx:277`).
22. **freight-22 [minor] DQ value is over-scaled for both Characters.** By the basis's own formula ($30 a driver a month),
    Dario's 3 drivers come to $1,080 a year and Lorna's 6 to $2,160, not $3,000.

## Chore fixes (edits to the playbooks)

- **carrier-accessorials.** Add "an estimate" to basis (the only freight basis without it). State the $8-20k range in
  the value or change value_usd to the midpoint with its derivation. Name in the brief each broker's window with its
  source (CHR in Navisphere, TQL final paperwork, Uber 24 h), since Lorna's judge failed C5 on "no window length".
- **customs-protests.** Verify "91 FR 41053 (2026)" against federalregister.gov (unverifiable offline). Persona-agnostic
  brief bullets ("Entries under the wrong tariff number" rather than kitchenware). Seed rule slots from 19 U.S.C.
  1514(c)(3) and 19 CFR 101.9(b) so the brief can cite them (freight-01).
- **denied-party-screening.** Replace the $1 count weights with a non-dollar `value_kind: count`. Show the value as
  "about 60 h a year" instead of "$0 a year". Add the re-screen at ship time and the 10 November 2026 affiliates-rule
  date to the brief, since the stay expiring inside a weekly cadence is the case a pro would flag.
- **driver-qualification-files.** Scale value by driver count (the basis is per driver). Mark the $90 truth weight as
  price-avoided (freight-03). Brief rule lines cite 382.701(b) and 391.25(a), which Lorna asked for.
- **duty-drawback.** Make the brief match the latest bench (found 3/4, $11,032.56), or re-bench. Add the substitution
  paths (1313(b), (j)(2)) and the notice of intent to export for unused direct-identification (19 CFR 190.35) to the
  rules and steps (offline knowledge). Add a trap: "claiming kits with no record that ties them to an import line or a
  substitutable HTS".
- **freight-claims.** State the loss rule plainly in the playbook: for non-delivery, the uniform bill of lading runs
  nine months after a reasonable time for delivery (offline knowledge). The world's BOL-date rule is the invented
  carrier's own, and the brief must not turn it into "from delivery". Drop "a service keeping 30%" from Left alone,
  because it is a choice, not an item.
- **ifta-quarterly.** Re-base value on penalty and interest avoided (R1220: $50 or 10%, the greater; R1230 interest),
  plus errors avoided on credits that a wrong return would lose. Do not count credits as value. Set per to "year" with
  times_per_year 4, so the value sorts honestly (freight-10).
- **isf-filings.** Value at the mitigated figure ($1,000-2,000 for a first violation), or as a count of filings made on
  time. Never "found" (freight-03, freight-14).
- **lease-operator-escrow.** Value = what the chore adds (disputed deductions plus interest), not the escrow. Make the
  brief use one figure ($1,538.77 including interest, or the $1,514.65 demand plus $24.12 claimed, said as two). Brief
  rule line: "45 days from termination, 49 CFR 376.12(k)".
- **ocean-demurrage-disputes.** Verify the "541.4 set aside in 2025" statement and cite the decision (offline:
  unverified). The brief should cite 541.7(a) and 541.6 (Lorna asked for them by number).
- **oversize-permits.** Mark the $72.50/$82.50 weights as price-avoided, so they are never shown as "Filed $392.50".
  The brief names each state's curfew rule with its citation (OAC 730:50, TDOT 1680-07-01).
- **parcel-guarantee-refunds.** Sound. Reconcile value ($4,000 a year) with the world (one week $269.85 x 52 =
  $14,032) in basis, so the two figures are not left unexplained (Lorna C2).

## What passed (protect these)

- **Approval is never optional and is said plainly.** Every brief states it (Lorna C4 12/12), every chore draws its
  gates on the flow (`flow.tsx:105-112`), and the interview is barred from offering to waive them
  (`adopt/prompts.py:62-63`).
- **Comprehension after onboarding.** The judge's `understood` sentence matches the chore's job in 24/24 pairs, even for
  Dario on customs and drawback.
- **Shaped-world honesty.** When the case changes the answer key, no dollar figure is claimed (`showcase.tsx:102-111`,
  `adopt/showcase.py:575-584`). Six pairs got this, and Dario's judge credited it (drawback C4, ISF C4).
- **Athena honours "do not file this".** The brake drums and the forklift (freight-claims-dario), the CRVU charge
  (ocean-dario), and "follow the ruling, not the ERP" (customs both) all went to Left alone.
- **She flags a stale case.** oversize-lorna's brief says the week of 12 October has already passed.
- **Short onboarding.** Every pair ended `clear`, none at the round cap, in at most 3 cards.
- **Playbook research quality.** The rules are dated and cited (eCFR versions, FR notices), the traps are the ones a
  pro worries about, and the caveats are honest about what is invented. The defect is that none of it reaches the
  screen (freight-01, freight-02).
- **The showcase labels its result "on invented data"** (`showcase.tsx:117`). The judge harness did not show this, and
  it should be kept.
