# Chores UAT, L1 area walk: employment

- **Category:** employment (11 chores: 9 work, 2 home)
- **Characters:** carmen (HR manager, 46-person plant), walt (owner, 24-person field firm, low tech), lan and marcus (layoff, home), aisha and samira (parental leave, home)
- **Pairs:** 22 of 22 complete, 0 failed. All 22 onboardings ended `clear`, all were approved and all 22 rehearsals finished (`done`).
- **Cost of the pairs:** $36.24 (sum of `cost_usd` over the 22 dumps)
- **Method:** I walked J7 and J8 over the code for every pair. The LC dumps are under `proving-runs/chores-uat/2026-10-23-chores/pairs/`. I treated judge findings as leads and checked each one against the dump and the code. I computed the arithmetic myself; it agrees with `numbers.json`.

**What the judges did not see.** The judge saw the playbook's *promise* plus the KPI lines from `numbers.py:301-321`. The real topic page shows other things:
- The hero shows the playbook's bulleted `brief`, and falls back to the promise only when the brief is empty (`topic.tsx:160-163`).
- The page has the "How it runs" flow, with gates labelled "Athena asks you first" (`flow.tsx:70,106-111`).
- It shows a "Filed on the bench" result (`flow.tsx:120-124`).
- It does **not** show a verdict line.
- The studio labels the rehearsal "on invented data" and plays it turn by turn (`adopt/showcase.tsx:40,117,148+`).

Several judge findings are therefore refuted or only partly confirmed. The table of refutations is in the findings JSON.

**Severity rule** (derived from impact). Three highs make a blocker. Two highs, or one high and two meds, make a major. One high or two meds make a minor. Anything else is polish.

## Scorecard

How the columns were counted:
- **Honest numbers** counts every NUMBER a Character meets on one walk, plus both pairs' rehearsal figures. It includes the catalogue row (3), the topic KPI band (4), "traps avoided" and the flow's trap note (2), the flow result figure and its line (2), "Worth $X" (1), the bold or dollar figures in the hero brief, and the rehearsal figures.
- **Jargon** counts distinct list words per screen: catalogue 3 (benched, exceed the bar, edge), topic 7 (persona, trap, bench, world, claim, brief, turn), studio 10 (slot, session, draft, brief, card, turn, rehearsal, world, claim, trap). The UI is generic, so it is the same 20 for every chore.
- **Judge pass** is passes out of 12 criteria (6 per Character, both pairs). Null counts as not passed.

| chore | honest numbers | jargon met | onboarding ended | rehearsal | adopt | judge pass | field reliability |
|---|---|---|---|---|---|---|---|
| 401k-late-deposits | 7/17 | 20 | clear / clear | done shaped / done $87.93 | maybe / maybe | 3/12 | issues |
| adverse-action-notices | 4/15 | 20 | clear / clear | done $8,000 / done $8,000 | maybe / maybe | 3/12 | sound (federal); issues multi-state |
| cobra-notices | 6/16 | 20 | clear / clear | done $770 / done shaped | maybe / maybe | 2/12 | issues |
| freelancer-receivables | 6/16 | 20 | clear / clear | done $6,000 / done $14,950 | maybe / maybe | 2/12 | wrong for walt; issues |
| layoff-sixty-days | 8/16 | 20 | clear / clear | done shaped / done shaped | no / maybe | 2/12 | issues (wrong law for lan) |
| osha-300-log | 6/16 | 20 | clear / clear | done shaped / done $165,500 | maybe / maybe | 2/12 | issues (bench short, hidden) |
| parental-leave-claims | 8/19 | 20 | clear / clear | done shaped / done shaped | maybe / maybe | 3/12 | issues |
| remote-payroll-registration | 4/16 | 20 | clear / clear | done $995 / done $995 | maybe / maybe | 2/12 | issues |
| ui-claim-responses | 6/18 | 20 | clear / clear | done $9,880 / done shaped | maybe / maybe | 2/12 | sound |
| workers-comp-premium-audit | 6/15 | 20 | clear / clear | done $19,016 / done $19,016 | maybe / maybe | 3/12 | sound (NY); issues for unknown state |
| wotc-screening | 6/19 | 20 | clear / clear | done shaped / done $19,200 | maybe / maybe | 2/12 | issues (credit lapsed per its own caveat) |
| **category** | **67/183 (37%)** | 20 per chore | 22 clear | 22 done (9 shaped) | 0 yes / 21 maybe / 1 no | **26/132 (19.7%)**; 24.1% of judged | 2 sound, 9 issues |

