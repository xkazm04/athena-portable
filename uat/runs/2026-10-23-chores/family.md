# UAT L1 area walk - Chores, category `family`

- **Chores (5):** estate-settlement, funeral-price-check, household-employer-tax, name-change-everywhere, veteran-burial-benefits
- **Characters (2):** grace (retired librarian, 59, grieving executor, low tech), samira (coordinator, 32, newly married, first-time household employer, medium tech)
- **Pairs:** 10 of 10 complete, 0 failed (every dump `complete: true`, `failure: ""`)
- **Cost of the LC pairs:** $19.54 (sum of `cost_usd`; estate pairs $4.34 + $4.33 carry 44% of it, rehearsal alone $3.71 / $3.63)
- **Method:** LC dumps `proving-runs/chores-uat/2026-10-23-chores/pairs/<pair>.json`, case cards `uat/chores/cases/<pair>.json`, playbooks, `numbers.json`; J7/J8 walked over `apps/desktop/src/scenes/chores/` and `src/athena/adopt/`. Judge findings were treated as leads and checked; four of them are refuted below.

## Scorecard

Honest numbers are counted with the rubric units over the path each Character walks: catalogue row, topic page (hero brief, three KPI tiles, "How it runs", "Make it yours" line), the studio's opening line, and the showcase result. Navigation counters ("Turn 3 of 27") are not counted. Jargon is counted per screen as catalogue / topic / studio+showcase. "claim" counts as jargon only where the chore is not a claim job.

| Chore | Honest numbers (h/n) | Jargon met (cat / topic / studio) | Onboarding ended (G, S) | Rehearsal (G, S) | Adopt (G, S) | Judge pass (G+S) | Field reliability |
|---|---|---|---|---|---|---|---|
| estate-settlement | 8/23, 8/23 | 3 / 5 / 8 | clear r2, clear r3 | shaped 10 vs 10 cards, shaped 10 vs 10 | maybe, maybe | 3/5 + 1/5 = 4/10 | **issues**: one trap misstates IRA disclaimer law, "IRS first" too simple, no court accounting step, value not plausible for either estate |
| funeral-price-check | 7/19, 7/19 | 3 / 6 / 9 | clear r2, clear r2 | $1,915 found (4 vs 8 cards), $1,915 (7 vs 8) - both unfinished | maybe, maybe | 2/5 + 2/5 = 4/10 | **sound, with gaps**: no rule on who must sign the cremation authorization |
| household-employer-tax | 8/18, 7/17 | 3 / 6 / 9 | clear r1, clear r1 | shaped 6 vs 6, $818.17 (6 vs 6) | maybe, maybe | 2/5 + 2/6 = 4/11 | **issues**: no check of past-year W-2 and Schedule H for someone who never filed, no EIN step, no flag when the employer has died, a late I-9 promised "by the third day" |
| name-change-everywhere | 8/18, 7/17 | 3 / 6 / 9 | clear r1, clear r1 | shaped 6 vs 6, $39.96 (6 vs 6) | maybe, maybe | 2/5 + 1/6 = 3/11 | **sound**: order and forms right; facts guessed, not asked |
| veteran-burial-benefits | 8/19, 8/19 | 3 / 5 / 8 | clear r2, clear r2 | shaped 3 vs 3, shaped 4 vs 3 | maybe, maybe | 2/5 + 2/5 = 4/10 | **issues**: drops the $2,000 service-connected allowance without checking PACT Act presumptives, never tells the niece she can claim |

**Category totals.** Honest numbers **76/192 (39.6%)**. Of the money figures alone, the only honest ones are the bench-labelled "Filed on the bench" result and the rehearsal's "found ... on invented data". Every figure a person reads as "what this is worth to me" is unsourced: the Value tile, the "Worth $X" line, the catalogue value and the hero brief's totals. Judge criteria **19/52 passed (36.5%)**, 12 null. Adopt: **0 yes / 10 maybe / 0 no**.

