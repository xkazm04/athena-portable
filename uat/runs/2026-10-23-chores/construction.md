# Chores UAT - L1 area walk: construction

- **Category:** construction (audience: work)
- **Chores (7):** certified-payroll, change-order-notices, closeout-package, inspection-scheduling, lien-desk, stormwater-permit-log, sub-insurance-certs
- **Characters (2):** Gina Russo (office manager, plumbing/mechanical sub, CA and TX), Ray Okafor (PM, GC with an electrical arm)
- **Pairs:** 14 of 14 complete, 0 failed. All 14 onboardings ended `clear` and were approved. All 14 rehearsals `done`.
- **Cost of the LC pairs:** $31.61 total (sum of `cost_usd`, range $1.54-$2.83 a pair). That includes $24.07 of rehearsal model spend.
- **Method:** I walked J7 and J8 in character over the code: catalogue.tsx, topic.tsx, flow.tsx, studio/casepanel, showcase.tsx, turn.tsx, lib/playbooks.ts, modules/playbooks/model.ts, adopt/loop.py, prompts.py, showcase.py. I checked the 14 LC dumps, the 14 case cards and the numbers audit against that code. Judge findings were treated as leads; four were refuted (see F-27..F-30).
- **Severity rule (derived, not picked):** count the `high`s in impact (frequency, reachability, trust_erosion). 3 = blocker, 2 = major, 1 = minor, 0 = polish.

## Scorecard

Two counting conventions:
- **Honest numbers** are counted with the rubric units over every NUMBER one Character's J7+J8 journey meets for that chore, summed over both Characters. Each journey has 14 NUMBERS: 3 on the catalogue row, 9 on the topic page and 2 in the showcase. Derivation is under "Honesty audit".
- **Jargon** is distinct internal words met across the four screens, for one journey.

| Chore | Honest numbers (h/n) | Jargon met | Onboarding ended (G / R) | Rehearsal (G / R) | Adopt (G / R) | Judge pass (G+R, decided) | Field reliability |
|---|---|---|---|---|---|---|---|
| certified-payroll | 12/28 | 23 | clear 2 rounds / clear 2 rounds | $81,056 (7 of 10 cards) / $81,417.95 (10 of 10) | maybe / maybe | 4/9 (3 null) | issues |
| change-order-notices | 11/28 | 22 | clear 2 / clear 2 | $31,023.50 (5 of 5) / shaped, 0 of 5 cards | maybe / maybe | 4/8 (4 null) | issues |
| closeout-package | 12/28 | 23 | clear 2 / clear 2 | $48,600 (10 of 10) / $48,600 (10 of 10) | maybe / maybe | 4/9 (3 null) | issues (minor) |
| inspection-scheduling | 11/28 | 23 | clear 1 / clear 1 | $2,400 (6 of 6) / shaped, 5 of 6 | maybe / maybe | 5/8 (4 null) | issues (minor) |
| lien-desk | 10/28 | 23 | clear 1 / clear 1 | shaped, 10 of 10 / shaped, 9 of 10 | **no** / maybe | 3/8 (4 null) | issues |
| stormwater-permit-log | 12/28 | 23 | clear 1 / clear 1 | $1,500 (6 of 6) / $1,500 (6 of 6) | maybe / maybe | 4/8 (4 null) | issues (wrong outside EPA states) |
| sub-insurance-certs | 11/28 | 23 | clear 2 / clear 2 | $7,200 (9 of 9) / shaped, 9 of 9 | maybe / maybe | 4/9 (3 null) | issues |
| **Category** | **79/196 = 40%** | 22-23 | 14/14 clear | 14/14 done; 9 showed $, 5 shaped | **0 yes / 13 maybe / 1 no** | **28/59 = 47.5%** decided (28/84 = 33% counting null) | 0 sound |

Judge pass by criterion. This shows where the category fails.
- **Gina:** c1 "I can say what it does" 6/7. **c2 "every deadline names job, GC, date and rule" 0/7.** **c3 "every figure sourced" 0/7.** c4 "I see the document" 0 pass / 7 null. c5 "she doesn't ask what's in my papers" 2/7. c6 "left-alone items say why" 0 pass / 7 null.
- **Ray:** c1 7/7. **c2 "clause or city rule named" 0/7.** c3 "figures sourced" 0 pass / 4 fail / 3 null. c4 "at most 15 minutes and 8 messages" 7/7. c5 "notices name change, date, clause and deadline" 0 pass / 7 null. c6 "nothing sent without my approval" 6/7.

