# UAT L1 + LC - Chores, category `benefits` (2026-10-23)

- **Category:** benefits (audience: home)
- **Chores (12):** aid-professional-judgment, fafsa-verification, fema-individual-assistance, fsa-claims-substantiation, medicaid-renewal, medicare-enrollment-timing, medicare-plan-review, msp-extra-help, pslf-employment-certification, rep-payee-accounting, rmd-check, ssdi-work-reporting
- **Characters (2):** `denise` (school secretary, 55, POA for her widowed mother, low tech comfort, scam-wary) and `lan` (pharmacy technician, 41, English second language, low tech comfort, fee-wary)
- **Pairs:** 24 of 24 complete, 0 failed. Onboarding ended `clear` in 24/24, rehearsal `done` in 24/24, brief approved in 24/24.
- **Cost of the pairs:** $36.94 (sum of `cost_usd` over the 24 dumps)
- **Judge:** 27 of 144 criteria passed (18.8%); adopt yes 0, maybe 23, no 1.
- **Honest numbers (rubric units):** 74 of 222 (33%) across catalogue, topic and practice result.
- **Method:** J7/J8 walked in character over `apps/desktop/src/scenes/chores/` (catalogue.tsx, topic.tsx, flow.tsx, adopt/showcase.tsx, adopt/casepanel.tsx, adopt/conversation.tsx), `modules/playbooks/model.ts`, `lib/playbooks.ts`, daemon `src/athena/adopt/prompts.py` and `slots.py`; LC evidence from `proving-runs/chores-uat/2026-10-23-chores/pairs/<pair>.json`; numbers from `numbers.json` and recomputed from `playbooks/<id>/bench.json`. Severity is derived from impact: 3 highs = blocker, 2 highs = major, 1 high or 2+ meds = minor, otherwise polish.

## How the numbers were counted

The screens a person sees before onboarding (identical for both Characters):

- **Catalogue row (3 NUMBERS):** time by hand, time with Athena, Value (`catalogue.tsx:105-134`). None has a source next to it. **0/3 honest.**
- **Topic page (9 + k NUMBERS):**
  - the hero brief's own figures, k per chore (`topic.tsx:160-161`)
  - the Value tile (`topic.tsx:188-191`)
  - Time saved: by hand, with Athena, and the ratio (`topic.tsx:193-203`)
  - the Traps avoided tile (`topic.tsx:204-208`)
  - the flow's spine note (`flow.tsx:117-118`)
  - the flow's result: a dollar figure and "n of n claims right" (`flow.tsx:120-123`)
  - the "Worth $X ..." line under Make it yours (`topic.tsx:246`)