### How the honest-number counts were built (estate, as the worked example)
- Catalogue row: "20h", "8m", "$20,000 per estate". 3 NUMBERs, 0 honest (no source on screen; `catalogue.tsx:108-133`, `facts.ts:21-27`, `model.ts:84-87`).
- Hero brief, rendered from `playbook.brief` (`topic.tsx:160-161`): $111,644 twice, $93,200, $9,022, $9,423 and $255. 6 NUMBERs, 0 honest: these are invented-world figures with no label beside them. The "invented portal world" note sits two sections lower, under "See it run" (`topic.tsx:220`).
- KPI tiles: Value "$20,000 / per estate, for the persona" (`topic.tsx:188-191`), and Time saved "20 h -> 8 min" plus "158× faster" (`topic.tsx:193-202`). 4 NUMBERs, 0 honest. economics.basis is never parsed (`lib/playbooks.ts:43-54`, `495-505`). Sources are parsed but rendered by no view, and a grep over `scenes/` finds no `.sources` use. Traps avoided "11/11 on the bench" counts as 1 honest NUMBER (`topic.tsx:204-207`).
- "How it runs": "Filed on the bench $104,460", "10 of 12 claims right, none false", and "walked past 11 of 11 traps the world held" (`flow.tsx:117-124`). 5 NUMBERs, all honest (source stated, agree with each other).
- "Worth $20,000 per estate for a daughter three states away..." (`topic.tsx:246`). 1 NUMBER, not honest.
- Studio opening, "**$111,644** to handle" (`src/athena/adopt/prompts.py:373-386`). 1 NUMBER, not honest.
- Showcase, shaped: "10 cards proposed ... against 10 cards in the recorded run" (`showcase.tsx:102-111`). 2 NUMBERs, honest.
- Result: **8/23**. The hero's $111,644, the tile's $20,000 and the flow's $104,460 are three different headline dollar figures for one chore, and nothing on the page says why they differ.

Every branch of the `per` mapping in this category was checked. `year` (household) renders "$800 / a year" and agrees with the "Worth" line: clean. `estate` and `episode` (the other four) fall through `PER` to "per estate" / "per episode" (`modules/playbooks/model.ts:104-110, 215`). They are not annualised and agree between the tile and the Worth line, so the topic has no annualising mismatch, but "per episode" is opaque wording. `times_per_year = 1` is ignored and harmless here. The household basis says "times a year: four" while value_usd is "$800 a year" against a one-quarter world of $818.17, so the unit is muddled in the data even though the UI is consistent.

### Time saved, with the person's own review counted
Computed from `bench.json` (`wall_s`, `your_time_s`) and `economics.manual_minutes`:

| Chore | Shown | With bench review time | Review the bench assumes |
|---|---|---|---|
| estate | 20 h -> 8 min, 158× | 95× | 5 min, to approve 10 cards incl. a $93,200 disclaimer, 3 creditor decisions and an IRS payment |
| funeral | 5 h -> 3 min, 113× | 45× | 4 min |
| household | 3 h -> 3 min, 52× | 28× | 3 min |
| name change | 10 h -> 2 min, 338× | 126× | 3 min |
| veteran | 4 h -> 3 min, 89× | 57× | 1.5 min, to approve 3 signed federal claims |

`beforeAfterOf` builds "your review N min" (`scenes/chores/model.ts:154`), but the topic tile renders only `band.manual.figure`, `band.athena.figure` and `band.ratio` (`topic.tsx:196-202`), so the review time never reaches the screen. The review times are also implausibly short for a careful person approving signed filings. No time-saved claim in this category is honest.

## Per-Character reviews

### Grace Lindqvist (estate, funeral, household payroll, name change, VA burial)

"I'll say first that she was kind to me. 'I'm so sorry about your mother' came at the right moments, she never hurried me, and I believed her each time she said she would ask before paying or filing anything. That last part matters most to me. My brother and sister would never forgive a payment nobody approved.

