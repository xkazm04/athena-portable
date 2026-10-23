# Chores UAT, L1 area walk: consumer

- **Category:** consumer (10 home chores, 1 work chore)
- **Chores (n=11):** baggage-delay-claims, class-action-claims, credit-report-disputes, data-broker-deletion, eitc-claim, eu261-flight-compensation, first-time-abate (work), reg-e-fraud-claims, subscription-audit, travel-credit-refunds, unclaimed-property-sweep
- **Characters:** Aisha (home, phone-first nurse, medium tech), Bev (home, 72, first AI tool, low tech), Gina and Walt (work, first-time-abate only)
- **Pairs:** 22 of 22 complete, 0 failed. All 22 onboardings ended `clear` and were approved; all 22 rehearsals `done`.
- **Cost of those pairs:** $37.83 (sum of `cost_usd` over the 22 dumps)
- **Evidence:** LC dumps `proving-runs/chores-uat/2026-10-23-chores/pairs/<pair>.json`, case cards `uat/chores/cases/`, `numbers.json`, and the desktop and daemon code walked for J7/J8. I treated the judge's findings as leads and checked each one against the code. Several were **refuted**: the Sonnet judge saw numbers.json and the promise text, not the rendered page (see "Refuted or narrowed").
- **Severity rule used:** each of the three impact axes scores low=1, med=2, high=3, and the scores are summed: 9 is blocker, 7-8 major, 5-6 minor, 4 or less polish.

## Scorecard

Units are the ones in `uat/rubric.md` ("Chores: honesty and comprehension units").

**NUMBERs counted per chore (14):** catalogue hand time, catalogue Athena time, catalogue value; topic Value tile, manual minutes, Athena minutes, "N× faster", Traps avoided; flow result $ and its "N of N claims right" line; spine "walked past N of N traps"; "Worth $X ... for <persona>"; the hero story's headline figure; the practice-run figure. data-broker's hero story has no figure, so it has 13.

**HONEST only when** a source sits next to the number AND it agrees with every other rendering of the same quantity. The traps count, the claims-right line, the spine note and the practice-run line all say "bench"/"invented data" next to them. The value, time and worth figures carry no basis, no "estimate" and no "measured on invented data". The flow's $ is honest except where it is a weighted exposure unit dressed as dollars (credit, eitc, data-broker).

**Jargon** counts words from the rubric list, each distinct word once per screen:
- Catalogue: 4 (benched, "exceed the bar", bench, edge in "Best edge").
- Topic: 6 (persona, bench, trap, world, turn, brief), or 7 where "claims right" uses claim in Athena's internal sense.
- Practice run: 5 (rehearsal, world, card, turn, brief).
- Brief: +1 ("What I'll claim") on chores where nothing is claimed.

| chore | honest (h/n) | jargon met (cat+topic+run+brief) | onboarding ended (A / B) | rehearsal (A / B) | adopt (A / B) | judge pass (n=12) | field verdict |
|---|---|---|---|---|---|---|---|
| baggage-delay-claims | 5/14 | 4+6+5+0 = 15 | clear 2r / clear 2r | shaped 6v6 / shaped 6v6 | maybe / maybe | 3/12 | sound |
| class-action-claims | 5/14 | 15 | clear 2r / clear 2r | $158 / shaped 6v6 | maybe / maybe | 2/12 | sound |
| credit-report-disputes | 4/14 | 4+7+5+1 = 17 | clear 2r / clear 2r | shaped 11v8 / shaped 10v8 | maybe / maybe | 3/12 | issues |
| data-broker-deletion | 4/13 | 17 | clear 3r / clear 3r | shaped 4v5 / shaped 4v5 | maybe / maybe | 5/12 | issues |
| eitc-claim | 4/14 | 15 | clear 2r / clear 2r | shaped 4v4 / shaped 4v4 | maybe / maybe | 2/12 | issues |
| eu261-flight-compensation | 5/14 | 15 | clear 1r / clear 2r | $5,445 / $5,445 | maybe / maybe | 3/12 | issues |
| first-time-abate (G / W) | 5/14 | 17 | clear 1r / clear 3r | $1,850.60 / shaped 4v4 | maybe / maybe | 3/12 | issues (minor) |
| reg-e-fraud-claims | 5/14 | 15 | clear 2r / clear 3r | shaped 6v5 / shaped 6v5 | maybe / maybe | 3/12 | sound |
| subscription-audit | 5/14 | 17 | clear 3r / clear 2r | $613.50 / $613.50 | maybe / maybe | 3/12 | issues |
| travel-credit-refunds | 5/14 | 15 | clear 2r / clear 2r | shaped 6v6 / $832 | maybe / maybe | 2/12 | sound |
| unclaimed-property-sweep | 5/14 | 15 | clear 2r / clear 2r | shaped 6v6 / $1,016.43 | maybe / maybe | 3/12 | issues |
| **category** | **52/153 = 34%** | 15-17 per journey | 22/22 clear | 22/22 done; $ shown in 8 | **0 yes / 22 maybe / 0 no** | **32/132 = 24%** (33.7% of decided) | 4 sound, 7 issues, 0 wrong |