**The honesty split.** None of the 9 author-set figures a chore shows (catalogue value, hand time and Athena time; topic Value, manual, Athena, ratio; Worth line; hero figures) carries a source, so 0 of 99 across the category are honest. Every honest figure is either bench-measured (traps avoided, claims right, "Filed on the bench") or a rehearsal figure the studio labels.

I counted a rehearsal "$X found" as dishonest when X is an exposure unit:
- FCRA damages of $1,000 per consumer
- the OSHA maximum of $16,550 per violation
- COBRA at $110 a day
- a vendor's $199 price
- the UI maximum charge
- a lapsed WOTC credit

**Time saved.**
- The ratio shown ranges from 32× to 85×.
- Counting the bench's own review time, it drops to 8.4× to 45.8× (`numbers.json`, `speedup_with_review`).
- The Characters' own expectations are 4× (carmen, 120 to 30 min) and 3× (walt, 90 to 30).
- `beforeAfterOf` builds a "your review X" line (`scenes/chores/model.ts:154`) that `topic.tsx:195-202` never renders.

## Per-Character reviews

### Carmen Ruiz (HR manager): 9 chores, judge pass 14/54, adopt 9 maybe

"I'll be fair: talking to her was easy every time. Two or three short cards, and the brief always ended up saying nothing goes to an employee, a candidate, the carrier or the state until I approve it. On COBRA, adverse action and the comp audit, the brief read the way I think. It had a list of who gets a notice, a list of who is left alone, and Tobias's skills test kept out of the background-check pile. I liked that she wrote '(my guess)' next to what she assumed instead of pretending.

But I asked the same thing nine times and never got it once: show me the rule. The brief says 'seven-business-day safe harbor', '44 days' and 'within 28 days' with no section next to any of them. Half the time she labels a rule the law settles as *her guess*. The SNAP age limit is in the IRS instructions. The 14-day COBRA clock is 29 CFR 2590.606-4. She apparently had those citations and never showed me one.

The numbers I simply don't believe. '75 minutes to 2 minutes, 40× faster' leaves out the hour I will spend reading every notice before it goes. '$2,000 a year' with nothing under it is a sales number. The practice run told me '$770 found', and that turns out to be one day's maximum penalty per notice, not money anybody found. On the plus side, the practice screen did say it was invented data, and when my case changed the rows it said so and claimed no dollars. I respect that.

The first card on nearly every chore offered me apps I have never heard of: Postwren, Crewmarrow, Binderwell. On the workers' comp audit I had the deadline circled, 6 November, and she never asked for it. On WOTC, nobody told me the credit has lapsed for anyone hired after last December, and all nine of my hires are from this fall. If that's true, it's the first thing I need to know.

Would I tell a peer? I'd say the interview and the approval gates are right. I'd also say don't trust a single figure on the page until it shows its source, and keep your paper calendar."

### Walt Brenner (owner, 24 people): 9 chores, judge pass 7/54, adopt 9 maybe

"The cards were short and nobody tried to sell me anything. I'll give it that. I got through every one in a few minutes.

But the first thing I see is about somebody else's company: a 38-person packaging outfit, a Texas distributor, a Portland software shop. Then she asks me whether I use programs I've never heard of. She never once told me where on my paperwork to find an answer, and that's all I asked for. My CPA used to tell me in two sentences what a letter wants and what it costs me if I ignore it. She never told me what anything costs me: the missed COBRA letter, the missed comp-audit date, the hiring credit, or this service itself.