But she asked too much at once. Every first card held three or four questions, and some held two questions in one. On the estate card she asked about the state, the IRS and Social Security together, and I didn't know how to answer. On my father's card she asked which bank I'd paid from twice. She asked for the county of my mother's court twice, when it's printed on the letters of appointment in my own Drive folder, which I'd already told her about. She never once told me what she could read for herself, or what came next.

What upset me was the page around her. My mother has just died, and the page says '$20,000 per estate, for the persona' and '20 h -> 8 min, 158× faster'. Above that it says a daughter has '$111,644 to handle', and further down '$104,460 filed on the bench'. I don't know whose estate that is or which figure is meant for me. On the funeral page it says '$2,500', and the practice run said '$1,915 found'. I didn't want a number about what my mother's death will 'save'. I wanted to know what I'm allowed to refuse to pay.

She opened by asking whether I use 'Hourquill', 'Ledgerline bank' or 'IDway'. I've never heard of them, and I felt foolish correcting her. On my father's VA claim she said 'a son paid for his veteran father's funeral'. I'm his daughter.

The practice runs did say they used invented data, and I'm grateful for that. But the estate rehearsal told me about a 'Ruth' who died in January and a disclaimer due October 15th. My mother died on October 6th, so for a moment I thought I'd already missed something. A paralegal would also have told me what the court needs from me, the inventory and the accounting, and the estate brief never mentions the court record at all.

Would I adopt? The funeral and VA chores, maybe, because the deadlines are real and the briefs were short and clear. The estate one I would want to read every card of. I would tell my sister it is careful about asking first, and not to believe the numbers on the page."

### Samira Okoye (estate, funeral, household payroll, name change, VA burial)

"Okay. Honest review: the questions were easy, the 'asks you first, every time' promise is great, and the VA one actually understood that my deadline is this weekend. That's the good part.

Here's my problem. I opened every single one with 'what order, and what's urgent?' and not one brief answered it. The brief format is 'Your setup / What I'll claim / Left alone'. There's no 'do this first, by this date, or this happens'. My estate disclaimer window closes around November 14th, Dev's I-9 was due on the 14th (so it's already late!) and he gets paid today, and the Q3 state report is due at the end of the month. None of those dates made it into a brief. The payroll brief even says 'sign his I-9 by his third business day', which was nine days ago.

Then it put things in my brief that I never said. My payroll brief says 'your nineteen-year-old son's wages are exempt'. I'm 32 and I don't have a son. My estate brief says 'your CPA's disclaimer advice', and I don't have a CPA. If it's inventing facts on the page I approve, how do I know it isn't inventing them on the IRS filing? On the name change it wrote three '(my guess)' facts about my own Social Security record and passport that it never asked me about. They happened to be right, but still.

Numbers: '$800 a year' and '52× faster' with no source, then the practice run said '$818.17 found', which turns out to be penalties avoided on a made-up household, not money anyone found. The name change says '$0' at the top and '$39.96 filed' further down, so which is it? I'm happy the practice run is labelled invented. I'm not happy that nothing tells me where the real-looking figures come from.

And never once did it say 'talk to an accountant about this'. Reclassifying Dev from contractor to employee is exactly where I want a person. On the VA one, my actual question was whether I can even claim as his niece, and it never asked how I'm related.

Would I tell a friend? I'd say the VA one is worth trying if you're on a deadline. The others need a real order-of-steps with dates before I'd hand them anything."

## Findings, ranked by impact (frequency × reachability × trust erosion)

Severity is derived: all three high = blocker; two high = major; one high = minor; none = polish.

### Category-wide