## Honesty audit

### The NUMBERS a construction journey meets (same set for all 7 chores)

| # | Screen | NUMBER | Source said next to it? | Agrees elsewhere? | Honest? |
|---|---|---|---|---|---|
| 1 | Catalogue row | hand time "5h" (`facts.ts:21-27`) | no | yes | **no** |
| 2 | Catalogue row | Athena time "3m" (bench wall-clock) | no; arrow aria-label only | yes | **no** |
| 3 | Catalogue row | Value "$40,000 a year" (`catalogue.tsx:121-134`) | no | yes | **no** |
| 4 | Topic KPI | Value, "a year, for the persona" (`topic.tsx:187-192`) | the persona only, not "an estimate", no basis | yes | **no** |
| 5 | Topic KPI | Time saved, manual (`topic.tsx:196`) | no (`band.manual.line`, the incumbent, is computed at `model.ts:162` and never rendered) | yes | **no** |
| 6 | Topic KPI | Time saved, Athena (`topic.tsx:200`) | no (`band.athena.line` with "your review N min" is computed at `model.ts:154` and never rendered) | yes | **no** |
| 7 | Topic KPI | ratio "96× faster" (`topic.tsx:202`, `modules/playbooks/model.ts:216`) | no; it leaves out the review time | disagrees with the review-inclusive figure | **no** |
| 8 | Topic KPI | Traps avoided "9/9", "on the bench" (`topic.tsx:204-207`) | yes (bench) | yes, with #9 | yes |
| 9 | Flow | "walked past 9 of 9 traps the world held" (`flow.tsx:117-118`) | yes | yes | yes |
| 10 | Flow | result "$81,418", "Filed on the bench" (`flow.tsx:120-123`) | yes | different quantity from #3/#4, with no word on why | yes by unit, confusing |
| 11 | Flow | "10 of 10 claims right, none false" | yes | yes | yes |
| 12 | Topic "Make it yours" | "Worth $40,000 a year for the payroll and compliance administrator of..." (`topic.tsx:246`) | the persona only | yes | **no** |
| 13 | Showcase | "$X found in the rehearsal, on invented data" (`showcase.tsx:113-119`), or "N cards proposed... no dollar figure is claimed" (`:102-112`) | yes | yes | yes |
| 14 | Showcase turns | per-card $ (`turn.tsx:74`) | yes on a renames-only run. On a shaped run they are scored against a key the page says no longer holds (F-05) | shaped run: **no** | renames-only yes / shaped **no** |

So a journey scores 6/14 when its rehearsal kept the answer key, and 5/14 when it was shaped. Sum: 9 renames-only journeys × 6 + 5 shaped journeys × 5 = 79/196 (40%).

Branches checked for `valueCell` (`model.ts:84-87`) and the "Worth" line (`topic.tsx:246`): all 7 construction playbooks have `per: "year"`. The year branch is clean (catalogue, KPI and Worth agree). The month and week branches, where Worth would show the unannualised amount, are **not reachable in this category**.

Scout hypotheses: I confirmed these.
- `economics.basis` is never parsed (`lib/playbooks.ts:495-502` reads value_usd, per, manual_minutes, incumbent, incumbent_fee_pct and sources only).
- `sources` is parsed but rendered by no chores view (grep of `scenes/chores`, `modules/playbooks`).
- `caveat` is parsed (`lib/playbooks.ts:522`) and rendered nowhere.
- The verdict sentence and `runs`/`sample` (`modules/playbooks/model.ts:112-152`) are rendered nowhere in `scenes/chores`. So the judges' "Exceeds on n=1" is something they read from numbers.json, not from the screen (F-27).

### What the money figures actually are (from each playbook's own `economics.basis`)

| Chore | Shown | What the basis says it is | Recovered money? | Time-value check (my arithmetic) |
|---|---|---|---|---|
| certified-payroll | $40,000 a year | "payments released rather than money recovered": one held $40k estimate a year | no, it is the company's own receivable released early | $40,000 × 8% × 60/365 ≈ **$526** of financing cost avoided |
| closeout-package | $30,000 a year | "payments released rather than money recovered": a fifth of a year's retainage released sooner | no, timing | $30,000 × 8% × 90/365 ≈ **$592** |
| lien-desk | $380,000 a year | "Protection, not recovery: what a missed day would put at risk". `basis_says_estimate` false | no, exposure | not a yearly flow at all. The bench world holds $416,700 in one weekly run |
| sub-insurance-certs | $25,000 a year | expected loss: one uncovered $200k claim every 8 years | no, protection (an expected-value form, defensible if labelled) | 200,000 / 8 = 25,000 ✓ |
| inspection-scheduling | $8,000 a year | "mostly minutes": 75 h × $50 plus a few failed inspections | no, and the same hours are shown again as Time saved | 75 × 50 = $3,750, so about $4,250 is failed inspections, unsourced |
| stormwater-permit-log | $5,000 a year | 50 h × $100 consultant rate | no, the same hours again | 50 × 100 = $5,000 ✓, double-counted with Time saved |
| change-order-notices | $60,000 a year | one in ten of $600k of changes lost to a missed or late notice | **yes**, recovered | 600,000 × 10% = 60,000 ✓ |