The injury log brief says she'll send OSHA the 300 and 301 too, and I have 24 people, so that's wrong. The OSHA card told me the signer can't be 'you'. I'm the owner, and I can sign it. The invoice chore kept talking about a freelancer law. I'm not a freelancer, I'm a 24-person company. She ended up telling me 'which law applies is unsettled', which is no answer at all.

The money on the screen looks like selling: $9,600 a year, $165,500 found, 82 times faster. I'd show it to Donna before I'd use it, and I wouldn't recommend it to anybody at the Rotary yet."

### Lan Tran (layoff): 1 chore, judge pass 0/6, adopt no

"Sorry, I want to be sure. I asked three times if it costs money, and nobody answered me. She asked my state two times. The first time I already said I don't know and asked her to read my papers.

The brief tells me to sign Option B, but it also says my state is not known. How does she know? It says COBRA is 1,020 dollars a month. My paper says 1,340. It says my payment starts this week. It does not say my back scan on 10 November. I would not sign anything from this."

### Marcus Webb (layoff): 1 chore, judge pass 2/6, adopt maybe

"Once I corrected the New York defaults to Washington ESD and Healthplanfinder, it framed things right. COBRA for October only covers the 6 October MRI, and she held off on severance until she checks how Washington treats payment timing. That's the right instinct, because New York's 30-day rule isn't mine.

What's missing is the math. The brief has no premium, no benefit rate, no credit amount, only 'with the math laid out first'. '$3,000 per episode' and '77×' have no method behind them. I'd redo all of it myself."

### Aisha Grant (parental leave, Arizona): 1 chore, judge pass 1/6, adopt maybe

"Setup was quick: three cards, and no SSN. But every app option was wrong. The page is about a woman in Rochester, with '$8,000 per episode, for the persona', and I still don't know what lands in my account or when.

Worse, my hospital pays four weeks of parental leave through Lincoln. Her brief files 'paid family leave only if your state's program exists', and Arizona has no state program, so as written she might skip my $4,147."

### Samira Okoye (parental leave): 1 chore, judge pass 2/6, adopt maybe

"It was tidy: one Workday request, a disability claim and a PFL claim, and nothing sent without me. But I asked what's urgent, and there isn't one deadline in the brief. The baby is due 24 November and today is the 23rd, so 30 days' notice runs out in two days. Nobody said so. I also wish it had said my new name isn't on anything yet."

## Findings, ranked (impact = frequency × reachability × trust erosion)

### Category-wide themes

1. **employment-01 (blocker): author-set figures carry no source anywhere in the UI.**
   - `economics.basis` is not parsed (`lib/playbooks.ts:43-54,497-503`).
   - `sources` and `caveat` are parsed but no chores view renders them.
   - So $2,500, $9,600, "90 min by hand" and the rest sit bare on the catalogue (`catalogue.tsx:104-134`) and on the topic page (`topic.tsx:188-192,246`).
   - Every Carmen C3 and every Walt C3 failed, 18/18.
2. **employment-02 (blocker): time saved leaves out review time.**
   - The ratio is `manual / bench wall` (`lib/playbooks.ts:591-595`).
   - The review line is built (`model.ts:154`) but not rendered.
   - The shown 32× to 85× compares to 8× to 46× with the bench's review time and about 3× to 4× by the Characters' own figures.
   - Carmen C4 failed 9/9.
3. **employment-03 (blocker): Athena labels law-settled rules "(my guess)" and cites nothing, though each playbook carries the citations.**
   - The rule exists: `prompts.py:69` says research fills public rules.
   - But the brief never shows a source, and Carmen C2 failed 8/8 judged (one null).
   - Examples: 401k "seven-business-day safe harbor (my guess)"; wotc "SNAP 18 to 39 (my guess)"; cobra (walt) "44 days (my guess)".
4. **employment-04 (major): rehearsal and bench "found" figures are often exposure units, not money.**
   - adverse $8,000 is FCRA damages at $1,000 per consumer.
   - osha $165,500 and $115,850 are OSHA maximum penalties.
   - cobra $770 is $110 per day.
   - remote $995 is a vendor's price.
   - ui $9,880 is the maximum potential charge.
   - These are shown as "found in the rehearsal" (`showcase.tsx:115-117`), "Filed on the bench" (`flow.tsx:121`) and "$Z found on the bench" (`model.ts:105`).
   - That is $135,495 of the category's $206,510 bench total (66%).