1. **family-01 (blocker): The page shows two or three different dollar figures for the same chore, and none says where it comes from.** Estate: hero $111,644, tile $20,000, flow $104,460. Funeral: $2,115 / $2,500 / rehearsal $1,915. Veteran: $3,196 / $2,000. Name change: $0 / $39.96 / rehearsal "found $39.96". Household: $818 / $800. The hero renders `playbook.brief` (`topic.tsx:160-161`), which carries the invented world's totals with no label. The tile renders `value_usd` (`topic.tsx:188-191`). economics.basis is not parsed (`lib/playbooks.ts:43-54`). sources (`:501`) and caveat (`:522`) are parsed but rendered by no view (a grep over `scenes/` finds none). Grace C3 and Samira C2 never pass on a single pair.
2. **family-02 (major): The studio's first line tells the real person an invented story and invented app names.** `prompts.py:373-386` builds the opening from the playbook brief's first paragraph and the world's app names. Grace (a daughter) heard "A son paid for his veteran father's funeral" and "**$111,644** to handle". Samira (a niece) heard the same "son ... father" line. All ten pairs were asked "whether you use Docshelf / Hourquill / Ledgerline / IDway..." and the cards repeat those names as options. Seven of ten pairs had to correct at least one name (dumps `#turn:1`).
3. **family-03 (major): The approved brief states world facts as the person's own.** In household-employer-tax--samira the brief reads "Your nineteen-year-old son's wages, which are exempt", but her case says she has no son ("her brother-in-law's teenage son Tobias is not involved"). In estate-settlement--samira the brief reads "your CPA's disclaimer advice", but her case says "She hasn't hired a lawyer or accountant". Neither appears in her answers. `BRIEF_SYSTEM` asks for "no claim the slots do not support" (`prompts.py:117-121`), but the playbook it reads carries the world's household.
4. **family-04 (major): Briefs have no order, deadline or consequence section.** The brief schema is lead / setup / claim / left_alone only (`prompts.py:130-134`, `loop.py:496-497`). Samira C4 failed or stayed null on 5/5 pairs. Her cases carry hard dates that never reached a brief: estate disclaimer about 14 Nov, I-9 due 14 Oct (already late), first payroll 23 Oct (today), veteran deadline 25 Oct.
5. **family-05 (major): Gain and speed wording on bereavement chores.** Four of the five chores follow a death. The page says "Value", "158× faster" and "Traps avoided", and the rehearsal says "found $1,915". Grace C4 failed 4/5. The judges' "Exceeds" is refuted (see below), but the money and speed tiles carry the same tone (`topic.tsx:187-209`).
6. **family-06 (major): Time saved leaves out the person's review and is implausibly large.** See the table above: 95× once review is counted, not 158×, for estate. The review time is computed (`scenes/chores/model.ts:154`) but not rendered (`topic.tsx:196-202`).
7. **family-07 (major): Cards hold up to four questions and never say what Athena will read herself or what comes next.** `MAX_QUESTIONS = 4` (`prompts.py:43`, `loop.py:545-553`). Grace C2 failed 5/5 and C5 passed 1/5. Athena asked for facts sitting in papers the person had already named: county and state twice for Grace and three times for Samira (estate), and burial and death dates (veteran).
8. **family-08 (major): No line ever says when to see a professional.** Each playbook's caveat says it (estate: "an executor works with a probate lawyer"), but the caveat is never rendered (`lib/playbooks.ts:522`) and the brief schema has no slot for it. Samira C5 failed 4/5 and was null 1/5.
9. **family-09 (major): The rehearsal, labelled "shaped like your case", keeps the world's dates and deaths.** In estate-settlement--grace the rehearsal says "Ruth died Jan 15" and "disclaimer must reach Beacon by October 15", but Grace's mother died 6 Oct 2026. The same run says "born 2024-11-02 ... which makes her 81" and still files a $6,000 card marked "Right claim". In veteran-burial-benefits--samira the rehearsal says the deadline is "16 days from today" when hers is 2 days away, and calls her uncle "Dad". The label comes from `showcase.tsx:40` and the claim "a world shaped like yours" from `casepanel.tsx:290`.
10. **family-10 (major): Jargon on every screen.** Catalogue: benched, exceed the bar, Best edge (`model.ts:104`, `catalogue.tsx:38`). Topic: persona (`topic.tsx:191`), traps and on the bench (`:205-207`), world (`flow.tsx:118`, `topic.tsx:220`), brief (`topic.tsx:83`), and claims for non-claim jobs (`model.ts:130`). Studio and showcase: The brief / draft (`casepanel.tsx:265-268`), slot (`:163`), world (`:290`), rehearsal (`showcase.tsx:85,97`), cards (`showcase.tsx:56,104`), turn (`turn.tsx:41` "the run loop handed her their results"), "Fell for a trap" / "Right claim" (`modules/playbooks/model.ts:154-162`), and "What I'll claim" on funeral and name-change briefs (`loop.py:496`).
11. **family-11 (minor): "Found" money from a rehearsal that did not finish.** Both funeral rehearsals stopped before booking a home: the last turn reads "please switch me to the Greenmeadow tab", with 4 and 7 cards against 8 recorded. Both still show "$1,915 found in the rehearsal" (`showcase.tsx:113-119`) without saying the run stopped short.
12. **family-12 (minor): Slot tiles read as broken sentences.** For example: "Do you use Estate bank account for what came in and went out, the scheduled distribution, bill pay, or something else?" (dump `estate-settlement--grace` `adopt.slots`, rendered by `casepanel.tsx:139`).
13. **family-13 (minor): The fallback line "I'll read this during the run" becomes a portal name in the rehearsal.** `loop.py:361,371` writes it as a slot value. The portal map then swaps it into the trace's portal chip (`showcase.tsx:189`, dump `estate-settlement--grace` trace turns 15-16 and 23-24).
14. **family-14 (minor): "Start for real" does not say what happens on real accounts or where approvals will appear.** `showcase.tsx:138-141` says only "Hands the brief's command to Athena. It waits in her composer". The rehearsal's own spend ($3.71 and $3.63 on estate) is shown nowhere.
15. **family-15 (minor): A shaped rehearsal still shows scorer verdicts.** When rows changed, the header says "no dollar figure is claimed" (`showcase.tsx:110`), yet each card still reads "Right claim" (`turn.tsx:68-73`; estate-grace trace outcomes "correct").