Column notes:
- **Onboarding ended:** A is Aisha (Gina for first-time-abate), B is Bev (Walt for first-time-abate); "2r" means two question rounds.
- **Rehearsal:** "shaped 6v6" means the run proposed 6 action cards against 6 in the recorded run, with no dollar figure claimed.

**Judge pass by criterion:**
- **Aisha:**
  - C1 (one minute on the topic page tells me what it does, what it asks, what it won't): 0/10
  - C2 (every $ sourced): 1/10
  - C3 (no unlabelled total): 1/10
  - C5 (setup within 10 minutes and six messages): 10/10
- **Bev:**
  - C1 (understood before starting): 10/10
  - C3 (no password, and a reason for every sensitive number): 7/10
  - C4 (every $ sourced): 0/10
  - C5 (no unexplained vocabulary): 0/10
- **Walt:** 1/6 (C5 only).
- **Gina:** 2/6.

**Time saved.** "N× faster" divides the author's `manual_minutes` by the bench wall-clock and leaves out the person's own review time:

| chore | shown | with review |
|---|---|---|
| baggage | 63× | 22× |
| class-action | 49× | 19× |
| credit | 77× | 25× |
| data-broker | 92× | 40× |
| eitc | 69× | 32× |
| eu261 | 76× | 47× |
| first-time-abate | 69× | 32× |
| reg-e | 35× | 18× |
| subscription | 85× | 27× |
| travel | 92× | 32× |
| unclaimed | 50× | 22× |

The with-review figures come from `numbers.json` `speedup_with_review`. Neither column counts the 3-6 minute onboarding conversation (pair `wall_ms` 2.8-6.1 min). The hand minutes are an author estimate, and nothing on the page says so.

## Per-Character reviews

### Aisha Grant, ER night nurse, Tucson (10 chores)

> Okay, credit where it's due: setup was the fastest thing I've done all month. Two or three cards, never once asked for my
> SSN, never asked to "connect everything". It got the stuff that matters right. It left out the handbag I bought after
> my bag showed up. It skipped the Cancún sunglasses and the resale cables. It flagged the Awardhelm "payout desk" as the
> scam it obviously is. It even noticed I sent the data-broker request while I was working in California. That's a
> person who knows the rules.
>
> But I asked the same question in basically every chore: *what do I actually get back, and when?* I never got a
> number. The brief for the bag claim literally says "You'll get an exact total, not an 'up to'" and then gives no total.
> My EITC is computable: my W-2 is about $39,800 and Marcus's about $12,500, three kids. That's roughly $3,450 off the
> IRS's own table. The page instead says "$3,000 a year, for the persona", which is a number about someone else. On the flight
> chore the practice run says "$5,445 found... shaped like your case". My case is Theo and me, one Lufthansa leg, €800.
> That's the exact "up to" money I delete apps over.
>
> The topic pages are all some other woman's story: a Boston vet tech, a San Diego office manager. One card even asked
> about "your son". I'm pregnant, lol. And every rule I'd want stated flat, like 21 days, 3 hours or 60 days, shows up
> as "(my guess)". So the thing that clearly knows the law sounds unsure of it. For my mortgage this spring, nobody
> warned me that "too old" stuff can still show up on a big-loan report. That's the one thing a consumer advocate
> would have said first.
>
> Would I adopt? Maybe, for class actions and travel credits, where being wrong costs me little. Would I tell my sister?
> Not until it shows me my own number with where it came from.

### Beverly Shaw, retired teacher, Roanoke (10 chores)

> I'm sorry, I'll try to be fair. Athena was kind. Nothing hurried me, and every brief said she would ask me before
> anything was sent. That is what I needed to hear after the $800. Nobody asked for a password or my account number.
> She left Moira's cardigan and my cashmere wrap out of the airline letter, and she left Carol's and Margaret's listings alone.
>
> But every first question listed names I have never heard of. Postwren, Cardhollow, Tripcairn, Streamquill. I had to
> keep typing "AOL Mail" and "Capital One" and worrying I'd done it wrong. When I asked her something myself, she moved
> on without answering. Why did she need to know where my IRS letters come? What would she open in my folder? What
> does Form 8332 do? Then she asked whether I have a disability, and I don't know why a stranger needs that.
>
> The pages frightened me. Big figures like $1,016.43 and "$5,445 found" with a lady in Portland or a family in Lisbon,
> and words I don't know: "persona", "traps", "bench", "rehearsal", "cards". That is how the scam emails look. The
> letters said "my guess" about the deadline for my suitcase, and that deadline is this coming Tuesday. On the
> subscriptions she only wrote down the Netflix I mentioned. She didn't ask about the meditation add-on or the walking club.
> For the money I sent the man about my grandson, she said only that she'd leave it alone. My old branch
> manager would at least have told me whom to report it to.
>
> Would I use it? Only with Tyler sitting beside me. I would not tell my friends yet.

### Gina Russo, office manager (first-time-abate, for the owner's tax letters)

> One card, four "which app" questions, done in a minute. Good. And I believe it when it says nothing goes to the IRS
> until I've seen the actual request. But the brief gives me categories, not notices. Which entity, which period,
> which code, what amount? It marks the three-year clean-history rule as "my guess". The page says $1,200 and the
> practice run says $1,850.60, and nothing connects them. "69× faster" pretends I won't check every request, and I will.
> Maybe. Show me the four requests as documents and I'm in.

### Walt Brenner, firm owner (first-time-abate)

> Short, and nobody asked me for an EIN. I'll give it that. But she asked which of my "two partnerships" had a penalty
> taken off. I don't have two partnerships. The $410 is on the payroll form, and I had to set her straight. Then she
> asked if it was paid or dropped and never said which paper would tell me. The page is one long sentence of
> "accuracy-related" and "installment agreement". Five "my guess" lines in a brief about the IRS is five too many. My
> old CPA would have told me in two sentences what each letter costs. This told me what it would *ask*. Maybe, if it
> learns to read my letters back to me.

## Findings, ranked by impact (full rows in `findings-consumer.json`)

### Category-wide themes

1. **consumer-01 · blocker · trust.** Every money figure on the catalogue and topic page is the author's estimate for an invented persona, with no "estimate" and no basis.
   - Where it shows: Value tile and "Worth $X ... for <persona>" (topic.tsx:189-191, 246) and the catalogue value column (catalogue.tsx:121-134).
   - Why the basis is missing: `economics.basis` is not parsed at all (lib/playbooks.ts:43-54, 495-505). `caveat` is parsed (lib/playbooks.ts:522) but no .tsx reads it (grep finds no use outside lib/model).
   - Effect: Aisha C2/C3 failed 9/10 each, Bev C4 failed 9/10 (one null).
   - Plausibility against the Character's own case: baggage $500 vs Bev's ~$207.75; eu261 $1,300 vs ~€800 for each Character; eitc $3,000 vs ~$3,449 (Aisha) and ~$7,892 (Bev); reg-e $900 vs ~$1,327 (Aisha); class-action $200 vs $117 (Aisha's case card).
2. **consumer-04 · major · time-saved.** "63× faster" leaves out the review time. `beforeAfterOf` computes "your review N min" (model.ts:154), but the topic renders only `band.ratio` (topic.tsx:202) and never `band.athena.line`. With review counted the ratios drop by 2-3× (table above).
3. **consumer-02 · major · trust.** Two "worth" dollar figures sit on one page and disagree: Value "$500 per episode" vs the flow's "Filed on the bench $203" (flow.tsx:121-123, model.ts:129).
   - 10 of 11 chores differ. `world_ratio` runs from 0.24 (eu261, $1,300 vs $5,445) to 2.46 (baggage). Only credit-report is 1.0.
   - Nothing on the page explains the difference.
4. **consumer-03 · major · trust.** Bench weights are rendered as dollars "filed" and summed into the catalogue's "found on the bench" (model.ts:105, modules/playbooks/model.ts:229):
   - eitc "$4,000" is 4 acts × a $1,000 weight. Its basis calls this "an exposure unit and not money recovered".
   - credit "$1,000" is 8 × $125, a "price avoided".
   - data-broker "$32" is 5 × $6.45, while its own Value tile says "$0 a year".
5. **consumer-09 · major · trust.** Aisha asked "what do I actually get back, and when" in effect in all 10 of her pairs. No brief gave a figure or a timeline, although most are computable from the case:
   - eitc: from the 2025 table.
   - eu261: 2 × €400.
   - baggage: line items.
   - The baggage brief promised "an exact total, not an 'up to'" and gave none.
6. **consumer-10 · major · trust.** Whenever a dollar figure appears in the practice run, the world was **not** shaped like the person's case:
   - The code: `found_usd` is set only when the shape edited no row and kept the date (showcase.py:575-584). Yet the label reads "Rehearsal on invented data shaped like your case" (showcase.tsx:40), and the figure "found in the rehearsal, on invented data" (showcase.tsx:113-118).
   - Shown in 8 of 22 pairs, against the Character's true figure:

     | pair | practice run showed | the Character's case |
     |---|---|---|
     | eu261, both | $5,445 (a family of four, four bookings) | ~€800 each |
     | subscription-bev | $613.50 | ~$426 of cancellations |
     | unclaimed-bev | $1,016.43 | $940.75 |
     | class-aisha | $158 | $117 |
     | travel-bev | $832 | n/a |
     | FTA-gina | $1,850.60 | n/a |
7. **consumer-08 · major · trust.** Rules the playbook researched and sourced are labelled Athena's guess.
   - The cause: prompts.py:97-98 says "A fact any public source answers (a rule, a rate) is filled from the playbook with status guessed", and loop.py:467-485 appends "(my guess)" to every non-confirmed slot.
   - Count: 49 "(my guess)" lines across 22 briefs, covering the 21-day complaint, the 3h/6h thresholds, the 30 days, the 7/10 years, and Ohio's 10% cap.
   - Facts the person typed are marked too: reg-e-bev "told the bank 3 October (my guess)".
8. **consumer-07 · major · clarity.** First-round answer options are the playbook's invented brands (Postwren, Cardhollow, Tripcairn, Aerolark, Streamquill...).
   - In 19 of 22 case cards at least one of the person's portals differs.
   - Asides in 13 pairs say they had to "pick around" or felt "I was doing it wrong" (Bev).
   - Where the options come from: prompts.py:58-59 asks for 2-5 options naming an app; the playbook's portal names are the only names offered.
9. **consumer-06 · major · clarity.** Jargon on every screen: catalogue 4, topic 6-7, practice run 5 (see Scorecard). Bev C5 failed 10/10, Walt C4 failed. Examples:
   - "Traps avoided ... on the bench" (topic.tsx:205-207).
   - "for the persona" (topic.tsx:191).
   - "walked past N of N traps the world held" (flow.tsx:118).
   - "N of N benched exceed the bar" and "Best edge" (model.ts:104, catalogue.tsx:38).
   - "N cards proposed ... answer key ... rows" (showcase.tsx:104-111).
10. **consumer-05 · major · clarity.** The hero's story is the invented persona's case, with nothing on the hero saying so. Only the gallery caption says "invented portal world" (topic.tsx:220), and the caveat that names every invented party is never rendered. Judges in 18 pairs read the page as "about someone else".
11. **consumer-15 · major · trust.** Facts from the persona leak into the conversation and the brief, despite prompts.py:63-64 ("The playbook's example is someone else's case"):
    - "your son" to a pregnant Aisha (subscription).
    - "which of your two partnerships" to Walt.
    - "Flights between Dublin and Lisbon" and "a 2 hour 10 minute" delay in Bev's travel brief.
    - "two partnerships (my guess)" in Gina's brief.
12. **consumer-16 · major · trust.** Direct questions from the person went unanswered, and sensitive questions came without a need:
    - eitc-bev: why does it need where the IRS letters arrive (turn r1q4)?
    - unclaimed-bev: what will you open in my folder?
    - eitc-bev: what does Form 8332 do?
    - travel-bev: asked about her disability.
    - credit-aisha: asked for the card's digits with no reason.
13. **consumer-17 · major · senior-quality.** Chores built on one jurisdiction's law are offered to everyone, with no residency gate:
    - data-broker uses California's Delete Act and DROP. Bev lives in Virginia. Her brief still adds her maiden name to the California request.
    - subscription uses California's Automatic Renewal Law. Aisha is in Arizona, Bev in Virginia.
    - unclaimed applies the uniform act as Illinois and Vermont enacted it to Bev's Ohio and Virginia (offline knowledge: neither state enacted the 2016 act).
14. **consumer-11 · major · clarity.** In 14 of 22 pairs the practice-run result is "N cards proposed, against M in the recorded run. Your case changed rows the answer key was written for." (showcase.tsx:102-111.) The person has nothing to check. Aisha C6 was null 10/10.
    - Present-but-missed: the turn-by-turn Player is there (showcase.tsx:121-124).
    - What is missing: a summary saying which letters she would send, to whom, for how much and by when.
15. **consumer-13 · minor · clarity (narrowed from a judge lead).** "The page never says what she asks first" is **refuted**: Flow renders an "Athena asks you first" diamond per gate (flow.tsx:106-112). The reason for each gate, though, exists only as a hover `title` (flow.tsx:106), which a phone-first user cannot reach.
16. **consumer-14 · minor · clarity (narrowed).** For Bev's "how to go back or stop":
    - Present: "← All playbooks" (topic.tsx:147-149), "Close", and "Leave anyway?" (studio.tsx:132-145). After approval: "nothing was sent" and "It waits in her composer until you send it" (showcase.tsx:40, 133-137).
    - Absent: a plain sentence before she begins saying she can stop at any point and nothing leaves without her yes.
17. **consumer-12 · polish (refuted lead plus an open gap).** Judges cited "Exceeds (n=1)" on the page. It is not rendered: the verdict badge, sentence and sample are unused in scenes/chores. The opposite gap is real: `sample: "n=1"` is computed (modules/playbooks/model.ts:132-136) and never shown beside the "N× faster" it qualifies.
18. **consumer-18 · minor.** data-broker shows "$0 a year" in the catalogue and on the topic page, and "Worth $0 a year for a Californian..." in Make it yours. That is honest but reads as broken. Its basis has the real value: 12 hours a year, or DeleteMe's $129 a year.
19. **consumer-19 · polish.** The catalogue's "Most value" sort compares per-episode figures raw against yearly ones (`numbers.json` quirks; 5 of 11 consumer chores are per-episode).
20. **consumer-20 · refuted hypothesis.** The scouts' "Value tile annualises while 'Worth' does not" does not bite here. I checked every `per` branch: consumer uses only `year` (6 chores) and `episode` (5). `valueCell` (model.ts:84-87) changes neither, and PER maps episode to "per episode" (modules/playbooks/model.ts:104-110, 215), so the tile and the line agree in 11 of 11.

### Chore-specific (field reliability, "senior bar")

- **consumer-21 · major · credit-report-disputes.** The account someone else opened is disputed only under 1681i. An advocate files an identity-theft **block** under 15 U.S.C. 1681c-2: the bureau must block it within 4 business days of an identity theft report. They also place a fraud alert or freeze. Both Characters had exactly this account. (Offline knowledge; the statute is not in the playbook's sources.)
- **consumer-22 · major · credit-report-disputes.** Aisha's stated goal is a mortgage pre-approval. 1681c(b)(1) lets obsolete items be reported for credit of $150,000 or more. The playbook's basis says so, but the chore and the brief promise that "too-old entries" come off without the warning.
- **consumer-23 · minor · credit-report-disputes.** "Paid medical collections must come off your reports (my guess)": no statute says so.
  - What does apply: the bureaus' voluntary policy (paid medical collections, and medical collections under $500; Aisha's is $386).
  - The CFPB's 2025 medical-debt rule was vacated (offline knowledge).
  - The dispute should rest on bureau policy or inaccuracy, not on law.
- **consumer-24 · major · eitc-claim.** It never tells the family the credit, though a deterministic table exists:
  - Aisha, MFJ, $52,300, 3 children: 8,046 − 0.2106 × (52,300 − 30,470) ≈ **$3,449**.
  - Bev, $31,200: ≈ **$7,892**.
  - Phase-out start and rate are from my offline knowledge of Rev. Proc. 2024-40. The 8,046 and 68,675 match the playbook's basis.
  - The page instead shows "$3,000 a year" and "Filed on the bench $4,000", a weight.
- **consumer-25 · major · eitc-claim.** The chore is framed "by the 15 October deadline". On 23 October both briefs say the return is past due and "will be filed late", and offer no next step.
  - What a preparer would say: a refund-only late return carries no failure-to-file penalty (6651(a)(1) is a percentage of tax due), and an EITC refund stays claimable for 3 years (IRC 6511). Offline knowledge.
  - The judge's lead that this "contradicts my extension" is refuted: the extension ended 15 October.
- **consumer-26 · minor · eitc-claim / eu261.** Catalogue titles bake in the persona: "...for three children", "Delayed family flights".
- **consumer-27 · minor · eu261.** The rule as written misses two things (offline knowledge of Reg. 261/2004 and Sturgeon):
  - Art. 7(2) halves compensation, for example on a flight over 3,500 km that arrives 3-4 h late.
  - National time limits on claims.
  - Also, amounts are shown in dollars at a fixed $1.10 to the euro while airlines pay in euros.
- **consumer-28 · minor · reg-e-fraud-claims.** The scam payment Bev sent herself is "left alone", and she is told nothing about where to go next. A branch manager would name her avenues: report it to the bank anyway, to the FTC and IC3, and as elder fraud (offline). The judge's lead that "the code-tricked top-up contradicts the left-alone rule" is **refuted**: Supplement I comment 2(m)-3 makes a transfer with a device obtained by fraud unauthorised, and the brief draws the line correctly.
- **consumer-29 · polish · reg-e-fraud-claims.** It omits the 1005.11(c)(3) extensions: 20 business days for new accounts, and 90 days for point-of-sale, foreign and new-account errors (offline).
- **consumer-30 · minor · first-time-abate.** For a late partnership return, a CPA asks first for Rev. Proc. 84-35 small-partnership relief (10 or fewer partners), which keeps the one-time waiver for later (offline). Walt's LLC-as-partnership fits.
- **consumer-31 · minor · unclaimed-property-sweep.** Bev's late husband's $389 listing is "left alone" as not hers. As his widow she is likely his heir. A pro would tell her the heir or estate route, not just skip it.
- **consumer-32 · major · subscription-audit.** Bev's brief captured 1 of her 4 dead plans: the duplicate Netflix. The meditation trial ($5.99, no reminder), the "Walking Club" price rise ($7.99 to $10.99) and the unused 200 GB storage plan are all in her case, and Athena never asked about add-ons or storage.
- **consumer-33 · major · baggage-delay-claims.** The written-complaint date is arithmetic (delivery + 21 days, Montreal Art. 31(2)), yet it is marked "(my guess)": Aisha 26 October, Bev 27 October. Bev's falls 4 days after the run, and it sits mid-list with nothing marking it urgent.
- **consumer-34 · minor · data-broker-deletion (Bev).** For a Virginia resident the brief still says "Add Beverly Anne Tolliver to your Erasepoint request". DROP serves California residents only; for her, the brokers' own opt-out forms are the route (the brief has those too).

## Chore fixes (edits to the playbooks)

| chore | edit a pro would demand | evidence |
|---|---|---|
| baggage-delay-claims | Store the complaint deadline as a computed fact (delivery + 21 days, Art. 31(2)) so it is never "guessed", and add a step that states it first. Set `value_usd` from a typical claim (~$200; bench $203; Bev's case $207.75), not $500. | bench score 203.3; case card baggage-bev; dumps #brief |
| class-action-claims | Keep. Lower `value_usd` toward the bench ($158; Aisha's case $117), or say "a year of small claims, typically $100-200". Name in the brief where each deadline came from (the notice), not "(my guess)". | numbers.json world_ratio 1.27; dump class-bev #brief |
| credit-report-disputes | Add a target, "identity-theft block under 1681c-2 with an FTC report" for an account she never opened, and a fraud-alert/freeze note. Add the 1681c(b) warning for mortgages and large loans. Recast "paid medical" as bureau policy (paid, or under $500), not law. Drop the "$1,000 a year" and $125 weights from money displays. | truth TG-1..; case credit-aisha "mortgage pre-approval in spring" |
| data-broker-deletion | Precondition: California resident at request time, asked first; out of state, skip DROP steps and use site forms only. Replace the $0 value with "about 12 hours a year, or a $129/yr removal service". Do not render the $6.45 weights as dollars. | econ.basis; dump data-broker-bev #brief; dump data-broker-aisha #turn:r3 (a strength) |
| eitc-claim | Add a step that computes the credit estimate from the W-2s and the IRS table, shown as "estimate, IRS decides". Add a late-filing branch: past the 15 Oct extension, still claim; no failure-to-file penalty on a refund; 3-year window. De-persona the title ("Earned income credit claimed for qualifying children"). | case cards eitc-aisha/bev wages; dumps #brief |
| eu261-flight-compensation | Add Art. 7(2) 50% reductions and the "per passenger who paid a fare" rule as a computed total. Show euros with a dated conversion. Value: "€250-600 per passenger per disrupted flight", not "$1,300 per episode". | case eu261-aisha (€800); rehearsal $5,445 |
| first-time-abate | Add a Rev. Proc. 84-35 first-step for small partnerships. Make the brief list each notice (entity, form, period, code, amount) with its decision. Ask "where on your papers" (e.g. "the notice code top right"). | dump FTA-gina judge; FTA-walt #turn:r2 |
| reg-e-fraud-claims | Add a step, "for a payment you sent yourself, here is who to tell", with no claim filed. Add the new-account and POS 90-day extensions. Value per episode is fine; label it. | case reg-e-bev $600 |
| subscription-audit | Precondition the state law, or generalise to "the service's own terms plus your state's renewal law". Ask explicitly about add-ons, trials and storage tiers (the classic misses). Separate "a year of price avoided" from "refund recovered" in every figure. | case subscription-bev facts; econ.basis split 587.52 / 25.98 |
| travel-credit-refunds | Keep (rules right, including the disabled-only connecting-airport clause). Ask the disability question only when the case has a connecting-airport change, with the reason in one plain sentence. | dump travel-bev #turn:r2 |
| unclaimed-property-sweep | Ask the state first; for non-RUUPA states, say the rules differ. Add an heir/estate branch ("as his spouse you may claim as heir with a death certificate"), not just "left alone". | case unclaimed-bev (Ohio/Virginia, Walter's $389) |

## What passed (protect these)

- **The bench answer keys are right in their fields.** All 11 chores scored 100% recall, 0 false claims and 0 traps filed on the bench, and the traps are the ones a pro would set: food on a grocery receipt, the card-benefit jacket, an opt-out, Toronto, the disabled-only connecting airport, Form 8332 not moving the EITC, the FTA earliest-period rule.
- **The briefs left alone exactly what each Character's case said to leave alone:** Moira's cardigan and Bev's wrap, the opted-out yogurt and coffee, the Delta inbound leg, Dan's and Marcus's plans, the 21-year-old cousin, the Mesa namesake.
- **Onboarding is short:** Aisha C5 passed 10/10, Walt C5 passed; median 2 rounds; no SSN, password or account number asked in any of the 22 pairs.
- **Ask-first gates are in every brief**, and Bev C1 passed 10/10. The gate list exists on the topic page too (flow.tsx:106-112).
- **Scams are spotted and named:** the Awardhelm payout desk, the refund advance, the maximizer, the Lostfunds 25%.
- **Athena found a precondition on her own:** "Erasepoint is California's platform... did you live in CA?" (data-broker-aisha round 3).
- **The practice run refuses to claim dollars when the answer key no longer fits** (showcase.tsx:102-111), and labels its dollars "on invented data" (showcase.tsx:117). The honesty mechanism is there; the "shaped like your case" label beside it is what misleads.

## Refuted or narrowed (judge leads checked against code)

- **"Exceeds (n=1)" shown on the page:** refuted. The verdict is not rendered in scenes/chores.
- **"Topic page never says what she asks first":** refuted. Flow gate diamonds render it; the reason is hover-only (consumer-13).
- **"No way to go back":** narrowed. Crumb, Close and Leave exist; a plain "you can stop" sentence is absent (consumer-14).
- **"Practice $5,445 not labelled invented":** refuted. It reads "found in the rehearsal, on invented data". The real defect is the "shaped like your case" label (consumer-10).
- **eitc-aisha "brief contradicts my extension":** refuted. 15 October had passed by the 23 October run (consumer-25).
- **reg-e-aisha "the Venmo top-up contradicts the left-alone rule":** refuted on the law. The clarity gap stands.
