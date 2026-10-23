# Recertify - run 2026-10-23-chores, after the fix wave

Commits under test: 25ad20b0 (playbook kinds, fit, derived example figure; ADR 0133), a8a9a33a (brief provenance,
dates, no example leak; ADR 0134), 2a2a99f6 (one money figure, kinds, review in time saved; ADR 0136), d892eb91
(practice-run honesty; ADR 0135), 66cd949d (the judge sees the page as drawn), 824f81e2 (time tile source).
Environment freshness: the Tauri dev app was restarted after the last of those commits (with a CDP port) before L2.

## What was re-run
- **LC:** 20 pairs, the two worst-rated chores per area with the same Characters and case cards
  (`recertify/lc-report.md`, run `2026-10-23-chores-recert`, $44.47, 20/20 complete). Research lanes stayed off, as
  in the original run. **The judge instrument changed** (it now sees the rendered page's text: the short brief, the
  five headline lines, the fit block, the disclosure), so the criteria deltas mix a product change and an instrument
  change. The brief counts below are read off the briefs and do not depend on the judge.
- **L2:** the live desktop over CDP: the catalogue and three topic pages (medical-bills, lien-desk, wotc-screening),
  `recertify/topic-pages.journal.json`, 20/20 checks passed, text and screenshots in `recertify/shots/`.

## Metric deltas (same 20 pairs)

| measure | original | recertify |
|---|---|---|
| judge criteria pass / fail / not evaluable | 27 / 71 / 23 | 52 / 44 / 25 |
| number-honesty criteria pass / fail | 2 / 26 | 14 / 11 |
| "(my guess)" lines in the 20 briefs | 36 | 12 |
| briefs with a dates section | 0 | 18 |
| adopt yes / maybe / no | 0 / 17 / 3 | 0 / 19 / 1 |

## Resolutions (theme -> state, with the honest ceiling)

| theme (SUMMARY) | findings | resolution | ceiling |
|---|---|---|---|
| 1 money figure without source, disagreeing | all `*-01`, health-03, family-01, housing-01, benefits-01 | **resolved-verified** (L2: one headline, estimate labelled, disclosure with basis/sources/caveat on 3 live pages) | the hero still image is a baked screenshot of the old page and still shows "$380,000 a year", "395x faster", "25 h by hand" (new finding R-1); the headline and the brief round $3,423.50 differently (R-2) |
| 2 non-money counted as found | commerce-03, construction-02, freight-03/11, employment-04 | **resolved-verified** (lien-desk live: "No money comes back in the example case: this chore protects money that is at risk"; "$416,700 ... protected") | the kinds are the authors' judgement per truth tool (ADR 0133), not measured; a re-bench is needed where an answer key itself is doubted (C-C1) |
| 3 brief rules as "(my guess)", no dates | freight-01, health-01, employment-03, benefits-03, construction-08, housing-03 | **fixed** (LC: "(my guess)" 36 -> 12, dates section 18/20) - not L2 | a dates section often holds rules with no calendar date because the interviewer still rarely asks for the person's anchor dates (lien-desk--gina: "I got rules with no dates") (R-3) |
| 4 example world leaks | benefits-05, family-02/03, construction-12, health-06 | **fixed** (LC) | the leak guard is a heuristic: a lone first name or "your son" passes it (ADR 0134) |
| 5 rehearsal overclaims | housing-02, consumer-10, public-03/05 | **fixed** (LC: no "shaped like your case" in any of 20 rehearsals) - not L2 | the recorded run still plays the example persona's lines under its own label |
| 6 time saved without review; verdict hidden | employment-02, public-02, health-04 | **resolved-verified** (L2: "including about 4 min of your review · 82x faster"; "Beat its bar in its one test run ...") | the hand time is still an author's estimate; the tile now says so (824f81e2) |
| 7 fit never stated | housing-04, commerce-06, benefits-04 | **resolved-verified** for the page (L2: "Where it fits" on 3 pages); **fixed** for the interview (LC) | cost and "what will you ask me for" questions were still unanswered in 2 of 20 conversations (R-4) |
| 8 verdict hidden | health-04 | **resolved-verified** (L2) | - |
| 9 chores wrong in their field | employment-17 and the area "Chore fixes" | **fixed** in playbook text and economics (25ad20b0) | wotc-screening still headlines the example's $19,200 of credits next to "lapsed for hires after 31 Dec 2025" - Carmen: "confusing next to the $19,200 example" (R-5); answer-key doubts unbenched (C-C1) |

## New findings for the next drain
- **R-1 (major, trust):** the topic page's hero still (`thumb.jpg`, from the evidence film) bakes the pre-0136 figures
  into pixels and contradicts the corrected tiles beside it (lien-desk shows "$380,000 a year, author's estimate",
  "Exceeds", "395x faster", "25 h by hand"). Evidence: `recertify/shots/lien-desk.png`. Acceptance: no still shows a
  figure the page does not; re-film or crop the stills to the drawing.
- **R-2 (minor, trust):** the money headline rounds $3,423.50 to "$3,424" while the brief says "$3,423"
  (medical-bills). Acceptance: one rounding rule for co-published figures.
- **R-3 (major, completion):** "Dates that matter" carries rules without dates when the person's anchor dates were
  never asked (lien-desk--gina, recoverable-depreciation--marcus asked to type dates that are on his statements).
- **R-4 (minor, clarity):** setup time, cost and "what will you ask me for and why" still go unanswered on the cards in
  2 of 20 conversations (ltc-claims--nadia, medicare-enrollment-timing--denise).
- **R-5 (major, trust):** wotc-screening's example headline ($19,200 back) contradicts its own lapse note; the example
  case predates the lapse but the page does not say so.
- **R-6 (minor, trust):** restricted-funds-release's disclosure still mixes $74,600 and $59,600.
