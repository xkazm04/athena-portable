# UAT chores, L1 area walk: public

- **Category:** public (government, grant and public-money compliance)
- **Chores (8):** bid-opportunity-triage, crop-insurance-notice, erate-applications, federal-prompt-pay-interest, fsa-acreage-reporting, grant-drawdown-reporting, public-records-requests, restricted-funds-release
- **Characters (2):** Devon Clarke (nonprofit finance manager, 26, ex-audit, medium tech comfort), Ruth Albers (Iowa farm bookkeeper, 63, low tech comfort, uses a phone)
- **Pairs:** 16 of 16 complete, 0 failed. Every onboarding ended `clear`, every brief was approved, every rehearsal finished `done`.
- **Cost of the pairs:** $33.11 (sum of `cost_usd` over the 16 dumps)
- **Method:** I walked J7 and J8 over the code (catalogue, topic, flow, studio, casepanel, showcase, turn) for each Character on each chore, and checked every judge lead against the dump and the code. The judges saw `numbers.json` and the playbook's `promise`, not the rendered UI, so several of their findings turn out false (listed as `refuted` in the JSON).
- **Harness caveat:** the UAT ran with the research lanes switched off (`src/athena/proving/chores_uat/run.py:6`, "research lanes off (the hooks are no-ops)"). No research leg appears in any of the 16 leg ledgers (43 interview, 43 audit, 27 persona, 16 brief, 16 shape). So "rule left as (my guess)" findings reflect the harness, and may not match production. I mark them `uncertain` where it matters.
- **Severity rule (derived, not picked):** three `high` impacts = blocker. Two = major. One `high`, or all `med` = minor. Anything else = polish.

## Scorecard

Honest numbers are counted over a fixed set of 14 NUMBERs per chore (rubric units):
- **Catalogue row (3):** hand time, Athena time, value.
- **Topic (10):** Value tile, manual time, Athena time, x-faster, Traps avoided, the "Worth $X" line, the flow's "walked past X of Y traps", the "Filed on the bench" figure, its "N of M claims right" line, and the hero's headline figure.
- **Showcase (1):** the rehearsal figure.

Jargon is distinct rubric words per screen: catalogue / topic / studio and showcase.

| chore | honest (h/n) | jargon met (cat/topic/studio) | onboarding ended (D, R) | rehearsal (D, R) | adopt (D, R) | judge pass (D, R) | field reliability |
|---|---|---|---|---|---|---|---|
| bid-opportunity-triage | 5/14 | 3/7/10 | clear r2, clear r2 | done shaped 11 vs 10 cards; done shaped 10 vs 10 | maybe, maybe | 0/5, 1/5 | issues |
| crop-insurance-notice | 6/14 | 3/6/9 | clear r2, clear r1 | done shaped 5 vs 5; done $34,527 | maybe, maybe | 0/4, 1/5 | issues |
| erate-applications | 6/14 | 3/7/10 | clear r2, clear r3 | done shaped 4 vs 4; done shaped 4 vs 4 | maybe, maybe | 0/5, 1/5 | issues |
| federal-prompt-pay-interest | 6/14 | 3/7/9 | clear r1, clear r1 | done $440.16; done $440.16 | maybe, maybe | 0/5, 1/5 | sound (minor gaps) |
| fsa-acreage-reporting | 4/14 | 3/7/9 | clear r2, clear r1 | done $132.65; done $132.65 | maybe, maybe | 0/5, 1/5 | issues |
| grant-drawdown-reporting | 4/14 | 3/7/9-10 | clear r2, clear r2 | done $31,492.60; done shaped 7 vs 6 | maybe, maybe | 1/5, 1/4 | issues |
| public-records-requests | 4/14 | 3/7/9 | clear r1, clear r2 | done $9; done $9 | maybe, **no** | 0/5, 1/5 | issues (state law) |
| restricted-funds-release | 3/14 | 3/7/9 | clear r1, clear r2 | done $74,600; done $74,600 | maybe, maybe | 0/5, 1/5 | sound rules, wrong total |
| **category** | **38/112 (34%)** | 19-20 words per journey | 16/16 clear | 16/16 done, 7 shaped, 9 with a figure | 0 yes / 15 maybe / 1 no | **9/78 (11.5%)** | 2 sound, 6 issues |