5. **employment-05 (major): the first card offers the playbook's invented apps as if they were the person's.**
   - Sources: `opening()` at `prompts.py:375-384` and the portal slot rule at `prompts.py:99`.
   - 20 of 22 pairs had to correct app names.
   - Characters met Postwren, Crewmarrow, Binderwell, Talentry, Carriercore, Coverfind, and so on.
6. **employment-06 (major): the topic page is the persona's case, labelled only by the jargon word "persona".**
   - Sources: `topic.tsx:191` ("for the persona"), the hero brief at `:160-161`, and the "Worth ... for <persona>" line at `:246`.
   - The only "invented" label is the gallery line at `:220`.
   - Every Walt C1 failed (9/9); Lan, Aisha and Samira said "about someone else".
7. **employment-07 (major): nothing says what using the chore costs before you use it.**
   - Lan asked three times; Walt asked on remote-payroll.
   - Run cost appears only after a real run, in `runs.tsx:90`, and in jargon ("ledger row").
8. **employment-08 (major): briefs carry no deadline list or what-happens-if-missed, even where the playbook has the dates.**
   - Affected: Lan C6, Samira C4, Walt (cobra, wc, wotc) and Carmen (ui-claims).
   - The brief schema (`prompts.py:131`) has setup, claim and left-alone, but no deadlines section.
9. **employment-09 (major): example-world figures leak into a real person's brief as facts.**
   - Lan's brief says "COBRA, at 1,020.00 dollars a month". Her case says $1,340 and she never stated a price (dump `layoff-sixty-days--lan#brief`).
   - Walt's OSHA brief names "A vendor's $395 offer". His case says "a few hundred dollars" (dump `osha-300-log--walt#brief`).
10. **employment-10 (major): rehearsal cards show the key, the action and the outcome only** (`turn.tsx:70-75`).
    - There is no due date, send date or employee event.
    - Carmen C5 was null in 9/9.
11. **employment-11 (major): studio jargon.**
    - The studio shows 10 list words: "Show every slot", "Waiting for the session", "draft 2", "The brief", "N cards proposed", "Turn x of y", "Rehearsal", "world shaped like yours", "What I'll claim", "Fell for a trap".
    - Sources: `casepanel.tsx:49,163,271`, `conversation.tsx:151`, `showcase.tsx:40,97,104-110`, `turn.tsx:68`, plus the model words.
12. **employment-12 (major): a failed bench is hidden.**
    - osha-300-log's verdict is `short` (found 7 of 10; missed the certification and both submissions).
    - No chores view renders a verdict or the n=1 run count.
    - The page reads like the passing chores: "$3,000 a year" and "Filed on the bench $115,850".
13. **employment-13 (minor): interviews asked what Athena could look up, or failed to ask what the rule hinges on.**
    - Asked what she could look up: carmen/cobra was asked to confirm the 44/14/60-day law; carmen and walt/freelancer were asked "NYC or elsewhere" though New York's freelancer law is statewide.
    - Failed to ask: Walt's OSHA headcount; Walt's COBRA administrator and the 20-employee test; Carmen's 6 November audit deadline; Aisha's employer parental benefit.
13a. **employment-14 (minor): Lan was asked for her state twice** (turn 2 q2 and turn 3 q1), after she had answered "don't know, read my papers".
14. **employment-15 (minor): "a world shaped like yours" is said even when only names changed.** found_reason is null on 13 of 22. For example, 401k-walt still ran on the 38-person world's $87.93 (`showcase.tsx:40,97`).
15. **employment-16 (minor): per-episode values sort raw against yearly ones** on "Most value" (layoff $3,000 and parental $8,000; `modules/playbooks/model.ts:347-352`), and `times_per_year` is ignored.

### Chore-specific (top items; the full list is in the JSON)

