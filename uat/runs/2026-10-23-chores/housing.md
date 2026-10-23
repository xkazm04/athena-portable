# UAT L1 + LC: Chores, category `housing`

- **Category:** housing (8 home chores, 1 work chore)
- **Chores (9):** escrow-analysis-check, homestead-exemption, lease-end-wear-charges, pmi-cancellation, property-tax-appeal, recoverable-depreciation, section8-landlord (work), tenant-deposit-return, vehicle-recall-reimbursement
- **Characters:** Marcus Webb (Tacoma WA, spreadsheet checker, medium tech), Rosa Villanueva (Texas, 64, low tech, four properties), Ruth Albers (Iowa farm, rents two town houses, low tech, phone), Walt Brenner (66, firm owner with a rental LLC, low tech, reads on paper)
- **Pairs:** 18 of 18 complete, 0 failed. Every onboarding ended `clear` and was approved. Every rehearsal reached `done`.
- **Cost of those pairs:** $31.43 (sum of `cost_usd`), wall time 145 to 333 s per pair
- **Judge verdicts:** adopt **0 yes / 18 maybe / 0 no**. Criteria: 30 pass, 48 fail, 30 null out of 108, so **27.8% pass** (38.5% of the 78 criteria the judge could decide).
- **Honest-number ratio (L1, product-authored numbers):** **96 / 294 = 32.7%** (method below)

Evidence: dumps `proving-runs/chores-uat/2026-10-23-chores/pairs/<pair>.json`, numbers audit `numbers.json`, case cards `uat/chores/cases/<pair>.json`, playbook files `playbooks/<id>/{playbook,bench,truth}.json`, UI code under `apps/desktop/src/scenes/chores/`, daemon under `src/athena/adopt/`.

## How the numbers were counted

I used the rubric's units (`uat/rubric.md:25-39`). Each Character's journey shows these product-authored NUMBERS:

| Screen | NUMBER | Honest? | Why |
|---|---|---|---|
| Catalogue row | hand minutes, Athena minutes, value | no (3) | No source on the row (`catalogue.tsx:104-134`, `facts.ts:21-27`). The Athena minutes leave out review time. |
| Topic hero brief | the invented case's money figures (k per chore: escrow 5, homestead 3, lease 2, pmi 4, ptax 3, recdep 2, s8 1, deposit 3, recall 1) | no (k) | They describe the invented household, but nothing beside them says so. The `caveat` is parsed (`lib/playbooks.ts:522`) and rendered nowhere. |
| Topic Value tile | `$X a year/per episode, for the persona` | no (1) | No basis. `Economics` has no `basis` field (`lib/playbooks.ts:42-54`, `:496-505`). The tile also disagrees with the same persona's brief total on the same page (finding housing-01). |
| Topic Time saved | manual, Athena, ratio | no (3) | The ratio is `manual / bench wall-clock`, with the review time left out (`modules/playbooks/model.ts:216`, `lib/playbooks.ts:591-595`). |
| Topic Traps avoided + Flow note | `12/12 on the bench` and `walked past 12 of 12` | yes (2) | The source is named ("on the bench"), though it is jargon, and the two agree. |
| Make it yours | `Worth $X <per> for <persona>` | no (1) | No basis (`topic.tsx:246`). |
| Flow result | `$4,440 Filed on the bench` and `6 of 6 claims right, none false` | yes (2) | The source is named, and it agrees with the brief total (`flow.tsx:119-124`, `model.ts:119-139`). |
| Showcase, `shaped` | `N cards proposed in the rehearsal, against M in the recorded run` | yes (2) | The source is named (`showcase.tsx:102-112`). |
| Showcase, dollars | `$X found in the rehearsal, on invented data` | no (1) | The screen calls this "Rehearsal on invented data shaped like your case" (`showcase.tsx:40`), but a dollar figure only appears when the world was **not** shaped. It is renames only (`src/athena/adopt/showcase.py:220-223`), so the figure is the invented household's total (housing-02). |

The Character's own figures echoed back in "Your setup" (for example $1,980, $412, $3,412) are honest: the source is the Character. I left them out of the ratio so it measures what the product itself claims.