Notes on the counts:
- **Honest every time:** the trap counts (8 and 10) and the "N of M claims right" line (12). Each names "the bench" as its source and agrees with the others.
- **Dishonest every time:** the catalogue cells, the Value tile, the time pair, the x-faster figure and the "Worth" line. None of them shows its source. `economics.basis` is not parsed (`apps/desktop/src/lib/playbooks.ts:43-54`, `:495-505`). `economics.sources` is parsed (`:501-504`) but no chores view renders it. The caveat is parsed (`:522`) and rendered nowhere.
- **Varies by chore:** the "Filed on the bench" figure, the hero headline and the rehearsal figure. See finding 01 and the restricted and grant rows.
- **Judge pass rates are as recorded.** My L1 re-check moves two criteria:
  - Devon C4 and Ruth C3 ("practice run labelled invented") would pass on 6 of 8 chores, because the showcase does say "on invented data" (`scenes/chores/adopt/showcase.tsx:40`, `:117`). The exceptions are fsa and records, where the "found" dollars are not money.
  - Ruth C2 ("says whether it files") becomes a partial. The Flow draws an "Athena asks you first" diamond on every gate (`scenes/chores/flow.tsx:106-112`), but no sentence says "prepared, not sent".
  - Every other judge fail stands.

## Per-Character reviews

### Devon Clarke (finance manager, community nonprofit), 8 chores

"I'll start with what I liked, because it matters. Each time, she wrote my own odd details back to me correctly. On the grant draw she had the $9,800 license from before the award, the county award's $7,200 rent, the gala deposit, the 990 penalty and Marcus Hale's timesheets. On E-Rate she had Corvane's engineer drafting the 470. On the crop policy she had the 15 church acres that never made the acreage report. Every brief left 'submitting' with me, and the drawing on the topic page puts an amber 'Athena asks you first' on every step that touches a portal. That is the right instinct.

But I could not explain any of these chores to my executive director in one paragraph and stand behind it, and the reason is the same every time:

- **No rule is quoted, and the sources exist but are hidden from me.** The playbook data cites 2 CFR 200.442, 5 CFR 1315.11, 13 CFR 125.6 and 7 CFR 718.106, but none of it reaches a screen I can read. The gate's 'why', which sometimes cites the rule, only appears when I hover over a diamond.
- **The briefs mark rules as guesses.** I read '(my guess)' next to the 28-day E-Rate wait, the 72-hour notice and the 40-day penalty window. I would never take a guessed federal rule to an auditor.
- **The numbers don't hold together.** The prompt-pay page says '$3,500 a year' and '39x faster'. The practice run says $440.16. My own case is worth about $27 of interest on one invoice. Nothing tells me which figure is a study, which is the made-up company and which is me.
- **The practice runs were someone else's.** They said 'shaped like your case', yet the 'You' lines read 'I'm Marian Oyelaran; I run Larkfield Systems'. On the bid chore, the practice run marked a bid I am eligible for as 'Fell for a trap', because the answer key was written for a firm with $21.4M in receipts and mine averages $5.32M.
- **The brief has no structure for approval.** I asked for three lists: what she prepares, what I approve, and what she never does alone. Every brief came back as 'Your setup / What I'll claim / Left alone', with approvals buried as setup bullets. 'Claim' is a strange word for keeping a bid or booking a release.

Would I adopt one? I'd try the grant draw and the restricted-funds releases first, watching every card, because their briefs were the most faithful to what I said. I would not tell a peer it's audit-ready. I'd tell them it's a sharp second pair of eyes that can't yet show its sources. What's missing for my job: the rule text with its citation beside every keep, draw, release and filing, and one number per screen that says where it comes from."