Only 1 of 7 "Value" figures is money the person would get back. The page labels all seven the same way ("Value ... a year").

### Time saved, once review is counted

| Chore | Shown ratio | With bench review time (`your_time_s`) | Characters' own expectation |
|---|---|---|---|
| lien-desk | 442× (25 h → 3 min) | 179× | Gina 160 → 40 min (4×) for her whole paperwork load |
| certified-payroll | 96× | 37× | Ray 120 → 30 min (4×) |
| change-order-notices | 79× | 43× | |
| closeout-package | 72× | 24× | |
| stormwater-permit-log | 52× | 23× | |
| sub-insurance-certs | 48× | 20× | |
| inspection-scheduling | 36× | 16× | judges' own estimates where given: 30, 45 and 90 min saved |

Two more points on lien-desk. Its `manual_minutes` is 1,500 while its own `expectation.minutes` is 35 and its `expectation.why` says "a seasoned office manager gets most of it right in a day". The playbook contradicts itself by a factor of 43.

## Per-Character reviews

### Gina Russo - office manager, plumbing and mechanical sub (7 chores)

> Which job, which GC, what date. That's my whole test, and none of the seven passed it. Not one brief put a date next to a job with the rule behind it. Not on the lien desk, where a missed preliminary notice once cost us lien rights on sixty thousand dollars. Not on closeout, where my whiteboard has a red date. Not on the subs' insurance, where I gave her six mobilization dates.
>
> What I liked: she asks before anything goes out, every time, and she says so in plain words. On certified payroll she wrote my case back better than I said it. Six weeks, the 8/30 no-work week, the 9/6 week that is NOT no-work, Dev at 60%, the $4.55 cash fringe. On closeout she knew to skip what Harlan already accepted, and she left an expired certificate alone. That is someone who has done this before.
>
> What made me close the window: the lien desk asked me three questions about software, asked about Textura twice, and then approved a brief that still says Mission Bay's state is "not yet known". The state decides every rule on that job. Then it says it moves weekend deadlines "to the business day before" for both my states. Texas doesn't work that way, and I've told every tool I've tried that I hate being treated as one state.
>
> The numbers: $380,000 a year and 442 times faster on the lien desk. $40,000 a year on payroll that is my own money the county is sitting on, not money anyone gives me. I check every notice, so three minutes is a fantasy. The practice run said "found $48,600 on invented data" on closeout. $48,600 is exactly my retainage on Westbrook, so which is it?
>
> Missing for my job: the document itself. I want to see the waiver, the notice, the payroll, not "10 cards". I want "conditional" written on the final waiver line, since that's the difference that matters. Would I tell a peer? I'd say try it on one job and read everything. I'm keeping the whiteboard.

Evidence: dumps lien-desk--gina (adopt no, 0/4 decided), closeout-package--gina card 1 and rehearsal, certified-payroll--gina brief. Case cards: closeout `$48,600`, lien-desk Bayshore NOC 9 Oct.

### Ray Okafor - PM, GC with an electrical arm (7 chores)

> Setup is the best part. Every chore took me one or two cards, three to five answers, done inside my hour. She listened when I corrected her. On change orders I said 7 days and 12%, not 21 and 15%, and the brief carried it. On sub insurance she kept Delgado and Pike off the notice list and held Summit Roofing because the renewal isn't bound. That's the right call.
>
> But that same change-order card offered "21 days, 15%, 5%" as an answer about my contract. Those are somebody else's numbers. If I'd been tired and clicked it, she'd have run my notices on the wrong clock, and a late notice already cost us forty grand once. Then the brief wrote my own 7 days down as "(my guess)". I said it. She was supposed to check it against Article 12. Those are two different things and the screen calls them the same.
>
> Not one brief named a clause. "Per CGP (my guess)" on the stormwater log, nothing on inspections, "Exhibit D" with no section. A GC's contract admin reads every notice looking for a way to deny it. Telling me she'll read the clause later is not the same as citing it.
>
> The practice runs: on change orders she drafted zero notices and told me there's no dollar figure. Fair, but I can't tell whether zero was right. ASI 11 sits right on day 7. Where she did draft, all I saw were codes and "Right claim". No notice text, so I couldn't check the tone.
>
> The page's dollar and speed figures have no source I can find, so I won't take them to my owner. Would I adopt? Maybe, one job at a time, reading every document. I'd tell a peer it sets up fast and asks before it sends. I wouldn't tell them it knows their contract.