Per pair: fixed set 12+k with 4 honest, plus the showcase (2/2 shaped or 0/1 dollars).

## Scorecard

| Chore | Honest numbers (h/n, both pairs) | Jargon words met (catalogue / topic / studio / showcase) | Onboarding ended (M/R or Ru/W) | Rehearsal (both) | Adopt (both) | Judge pass (both, of 12) | Field reliability |
|---|---|---|---|---|---|---|---|
| escrow-analysis-check | 12/38 | 3 / 6 / 7 / 4 | clear r2 / clear r2 | shaped 6v6 / shaped 6v6 | maybe / maybe | 2/12 | **sound** (gap: notice-of-error address) |
| homestead-exemption | 12/34 | 3 / 6 / 7 / 4 | clear r2 / clear r2 | shaped 5v4 / shaped 4v4 | maybe / maybe | 3/12 | **issues** (Texas only; Washington has no general homestead exemption; age-65 school tax ceiling missing) |
| lease-end-wear-charges | 10/31 | 3 / 6 / 7 / 4 | clear r1 / clear r2 | $880 / shaped 5v5 | maybe / maybe | 4/12 | **sound** |
| pmi-cancellation | 12/36 | 3 / 6 / 7 / 4 | clear r1 / clear r2 | shaped 3v3 / shaped 3v3 | maybe / maybe | 3/12 | **sound** (gaps: evidence that value has not declined, notice-of-error address) |
| property-tax-appeal | 10/33 | 3 / 6 / 7 / 4 | clear r2 / clear r3 | shaped 9v9 / $2,310 | maybe / maybe | 4/12 | **issues** (Texas only; no 10% homestead cap check; no unequal-appraisal ground; no out-of-season path) |
| recoverable-depreciation | 10/31 | 3 / 6 / 7 / 4 | clear r4 / clear r2 | $15,190 / shaped 3v4 | maybe / maybe | 3/12 | **issues** (California's 36-month rule applied to Washington and Texas claims) |
| section8-landlord | 10/29 | 3 / 6 / 7 / 4 | clear r2 / clear r2 | $4,970 / shaped 8v9 | maybe / maybe | 3/12 | **sound** (gap: when the 24-hour and 30-day clocks start, a rule the chore holds but the brief calls a guess) |
| tenant-deposit-return | 10/33 | 3 / 6 / 7 / 4 | clear r1 / clear r2 | shaped 6v6 / $1,445 | maybe / maybe | 4/12 | **issues** (California only; Washington's checklist rule and Texas's bad-faith remedy missing) |
| vehicle-recall-reimbursement | 10/29 | 3 / 6 / 7 / 4 | clear r1 / clear r2 | $674.02 / shaped 4v4 | maybe / maybe | 4/12 | **sound** |
| **Total** | **96/294 (32.7%)** | | 18/18 clear | 18/18 done (6 $, 12 shaped) | 0/18/0 | **30/108 (27.8%)** | 4 sound, 1 sound with gap, 4 issues, 0 wrong |

**Jargon by screen.** I counted distinct words from the rubric list, each once per screen.
- **Catalogue (3):** bench, benched, exceed the bar (`model.ts:100-108` totals line).
- **Topic (6):** persona (`topic.tsx:191`), trap and bench (`:207`, `flow.tsx:118`), world (`flow.tsx:118`, `topic.tsx:220`), claim in Athena's scoring sense ("6 of 6 claims right", `model.ts:130`), turn ("Watch the run turn by turn", `topic.tsx:286`).
- **Studio (7):** brief and draft (`casepanel.tsx:268-271`), slot (`casepanel.tsx:163`), world and rehearsal (`casepanel.tsx:292`), lane (`state.ts:333`), session ("Waiting for the session", `conversation.tsx:151`).
- **Showcase (4):** rehearsal, world, card, turn (`showcase.tsx:40,97,104-110`, `turn.tsx:66,79`), plus "Your case changed **rows** the **answer key** was written for".

Athena's own words in the trace player also leak card ids: "Answer apr_f88b43841612 on the decision list" (homestead bench `closing_words`) and "apr_a4fe90fb0071, apr_864f8b77237a…" (section8 bench).

## Honesty audit per chore (values, worlds, Characters)

Every topic page in this category shows three different money figures for the same invented persona: the brief total, the Value tile and the flow result. The tile disagrees with the other two on all 9 chores. None of the figures is the Character's.

| Chore | Value tile (per) | Brief and flow total (same persona) | Rehearsal shown | Character's real case (case card) | Speed shown / with review |
|---|---|---|---|---|---|
| escrow | $700 a year | $4,440 (incl. $1,980 one-off duplicate, $214.60 one-off surplus) | cards only | Marcus: payment up $200/mo, so $2,400/yr | 41× / 17× |
| homestead | $1,200 a year | $2,893 ($2,335 of it one-off late refunds) | cards only | Marcus (WA): no general homestead; Rosa: 2024 and 2025 late plus age 65 2026 | 51× / 28× |
| lease-end | $900 per episode | $880 | Marcus $880 | Marcus: same $2,785 bill as the world | 83× / 25× |
| pmi | $1,500 a year | $2,732 | cards only | Rosa: $240k price, $189.4k balance | 34× / 22× |
| property-tax | $1,100 a year | $2,310 a year | Rosa $2,310 | Rosa: house $286k, duplex $342k, lot $41k, so different comps and rate | 135× / 38× |
| recdep | $6,500 per episode | $15,190 | Marcus $15,190 | Marcus: only the roof is claimable, $11,200 − $8,850 = **$2,350** | 103× / 55× |
| section8 | $9,000 a year | $4,970 | Ruth $4,970 | Ruth: one voucher house, HAP $690/mo; raise $875 to $925 | 36× / 15× |
| deposit | $1,500 per episode | $1,445 | Rosa $1,445 | Rosa: **$1,142.60 kept in total**; her contestable lines add to 480+210+38+65+75+90 = **$958** | 54× / 23× |
| recall | $700 per episode | $674.02 | Marcus $674.02 | Marcus: expects 312.00+28.50+236.40+23.64 = **$600.54** | 48× / 21× |

The "with review" figures are computed as `manual / (bench minutes + your_time_s/60)`, using `numbers.json` `speedup_with_review`. I checked recdep by hand: 240 / (2.33 + 2) = 55.4.

- **Basis plausibility.** escrow, homestead, lease, deposit and recall have defensible bases in `economics.basis`, and each says it is an estimate. Three are weak:
  - Property tax $1,100 rests on Ownwell's average **of customers who won**, quoted second-hand from a review site.
  - Recdep $6,500 rests on an invented "about a third of an average claim".
  - Section8 $9,000 assumes 4 to 5 voucher units, while both Characters' cases are smaller (Ruth has 1).
  - None of these bases reaches the screen.
- **Units.** Housing uses only `year` (5 chores) and `episode` (4). I enumerated every branch: `valueCell` (`model.ts:84-87`) and `Make it yours` (`topic.tsx:246`, using `PER`/`per ${…}` at `modules/playbooks/model.ts:104-110,215`) agree for both. The scout hypothesis that the tile annualises while "Worth" does not is **refuted for this category**: no housing playbook uses `month`.
- **Time saved.** The review time (`your_time_s`, 90 to 270 s) and the incumbent's fee line are computed (`model.ts:152-163`) and never rendered: the KPI shows only `band.ratio` (`topic.tsx:194-205`). Counting the person's review, the claimed speed-ups fall by 1.6× to 3.5×. Even then this is a 1-to-4-minute review of a bench run, not the time a Character needs to check the work. Marcus "will redo any number".

## Per-Character reviews

### Marcus Webb (9 home chores)

"I went through nine of these, and I'll give them this: the setup is quick. Three or four questions, all about where my stuff lives, and a page that says what it'll dispute and what it'll leave alone. When I told it the $412 supplemental bill and the umbrella premium were legitimate, the brief put both in 'Left alone'. When I said my laptop replacement came in under what Hearthguard paid, it left that alone too. That is exactly the instinct I want.

"But I'm the guy who rebuilds every total, and this product contradicts itself on its own page. Escrow says $700 a year in the big tile, $4,440 in the write-up above it, and $4,440 again 'filed on the bench'. All three are about the same invented family, and none of them is mine. My servicer raised me $200 a month: that's $2,400 a year, and nobody asked. Then the rehearsal. It's labelled 'invented data shaped like your case', and it tells me it found $15,190 on my insurance claim. My roof is the only finished line, and the most I can claim is $2,350. On the recall it says $674.02. My four lines add to $600.54; I did the sum before I opened the app. A number that's labelled as shaped like my case but isn't, is worse than no number.

"Then the law. I'm in Washington. The homestead chore is written for Texas, and it never said so. It asked whether 'my husband's' license was at IDway. Washington doesn't have a general homestead exemption at all, and the senior one Dennis might get has an income test it never asked about. The depreciation chore took California's three-year disaster window and wrote it into my brief as '14 Mar 2028 (my guess)'. The deposit chore is California law too, for a Tacoma townhouse. A paralegal who got the state wrong wouldn't last a week.

"Would I adopt? Lease-end and recall, maybe. Their logic is right, and the turn-by-turn replay does show the per-line math if you step through it. The rest, not until every figure says where it came from and which state's law it's using. Would I tell a peer? I'd tell them to check every number, which is not a recommendation."

### Rosa Villanueva (8 home chores)

"The questions were easy and kind. I like that she always asks me before she files anything, and the brief says so plainly every time. When I told her what I really owe on the townhome, she listed each one under 'Left alone', the wine stain and the screens too. That made me trust her a little.

"But I asked for three things in every chore, and I got none of them.
- **Deadlines first, with a date and the property.** Not once did I see a date. I saw 'Texas gives 30 days; research finds your exact date (my guess)' and 'Your deadline is about 12 August 2028 (my guess)'. And on the house protest, 'your house deadline has likely passed'. It's October. If it passed, tell me, and tell me what I can still do.
- **Each property by its own name.** The duplex and the lot get one line together under 'Left alone'.
- **What it costs next to Dale's consultant.** He keeps a third. Nobody answered.

"The money worries me most. The page talks about a teacher in Oakland and $1,500. Then my practice run says it found $1,445 on my deposit, and they only kept $1,142.60 of mine. How can it find more than they took? And she never once asked me to read a number off a paper. I have the folders right here; she asked me which app I use.

"Would I use it? For the homestead late filing, maybe. It got 2024, 2025 and Hector's 65 right. For the rest, not yet. I wouldn't tell my neighbour about it until it puts dates first."

### Ruth Albers (section8-landlord, work)

"It asked about four apps I've never heard of and called my two houses 'five apartments'. Then it stopped. It never asked what failed on the Maple Street inspection or what Dale already fixed. Dale put the smoke alarm in on the 9th; I'd have told it if it asked. The notice says November 7. The brief says my correction deadline is 'on the notice (my guess)'. That date is the one thing I'm afraid of missing, and it's the one thing it guessed.

"I do like 'nothing goes out without you'. But the page says 'certified' and 'reported' and never says plainly what gets filed with the housing authority and what's only made ready for me. And $9,000 a year? Our voucher payment is $690 a month. That's a sales pitch. I wouldn't rely on it, and I wouldn't tell the neighbours."

### Walt Brenner (section8-landlord, work)

"The questions were short and plain, and I could say AppFolio and Buildium. She took my word on which items the tenant broke and which just wore out, and she promised not to report the family without asking. That's decent. But the topic page reads like a lawyer wrote it: abated, certified, anniversary. And the promise that nothing goes out without my say-so only shows up in the brief, after the talking is done. I asked how the days are counted, from the letter or the inspection, and that went into the brief as 'my guess'. $9,000 a year and '36 times faster' from one run sounds like that payroll add-on that burned me. I'd want my old CPA to look at it first."

## Findings, ranked by impact

Severity follows from impact: blocker when frequency, reachability and trust erosion are all high; major when two are high; minor when one is; polish when none is.

### Themes across the category

1. **housing-01 (blocker): Value tile disagrees with the same persona's brief and flow total, on every chore, with no basis shown.** 9/9 chores (table above). `economics.basis` is not parsed (`lib/playbooks.ts:42-54,496-505`), and the tile says "for the persona" (`topic.tsx:188-192`). Every judge cited it, including escrow-M, pmi-M and ptax-R.
2. **housing-02 (blocker): A rehearsal dollar figure appears only when the world was not shaped, yet it is labelled "shaped like your case".** `showcase.py:220-223` keeps dollars only for renames-only worlds, and `showcase.tsx:40,113-118` labels the result "Your rehearsal… shaped like your case". In 6/6 dollar rehearsals `found_usd` equals the bench world total exactly (880, 2,310, 15,190, 4,970, 1,445, 674.02). Rosa's $1,445 exceeds her whole $1,142.60 deduction.
3. **housing-03 (blocker): The brief has no deadlines: no dates, no property, no rule named.** `prompts.py:117-133` `BRIEF_SYSTEM` has only lead/setup/claim/left_alone. Rosa's criterion 2 failed 8/8 and Ruth's criterion 4 failed. The chores hold the rules (TX §41.44, Tex. Tax 11.431, 24 CFR 982.404, Cal. Ins. 2051.5).
4. **housing-04 (blocker): Single-state chores are offered and run out of state with nothing said.**
   - Four chores are bound to one state: homestead (TX), property-tax (TX), deposit (CA), recdep (CA).
   - 6/18 pairs ran out of state: homestead-M, ptax-M, deposit-M, deposit-R, recdep-M, recdep-R.
   - The state appears only in the hidden caveat. The recdep briefs carry California's 36-month rule into Washington (M: "window ends 14 Mar 2028") and Texas (R: "about 12 August 2028").
5. **housing-05 (major): "(my guess)" also marks the rules the playbook itself cites.** 45 guessed lines in 18 briefs. They include the RESPA one-sixth cushion and 30-day surplus (escrow M/R), TX §41.44 (ptax-R), the 60-day HAP notice (s8 R/W) and Cal. 2051.5 (recdep).
   - The slot status model has only confirmed, guessed and open (`loop.py:467,479,485`).
   - Prompt rule 7 (`prompts.py:103-106`) folds research into "guess".
   - Every judge read "my guess" as a sign she doesn't know the law.
6. **housing-06 (major): Time-saved ratio leaves out the person's review; the review line and incumbent line are computed but not shown.** Computed at `model.ts:152-163`, rendered at `topic.tsx:194-205`. 41× becomes 17×, 135× becomes 38×.
7. **housing-07 (major): The topic hero tells the invented persona's story with no "invented" label beside it.** The caveat is rendered nowhere. Lease-end's persona is "a Tacoma physical therapist", which is Marcus himself. Rosa and Marcus both read the page as someone else's case (deposit-R, recall-R, lease-R).
8. **housing-08 (major): The questions locate portals but never point to a paper and a line; the first card offers the playbook's invented portals and leaks persona facts.**
   - Rosa's criterion 5 failed 7/8. Walt: "never told me the letter was in my folder".
   - 13/18 pairs had to correct a portal guess.
   - homestead-M: "your husband's driver license" (Marcus is the husband). s8-Ruth: "your five apartments".
9. **housing-09 (major): The cadence suggested for yearly chores is "every 365 days from today".** `cadence.py:277-287`. A property-tax chore adopted on 23 October next runs in October 2027, after the April-May protest window. Episode chores (lease, deposit, recall, recdep) get a yearly schedule they don't need. No rule kind can anchor a date (`lib/adopt.ts:313-321`). The copy reads "1 times a year" (`cadence.py:279`).
10. **housing-10 (major): The cost against the consultant is never answered.** `incumbent_fee_pct` exists (escrow 35, homestead 30, ptax 25, recdep 15, s8 8), and model cost per run ($0.69 to $1.86 on the bench) is computed (`model.ts:156`). Neither is rendered. Rosa asked in 5 pairs.
11. **housing-11 (major): Jargon on every screen** (3 catalogue, 6 topic, 7 studio, 4 showcase), plus raw `apr_…` card ids and the words "rows" and "answer key". Walt's criterion 4 failed.
12. **housing-12 (minor): The brief is not laid out by property.** Rosa (4 properties) and Marcus (3) get one flat list. Escrow-R and homestead-R never name the duplex or the lot as theirs.

### Chore-specific findings

13. **housing-13 (major), section8: Ruth's onboarding ended `clear` after 2 questions.** It never asked about the failed items, the Nov 7 date on her notice, or Dale's Oct 9 smoke-alarm fix. The brief would send repairs without knowing which are done. Clear-check is `prompts.py:103-106`.
14. **housing-14 (major), property-tax: out of season, with no next step.** Rosa's house notice of April 18 had a May 18 deadline. The brief says "likely passed; Athena will check" and leaves her there. A consultant would say plainly that the 2026 protest window is closed, check the §25.25 correction motions, notify the district about the condo she sold, and set April 2027.
15. **housing-15 (major), property-tax: no 10% homestead cap check (Tex. Tax Code §23.23) and no unequal-appraisal ground (§41.43(b)(3)).** Rosa's house rose from $248k to $286k, which is +15.3%, so the cap alone may lower its taxable value. Offline knowledge.
16. **housing-16 (major), homestead: Texas logic run for a Washington household.** Washington has no general homestead exemption; its senior and disabled exemption (RCW 84.36.381) has a combined-disposable-income test the chore never asks about. The brief also omits the Texas age-65 school tax ceiling (§11.26). Offline knowledge.
17. **housing-17 (major), tenant-deposit: California only.**
   - Washington: no deposit may be kept without a written move-in checklist (RCW 59.18.260). That is Marcus's strongest lever, and nobody asked.
   - Texas: forwarding address (Prop. Code §92.107) and the bad-faith remedy of $100 + 3× + fees (§92.109) are missing for Rosa.
   - Offline knowledge.
18. **housing-18 (minor), escrow and pmi: disputes are "filed in the servicer portal".** Regulation X lets a servicer name an exclusive address for notices of error (12 CFR 1024.35(c)), and a portal message may not count. PMI omits the servicer's right to ask for evidence that the value has not declined (12 U.S.C. 4902(a)(4)). Offline knowledge.
19. **housing-19 (minor), recdep economics:** "about a third of an average claim" is an invented ratio. Recdep's per-episode $6,500 sits next to a $15,190 bench world. Property tax's $1,100 rests on a survivor-only average quoted second-hand.

### Judge leads checked

- **R1 (refuted).** "The practice result is not labelled as invented" (pmi-M criterion 4, deposit-M criterion 4, s8-Ruth, recall-M). The showcase labels it at `showcase.tsx:40` ("Rehearsal on invented data… nothing was sent") and `:117`. The judge saw only the summary. The real defect is the opposite: the label overclaims "shaped like your case" (housing-02).
- **R2 (refuted, present-but-missed).** "The rehearsal shows no per-line math or legitimate-charge reasons" (escrow-M, recdep-M, recall-M, lease-M). The trace player renders Athena's prose with the arithmetic and each card's amount and outcome (`turn.tsx:44-78`). The recorded escrow run shows "6,212.40 + 1,980.00 + 795.00 + 412.00 + 186.00 = $9,585.40", and deposit lists "Left alone (8 lines, $1,128.70)" with reasons. It is real but invented data, it sits behind turn stepping, and it is absent from the brief. Kept as uncertain in the JSON.
- **R3 (refuted, scout).** "Value tile annualises but 'Worth $X a month' does not": no housing chore uses `per: month`, and the year and episode branches agree.

## Chore fixes (playbook edits a pro would demand)

- **escrow-analysis-check**
  - Split `value_usd` into a recurring figure (over-collection a year) and one-off recoveries, so the $1,980 duplicate and the $214.60 surplus aren't read as yearly.
  - Add a step: "send each notice of error to the servicer's designated notice-of-error address (1024.35(c)), not only the portal".
  - Add a trap: a surplus is refundable only if the borrower is current.
  - State the cushion rule as "RESPA / 12 CFR 1024.17(c)(1)", so the brief can cite it instead of guessing.
- **homestead-exemption**
  - Put "Texas only" in `short_title` and `persona`, for example "Texas homestead exemptions claimed late".
  - Add the age-65 school tax ceiling (§11.26) to `promise` and steps.
  - Add a trap: an owner outside Texas (another state's exemption has different rules, such as Washington's income test under RCW 84.36.381).
  - Report recurring yearly value apart from one-off late refunds ($2,335 of the $2,893).
- **lease-end-wear-charges**
  - Add "read the lease's own dispute deadline and the lessor's written review window first" as step 1.
  - Shorten `title`: it is a 70-word paragraph.
  - Otherwise sound: Regulation M was read carefully, and the basis even corrects the roster's citation.
- **pmi-cancellation**
  - Add a gate note: a borrower request may require evidence that the value has not declined (12 U.S.C. 4902(a)(4)), sometimes a paid appraisal, and the person should be told before the request.
  - Add the notice-of-error address step as for escrow.
  - Add an FHA/VA trap: the Act does not apply to them.
- **property-tax-appeal**
  - Mark it "Texas" in `short_title`.
  - Add steps:
    - check the 10% homestead cap (§23.23);
    - check the 20% cap on non-homestead property under about $5M (§23.231, tax years 2024-2026);
    - consider an unequal-appraisal ground (§41.43(b)(3)).
  - Add an out-of-season branch: after the deadline, report "closed for this year" with the §25.25 options and the next window.
  - Replace the $1,100 basis: the survivor-only Ownwell average via Money Crashers should give way to a primary source, or the bench's own per-property figure.
  - The incumbent is 25% in Texas, but Rosa's neighbour pays a third. Show a range.
- **recoverable-depreciation**
  - Make the window a variable: "the policy's replacement-cost clause and the state's rule", with California §2051.5 as one case.
  - Add a trap: a claim outside California, where the policy's own deadline (often 180 days to 2 years) governs.
  - Replace the "a third of an average claim" ratio with a sourced holdback share, or drop the per-episode figure.
- **section8-landlord**
  - Write the clock rule into `chore` and a step: "24 hours and 30 days from the PHA's notice, as the notice states". That would let the brief state it instead of guessing.
  - Size the persona to the common small owner (1 to 2 voucher units), or scale `value_usd` per voucher unit: $9,000 assumes 4 to 5 units.
  - Add a step that names what is filed with the authority (certifications, damage reports, rent requests) and what is only prepared (work orders to the person's own handyman).
- **tenant-deposit-return**
  - Mark it "California" in `short_title`.
  - Add a jurisdiction trap.
  - For a generalised version, add a step that asks for the move-in checklist first (Washington RCW 59.18.260 bars any deduction without one) and add the Texas §92.107 and §92.109 remedies.
- **vehicle-recall-reimbursement**
  - Sound.
  - One fix: `promise` names a Boise bookkeeper and 2022 Kestrel. Say "for example" on the page, or label the invented persona.

## What passed (protect these)

- **Approval-first is clear and kept.** Every gate is drawn on the topic page as "Athena asks you first" (`flow.tsx:70,110`). Every brief says it asks before each act. Rosa's criterion 6 passed 8/8, and Marcus's criterion 1 passed 9/9.
- **Left-alone lists are faithful.** What a Character said was legitimate went verbatim into "Left alone": the $412 supplemental bill, the umbrella premium, the laptop, Hector's truck, the $174 rent and $61.60 water. So did the mother's PMI late payment, which was handled exactly right (pmi-R). This is the "tell me when to pay it" behaviour Marcus wants.
- **Bench quality.** All 9 chores scored 100% value recall with 0 false claims and 0 traps filed on the bench. The flow result and traps figures are the only honest product numbers, because they name their source.
- **Short onboarding.** 1 to 4 rounds, about 2.5 to 5.5 minutes, all approved.
- **Text size.** No literal `font-size` below 12px in `chores.css` or `adopt.css` (token-based sizes not audited). This meets Rosa's criterion 4 at the code level.
- **Playbook research depth.** lease-end, deposit and recall bases read the primary rule and correct the roster's own citations, which is the standard to copy into the weaker bases.
