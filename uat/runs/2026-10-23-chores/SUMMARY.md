# Chores UAT - run 2026-10-23-chores - SUMMARY

Spark `chores-uat`, ADR 0132. All 100 chores, each onboarded by two Characters of its own audience (22 Characters,
`uat/chores/pairs.json`): the real adopt conversation played by Sonnet 5.5, approval as the desktop does it, the real
rehearsal on a world shaped like the Character's case, and a blind Sonnet judge in the Character's voice (LC). Then
ten area walkers judged the catalogue, topic page, studio and rehearsal over the code (L1) and checked every judge
lead against it. L2 (the live desktop) was not driven in this run.

- LC: 200/200 pairs complete, 0 failed, $375.00 ledgered over 4,472 model calls (`lc-report.md`).
- Every onboarding ended `clear` (median 2 question cards); every brief was approved; every rehearsal finished
  (120 showed a dollar figure, 80 withheld it because the shape changed rows).
- Adopt: **0 yes, 195 maybe, 5 no.** Judge criteria: 277 pass / 671 fail / 264 not evaluable. Number-honesty
  criteria: **17 pass / 240 fail**. Plain-words criteria: 134 pass / 146 fail.
- L1: 331 findings (`findings.json`, merged from `findings-<area>.json`): 254 confirmed, 40 uncertain, 37 refuted;
  29 blockers and 143 majors after the refuter pass; 36 strengths.

## Scorecard by area

| area | pairs | LC cost | honest numbers | judge pass (all criteria) | adopt y/m/n |
|---|---|---|---|---|---|
| health | 28 | $54.20 | 140/468 (30%) | 27% | 0/28/0 |
| benefits | 24 | $36.94 | 74/222 (33%) | 19% | 0/23/1 |
| freight | 24 | $50.36 | 59/213 (28%) | 17% | 0/23/1 |
| employment | 22 | $36.24 | 67/183 (37%) | 20% | 0/21/1 |
| consumer | 22 | $37.83 | 52/153 (34%) | 24% | 0/22/0 |
| commerce | 22 | $43.75 | 113/365 (31%) | 30% | 0/22/0 |
| housing | 18 | $31.42 | 96/294 (33%) | 28% | 0/18/0 |
| public | 16 | $33.11 | 38/112 (34%) | 12% | 0/15/1 |
| construction | 14 | $31.61 | 79/196 (40%) | 33% | 0/13/1 |
| family | 10 | $19.54 | 76/192 (40%) | 37% | 0/10/0 |
| **all** | **200** | **$375.00** | **794/2,398 (33%)** | **23%** | **0/195/5** |

"Honest" uses the rubric unit (source stated next to it AND agrees with every other rendering). The only figures
that pass are the bench counts and the rehearsal line labelled "on invented data".

## Cross-cutting themes, ranked (convergence across areas first, then impact)

1. **The money figure has no source and disagrees with itself (10/10 areas, blocker).** `economics.basis` is never
   parsed (`apps/desktop/src/lib/playbooks.ts` Economics/parsePlaybook); `sources` and `caveat` are parsed and rendered
   nowhere. One topic page shows two to four different dollar figures for the same job: the Value tile (authored,
   sometimes annualised), the hero brief (the bench world's answer-key total, worded as an achievement), "Worth $X"
   (unannualised), and the flow's "Filed on the bench". Examples: ltc-claims $20,000 / $26,410 / $5,252 / $15,425;
   estate-settlement $20,000 / $111,644 / $104,460; pslf $40,000 vs its own case $20,000. Authored values run far past
   the Character's case (cpg-deductions $60,000 vs $547-1,094 for a one-person shop; fsa-acreage $10,000 against a
   basis that says no programme dollar exists).
2. **"Value" and "found" count things that are not money (7/10 areas, blocker).** Scoring weights ($1 per screened
   order, $1,000 per credit claim), penalty maximums (isf $25,000 "found"), released receivables (certified-payroll,
   closeout), exposure (lien-desk $380,000 "a year"), annual sales protected (trademark $45,500), tax already paid
   (ifta). 39-66% of an area's "$ found on the bench" total is not money. The catalogue total and the home-screen
   light sum it.
3. **The brief cannot carry a rule or a deadline (9/10 areas, blocker).** Rules the playbook researched and cites are
   written as "(my guess)" (65 times in 28 health briefs; 23/24 freight briefs) because a slot is "confirmed" only when
   the person said it (`src/athena/adopt/loop.py` ~467-487, `slots.py`), and the interviewer is told never to ask about
   rules (`prompts.py` ~66-68). The brief format has no deadlines section (`prompts.py` ~117-136): Characters'
   deadline criteria failed 0/12, 0/8, 7/7 across areas; real dates (Nov 7 on a notice, an I-9 already late) never
   reach the brief.