Evidence: change-order-notices--ray (card 1 r2q1 options, brief `(my guess)` lines, rehearsal 0 of 5 shaped), sub-insurance-certs--ray brief, criteria c4 7/7 and c6 6/7.

## Findings, ranked (frequency × reachability × trust erosion)

F-NN here is `construction-NN` in `findings-construction.json`. That file has 33 rows: 4 blocker, 18 major, 3 minor, 1 polish, 4 refuted leads (rated polish) and 3 strengths.

### Category-wide

1. **F-01 (blocker) No figure says where it comes from.** The catalogue Value, the topic Value ("for the persona") and "Worth $X a year" show the author's estimate with no basis and no "estimate" label. `basis` is never parsed (`lib/playbooks.ts:495-502`). `sources` is parsed and never rendered. Judges: Gina c3 0/7, Ray c3 0 pass.
2. **F-02 (blocker) Six of seven "Value" figures are not value.** They are released receivables, exposure, expected loss, or minutes priced a second time (see the table above). Only change-order-notices is recovered money.
3. **F-06 (blocker) The practice run never shows the document.** Cards carry only `action`, `key`, `outcome` and `valueUsd` (`lib/playbooks.ts:147`, `turn.tsx:65-77`). Athena's words are cut (`turn.tsx:49-51`). This is the core criterion for both Characters: Gina c4 null 7/7, Ray c5 null 7/7.
4. **F-08 (blocker) Briefs never name the rule, clause or date behind a deadline.** The brief schema has only lead, setup, claim and left_alone, with bullets of at most 15 words (`prompts.py:126-135`, `loop.py:495-497`). No field exists for "rule: §" or "date". Gina c2 0/7, Ray c2 0/7. The playbooks carry cited `sources` that never reach the brief.
5. **F-03 (major) Time saved leaves out the review.** It shows 36-442× against 16-179× with review, and the Characters expect 4×. The review line is computed (`model.ts:154`) and dropped (`topic.tsx:193-202`).
6. **F-12 (major) "Start for real" hands over the playbook's command, which still names the invented world.** For example "The City of Halvern ... Larkin Street" or "Primeline is holding our $48,600 retainage on Harbor Point". "My case" lines are added after it (`loop.py:453-469`, `studio.tsx:252`). A real run is then told about a fictional GC and job.
7. **F-26 (major) The caveat is rendered nowhere** (`lib/playbooks.ts:522`). Every construction caveat says the rules are summaries and "not legal advice". Lien, payroll and permit filings are where that sentence matters most.
8. **F-04 (major) The rehearsal's "found $X" is labelled "on invented data"** (`showcase.tsx:117`), which refutes the judges. But "found" is applied to released receivables (certified-payroll $81k) and to per-act weights (stormwater $1,500 = 6 × $250; sub-insurance $7,200 = 9 × $800; inspection $2,400 = 6 × $400). On closeout it equals Gina's real retainage, $48,600.
9. **F-05 (major) A shaped rehearsal still grades every card against a stale key.** The truth is only renamed (`showcase.py:271-275`). The per-card outcome word and $ (`turn.tsx:71-74`) still show, under a line saying "no dollar figure is claimed". This hit 5/14 runs.
10. **F-09 (major) "(my guess)" covers two different things.** It marks Athena's default and also the person's own stated value that she has yet to verify (`loop.py:367-372`, `:467-485`). It appears in 11/14 briefs. Ray's own "7 days" was marked as her guess.
11. **F-10 (major) Answer options name the bench world's invented apps** (Clockyard, Primeline GC, Sitegrid, Mailnest, Rainlog...) in 13/14 pairs. They come from the slots' `source: "default"` values. Characters had to choose "something else" and retype every time.
12. **F-11 (major) Answer options pre-fill the invented contract's terms as answers about the real contract.** "21 days, 15%, 5%" in change-order Ray r2q1, "15% own, 5% on subs" in change-order Gina r2q1.
13. **F-07 (major) The run doesn't say why an item was left alone.** The trace keeps no record of items left alone (`lib/playbooks.ts:137-148`). Gina c6 null 7/7.
14. **F-13 (major) Jargon: 22-23 internal words a journey.**
    - Catalogue: "benched", "exceed the bar", "found on the bench", "Best edge" (`model.ts:100-109`, `catalogue.tsx:38`).
    - Topic: "for the persona", "Traps avoided", "on the bench", "the world held", "claims right", "Watch the run turn by turn".
    - Studio: "The brief", "draft 2", "rehearses it on a world shaped like yours", "What I'll claim".
    - Showcase: "Your rehearsal", "The benched run", "world", "turn", "cards", "Right claim", "Fell for a trap", "the brief's command".