- **employment-17 (blocker), wotc-screening: the credit may not exist for these hires.** The playbook's own caveat says WOTC lapsed for hires starting after 31 December 2025, and Congress had not extended it as of October 2026. Yet the page shows "$9,600 a year", and both briefs promise credits for autumn-2026 hires. The caveat is not rendered.
- **employment-18 (major), freelancer-receivables: the law is applied to the wrong kind of business.**
  - New York's Freelance Isn't Free Act covers a freelancer: an individual, or an organisation of one with no employees.
  - Walt's 24-person LLC is outside it, and the brief left the answer "unsettled".
  - The title "freelance invoices" fits neither Character as an employer.
- **employment-19 (major), layoff-sixty-days (lan): New York's rule applied with the state unknown.**
  - New York's 30-day severance rule (Labor Law 591(6)) is applied as "Sign Option B" although her state is unknown.
  - "Payments start this week" ignores the waiting week.
  - The real deadline is missing: choose a plan by 31 October for a 1 November start.
  - Medicaid and CHIP are never raised for a $31,000 household of three (offline knowledge).
- **employment-20 (major, uncertain), parental-leave-claims: up to 8 weeks of paid leave left unclaimed.** The truth caps New York PFL at 4 weeks after disability. New York PFL allows up to 12 weeks in 52, with its own job protection, and combined disability plus PFL may run to 26 weeks (offline knowledge). That would leave about 8 × $1,098.80 = $8,790 unclaimed.
- **employment-21 (major), parental-leave-claims (aisha): the employer's parental benefit is at risk.** Her hospital's 4-week parental benefit through Lincoln is framed as state PFL, filed "only if your state's program exists". Arizona has none.
- **employment-22 (major), osha-300-log (walt): the brief overstates what he must file.** It claims "Submit your 300A, 300 and 301 data". At 24 employees, only the 300A goes (1904.41(a)(1)). The card told the owner "not you or HR" can certify, but an owner may (1904.32(b)(3)).
- **employment-23 (major), remote-payroll-registration: accounts a payroll pro would also open are missing.**
  - The missing registrations: CO FAMLI, MN Paid Leave (2026), WA PFML and WA Cares, Paid Leave Oregon, Oregon statewide transit tax, Nevada MBT (offline knowledge).
  - The $1,990 a year assumes five new states a year. Each pair here opens one.
- **employment-24 (major), 401k-late-deposits: the value and the follow-through are both off.**
  - $2,500 a year against $87.93 of lost earnings on the bench (28×).
  - The steps stop at paying. They skip the VFCP self-correction notice, the Form 5330 decision (or the PTE 2002-51 relief) and the Form 5500 line 4a disclosure.

## Chore fixes (edits to the playbooks)

- **401k-late-deposits.**
  - Make `value_usd` the participant lost earnings plus avoided excise tax for a 30-person plan (about $100 to $400 a year), or relabel it as compliance, not money.
  - Add a step and a gate: file the VFCP self-correction notice and record on Form 5500 Schedule H/I line 4a.
  - Add a trap: Form 5330 filed when self-correction relief applies.
  - Reword "late after the 7th business day" to "outside the 7-business-day safe harbor; may still be late if it could have been sooner (2510.3-102(a)(1))".
- **adverse-action-notices.**
  - Stop weighting items at $1,000 of FCRA damages in anything labelled "found". Weight by minutes, or label it "exposure, not money".
  - Add a step: ask which states and cities the candidates are in, and flag fair-chance laws (CA Fair Chance Act, NYC) as out of scope with a lawyer handoff.
  - Explain "pre-adverse" in one plain line.
- **cobra-notices.**
  - Add a slot: who administers COBRA (you, the carrier, a TPA). This decides 44 days versus 30 + 14.
  - Add a slot: employee count on a typical day last year, for the under-20 exception and state continuation.
  - Add a plain answer: a resignation is a qualifying event and gets a notice.
  - Show "$110 a day (ERISA 502(c)(1)) plus $100 a day excise (IRC 4980B)" with its citation instead of "(my guess)".