### Chore-specific

- **family-16 (major) estate: The value is not plausible for either Character, and the hero counts a disclaimer as value.** $20,000 per estate rests on California statutory fees for a $1M estate (basis). Grace's estate is an $11,300 account plus a $64,000 IRA that passes outside probate. Samira's is $23,400 plus a $61,000 IRA. California's statutory fee on the probate part would be about 4% of the first $100k, roughly $450-$950 each for attorney and executor at these sizes (offline knowledge, Cal. Prob. Code §10810). The hero's "$111,644 handled rightly" includes a $93,200 disclaimer, which is money handed on to the next heirs, not value to the family. The basis cites "570 hours" while manual_minutes is 1,200 (20 h).
- **family-17 (minor, verdict uncertain: offline law) estate: One trap contradicts IRS guidance.** The trap reads "Taking the IRA's required distribution first, which would void the disclaimer that matters". Rev. Rul. 2005-36 holds that taking the year-of-death RMD does not by itself bar a qualified disclaimer of the rest; only the amount received is treated as accepted (offline knowledge). Separately, "debts paid in legal order, IRS first" is too simple. State priority statutes put administration and funeral costs ahead of taxes, and the federal priority (31 U.S.C. 3713) bites on insolvent estates (offline knowledge).
- **family-18 (minor) estate: No court record step.** Grace's senior bar is "a record the court accepts", but no step produces an inventory or accounting, and nothing covers Form 56, the final 1040 or the 1041 (offline knowledge).
- **family-19 (major) household: No check of past-year federal filings for someone who has never filed.** Samira's background is "has not filed anything". Rosalind has been paid since January at about $620 a week, far above the $3,000 threshold. The playbook leaves out W-2s and Schedule H because "this world does not hold" them (basis). No step names the EIN either. Her senior bar is "nothing that puts me on the wrong side of the IRS".
- **family-20 (minor) household: A late I-9 is promised as on time, and a dead employer is not flagged.** Samira's brief promises "Sign his I-9 Section 2 by his third business day". Her case puts that day at 14 Oct, nine days before the run date. Grace's mother, the employer, died on 6 Oct. The chore adopted the case without saying that the estate is now the employer, with final wages and a final W-2 to handle. The rehearsal "Felix, your son, 19 ... exempt" maps onto Grace's Anders, who is the decedent's grandson. The child-under-21 exemption covers the employer's own child, not a grandchild (offline knowledge, Pub 926).
- **family-21 (minor) name change: "$0" tile beside "$39.96 filed on the bench" and "found $39.96".** The basis explains $39.96 as a name-change kit price avoided, "not money recovered", but the UI calls it found.
- **family-22 (minor) name change: Load-bearing facts guessed, not asked.** Samira's brief carries three "(my guess)" facts that decide the plan: her Social Security record is updated, her passport is under a year old (so DS-5504 applies), and her husband took the name. None was asked. They match her case only because the world was built like it.
- **family-23 (major) veteran: The service-connected allowance is written off without checking presumptives.** The trap calls pancreatic cancer "unrelated". Pancreatic cancer is a PACT Act presumptive for Gulf War and post-9/11 burn-pit exposure (offline knowledge). Samira's uncle's service era is never read, and no step reads service dates or locations from the DD-214. Grace's father (Vietnam era, 1967-69) is likely not covered, but the chore should say why.
- **family-24 (minor) veteran: Never tells Samira she can claim as a niece.** Any person who paid the burial costs may claim (38 CFR 3.1702, offline knowledge). That is the good news she was afraid to ask about. Her brief also repeats "this Saturday, 25 Oct 2026", but 25 Oct 2026 is a Sunday (computed). A pro would say "file today, Friday".
- **family-25 (polish) veteran: The value is easy to misread.** "$2,000 per episode" is the same number as the $2,000 service-connected trap, while the cash actually owed is $978 + $978 = $1,956 plus a marker given in kind.
- **family-26 (minor) funeral: The value is set above its own bench world and above both cases.** value_usd $2,500 against world $2,115 (ratio 1.18). Rough savings from the case cards, signing the holding home's statement versus the cheapest corrected home: Grace about $1,400-1,800, Samira about $1,100-1,500 (computed approximately from the case-card prices). Samira's question "does Tobi have to sign too?" is a right-of-disposition rule many states set for the next of kin, and the playbook has no step for it (offline knowledge).