15. **F-14 (major) The catalogue row says nothing about what the chore does.** It shows short title, job chip, two times and value. The description is only in a hover `title` (`catalogue.tsx:87`), which a tablet user (Ray) never sees.

### Chore-specific

16. **F-15 (major) lien-desk / Gina: onboarding failed the office manager.**
    - One card, all about software.
    - r1q3 asked about Textura after she had ticked it in r1q2.
    - The approved brief says Mission Bay's "state not yet known".
    - None of her case's jobs or deadlines appear, for example Alvarado (contracted with the owner) and the Bayshore NOC of 9 Oct.
    - The only `adopt: no` in the category.
17. **F-16 (major) lien-desk economics.**
    - $380k a year is exposure.
    - `basis_says_estimate` is false.
    - 1,500 manual minutes contradicts the playbook's own 35-minute expectation.
    - There is no `times_per_year`.
18. **F-17 (major) lien-desk briefs say "Move weekend deadlines to the business day before" for both states.**
    - The truth's own Texas items go forward: RR-DC "30th day is Sun 10-18, so by Mon 10-19", and "11-15 is a Sunday, due 11-16".
    - California CCP §12a extends to the next court day (offline knowledge). Filing early is prudent, but stating it as the rule is not what the law says.
    - Treating two states the same is Gina's named pet peeve.
19. **F-18 (major) certified-payroll weights back pay at 0.5% of the value** ($417.95 of $81,417.95). Gina's rehearsal missed 2 of 3 adjustment checks (E-21 $246, E-14 $115.95; 81,417.95 − 81,056 = 361.95) and still showed "$81,056 found", 99.6%. Certifying a payroll while workers are still shorted is a false Statement of Compliance. The figure cannot see the miss that matters most.
20. **F-19 (major) certified-payroll covers federal Davis-Bacon only.**
    - Gina's job is a county job in CA or TX, where a state prevailing-wage regime may govern (CA Labor Code §1776 and DIR eCPR; offline knowledge).
    - No apprentice-ratio check (over the ratio, the journeyman rate is owed).
    - No annualization of the fringe credit when crews also work private jobs, which is exactly Gina's Luis case.