### Ruth Albers (farm books, Iowa), 8 chores

"She asked me easy questions, and the brief always said nothing goes out until I say yes. I'll give her that, because that is the first thing I want to know. She got the flooded Creek Forty replanted to beans. She got Dale's real share of his time on the seed line, the beer at the field day and the cover-crop seed that belongs to NRCS.

Here is what bothered me, chore after chore:

- **Too many questions on one card.** Two, three, sometimes four on a phone at night. Half of them asked whether I use things like 'Postwren', 'Contractdesk' or 'Bidmoor', which I've never heard of.
- **The bid chore was built for an office.** It offered help desk and HVAC work and receipts in millions, when we mow ditches and plow snow and make $338,000.
- **No dates.** Dates are what I care about, and they weren't there:
  - the grant brief never said when the SF-425 is due;
  - the acreage brief said 'before the 15th';
  - the freeze brief said '72 hours of the freeze', when my agent always told me it runs from when you find the damage.
- **The freeze brief guessed at the wrong things.** It said a unit already noticed 'gets no second notice', but a new storm is a new notice.
- **The practice runs weren't about me.** I told her: list the fields and the dates, don't file. The freeze practice run filed three claims worth $34,527 for some other farm. On the grant, it put Dale at his timesheet share, exactly as I told it to, and then stamped that line 'Unfounded' in red.
- **The records chore used the wrong law.** It ran on California's records law for my Iowa county, and Iowa can charge for more than copying. That one I'd say no to.
- **The money reads like a sales pitch.** '$10,000 a year', '64 times faster' and '$132.65 found' on the acreage report. That $132.65 isn't money anybody gets; it's hours priced at a farmhand's wage.

Would I use it? On the acreage report and the prompt-pay interest, maybe, with Tyler looking over my shoulder. I wouldn't tell the neighbours yet. What I need: the field and the date first, the rule the date comes from, one question at a time, and a plain line at the top: 'this prepares; you file'."

## Findings, ranked by impact (category-wide first)

The full schema is in `findings-public.json`. I checked every one against code or dump.

1. **public-01 (blocker) The Value figure has no basis on screen, and two of them contradict their own basis.**
   - What the desktop has: `economics.basis` is never parsed (`lib/playbooks.ts:43-54`). `sources` is parsed but rendered by no chores view. The only label is "for the persona" (`scenes/chores/topic.tsx:191`, `:246`).
   - **fsa:** the basis says "no programme dollar is built on it" and prices the world at 7 x $18.95 = $132.65, yet the page shows $10,000 a year, 75x the world (numbers.json `world_ratio` 75.4).
   - **prompt-pay:** shows $3,500 a year, which is 8x the world's $440.16. Devon's own case works out at about $27: $18,600 x 4.75% x 11/360 = $27.00 on TR-0412.
   - **erate:** shows $40,000 a year, but Ruth's library bids add up to $23,500, so about $18,800 at an 80% discount.
2. **public-02 (blocker) Time saved leaves out the person's review time, and the review figure is computed but never shown.**
   - `beforeAfterOf` builds "your review N min" (`scenes/chores/model.ts:152-158`), but the topic page renders only the two figures and the ratio (`topic.tsx:194-202`).
   - Shown versus with review (numbers.json `speedup_with_review`): bid 50x/16x, crop 66x/39x, erate 129x/62x, prompt 39x/22x, fsa 64x/26x, grant 142x/75x, records 69x/22x, restricted 64x/29x.
   - The Characters' own expectations are about 4x (Devon 150 to 35 min) and about 3x (Ruth 100 to 30 min).
3. **public-03 (blocker) The "rehearsal shaped like your case" plays the example persona's script and ignores the brief's scope.**
   - All 16 traces open with the persona's user turns, shown under "You" (`scenes/chores/turn.tsx:35`). Examples: "I'm Marian Oyelaran; I run Larkfield Systems" and "I'm the technology director of Larchmoor Unified".
   - Ruth's crop brief said "A list of each field needing notice" and nothing more. The rehearsal filed 3 claims and showed "$34,527 found" (`dump:crop-insurance-notice--ruth#rehearsal`).