- **Which of these count as honest:**
  - **Honest:** the trap tile, the spine note and the claims count. They say "on the bench", and the gallery on the same page explains "bench run, on an invented portal world" (`topic.tsx:220`).
  - **Honest only when it agrees with the Value tile:** the flow's dollar result.
  - **Never honest:** the Value tile and the Worth line (no source), the times (no source, and the person's review time is left out), and the brief figures (the invented persona, never labelled as such).
- **Practice result (rehearsal):** 1 NUMBER when a dollar figure is claimed, 2 when the world was shaped. These are labelled "on invented data" (`showcase.tsx:40, 102-118`), so all of them count as honest.
- **Not counted:** the brief's figures. They are the person's own answers and are not claims.

Branches of the shared value mapping: in benefits `per` is `year` (10 chores) or `episode` (pslf, fema). There is no `month` or `week`, so the scouts' annualisation mismatch between the Value tile (`model.ts:84-87`) and "Worth $X {view.per}" (`topic.tsx:246`) **does not occur in this category**. Both branches render the same figure. The `episode` branch has its own defect (benefits-14).

## Scorecard

Jargon words met = distinct words from the rubric's list shown without an explanation, across catalogue, topic, studio and showcase. The words are:

- catalogue: bench, exceed the bar, edge
- topic: persona, trap, world, claim, turn
- studio: slot, draft, session
- showcase: brief, rehearsal, card

That is 14 words in all, and 13 for fsa, where "claim" is the field's own term. The benefits terms left unexplained are listed under Chore fixes.

| chore | honest h/n | jargon met | onboarding ended (D / L) | rehearsal (D / L) | adopt (D / L) | judge pass (D / L, n=6 each) | field verdict |
|---|---|---|---|---|---|---|---|
| aid-professional-judgment | 6/17 | 14 | clear, 2 cards / clear, 2 | $4,000 / $4,000 | maybe / **no** | 1 / 1 | sound |
| fafsa-verification | 6/17 | 14 | clear, 2 / clear, 2 | $7,000 / shaped 7 of 7 cards | maybe / maybe | 1 / 1 | sound (2 rules unverified) |
| fema-individual-assistance | 6/21 | 14 | clear, 2 / clear, 3 | $12,400 / shaped 3 of 3 | maybe / maybe | 1 / 1 | issues |
| fsa-claims-substantiation | 7/20 | 13 | clear, 2 / clear, 2 | shaped 7 of 7 / shaped 7 of 7 | maybe / maybe | 1 / 1 | issues |
| medicaid-renewal | 8/18 | 14 | clear, 2 / clear, 2 | shaped 7 of 8 / shaped 8 of 8 | maybe / maybe | 0 / 1 | sound (value proxy) |
| medicare-enrollment-timing | 5/16 | 14 | clear, 1 / clear, 2 | $487 / $487 | maybe / maybe | 1 / 1 | issues |
| medicare-plan-review | 5/17 | 14 | clear, 1 / clear, 1 | $1,516 / $1,516 | maybe / maybe | 1 / 1 | sound |
| msp-extra-help | 6/18 | 14 | clear, 2 / clear, 2 | $3,797.20 / shaped **2 of 5** | maybe / maybe | 1 / 2 | issues (minor) |
| pslf-employment-certification | 7/18 | 14 | clear, 2 / clear, 2 | shaped 5 of 6 / shaped 4 of 6 | maybe / maybe | 1 / 2 | **wrong economics**, sound rules |
| rep-payee-accounting | 6/20 | 14 | clear, 2 / clear, 2 | shaped 8 vs 7 / $315 | maybe / maybe | 1 / 2 | sound |
| rmd-check | 5/19 | 14 | clear, 1 / clear, 1 | $2,900 / **$2,120 (key $2,900)** | maybe / maybe | 1 / 1 | sound (1 deadline missing) |
| ssdi-work-reporting | 7/21 | 14 | clear, 2 / clear, 1 | shaped 5 of 5 / $4,000 | maybe / maybe | 1 / 2 | issues (minor) |
| **total** | **74/222 (33%)** | | 24/24 clear | 24/24 done | 0 yes, 23 maybe, 1 no | **27/144 (18.8%)** | |

### The same quantity, rendered differently on one topic page

"Worth $X for <persona>" and the flow's "Filed on the bench" both describe the persona's case, which *is* the bench world. They disagree in 9 of 12 chores:

| chore | Value tile + Worth line | brief headline | flow result (bench) | tile / world |
|---|---|---|---|---|
| medicare-enrollment-timing | $1,000 a year | "$487 a year" | $487 | **2.05x over** |
| pslf-employment-certification | $40,000 per episode | balance "$48,200" | $20,000 | **2.00x over** |
| rep-payee-accounting | $500 a year | "$315" | $315 | **1.59x over** |
| medicare-plan-review | $1,200 a year | "$1,516" | $1,516 | 0.79 |
| fsa-claims-substantiation | $900 a year | "$966.47" | $966.47 | 0.93 |
| fafsa-verification | $5,000 a year | "$7,000 of aid stays held" | $7,000 | 0.71 |
| rmd-check | $2,000 a year | "$6,000" missed | $2,900 | 0.69 |
| msp-extra-help | $2,500 a year | "$3,797 a year" | $3,797.20 | 0.66 |
| fema-individual-assistance | $8,000 per episode | "$12,400" | $12,400 | 0.65 |
| aid / medicaid / ssdi | $4,000 / $7,000 / $4,000 | (no total) | same | 1.00 (clean) |

### Time saved, honestly

The topic page shows by hand → with Athena and "N× faster" (`topic.tsx:194-202`; `speedup()` at `lib/playbooks.ts:591-595`). The bench's own review time is computed into `athena.line` (`model.ts:154`) and rendered by no topic element.

| chore | shown | ratio shown | with bench review | Character's own (Denise 120→35, Lan 150→40) |
|---|---|---|---|---|
| rep-payee-accounting | 8 h → 3 min | 152× | 72× | 3.4× / 3.75× |
| pslf | 6 h → 3 min | 140× | 65× | same |
| fema | 3 h → 2 min | 106× | 56× | same |
| msp-extra-help | 3 h → 2 min | 99× | 42× | same |
| medicare-enrollment | 2.5 h → 2 min | 90× | 56× | same |
| ssdi | 1.5 h → 1 min | 80× | 25× | same |
| medicare-plan-review | 3 h → 2 min | 79× | 47× | same |
| fsa | 2 h → 2 min | 78× | 24× | same |
| aid | 2.5 h → 2 min | 77× | 51× | same |
| medicaid | 3 h → 3 min | 64× | 26× | same |
| fafsa | 1.5 h → 2 min | 49× | 17× | same |
| rmd-check | 3 h → 4 min | 42× | 25× | same |

No judge would estimate the time saved: `time_saved_min_est` is null in 24/24 pairs. Denise's mother's annual payee report is the worst case. A bench "review" of 3.5 min is set against her checking a year of statements before she signs a federal accounting.

## Per-Character reviews

### Denise Holloway - in her words, over the 12 chores

> I went through twelve of these, and every time I typed the same thing first: tell me what you'll ask
> me for before you ask, especially Mom's Social Security number or her bank details, and tell me by when
> I have to do something. Not once did a screen answer the first part before the questions started
> (0 of 12). The questions themselves were kind, easy and short. But they offered me apps I've never
> heard of - Mailnest, Postwren, Ledgerline, Carenook, Rxmeadow - and I had to type "not that one" over
> and over. That's exactly what the scam sites look like to me: names that are almost right.
>
> The thing I came for, the dates, I never got. Not one of the twelve briefs I approved listed my
> deadlines with dates (0 of 12). They said "Athena reads the deadline during the run (my guess)". For
> Maya's aid the page said 16 October, and I thought I'd already missed it. My own notice says
> 30 October. That page was somebody else's family, and nothing told me so.
>
> The money figures mean nothing to me. The page says "$1,000 a year, for the persona" for Walt's
> Medicare, and the very next line of the same page says "$487 a year". Which one is it, and whose? On
> the loan forgiveness page it said $40,000, and my whole loan is $31,400. Who is "the persona"? I did
> like the practice run saying "on invented data, nothing was sent". That part I understood.
>
> What I do trust: the diamonds that say "Athena asks you first", and the brief saying she asks
> before every filing, payment or reply. That held in 11 of 12. The Medicare drug-plan review and the
> required-withdrawal one got Mom's facts right: Humana, Corner Pharmacy staying, Uncle Walter's IRA at
> Harborline. I'd try the drug-plan one in December with Greg looking over my shoulder.
>
> Would I adopt it? Maybe, for things I can check myself. Would I tell my brother? Not until it gives me
> the dates and tells me up front what it wants. Words like QMB, IRMAA, "run-out", "trial work month",
> "dependency override" and CMS-L564 need one plain line each, or I can't explain to Gary what I did.

### Lan Tran - in her words, over the 12 chores

> Sorry, I want to be sure. My first question every time was: does this cost money? I paid a helper
> before and got nothing. Only two times the brief said it plainly, "nothing here costs you money"
> (Medicare savings, disability report). Other times it said "you are told before anything costs money".
> That sounds like a fee later. And some briefs had fees I never said: $189, $149, $299, as if they were
> mine. That made me more worried, not less.
>
> The questions were short, and she never asked me the same thing twice (12 of 12 good). But she asked
> about apps, not papers. I want "the renewal form from the state" or "your W-2", the name printed on the
> paper. And she asked me things she could look at herself. Which state is my mother in? It is in
> Statecare. Which months is the payee report? It is in the letter in my Drive. I said "can you check?"
> and the brief wrote "my guess".
>
> Dates: I need the date and what happens if I miss it. No brief gave both (0 of 12). For FEMA, my
> appeal date was 19 October and it was 23 October. The brief said only "Athena will check". For
> Medicaid it wrote 14 November two times, but not "if you miss it, coverage stops, and you still have 90
> days to send it". A navigator at the community centre would tell me that.
>
> The loan forgiveness page shows $40,000. My loan is $31,400, and my hospital job ended in 2021. I think
> it cannot be $40,000 for me. In the practice for my mother's withdrawal it said "$2,120 found". It did
> not say that the full answer was $2,900, or that one withdrawal was missed.
>
> Would I use it? Maybe, slowly, checking each step. Would I tell my sister-in-law? Only after it says
> "free" on the first screen and gives every date with what happens if it is late.

## Findings, ranked by impact

Category-wide first, then chore-specific. Full schema in `findings-benefits.json`.

### Category-wide

1. **benefits-01 (blocker, trust).** The topic page contradicts itself on the money. The Value tile and Worth line (`topic.tsx:188-191, 246`; `model.ts:84-87`) disagree with the page's own brief (`topic.tsx:160-161`) and the flow result (`flow.tsx:120-123`; `model.ts:127-131`) in 9 of 12 chores. Three of them overclaim: medicare-enrollment 2.05×, pslf 2.0×, rep-payee 1.59×.
2. **benefits-02 (blocker, trust).** No dollar figure carries its source.
   - `economics.basis` is never parsed: the economics object at `lib/playbooks.ts:495-505` has no basis key.
   - `economics.sources` is parsed (`lib/playbooks.ts:501`) and `caveat` is parsed (`lib/playbooks.ts:522`), but grep finds no renderer in `scenes/` or `modules/` for either.
   - Every basis says "an estimate" except medicaid-renewal. Criterion 3 failed for 24/24 pairs.
3. **benefits-03 (blocker, missing).** The brief has nowhere to put a deadline.
   - The interview is told "Never ask ... a deadline set by law: research does that" (`prompts.py:68`).
   - The brief schema is lead / setup / claim / left_alone (`prompts.py:130-136`), with no deadlines and no consequence field.
   - Result: Denise c5 0/12, Lan c6 0/12. Briefs say "(my guess)" or "read during the run".
4. **benefits-04 (blocker, trust).** No screen says, before the questions, what will be asked (sensitive numbers) or whether the chore costs anything.
   - Denise c1 0/12; Lan c4 2/12 (only where the brief happened to say it).
   - `INTERVIEW_SYSTEM` (`prompts.py:49-77`) has no rule to answer the person's own up-front question, and `say` is optional.
   - The studio has no static "what this asks for / what it costs" panel: grep finds no such text in `scenes/chores`.
5. **benefits-05 (major, clarity).** The first card offers the playbook's invented app names as answer options.
   - `mechanical_slots` (`slots.py:130-141`) builds "Do you use {invented name} for ...", with the invented name as the default value.
   - Nearly every pair had to type "not Mailnest / Postwren / Ledgerline / Carenook ...". For Denise this looks like a scam pattern.
6. **benefits-06 (major, time-saved).** "N× faster" (42-152×) leaves out the person's review time. The bench's own `your review` (`model.ts:154`) is computed but not rendered. Counting the review it is 17-72×, and on the Characters' own estimates it is 3.4-3.75×.
7. **benefits-10 (major, trust).** Briefs import the persona's fee offers ($189, $149, $299, $695) into a real person's "Left alone" as if they were in her case. Lan read these as hidden fees (msp-lan, fafsa-lan brief; medicare-enrollment-denise judge).
8. **benefits-12 (major, effort).** Cards hold up to 4 questions (`MAX_QUESTIONS = 4`, `prompts.py:43,55`), mostly with no stated purpose. Denise's "one at a time, each says what it is for" passed 0/12.
9. **benefits-13 (major, clarity).** Jargon on every screen:
   - catalogue: bench, exceed the bar, Best edge (`catalogue.tsx:38`; `model.ts:104`)
   - topic: persona (`topic.tsx:191`), trap, bench, world (`flow.tsx:118`), claims (`model.ts:130`), turn (`topic.tsx:286`)
   - studio: slot (`casepanel.tsx:163`), draft (`casepanel.tsx:271`), session (`conversation.tsx:151`)
   - showcase: rehearsal, card, answer key (`showcase.tsx:107-109`)
   - Benefits terms with no plain line, in the briefs and on the pages: QMB/SLMB/QI/QDWI, Extra Help, deemed, disregard, run-out, EOB, CMS-L564, COBRA, special enrollment period, trial work month, inherited IRA, Form 5329, dependency override, professional judgment. Denise c2 0/12.
10. **benefits-15 (major, trust).** The catalogue claims "N of M benched exceed the bar" (`model.ts:104`) on one run: 11 of 12 benefits chores have `bench_runs_n` 1, pslf has 3. The verdict sentence and the `n=1` sample (`modules/playbooks/model.ts:132-152`) are computed but rendered nowhere (grep).
11. **benefits-16 (major, trust).** The persona's fixed dates read as live. Examples: aid "16 October", fafsa "16 October", fema "19 October". On the run date (23 Oct) these were past. Denise thought she had missed Maya's deadline, though her own was 30 Oct. No "example case" label sits beside the brief.
12. **benefits-09 (minor, trust; under-ranked by frequency).** A rehearsal's dollar figure hides what it missed. For rmd-lan the screen shows "$2,120 found in the rehearsal, on invented data" (`showcase.tsx:113-118`), but the answer key is $2,900. The $780 gap equals exactly the Pinebrook IRA 2026 RMD weight in `truth.json`: a missed RMD (25% excise risk) shown as a success. msp-lan "2 of 5 cards" is shown, but only in jargon and with no verdict.
13. **benefits-11 (minor, effort).** Athena asks for what she will read herself:
    - msp-lan: mother's state (in Statecare)
    - rep-payee-lan and rep-payee-denise: report year (in the SSA letter)
    - fafsa-lan: aid amount held (in Aidcenter)
    - fsa-denise: coverage start (in Flexwell)
    - aid-lan: an earlier 2024 hours cut, which the brief then stated as a fact

    The interview's ban covers only public facts (`prompts.py:68`).
14. **benefits-14 (minor).** `per: episode` values are sorted raw against yearly ones in "Most value" (`model.ts:351`, `annualValue` default branch at `model.ts:191-200`). That puts pslf ($40,000) and fema ($8,000) at the top of benefits.
15. **benefits-19 (minor, harness).** The chores_uat judge was given the playbook's title and promise as "the page" (`judge.py:5-7`). The app's topic hero renders the bulleted brief (`topic.tsx:160-164`). Every "page is one long sentence" verdict (14 judge findings) is about text the app does not show.

### Judge leads checked and refuted

- **benefits-07 (refuted).** "Topic page is one very long sentence". The hero renders `p.brief`, a bulleted brief of 10-15 short lines. The promise appears only when the brief is empty (`topic.tsx:160-164`). The long promise is reachable only as the catalogue row's tooltip fallback (`catalogue.tsx:87`), and every benefits chore has a brief.
- **benefits-08 (refuted, with a residue).** "Rehearsal not labelled as invented". The showcase tags it "Rehearsal on invented data shaped like your case - nothing was sent" and "found in the rehearsal, on invented data" (`showcase.tsx:40, 113-118`). Residue: a rehearsal shaped by renames only shows the persona's own total ($4,000, $487, $1,516) under "shaped like your case", which Denise could still read as her mother's money.
- **benefits-17 (refuted, partly).** "The page doesn't say nothing is sent without approval before I begin". The topic flow carries a legend "Athena asks you first" and one diamond per gate (`flow.tsx:69-70, 106-111`). The wording is still generic: it does not say "nothing is sent to an agency, a plan or a custodian".

### Chore-specific

16. **benefits-20 (major, pslf).** Value of $40,000 per episode, 2× the world's $20,000. It exceeds the *entire* balance of both Characters ($31,400 each, per the case cards). Lan has had no qualifying employer since January 2021, so no forgiveness is reachable without a return to public service, and the page cannot say so.
17. **benefits-21 (major, medicare-enrollment-timing).** The Value tile shows $1,000 a year. The brief and the world say $487 a year (20% × $202.90 × 12 = $486.96, computed). The basis's "and the gap avoided" is not in the world.
18. **benefits-26 (minor, medicaid-renewal).** The $7,000 is KFF's state *spending* per expansion adult, shown as the family's "Value". It is the only basis that does not say "estimate". The consequence the rule gives, 90 days to return the form after coverage ends (42 CFR 435.916, which is in its own sources), is not in the brief (Lan c6).
19. **benefits-24 (minor, medicare-enrollment-timing).** The senior bar would add the dates that Part B sets off: the Medigap 6-month open enrollment, Part D creditable coverage and 63 days, and stopping HSA contributions (offline knowledge).
20. **benefits-22 (minor, fsa).** With a carryover plan (the world's plan has one, $660), unclaimed health FSA dollars up to the carryover are not forfeited. The "money recovered" counts them anyway. Dependent care ($610) and the swipe ($86) are real exposure (offline knowledge plus the basis text).
21. **benefits-23 (minor, msp-extra-help).** A burial fund held "at a funeral home, only for burial" (Lan's case) may be an irrevocable prepaid contract, which is excluded entirely. The chore always counts it above the $1,500 exclusion as reduced by life insurance (offline knowledge, SSI burial rules).
22. **benefits-25 (minor, ssdi).** It reports the months but never tells her how many trial work months are used or what follows: the EPE, and SGA of $1,690. In Lan's case July ($1,092) is under $1,210 and is not a TWP month. A pro tells her that; she fears a debt.
23. **benefits-27 (minor, fema).** The car appeal (ONA transportation) lacks a trap for the vehicle conditions: the household's only usable vehicle, and insurance first. The chore has no rule for an appeal just past 60 days (Lan, 4 days late) beyond "left alone".
24. **benefits-28 (minor, rep-payee).** "8 h → 3 min, 152× faster" for a year's federal accounting she must sign. The bench's 3.5 min of review is implausible.
25. **benefits-29 (minor, rmd-check).** For an IRA inherited from a sibling, the 10-year final distribution date is the governing deadline (basis cites the 10-year rule). It is in neither brief, and Denise asked for every deadline.
26. **benefits-30 (polish, medicare-plan-review).** The short title "Parents moved to their cheapest drug plans" states as done an outcome that needs approval.
27. **benefits-18 (polish).** The studio composer's placeholder is "My airline is Skylindle, and I paid with two cards…" on every chore (`conversation.tsx:38-39`).

## Chore fixes (edits to the playbooks themselves)

- **aid-professional-judgment.**
  - Add a "your college's deadline" fact slot: the case's own date was 30 Oct, not the persona's 16 Oct.
  - Explain "special-circumstances request" and "dependency override" in one plain line each in `brief`.
  - The basis says each filing is weighted $2,000 as an exposure unit. State that on the page ("estimate, up to the $7,395 Pell maximum").
  - Add a step note: a pro would also ask whether the 2027-28 FAFSA (2025 income) changes the picture.
- **fafsa-verification.**
  - Make `value_usd` agree with the world, or label it: the brief says "$7,000 stays held", the tile says $5,000.
  - The rules on the Statement of Educational Purpose and online notaries rest on the 2026-27 AVG as read through GEN-25-10 (I could not verify them offline). Keep the citation visible with the trap.
  - Add "what happens if missed": aid is cancelled and the Pell must be returned (668.60(c)(2), already in the basis).
- **fema-individual-assistance.**
  - Add a trap and fact for car ONA eligibility: only vehicle, insurance first.
  - Add a rule for an appeal past 60 days: say so plainly, and tell her to call and document the reason, not just "left alone".
  - Give a value that agrees with the brief: $8,000 against $12,400.
- **fsa-claims-substantiation.**
  - Split the value into health (carryover-protected up to $660) and dependent care plus the swipe (forfeit or repay).
  - Explain "run-out" and "EOB" in `brief`.
  - The deadline line needs two dates: the swipe deadline and the run-out.
- **medicaid-renewal.**
  - Mark the basis as an estimate and say whose money it is ("what the state would pay for your coverage, not cash to you").
  - Add the 90-day reconsideration consequence to the brief.
  - Explain "household as the tax rules define it" in one line: "your mother files her own taxes, so she is her own household".
- **medicare-enrollment-timing.**
  - Set `value_usd` to the penalty actually avoided ($487 a year, for life), or show both.
  - Add Medigap OEP, Part D 63 days and HSA as facts and steps.
  - Explain Part B, SEP, CMS-L564 and COBRA in one plain line each.
- **medicare-plan-review.**
  - Make the value $1,516 or label $1,200 as an estimate.
  - Short title: "Parents' drug plans compared for 2027".
  - Add an Extra Help/MSP eligibility check as a step: a SHIP counsellor screens for it.
- **msp-extra-help.**
  - Add a fact: is the burial fund revocable or an irrevocable funeral contract?
  - Define QMB, SLMB, QI, QDWI, "deemed" and "disregard" in one plain line each.
  - Add a renewal date and the state's processing time (45 days) as dates.
  - Make the value agree: $2,500 against $3,797.20.
- **pslf-employment-certification.**
  - Replace $40,000 per episode with a figure tied to the person's own remaining balance and months. The world's own valuation (a 120th of the balance per month) already does this.
  - Have the brief say plainly when no current employer qualifies.
  - Explain certification, reconsideration and buyback in plain lines.
  - Check the July 2026 qualifying-employer rule change (offline; uncertain).
- **rep-payee-accounting.**
  - Make `value_usd` agree with the world ($315) or say it is an estimate of fees caught.
  - Restate time saved as "she prepares the report; you check it" with a realistic review time.
  - Add the report's due date, and "what happens if not filed": SSA may treat it as a payee-suitability issue.
- **rmd-check.**
  - Add the 10-year final-distribution deadline and 31 December as dated items.
  - Explain "inherited IRA", "Form 5329" and "waiver".
  - The rehearsal score should show the shortfall against the answer key.
- **ssdi-work-reporting.**
  - Add a step and fact: trial work months used so far, the end of the TWP, and what the EPE/SGA means for her benefit.
  - Explain "trial work month" and "gross" in one line each.
  - Have the brief say "report promptly; late reports can create an overpayment you must repay".

## What passed (protect these)

- **Approval gates are trusted.**
  - Denise c6 passed 11/12. Every brief stated "asks you first" for each gated act.
  - The topic flow shows "Athena asks you first" diamonds before onboarding (`flow.tsx:106-111`).
  - The gate is fixed policy, never asked (`slots.py:144-158`).
- **The studio converges fast and cleanly.** 24/24 ended `clear` in 1-3 cards. Lan c5 (never asked twice) passed 12/12.
- **Briefs adapt to the person's own words.** Examples:
  - rmd-denise: Yahoo, Dropbox, and both IRAs at Harborline
  - aid-lan: "Linh only, nothing for Danny"
  - msp-lan: income and resources from her own answers
  - "(my guess)" marks unconfirmed facts honestly
- **Rehearsals ran: 24/24 done, 0 failed.**
  - The shaped-world branch refuses a dollar claim when the answer key no longer holds (`showcase.tsx:102-111`). That is the right instinct.
  - A practice figure is labelled "on invented data".
- **The bench is clean.** 12/12 chores found every eligible item with 0 false claims and every trap avoided (`bench.json` score). Rules are cited to CFR and POMS level, and the field rules I could check offline are right, among them QMB math, MAGI household, PSLF union exclusion, RMD ages and tables, FEMA's 60 days, TWP earned-month.
- **Medicaid's and SSDI's premises were corrected against the regulations** (the basis's "THE BRIEF'S PREMISES" sections). That is the senior-bar habit to extend to the page.