### Judge leads refuted or narrowed
- **"'Exceeds' on the page"** (5 Grace verdicts): refuted. `verdict.label` is rendered by no chores view; only the catalogue header's "N of M benched exceed the bar" (`scenes/chores/model.ts:104`) uses the word. The judges saw `numbers.json`, not the UI.
- **"The practice run is not labelled invented"** (funeral G and S, household S, name S, veteran S): refuted. `showcase.tsx:40` reads "Rehearsal on invented data shaped like your case - nothing was sent", and `:117` reads "found in the rehearsal, on invented data". The real defect is family-09: the label overclaims "shaped like your case".
- **"The rehearsal showed only a turn count"** (estate G, name G, veteran G): refuted. The Player plays every turn with what she said, read and filed (`showcase.tsx:148-235`, `turn.tsx`).
- **"Caregiver taxes and the name mismatch ignored"** (estate S, name S): by design. One chore covers one job; a cross-chore pointer would be a feature, not a defect in these briefs.

## Chore fixes (edits to the playbooks themselves)

**estate-settlement**
- economics: reprice per Character-size estate, or state the basis next to the tile. Drop "$93,200 disclaimer" from the "Handled rightly" total in `brief`; list the disclaimer as an act, not money. Evidence: the basis cites a $1M California estate; both case estates are under $100k in probate.
- traps: replace the RMD trap with "Disclaiming more than remains after a year-of-death RMD already taken (only the RMD itself is accepted)" (Rev. Rul. 2005-36). Reword "IRS first" to "in the order the state's statute and the federal priority set: administration and funeral first where the state says so".
- steps: add "Prepares the inventory and the accounting the court requires, from the ledger", plus Form 56, final 1040 and 1041 reminders, for Grace's senior bar.
- brief: open with a non-world lead ("Settles a parent's estate: finds what is owed to it, pays what it owes in order, files the disclaimer in time") so the studio opening stops reading "$111,644 to handle".