4. **public-04 (blocker) No brief or topic page names a rule's source, and every deadline in Ruth's briefs lacks a calendar date or a rule.**
   - `BRIEF_SYSTEM` asks for neither (`src/athena/adopt/prompts.py:117-135`).
   - A gate's `why`, which sometimes cites the rule (e.g. fsa's 7 CFR 718.106), sits only in a hover `title` (`flow.tsx:106`). Ruth on a phone never sees it.
   - Devon's C2 fails 8/8. Ruth's C4 fails 7/7 judged.
5. **public-05 (major) Shaped rehearsals carry outcome labels from the old answer key.**
   - The showcase says "Your case changed rows the answer key was written for, so no dollar figure is claimed" (`showcase.tsx:110`). Yet each card still renders `OUTCOME_WORDS[c.outcome]` (`turn.tsx:68-73`).
   - Devon's BL-107 (an NAICS 238220 bid he qualifies for at $5.32M) shows "Fell for a trap".
   - Ruth's PAY-Q3-DALE (Dale at his timesheet share, exactly as her brief said) shows "Unfounded".
6. **public-06 (major) Money of three different kinds sits on one topic page with no key.**
   - The Value estimate, "Filed on the bench" (`flow.tsx:121-123`, from `blueprintOf`, `model.ts:129`) and the rehearsal's "found" figure all appear as dollars.
   - Two are count weights: bid shows $10 and records shows $9, both at $1 per item.
   - One is wage weights: fsa shows $132.65.
   - Restricted shows $74,600 "filed" under a hero that says "Released — $59,600". The extra $15,000 is the 9,000 and 6,000 reports counting the same dollars twice (23,200 + 15,000 + 6,300 + 9,400 + 5,700 = 59,600).
7. **public-07 (major) The brief's fixed headings bury approvals and use "claim" in its internal sense.** The headings are hard-coded (`src/athena/adopt/loop.py:492-497`). No brief has a "needs your OK" or "never on its own" section. Devon's C5 fails 8/8.
8. **public-08 (major) The interview speaks in the template's terms.**
   - Invented portal names are offered as answer choices on nearly every first card. Ruth: "Never heard of Contractdesk or Postwren."
   - The bid chore offered Ruth IT/HVAC work types and receipts "in millions" when hers are $338,000 (`dump:bid-opportunity-triage--ruth#turn:2`).
9. **public-09 (major) The brief restates the example's facts as the person's.**
   - `_brief_sections` seeds "claim" and "left alone" from the playbook's own brief (`loop.py:507-520`).
   - After one question about apps, Devon's records brief lists the $584 and $12 invoice, the $1,840 estimate, F-2's lapsed window and "Requestbright's $249 offer". All of these are world fictions (`dump:public-records-requests--devon#brief`).