21. **F-20 (major) change-order-notices defaults to A201's 21 days.**
    - A subcontract usually sets a shorter window so the GC can meet its own (Ray's case: 7 days).
    - Items past the window are left alone silently. A senior PM would still give notice with a reservation and flag it, because whether a late notice waives the claim "varies by state and by contract" (the playbook's own caveat).
22. **F-23 (major) stormwater-permit-log uses only the EPA 2022 CGP**, which applies only where EPA is the permitting authority. Both Characters work in CA and TX (offline knowledge):
    - TX TXR150000 triggers on 0.5 in.
    - CA CGP uses 0.5 in qualifying precipitation events.
    - Both briefs marked 0.25 in, 24 h and 7 days as "(my guess)" with no source.
23. **F-21 (minor) closeout-package.**
    - The promise "so the GC releases the retainage" overpromises: release also waits on the owner's final payment and the punch list.
    - The page and brief say "final waivers" without "conditional", although the truth correctly uses a conditional final (DS-11).
24. **F-22 (polish by the severity rule: all three impacts med) inspection-scheduling cites IBC §110 only.** Townhomes usually fall under IRC R109, and plumbing and mechanical inspections under IPC and IMC §107 (offline knowledge). Value double-counts minutes.
25. **F-24 (minor) sub-insurance-certs checks only GL additional-insured endorsements and limits.** It leaves out primary and non-contributory, waiver of subrogation, WC, auto, umbrella follow-form, and the edition date. CG 20 10 07 04 has no completed-ops coverage, and the caveat itself names editions.
26. **F-25 (minor, uncertain) change-order Ray's shaped rehearsal filed 0 of 5 cards.** ASI 11 (16 Oct) sits on day 7 of a 7-day window on 23 Oct. The page cannot say whether 0 was right.

### Judge leads refuted

- **F-27:** "Exceeds (n=1)" is not on screen.
- **F-28:** the rehearsal *is* labelled invented data.
- **F-29:** lien-desk Ray *was* asked where his contracts are (r1q1). Change-order notices are a different chore.
- **F-30:** the certified-payroll hedge on Luis is correct; his case says the determination calls compactor work laborer's work.

## Chore fixes (edits to the playbooks)

- **certified-payroll**
  - Economics: show "payments released: about $40,000 a year released sooner" as a separate *cash-flow* line, not as Value, or set value_usd to the avoided financing cost plus the avoided penalty (about $500-$1,000) with that basis.
  - Raise the restitution weight so a missed adjustment check moves the figure, or score restitution as pass/fail ahead of any $ (F-18).
  - Add traps:
    - apprentice over the journeyman ratio, owed the journeyman rate;
    - health-plan fringe credit annualized across private hours.
  - Add a rule line: "federal DBRA; a state prevailing-wage job follows the state's submission rules."
- **change-order-notices**
  - Rule: "the notice window is the subcontract's, not A201's; read it, cite the clause, and default to the shorter."
  - Change the trap "past their 21 days, left alone" to "past the window: draft a late notice with reservation and flag it, never send unasked".
  - Add the notice address and method (the contract's notice article) to the notice's required fields.
  - Remove the invented markups from the answer options.
- **closeout-package**
  - Wording: "Conditional final lien waivers (unconditional only after the retainage is in the bank)".
  - Promise: "removes the paperwork reason the GC holds retainage".
  - Value as cash-flow, not $30k a year.
  - Add a trap: the punch list is open, so the package is ready but release is not.
- **inspection-scheduling**
  - Rules: cite IRC R109 for one- and two-family dwellings and townhouses, and IPC and IMC §107 for trade inspections.
  - Add the request cutoff time (for example "by 3 pm the business day before").
  - Value: drop the $3,750 of hours already shown as Time saved, and keep only failed-inspection fees and held-crew days, sourced.
- **lien-desk**
  - value_usd: say "protects about $X of receivables". Exposure, not "a year".
  - Set `basis_says_estimate` consistently.
  - Reconcile manual_minutes (1,500) with the expectation (35).
  - Weekend rule per state, with cites: CA CCP §12a forward, with "record earlier to be safe" as advice; TX Prop. Code §53.003 forward.
  - Add a guard: "a job whose state is unknown gets no deadline until the state is confirmed".
- **stormwater-permit-log**
  - Rule set chosen by permit: EPA CGP, CA CGP or TX TXR150000.
  - Ask "which permit covers this site?" up front.
  - Value: minutes only once.
- **sub-insurance-certs**
  - Add traps:
    - CG 20 10 07 04 edition with no completed ops;
    - missing primary and non-contributory wording;
    - missing waiver of subrogation (CG 24 04);
    - WC or auto under limits;
    - umbrella not follow-form.
  - State the $800-per-act weight on the page or stop showing it as "found".

## What passed (protect these)

- **Approval before every act is stated plainly in every brief.** Ray c6 6/7. "She asks you first, every time" gates come from the playbook's gates (`flow.tsx:105-112`, brief setup lines).
- **Setup speed.** 1-2 cards, 3-6 answers, Ray c4 7/7. All 14 ended `clear` with no round cap.
- **Briefs that carry the person's own specifics accurately.** Certified-payroll Gina (weeks, apprentice, fringe arithmetic), sub-insurance Ray (Delgado, Pike, Summit unbound), closeout Ray (A201 §9.10). Gina c1 6/7, Ray c1 7/7.
- **Shaped honesty.** When the case changed rows, the showcase claims no dollar figure (`showcase.tsx:102-112`, `showcase.py:575-584`). Ray's judges credited it in lien-desk and change-order.
- **Strong playbook rules.** lien-desk (Civ. Code §8204's 20 days, the 30-day NOC window, the 8136/8138 forms, Exceptions, Texas §53.284 forms). Closeout uses a conditional final waiver. Change-order's world handles 14-day concealed conditions under §3.7.4. Sub-insurance checks the policy, not the certificate.