**funeral-price-check**
- economics: value_usd should not exceed the world's own $2,115. Consider about $1,500 with the basis stated.
- steps/traps: add "Checks who must sign the cremation authorization under the state's right-of-disposition order (all adult children in many states) before booking" and a trap "Booking with one sibling's signature where the state requires all".
- brief: drop "(my guess)" from the basic-services-fee line. It is the rule (16 CFR 453.4(b)(1)(ii)), and a guess reads as doubt.

**household-employer-tax**
- steps: add "Checks every prior year in which a worker passed the threshold for W-2s, W-3 and Schedule H not filed, and says the penalty exposure and that a household payroll service or CPA should file back years", plus "Confirms an EIN exists (Form SS-4) before any W-2".
- traps: add "Promising an I-9 'by the third business day' after it has passed: sign Section 2 now and note the late date".
- gate: add a stop when the employer has died ("the estate is now the employer; final wages and W-2 go out under the estate").
- economics: settle the unit. Either $818 per quarter with times_per_year 4, or a yearly figure that includes the January W-2 / Schedule H penalties the basis names.

**name-change-everywhere**
- economics: either show the $39.96 as "a $39.95 kit avoided" or keep $0 and stop the bench result reading "found". Today the tile says $0 beside "$39.96 filed".
- interview: mark the Social Security status, the passport issue date and the spouse's name choice as facts that must be asked, never defaulted. DS-5504 eligibility turns on the issue date (22 CFR 51.54).

**veteran-burial-benefits**
- steps: add "Reads service dates and locations on the DD-214 and checks the cause of death against VA's presumptive lists (PACT Act, Agent Orange) before ruling out the service-connected allowance".
- trap B-SC: reword to "...unless a presumptive (PACT Act) applies to his service".
- brief/promise: "Any person who paid may claim (38 CFR 3.1702): a son, a daughter, a niece".
- economics: show $1,956 cash plus the marker in kind, or explain why $2,000, so it does not collide with the $2,000 trap. Change the short persona from "son ... father" to "a family member who paid".

## What passed (protect these)
- **Ask-first gates land with both Characters.** C6 ("nothing filed without my approval") passed 10/10, and every brief states it in plain words.
- **Kind, short interview turns.** Grace's asides repeat "gentle", and no pair hit a round cap. All ten ended `clear` in 1-3 rounds with the brief approved.
- **Briefs reflect what was said, when it was said.** Grace's veteran brief (burial 9 Nov 2024, flat bronze only, hospice not VA care) and her name-change brief (estate account left alone) mirror her answers exactly.
- **The rehearsal says when no figure can be claimed** (`showcase.tsx:102-111`). Six of ten runs were shaped, and none put an invented dollar figure on screen.
- **Left-alone lists carry the field's traps right.** No funeral item may be required except the basic services fee (16 CFR 453), no medallion for an unmarked grave (38 CFR 38.630), no fee for a free filing (38 CFR 14.636), no second Social Security application, no paid passport form when DS-5504 applies.
- **Bench integrity.** 0 traps filed and 0 false claims across all five benches, and the bench result is labelled "on the bench" in the flow.