10. **public-10 (major) The topic page never says in words whether Athena files or only prepares.**
    - The short titles and steps say "filed", "Files a Form 471", "files the SF-425".
    - The ask-first diamonds exist (so the judges' "never says asks first" is refuted), but nothing says "prepared, nothing sent until you approve".
    - Ruth raised this in her asides on 8 of 8 chores.
11. **public-11 (major) "Start for real" doesn't say what happens next.** It says only "Hands the brief's command to Athena. It waits in her composer until you send it" (`showcase.tsx:136-147`). Nothing about real accounts, approvals, Due or Runs (J8 definition of done).
12. **public-12 (major) Rehearsal cards show no reason, and the items she left alone are invisible.** `BenchCard.why` exists but the turn card renders only the key, the action, the outcome and the value (`turn.tsx:70-75`). J8 asks for "why and whether it was right".
13. **public-13 (major) Several questions per card.** The prompt allows "At most 4 questions" (`prompts.py:55`). Ruth's C5 fails 8/8.
14. **public-14 (major) Jargon on every screen.**
    - Catalogue: "benched exceed the bar", "found on the bench" (`model.ts:104-105`) and the "Best edge" sort (`catalogue.tsx:38`).
    - Topic: persona, Traps avoided, on the bench, world, claims, brief, turn (`topic.tsx:191,205-207,220,246,286`; `flow.tsx:118`).
    - Studio: The brief, draft N, slot, rehearses, world (`casepanel.tsx:163,268-271,292`).
    - Showcase: benched run, cards, answer key, Turn N, Fell for a trap / Right claim.
15. **public-15 (major, uncertain in production) Rules of law left as "(my guess)".**
    - 27 guess lines across 16 briefs. By my reading, 18 are rules or arithmetic Athena could settle: the 50% limit, 72 h, 28 days, the $1 floor, 40 days, Iowa Code ch. 22, double-crop, prevented planting, ASC 958 corpus.
    - In the bid chore the interview even asked Devon the 50% rule, against its own instruction "Never ask what public sources can answer" (`prompts.py:68-69`).
    - With research off in the harness, production may differ.
16. **public-16 (major) The verdict and its sample size are never rendered.** `verdictOf` builds the sentence, "exceeds in N of M" and "n=1" (`modules/playbooks/model.ts:112-152`), and no `.tsx` renders them. The judges' "Exceeds (n=1)" quotes are therefore refuted as "seen". The confirmed problem is that 39x to 142x claims resting on one run carry no n.

Chore-specific findings (17 to 27) are in the JSON. Highlights:
- **crop:** Ruth's brief has "72 hours of the freeze" (the policy says initial discovery). It also has "no second notice" for noticed units, dropping "for the same cause", which Athena herself read in the rehearsal (trace turn 2).
- **records:** California law was applied to Ruth's Iowa county.
- **grant:** neither brief gives the SF-425 due date. The quarter ended 30 Sep, so it is due 30 Oct under 2 CFR 200.328, which is in the playbook's own sources.
- **grant:** "$31,492" in the hero against "$31,493" in the flow, a rounding disagreement.

## Chore fixes (edits to the playbooks a pro would demand)

**bid-opportunity-triage**
- **Economics.** Stop rendering $0 as a Value, and stop rendering the $1 count weights as "$10 filed". Show "10 of 10 decisions right" instead. Evidence: numbers.json `quirks`; `flow.tsx:122`.
- **Rules.** The 50% trap needs its condition stated: the limitations on subcontracting (13 CFR 125.6) apply to set-aside and sole-source awards, not to full-and-open bids. Word it as "of the amount paid to you", which Devon's brief got right and Ruth's ("of the price") got wrong.
- **Missing cases (offline knowledge).** An active SAM registration and reps & certs; the ostensible-subcontractor rule for teaming.
- **Interview.** Ask the person's kind of work and receipts scale before offering options. Ruth's mowing and hauling sits in NAICS codes the playbook's five-code table doesn't hold.

**crop-insurance-notice**
- **Rules (offline knowledge, CCIP 7 CFR 457.8 §14):**
  - add "do not destroy or harvest a damaged unit before the adjuster appraises it, or leave representative strips";
  - add the notice due 15 days before harvest for damaged units;
  - state that notice runs from discovery, not from the weather event (Ruth's brief got this wrong).
- **Coverage.** Say that most Iowa corn and soybean acres carry Revenue Protection, so a Yield-Protection-only claim formula (guarantee less production x projected price) understates many real claims.
- **Economics.** $18,000 a year is "for the persona". Show the basis sentence ("not every year is a loss year") beside it.

**erate-applications**
- **Economics.** $40,000 a year is a district figure. For a library, the Category Two budget is per square foot, not per student. Ruth's case works out at about $18,800 at 80%, so give a library line or a range.
- **Rules (offline knowledge).** Add the eligibility check (a nonprofit "learning center" is eligible only as a school or a library under state law) and the CIPA/Form 486 step after the funding decision.

**federal-prompt-pay-interest**
- **Economics.** The $3,500 basis assumes a penalty claimed on every late payment ("the same again in penalties"). Halve it, or say so. Show $440.16 as "on the invented contractor".
- **Rules (offline knowledge).** Add constructive acceptance (the 7th day after delivery unless the contract says otherwise, 5 CFR 1315.4(g)). Say the Act covers procurement contracts, not grant reimbursements. Devon's brief "Every federal invoice in Invoicepoint gets checked (my guess)" would sweep grant draws.

**fsa-acreage-reporting**
- **Economics.** Its own basis says no programme dollar exists, so the $10,000 Value contradicts it. Make value_usd 0 with "mostly minutes", or price the real exposure (loss of ARC/PLC and insurance eligibility under 718.106). Never show $132.65 of wage weights as "found".
- **Rules (offline knowledge, verify).** A wet field with no prevented-planting notice is not "left alone". FSA expects all cropland on the farm reported, so it goes on as idle or fallow, not as PP.
- **Brief.** Write "15 July 2026, final reporting date (FSA Iowa notice)", not "the 15th".

**grant-drawdown-reporting**
- **Brief.** Add the SF-425 due date (30 days after the quarter, 2 CFR 200.328, already in `sources`).
- **Rules (offline knowledge).** Add cost share/match. Ruth's USDA value-added grant requires a dollar-for-dollar match documented with each draw. Add the de minimis 15% indirect rate (2024 revision). Know each agency's system: Education uses G6, not PMS, which Devon gave and Athena accepted silently.
- **Hero.** "$31,492" should be "$31,493", or show "$31,492.60" everywhere.

**public-records-requests**
- **Rules.** The chore is California-only (CPRA). Make the city leg's law a slot. Iowa Code ch. 22 has no 10-day clock and lets a county charge reasonable retrieval and supervision costs (offline knowledge). The rehearsal for Ruth still ran Pellmoor Bay's CPRA rules.
- **Economics.** $1 count weights render as "$9 found". Show "9 of 9 acts right".

**restricted-funds-release**
- **Economics.** Count only released dollars as the bench total ($59,600), or label the $15,000 of reports as "reported, not new money". Evidence: hero $59,600 against flow and rehearsal $74,600.
- **Rules.** Keep them. The ASC 958 reading (board designation is not a restriction; equipment is released when placed in service; all-or-nothing barriers) is sound. The basis's honest refusal of the $30,000 roster figure should be visible.

## What passed (strengths worth protecting)

- **The gate model holds end to end.** Every pair's gate slots came out "Asks you before ..." `confirmed` (16/16 dumps). Every brief keeps submission or payment with the person. The Flow draws each gate as an amber "Athena asks you first" diamond (`flow.tsx:106-112`).
- **The briefs are faithful to case-specific exclusions.**
  - grant: the pre-award license, the other award's rent, the alcohol, lobbying and penalty, and pay by timesheet, for both Characters;
  - crop-devon: the unreported church acres;
  - erate: the conflicted 470 drafter, for both;
  - fsa-devon: the double-crop line and the share lease;
  - restricted-ruth: the board reserve versus the perpetual endowment.
- **The practice run labels itself honestly where it can.** "Rehearsal on invented data shaped like your case — nothing was sent", and "no dollar figure is claimed" when the shape broke the key (`showcase.tsx:40,110`). The judges missed this because they never saw the UI.
- **The topic hero is short and structured.** It renders the playbook `brief` (`topic.tsx:160-164`), not the run-on `promise` the judges criticised.
- **Grant (per quarter) renders consistently.** The Value tile and the "Worth" line both say "per quarter" (`model.ts:84-87`; `modules/playbooks/model.ts:104-110`). The scout hypothesis about annualising is refuted for this category. The remaining quarter issue is the global ledger sort.
- **The rehearsals followed the rules.** 0 false claims across the 9 scored runs; the 2 non-correct cards are both answer-key artefacts (public-05).
- **The playbook data is excellent.** The economics bases cite sections, dates and measurements, and restricted declines an unsupported roster figure. The fix is to surface this data, not to rewrite it.
