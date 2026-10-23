# Chores UAT, L1 area walk: commerce

- **Category:** commerce · **chores:** 11 · **Characters:** hana (one-person handmade shop, medium tech), reggie (part-time finance at a small food brand, 175% zoom, high contrast)
- **Pairs:** 22 of 22 complete, 0 failed (dumps `proving-runs/chores-uat/2026-10-23-chores/pairs/*--{hana,reggie}.json`); **cost of those pairs $43.75**
- **Journeys:** J7 (onboarding) and J8 (in use), walked over the code: catalogue.tsx, topic.tsx, flow.tsx, adopt/studio.tsx + casepanel.tsx + card.tsx, adopt/showcase.tsx, turn.tsx, modules/playbooks/model.ts, lib/playbooks.ts, daemon adopt/prompts.py, loop.py, showcase.py
- **Units:** `uat/rubric.md` "Chores: honesty and comprehension units". **Severity rule:** derived from impact, by the number of `high` among frequency, reachability and trust_erosion: 3 = blocker, 2 = major, 1 = minor, 0 = polish.
- **L1 verdict:** J7 **L1-conditional** (the flow completes in every pair; the number layer has blockers). J8 **L1-conditional** (Start for real hands off; the result view has no itemised list).

## Headline figures

| measure | value |
|---|---|
| honest NUMBERS / all NUMBERS (J7 path, 22 pairs) | **113 / 365 = 31%** |
| judge criteria pass rate | 39 pass / 84 evaluable = **46%** (39 / 132 = 30% counting the 48 null) |
| adopt | yes 0 · **maybe 22** · no 0 |
| onboarding ended | clear 22 / 22, 1 to 3 rounds, at most 4 messages from the person |
| rehearsal | done 22 / 22: 19 show a dollar figure, 3 `shaped` (no dollar figure) |
| distinct JARGON words met on the J7 path | 14 (13 for fba, where "claim" is the field's own word) |

**How the NUMBER count was taken.** These are the slots every chore shows the same way. Catalogue row: time by hand, time with Athena, value (3). Topic page: the Value tile, by-hand minutes, Athena minutes, the speed ratio, traps avoided (5). Flow: the traps note, the result figure, the result line (3). "Worth $X" in Make it yours (1). Then the case figures in the hero brief (2 to 6 per chore) and the showcase result (1, or 2 when shaped). The honest ones are the four bench-sourced slots (traps avoided, the traps note, the result figure, the result line: each says "on the bench" and they agree with each other) plus the showcase result, which says "found in the rehearsal, on invented data" (showcase.tsx:113-119). Every other slot fails the rubric:
- The Value figure, its "Worth" twin and both catalogue time cells carry no source.
- The by-hand minutes carry no source: `band.manual.line` is built but not rendered.
- The Athena minutes and the "N× faster" leave out the person's review.
- The hero-brief figures never say they belong to an invented example.

Arithmetic per pair: n = 12 + brief figures + showcase figures; h = 4 + showcase figures.

## Scorecard

| chore | honest numbers (h/n per pair) | jargon met | onboarding ended (H / R) | rehearsal (H / R) | adopt (H / R) | judge pass (both, of evaluable) | field reliability |
|---|---|---|---|---|---|---|---|
| chargeback-representment | 5/16 · 5/16 | 14 | clear r3 / clear r1 | $957, 7 of 7 cards / $957, 7 of 7 | maybe / maybe | 3/8 | **issues**: small-order economics |
| counterfeit-takedowns | 5/17 · 5/17 | 14 | clear r1 / clear r2 | $11,030 / $11,030 | maybe / maybe | 5/8 | sound (the value is the copier's sales) |
| cpg-deductions | 5/16 · 5/16 | 14 | clear r2 / clear r2 | $10,882, 8 v 7 / $7,380, 4 v 7 | maybe / maybe | 3/8 | **issues**: wrong fit for a Faire maker |
| fba-reimbursements | 5/15 · 6/16 | 13 | clear r2 / clear r2 | $359.78 / shaped, 6 v 5 cards | maybe / maybe | 4/7 | **issues**: no basis; self-made goods |
| food-recall-trace | 5/15 · 5/15 | 14 | clear r2 / clear r2 | $20,000 / $17,500, 7 v 8 | maybe / maybe | 3/8 | **issues**: no consumer-level path; invented $ |
| gpsr-listings | 5/16 · 5/16 | 14 | clear r2 / clear r2 | $7,100 / $7,100 | maybe / maybe | 3/8 | **issues**: maker case missed |
| merchant-fee-audit | 5/17 · 5/17 | 14 | clear r2 / clear r2 | $118 / $118 | maybe / maybe | 4/8 | sound (value overstated) |
| mlc-unmatched-royalties | 5/16 · 5/16 | 14 | clear r3 / clear r2 | $1,339 / $1,339 | maybe / maybe | 3/6 | sound (value implausible for a small catalogue) |
| organic-annual-update | 5/19 · 6/20 | 14 | clear r2 / clear r2 | $600 / shaped, 8 v 8 | maybe / maybe | 4/7 | **issues**: late change notice |
| sales-tax-exemption-certs | 6/19 · 5/18 | 14 | clear r2 / clear r2 | shaped, 8 v 9 / $4,250 | maybe / maybe | 4/8 | **issues**: no nexus check |
| trademark-maintenance | 5/16 · 5/16 | 14 | clear r2 / clear r2 | $45,500 / $45,500 | maybe / maybe | 3/8 | sound (§15 not offered) |

Judge per criterion:
- **hana:** C1 fit 1/11 · C2 can restate 11/11 · C3 every dollar sourced 0/11 · C4 nothing asked that could be looked up 5/11 · C5 at most 8 messages 11/11 · C6 drafted replies null 11/11.
- **reggie:** C1 zoom null 11/11 · C2 lines add up 0 pass (10 fail, 1 null) · C3 practice not shown as real money 0 pass (8 fail, 3 null) · C4 can restate 11/11 · C5 and C6 null 11/11.

## Hana Kowalczyk: my review of the commerce chores

"Okay. Eleven chores, and every one of them I could answer in two or three cards from memory. That part is honestly great. Nobody made me download a report, and I never typed more than four messages. And every brief says she asks me before she sends anything. After that template app burned me, that's the line I actually read.

"But the first thing I asked, every single time, was 'is this even for a shop my size?' I got an answer once, sort of, on the knock-off one, because the example was a little linen brand like mine. The others? The deductions page is about a $4M brand selling through UNFI and KeHE. I sell $3,800 a month to boutiques. It still says **$60,000 a year**. The tax one says **$15,000 a year**, and my Ohio letter is about three orders worth $2,715. That's maybe two hundred dollars of tax. The disputes page says $8,000 a year, and my disputes are forty-dollar orders. I don't think I *sell* $8,000 a year in disputed orders. So when a page shows me a big number with 'for the persona' under it, I stop trusting the rest of the page. What's a persona? Oh, the merchant-fee page's example is literally 'a small online ceramics shop in Oregon'. That's me! But I only found that out in a sentence way down by the button.

"The practice runs: it does say 'on invented data' in small grey letters next to a big **$45,500**. For my trademarks, that number turns out to be *sales*, not money anyone found. That's misleading even if it's labelled.

"The questions kept offering me apps that don't exist, like Paycurrent, Binderwell and Postwren, so I kept typing 'not those'. The briefs are full of '(my guess)' and nobody tells me who checks the guess.

"What's missing for MY job: for the EU safety one, I *make* my mugs. I'm the maker outside the EU, so I'm the one who needs that EU contact person, and she asked me about 'makers whose goods you resell'. For the recall, I sell jars straight to people on my own site, and nothing talks about telling them. For the Ohio letter, nobody asked whether I even have to collect Ohio tax at my size.

"Would I adopt? Maybe. The fee check and the disputes, yes, if the page says up front 'for shops doing a few disputes a month, here is what that's worth to you'. Would I tell another maker? I'd tell her the conversation is easy and to ignore the dollar numbers."

## Reggie Banks: my review of the commerce chores

"I read it line by line, as I always do. The conversation was good. Short questions, plain multiple choice, nothing I had to scroll sideways to read. Every brief repeats back what I told it: the September 10 against September 15 price change, the two lots either side of the recall, the Greenlane licence, Kessler Cashew on its own line with its reason. It says it asks before every dispute, hold or filing. I can tell the founder what each chore will do. That much passes, eleven out of eleven.

"Then I want the lines, and I don't get them the way I need them. The practice result gives me one large figure, $7,380 or $45,500, in big type. The lines are there, but they're scattered across a dozen turns that move on by themselves every three seconds, each card a code like UN-88411 with an outcome word. Nowhere is there a list of the items with a total at the bottom. If the total is right, the lines will add up. Show me the lines. The words 'on invented data' are there, in grey, in a smaller size than the figure. Grey on my screen is the first thing I lose.

"Then the page. **$60,000 a year**, **$15,000 a year**, **$5,000 a year**, with nothing under them. The 'Time saved' tile says 4 hours goes to 2 minutes, 145 times faster. That counts the machine and not the hour I'll spend checking every line before I sign. On the trademark page the value says $5,000 a year and the practice says it found $45,500. Those two can't both be what the brand gets. Nobody explains which is which.

"Would I adopt it? Maybe. The deductions one, after a month of watching it on our own short-pays, if every disputed line shows the deduction, the deal sheet it was checked against and the decision, in one list I can total. Would I tell a peer? I'd tell him the interview is the best part and the arithmetic is the worst."

## Findings, ranked by impact

Category-wide themes first, then chore-specific findings. The full rows, with evidence, are in `findings-commerce.json`.

### Category-wide

1. **commerce-01: blocker, trust. The headline value has no source on any screen.**
   - The Value tile (topic.tsx:188-192), the catalogue value cell (catalogue.tsx:121-133) and "Worth $X" (topic.tsx:246) show the authored `value_usd` with only "for the persona" beside it.
   - `economics.basis` is not parsed: the parse at lib/playbooks.ts:494-503 has no `basis` field. That is confirmed, and the scouts' hypothesis holds.
   - `economics.sources` is parsed (lib/playbooks.ts:501) and `caveat` too (:522), but a grep over `src/` finds no view that reads either. Both are present-but-unwired.
   - 10 of 11 commerce playbooks carry a careful, dated basis (fba carries none) that nobody sees. Every pair failed hana C3 or reggie C2 on this.
2. **commerce-02: blocker, trust. The authored values do not fit a one-person shop, by the playbooks' own arithmetic.** Computed against the case cards:
   - **cpg-deductions:** Hana has $3,800/mo wholesale = $45,600/yr. At the basis's own 1.2 to 2.4% written off, that is **$547 to $1,094 against $60,000 shown (55 to 110×)**.
   - **sales-tax-exemption-certs:** the Ohio letter covers $1,240 + $860 + $615 = $2,715 of sales, about $197 at 7.25%. The page shows **$15,000 a year (about 76×)**.
   - **chargeback-representment:** Hana has ten open disputes in the busy season, mostly $40 orders. $8,000 a year is more than her likely total disputed volume (about 40 × $40 = $1,600/yr, an estimate).
   - **merchant-fee-audit:** the world holds $118 over three statements, which is $472/yr. The page says **$4,000 (8.5× its own bench)**.
   - **fba-reimbursements:** at the playbook's own source of 1 to 3% unreimbursed, Hana's $40k FBA gives $400 to $1,200 and Reggie's $140k gives $1,400 to $4,200, against $5,000.
3. **commerce-03: blocker, trust. "Found" and "Filed" are used for figures that are not money.**
   - The showcase says "found in the rehearsal" (showcase.tsx:115-118), the flow says "Filed on the bench" (flow.tsx:121) and the catalogue says "$X found on the bench" (model.ts:105).
   - Six of 11 commerce truths value something other than recovered money:
     - trademark: annual sales under the registrations, $45,500, which the basis itself calls "protection, not money recovered"
     - food recall: eight acts weighted $2,500 each
     - organic: $75 per item, a certifier's hourly rate
     - counterfeit and gpsr: 90 days of listing sales
     - sales tax: tax exposure avoided
   - So trademark-maintenance shows **$5,000 a year** as Value and **"found $45,500"** in the practice run, a ratio of 0.11. Both Characters read the $45,500 as money.
4. **commerce-05: major, time-saved. "N× faster" leaves out the person's review, and the code that says so is not wired.**
   - The tile renders `band.ratio` = manual ÷ bench wall-clock (topic.tsx:202, lib/playbooks.ts:591).
   - `beforeAfterOf` builds a line "your review N min · turns · $ of model time" (model.ts:152-158, 164), but topic.tsx:193-203 never renders `band.athena.line`, and `band.manual.line` (the incumbent) is not rendered either.
   - With review counted, the ratios are: chargeback 55× → 24×, organic 145× → 42×, sales-tax 69× → 22×.
   - The Characters themselves expect 20 min (Hana) and 45 min (Reggie) with the app, against "2 to 4 min" on every tile.
5. **commerce-06: major, clarity. The fit question is never answered.**
   - Hana opened 11 of 11 conversations asking whether the chore fits her size, and failed C1 in 10 of 11.
   - The interviewer's rules (prompts.py:49-79) never tell it to answer a direct question, and its only free text is "one short line before the card".
   - The playbook schema has no who-it's-for or size field.
   - The persona (the example's business) reaches the screen only inside the "Worth $X for …" sentence at topic.tsx:246. For merchant-fee-audit that persona is literally a small Oregon ceramics shop, so the answer is there but below the fold (present-but-missed).
6. **commerce-07: major, confusion. The topic hero is someone else's business with no "example" label.**
   - `p.brief` is rendered as the hero (topic.tsx:160-161), e.g. "A $4M natural-foods snack brand…", "A Vermont outdoor brand keeps twelve trademark registrations…". It is not marked as an invented example.
   - The only invented-data note is far below, in the gallery: "Real screens of the bench run, on an invented portal world" (topic.tsx:220).
   - Judges flagged "describes a different business" in cpg, counterfeit (Reggie), organic, trademark and gpsr.
7. **commerce-08: major, effort. The first question card offers the playbook's invented apps as answers.**
   - `playbook_block` lists the apps without saying they are invented (prompts.py:217-224), and the interviewer is told to give app names as options (prompts.py:58).
   - 18 of 22 first cards offered names like Paycurrent, Binderwell, Postwren, Storeline or Markwick. About 22 of 66 round-1 answers had to type a correction ("Not those", "None of those fit").
8. **commerce-10: major, trust/missing. The practice result has no itemised list that adds up to its total.**
   - The figure is 40px (adopt.css:880-884). The lines exist only as per-turn cards (turn.tsx), showing a code, the action, an outcome word and a value, inside a player that auto-advances every 2.8 s (replay.tsx:35).
   - This is the judges' "no lines at all" partly refuted (present-but-missed), and confirmed as a quality gap: Reggie's C2 and C5 cannot pass on any chore.
9. **commerce-13: major, clarity. 14 internal words on the J7 path.**
   - Catalogue: bench, benched, exceed the bar, edge (totals line model.ts:104-105, sort "Best edge" catalogue.tsx:38).
   - Topic: persona, trap, bench, world, claim, turn (topic.tsx:191, 205-207, 220, 286; flow.tsx:118-123).
   - Studio: brief, draft, slot, world, rehearsal, plus "What I'll claim" in every brief (casepanel.tsx:268-292, 163; loop.py:496).
   - Showcase: rehearsal, world, card, turn, claim and trap, in the outcome words "Right claim" and "Fell for a trap" (showcase.tsx:39-40, 56, 96; model.ts OUTCOME_WORDS).
10. **commerce-09: minor, trust.** Every approved brief carries "(my guess)" lines (loop.py:467-485), often public rules or fees. The studio says only "Still her guess: …" and never who checks a guess, or when. In trademark-reggie, the USPTO fees in a sworn filing are "my guess", though the playbook's basis cites 37 CFR 2.6(a) fees exactly.
11. **commerce-04: major, trust.** The catalogue totals line "$X found on the bench" (model.ts:100-108) sums `valueFoundUsd` across meanings. Commerce alone contributes $102,136, of which $88,480 (87%) is sales protected, exposure avoided or weighted acts.
12. **commerce-12: minor.** "55× faster" rests on one run (`bench_runs_n` = 1 for 10 of 11; cpg has 3), and nothing says so. `verdict.sample`/`runs` are computed (modules/playbooks/model.ts:126-130) but rendered nowhere. (The judges' "Exceeds (n=1) on the page" is refuted: see commerce-11b.)
13. **commerce-14: minor, clarity.** The catalogue row names the example's specifics, e.g. "Recalled almond butter traced to every customer" (food-recall-trace short_title). A peanut or flour recall does not look like a fit.
14. **commerce-15: minor.** food-recall-trace's $20,000 "per episode" is sorted raw against yearly values under "Most value": `annualValue` defaults to v (modules/playbooks/model.ts:191-201, 172).

The other branches of the `per` mapping are clean for commerce: 10 of 11 are `year` (tile and "Worth" agree), and `month`, `week`, `run` and `claim` are unused here.

15. **commerce-16: polish.** In the showcase, the turn dots mark "has cards" by styling only (`data-cards`, showcase.tsx Player). This touches Reggie's C6. Everything else in J7 pairs its colour with a word: StatusDot + outcome word, and the gate diamond + "Athena asks you first".
16. **commerce-17: uncertain, effort.** Hana's C4 failed in 6 of 11 pairs, on questions she felt Athena could read herself: which marketplaces her disputes came from, where Faire shows payouts, which listings ship to the EU, which makers are EU-based. The first card's portal questions are by design: research cannot read an app it has not been told about. The round-2 questions about facts inside connected files are a lead for L2.

### Chore-specific (the chores themselves)

- **commerce-20: fba-reimbursements, major.** There is no `economics.basis` at all (numbers.json quirk). The brief accepted Hana's "count in my head, no packing list" and "$6.80 by my own reckoning" with no warning. A senior FBA bookkeeper would say short-receipt cases need a packing list or invoice, and that self-made goods need proof of cost (dump fba--hana brief).
- **commerce-21: food-recall-trace, major.** The world has B2B accounts only. Hana sells jars direct on Shopify, and nothing handles consumer-level notice (21 CFR 7.42(b)(1), cited in the basis) or notifying a regulator (offline knowledge: Reportable Food Registry / FDA district). The $20,000 is eight invented $2,500 weights, shown as "found $20,000".
- **commerce-22: gpsr-listings, major.** The answer key is shaped for a reseller. Hana *makes* her goods, outside the EU, so under GPSR she herself needs an EU-based responsible economic operator. Athena asked "Are any of the makers whose goods you resell based in the EU?" (dump gpsr--hana#turn:2), and the brief promises to "Add an EU responsible person … from your Drive files", which no file can supply. Ceramic mugs are also food-contact articles, under separate EU rules (offline knowledge).
- **commerce-23: organic-annual-update, major.** Hana moved blending to a shared kitchen in March, and the brief reports it in the November update. A certification pro would say a new handling site has to be notified when it happens, not saved for the annual update (offline knowledge: 7 CFR 205.400(f)(2)). Nobody asked whether she is the importer of record for her Egyptian, South African, Sri Lankan and Indian ingredients. The NOP Import Certificate duty (205.273) falls on whoever imports them.
- **commerce-24: sales-tax-exemption-certs, major.** Hana is an Oregon seller with three Ohio wholesale sales ($2,715). The chore answers Ohio without first asking whether she is registered there, or above Ohio's economic-nexus threshold (offline knowledge: $100,000 of sales; verify). Value is $15,000 a year against about $197 at stake.
- **commerce-18: chargeback-representment, minor.** Acceptances are valued at "the $25 fee each avoids". With most processors the dispute fee is charged whether you accept or contest, and some add a fee to contest (offline knowledge, verify per processor). For $40 orders, the economics a senior bookkeeper would show are win probability × order minus contest cost. The Visa CE 3.0 rule text (two prior transactions 120 to 365 days old, device or IP plus one more element) is correct.
- **commerce-19: cpg-deductions, minor.** The chore is built for UNFI and KeHE. Hana's case (Faire + a regional gift distributor) left Faire's "dispute window" as "(my guess)". Faire charges commission and handles returns; it does not take distributor-style deductions (offline knowledge). The fit statement should say: brands selling through grocery distributors.
- **commerce-25: merchant-fee-audit, minor.** The value is overstated (see 02). The Regulation II figures in the basis (21¢ + 5 bp + 1¢) are correct (offline knowledge). Sound.
- **commerce-26: mlc-unmatched-royalties, minor.** $1,500 a year for "two small records I mostly forgot" needs on the order of a million or more US streams a year at mechanical rates (offline estimate). Hana left a song out because nobody explained what a handshake label deal means for her share (dump mlc--hana#turn:3).
- **commerce-27: trademark-maintenance, minor.** The fees and windows are right: §8 between years 5 and 6, $325 per class, a $100 grace surcharge, $250 to delete goods (offline knowledge, 2025 USPTO schedule). The chore does not offer the combined §8 + §15 declaration that a docketing paralegal files at year 5 to 6. The headline mismatch ($5,000 a year against $45,500 found) is commerce-03.
- **commerce-28: counterfeit-takedowns, minor.** The value counts the copier's 90-day listing sales as if they were the brand's (the basis says so). There is no step for a counter-notice under 512(g) (offline knowledge).

### Judge leads checked and refuted

- **commerce-11a: refuted. "The rehearsal is not labelled as invented".**
  - The showcase labels it twice: "Rehearsal on invented data shaped like your case — nothing was sent" (showcase.tsx:39-40) and "found in the rehearsal, on invented data" (:117). Shaped worlds claim no dollar figure (:105-112).
  - The judge saw a summary line, not the UI. Residual (minor): the label is 14px muted grey (`ad-note`, adopt.css:104-108) beside a 40px figure.
- **commerce-11b: refuted. "'Exceeds (n=1)' on the page".** `verdict.label`, `.sentence`, `.sample` and `.runs` are rendered by no chores view: a grep in `scenes/` finds nothing. The judges read numbers.json. What *is* rendered is "N× faster" (topic.tsx:202).

## Chore fixes (edits to the playbooks themselves)

| chore | edit | evidence |
|---|---|---|
| all 11 | Add a `fit` line ("for shops with a few disputes a month; worth little under N") and an `example` label on `brief`. Write `value_usd` for the stated fit band, and state per-unit economics ($ per dispute, % of wholesale revenue) the person can multiply. | commerce-02, -06, -07 |
| all 11 | Add `value_kind`: recovered · exposure avoided · sales protected · weighted. The UI then says "protected", not "found", for six of 11. | commerce-03 |
| chargeback-representment | Value acceptances at contest cost avoided, not a flat $25. Add a small-order rule: contest only where win odds × amount beats the contest fee. Lower `value_usd`, or express it per dispute. | basis; commerce-18 |
| counterfeit-takedowns | Restate the value as margin on recaptured sales, not the copier's listing sales. Add a counter-notice (512(g)) follow-up step. | basis; commerce-28 |
| cpg-deductions | Fit: grocery-distributor brands (UNFI/KeHE). Value: 1.2 to 2.4% of distributor revenue with the brand's revenue as the input. Re-verify both windows against the portals' current terms. | basis; commerce-19 |
| fba-reimbursements | Write the missing `economics.basis`. Add rules: no case without an invoice or packing list; proof of cost for self-made goods. | numbers.json quirk; commerce-20 |
| food-recall-trace | Add a consumer-notice path for direct-to-consumer sellers and a regulator-notice decision. Drop the $2,500 weights from "found", or relabel them "cost avoided (estimate)". Rename to "Recalled ingredient traced to every customer". | commerce-21, -14 |
| gpsr-listings | Add the maker-outside-the-EU case: the person must appoint a responsible person (a gate, not a fill). Add a food-contact rule for ceramics and glassware. Value: EU share of sales. | commerce-22 |
| merchant-fee-audit | Value from its own world: about $470/yr at this shop's size, or a % of card volume. | commerce-02 |
| mlc-unmatched-royalties | Value per 100k US streams. Add a rule for informal label deals (ask, explain, do not drop silently). | commerce-26 |
| organic-annual-update | Add a rule and a trap: a site or supplier change should already have been notified; flag a late one. Ask for the importer of record before logging NOP Import Certificates. | commerce-23 |
| sales-tax-exemption-certs | First step: confirm registration or nexus in the requesting state. Value per $ of exempt sales, with a small-seller band. | commerce-24 |
| trademark-maintenance | Offer §15 with §8 where eligible. Say the $45,500 is sales protected. Mark fees as researched public figures, never "(my guess)". | commerce-27, -09 |

## What passed (protect these)

- **Gates held everywhere.** All 22 briefs say Athena asks before every dispute, filing, hold, notice or registration. Both Characters named this as the reason they would try it (dumps, judge voice in all 22).
- **Short, clear onboarding.** 22 of 22 ended `clear` in 1 to 3 rounds. Hana C5 passed 11/11 and C2 11/11; Reggie C4 passed 11/11. The `understood` lines match the briefs.
- **Briefs carry the person's specifics.** For example: Reggie's Sept 10 / Sept 15 price issue (cpg), lots 0411 and 0419 left alone (food), Greenlane's licence (counterfeit), Kessler Cashew on its own line (organic); Hana's unshipped Fern & Fig order and the C-1002 rework (food).
- **The showcase's honesty machinery works.** It names the rehearsal as invented, and it refuses a dollar figure when the shape changed the answer key (fba-reggie, organic-reggie, sales-tax-hana), saying cards against recorded cards instead (showcase.tsx:105-112, showcase.py:575-584).
- **The rule citations in the playbooks are precise and dated** (Visa CE 3.0, Reg II, 37 CFR 2.6 fees, SSUTA §317, 7 CFR 205.406). They only need to reach the screen (commerce-01).
- **Type size.** No chores text is under 12px (chores.css and adopt.css minimum 12px), so Reggie's C1 font floor passes at L1. Sideways scroll at 175% is an L2 check.