- **freelancer-receivables.**
  - Split the audience: "freelancer" (FIFA, statewide since 28 August 2024; drop the NYC/elsewhere question) and "small business" (contract, NY prompt-payment for construction, public-entity prompt pay).
  - Replace the 2014 Freelancers Union average with a figure for the chore's own case.
  - Fix the mojibake in `basis` ("2014â€“2015").
  - Add `times_per_year`.
- **layoff-sixty-days.**
  - Make the 30-day severance rule conditional on a New York slot, and add "your state's rule" research.
  - Remove "payments start this week" and state the waiting week.
  - Add the "choose by the last day of coverage" deadline.
  - Add Medicaid and CHIP screening for income under 138% to 200% of the poverty line.
  - Never copy premiums from the world into a brief.
- **osha-300-log.**
  - Fix the bench miss (certification and submissions), or show "fell short on its bar" on the page.
  - Make the submission set depend on a headcount and NAICS slot: 20 to 249 in Appendix A means 300A only; 100+ in Appendix B adds 300 and 301.
  - Allow "owner" as certifier (1904.32(b)(3)).
  - Re-weight the $16,550 penalty units as exposure.
- **parental-leave-claims.**
  - Re-check New York PFL length (up to 12 weeks after DB, combined 26) against the Board's page, and update truth and value if confirmed.
  - Add a slot: "does your employer pay its own parental or bonding benefit?", separate from state PFL.
  - Add a deadlines block: 30-day FMLA notice, DB-450 within 30 days, PFL claim within 30 days.
  - Add a name-change check on claim forms.
- **remote-payroll-registration.**
  - Add paid-leave and local-tax registrations to the steps, or state plainly on the page that they are out of scope (the caveat says so, but nothing shows it).
  - Make value scale with the number of new states found.
  - Note that state registration itself is free. Walt asked.
- **ui-claim-responses.** The chore is sound.
  - Have the brief list each notice with its due date and the rule (TX 14 calendar days from mailing; CA 10 days from notice date; WA due date on letter).
  - Label $9,880 as the "maximum potential charge".
- **workers-comp-premium-audit.**
  - Add a slot for the policy's state, and name the manual applied (New York CIRB) on the page.
  - Answer the missed-window question from the basis: the manual sets no appeal deadline (Rule I(J)), so a late dispute may still go to the Rating Board.
- **wotc-screening.**
  - Show the lapse on the page and in the brief: "for hires after 31 Dec 2025, filing protects a credit only if Congress extends it".
  - Set value to $0 confirmed, plus a contingent figure.
  - Cite IRC 51 and the 8850 instructions next to the 28-day, SNAP 18 to 39, relative and rehire rules instead of "(my guess)".
  - Say that the "up to $2,400" needs 400+ hours (25% at 120 to 399 hours).

## What passed (protect these)

- **Gate discipline.** All 22 approved briefs state the ask-first rule. The topic flow draws each gate as "Athena asks you first" (`flow.tsx:106-111`). The studio repeats "nothing is sent" at approve and at "Start for real" (`casepanel.tsx:280,292`; `showcase.tsx:138-140`).
- **Short interviews.** All 22 ended `clear` in 1 to 3 rounds. Walt's "under 15 minutes" passed 7 of 9 judged.
- **Rehearsal honesty when the world is reshaped.** The studio claims no dollars, says why, and compares cards against the recorded run (`showcase.tsx:102-111`). The tailored run is labelled "on invented data ... nothing was sent" (`:40`).
- **Visible assumptions.** "(my guess)" in briefs and the "Still her guess: ..." note (`casepanel.tsx:276`) earned Carmen C6 passes on 6 of 9 judged.
- **Left-alone lists that a pro would agree with:**
  - Tobias's skills test
  - Hank Dwyer's earlier notice
  - Utah's existing accounts
  - the Denver contractor
  - the withdrawn Cheyenne offer
  - Lou the uninsured painter
  - Gail and Phil kept in site classes
- **Field-sound chores:** ui-claim-responses, and workers-comp for a New York policy. Their rules and traps match the cited law.