4. **The example world leaks into the person's case (8/10 areas, major).** The first card offers the playbook's
   invented app names as answers (`slots.py` ~130-141; 18-20 of 22-24 pairs had to correct them, and to a wary user it
   reads as a scam); Athena's opening line tells the example's story (`prompts.py` ~373-386); approved briefs state
   invented facts as the person's ("your nineteen-year-old son", the example's COBRA price); "Start for real" hands
   Athena the playbook's own command, which names the invented city and street (`loop.py` `fitted_command` ~453-469).
5. **The rehearsal overclaims "shaped like your case" (6/10 areas, blocker in housing and public).** A dollar figure
   appears only when the shape edited no row, so the figure is always the invented household's total (Rosa: "$1,445
   found" on a deposit where $1,142.60 was kept). The rehearsal still plays the example persona's script ("I'm Marian
   Oyelaran" in 16/16 public pairs), grades cards against an answer key it says no longer fits ("Fell for a trap" on an
   eligible bid), and ignores the brief's scope (a "file nothing" brief filed 3 claims).
6. **Time saved leaves out the person's review (8/10 areas, blocker in employment and public).** `manual_minutes`
   against the bench wall clock: 20-442x shown; with the review time the code already computes (`beforeAfterOf().athena.line`,
   `scenes/chores/model.ts` ~152-158, never rendered) it is 8-126x; Characters expect 3-4x. `manual_minutes` itself is
   authored and sometimes contradicts the playbook's own expectation (lien-desk 1,500 min vs 35).
7. **Fit is never stated (5/10 areas, blocker in housing).** Single-state chores (Texas homestead, California deposit
   and depreciation, California records law) are offered and run for people in other states without a word; a
   one-person shop's "is this for a shop my size?" was asked 11/11 times and never answered; nothing says up front what
   will be asked (SSN, bank) or whether the chore costs money.
8. **The verdict is hidden (health, employment).** "Falls short" (ltc-claims 20%, clinic-denials 72%, osha-300-log)
   and "one run" are computed (`modules/playbooks/model.ts` ~112-152) and shown nowhere, while the totals line says
   "N of M benched exceed the bar".
9. **Chores wrong in their field (every area has some; one blocker).** wotc-screening promises a credit its own caveat
   says lapsed for these hires; estate-settlement's value rests on California fees for a $1M estate and one trap may
   contradict Rev. Rul. 2005-36 (offline knowledge); stormwater is wrong outside EPA-permit states; layoff-sixty-days
   copies a New York severance rule and ignores the waiting week; ifta counts tax already paid as value; isf assumes two
   full penalties a year. Per-chore edits are in each area report under "Chore fixes".
10. **Jargon is real but secondary.** Plain-words criteria passed about half the time; the words that hurt are the
    ones that carry a number or a promise: "on the bench", "exceed the bar", "(my guess)", "Traps avoided", "persona".

## Strengths worth protecting (do-not-touch guardrails)
- Approval-first is clear on every screen and in every brief: "Athena asks you first" before every gated action.
- Onboarding is short and always ends: median 2 cards, 200/200 cleared and approved.
- The rehearsal is labelled "on invented data", and a shaped rehearsal withholds its dollar figure (ADR 0125).
- Runs receipts say where every number comes from; the "left alone" lists keep what the person said they owe.
- The answer keys are mostly right: full recall and no false claims on most benches.
Any fix must keep these: an honest label added to a number must not turn into a disclaimer wall, and the
shaped-rehearsal withholding must survive.

## Honest ceilings (what this run cannot say)
- No L2: nothing here was seen rendered; findings on layout or reading order are L1 (code) only.
- The judge saw the chore's `promise` and the numbers row, not the rendered page, which produced the 37 refuted leads
  (it criticised a long sentence the page does not show and an "Exceeds (n=1)" label that is not rendered).
- The harness ran onboarding with the research lanes off, so "(my guess)" counts may be higher than production with
  research on; those findings are kept but marked uncertain where they depend on it.
- Case cards were written from each playbook's world, so they echo it; the harness under-measures world leakage.
- Field-law points the walkers could not check against a source are marked "offline knowledge" and `uncertain`.

## Panel verdict
Every Character got through the conversation and understood what Athena would do; not one would adopt the chore
yet. They trust her to ask before acting. They do not trust any number she shows them, and they are right not to:
two in three figures on a chore's page have no source, and many disagree with each other or are not money at all.
