# Chores UAT, L1 area walk: health

- **Category:** health (home: 7 chores, work: 7 chores) - 14 chores
- **Characters:** Maribel Santos (certified biller, work), Tom Whitcomb (practice administrator, work), Joel Martinez (family PPO, home), Nadia Haddad (chronic pain, low tech comfort, home)
- **Pairs:** 28 of 28 complete, 0 failed. Every onboarding ended `clear`, every brief approved, every rehearsal `done`.
- **Cost of the LC pairs:** $54.20 (sum of `cost_usd`), 108.7 min wall-clock.
- **Evidence:** LC dumps `proving-runs/chores-uat/2026-10-23-chores/pairs/<pair>.json`, numbers audit `numbers.json`, case cards `uat/chores/cases/`, and the desktop and daemon code cited by file:line. Judge findings were treated as leads and checked against the code. Four of them are refuted below.

## Headline

- **Honest numbers: 140 of 468 (30%)** across the 28 J7 walks (method below). On every chore the only honest numbers are the bench counts in the flow and the rehearsal line. Every dollar and time figure on the catalogue, the hero, the Value tile and "Make it yours" has no source next to it.
- **Judge criteria:** 46 pass, 77 fail, 45 not evaluable. That is **27% of all 168** and **37% of the 123 that could be judged**.
- **Adopt:** yes 0, maybe 28, no 0.
- **Worst chore: `ltc-claims`.** One topic page shows four dollar figures for the same job: Value **$20,000 a year**, hero **"Claimed for her mother - $26,410"**, flow **"Filed on the bench $5,252"** and, in Nadia's studio, **$15,425.20**. The bench verdict is **Falls short** (it found 20% of the value and 3 of 10 items), and no screen shows that verdict. The playbook also misses the benefit-trigger recertification that every tax-qualified long-term-care claim depends on.

### How numbers were counted (rubric units, applied to every chore the same way)

A Character meets these NUMBERS on one chore in J7:

| Surface | NUMBERs | Source shown next to it? |
| --- | --- | --- |
| Catalogue | value cell (1), hours by hand (1), time with Athena (1) | no (catalogue.tsx:106-130) |
| Topic hero | the playbook's own brief, `p.brief`, rendered as Markdown (k numbers, 1 to 6 per chore) | no (topic.tsx:160) |
| Topic KPIs | Value (1), hours by hand (1), time with Athena (1), "N× faster" (1), traps avoided (1) | only traps ("on the bench") (topic.tsx:189-214) |
| Flow | "walked past N of M traps" (1), result figure (1), "X of Y claims right" (1) | yes, "Filed on the bench" (flow.tsx:116-123) |
| Make it yours | "Worth $X <per> for <persona>" (1) | no (topic.tsx:246) |
| Studio rehearsal | "$X found ... on invented data" (1), or "N cards ... against M" (2) | yes (showcase.tsx:102-119) |

That gives 13+k or 14+k NUMBERS per pair, of which 5 or 6 are honest. In 4 chores (`ltc-claims`, `clinic-denials`, `overpayment-refunds`, `medical-bills`) the flow figure disagrees with the hero total for the same quantity, so one more NUMBER per pair fails the agreement test. Total: 148 - 8 = **140 honest of 468**. Excluded: the category totals line, which is not a per-chore figure.

## Scorecard

Jargon is counted in rubric words, distinct per screen, and is the same for every chore because the screens are shared. Catalogue: 4 (bench, benched, exceed the bar, edge). Topic: 6 (persona, trap, bench, world, turn, claim). Studio: 7 (card, brief, draft, rehearsal, world, turn, claim). Total: **17 per chore**.

| Chore | Honest (h/n) | Jargon | Ended (M/T or J/N) | Rehearsal (both) | Adopt | Judge pass (n=12) | Field reliability |
| --- | --- | --- | --- | --- | --- | --- | --- |
| abn-liability-sweep | 10/32 | 17 | clear / clear | $539 / $539 | maybe ×2 | 3 | sound |
| clinic-denials | 9/35 | 17 | clear / clear | $1,910 / shaped 9 vs 6 | maybe ×2 | 5 | issues |
| clinic-underpayments | 10/30 | 17 | clear / clear | $547 / $565 | maybe ×2 | 5 | sound |
| good-faith-estimates | 10/34 | 17 | clear / clear | $400 / $400 | maybe ×2 | 4 | sound (brief garbles timing) |
| hospital-financial-assistance | 10/34 | 17 | clear / clear | $7,560 / $7,560 | maybe ×2 | 2 | issues |
| ltc-claims | 9/29 | 17 | clear / clear | shaped 3 vs 3 / $15,425.20 | maybe ×2 | 3 | issues |
| medical-bills | 9/37 | 17 | clear / clear | shaped 8 vs 7 / $2,183.50 | maybe ×2 | 3 | issues |
| medical-records-gather | 11/33 | 17 | clear / clear | $342.50 / shaped 8 vs 7 | maybe ×2 | 2 | issues |
| observation-status-appeal | 10/36 | 17 | clear / clear | $10,200 / $10,200 | maybe ×2 | 2 | sound |
| out-of-network-claims | 11/35 | 17 | clear / clear | shaped 8 vs 6 / $921 | maybe ×2 | 4 | sound |
| overpayment-refunds | 9/35 | 17 | clear / clear | $866.08 / shaped 10 vs 8 | maybe ×2 | 3 | sound |
| part-d-exception | 11/29 | 17 | clear / clear | $799 / shaped 4 vs 3 | maybe ×2 | 3 | issues |
| prior-auth-renewals | 10/38 | 17 | clear / clear | $3,664 / $3,664 | maybe ×2 | 4 | sound |
| provider-revalidation | 11/31 | 17 | clear / clear | $1,200 / shaped 10 vs 10 | maybe ×2 | 3 | issues |

### Time saved, with the review counted (numbers.json, n = bench runs shown)

The topic page divides manual minutes by bench wall-clock only (`speedup()`, lib/playbooks.ts:591; `beforeAfterOf` passes `view.speed`, scenes/chores/model.ts:165). The review time is computed (`your review N min`, model.ts:153) and never rendered: topic.tsx:203 prints only `band.ratio`.

| Chore | Shown | With review | Bench runs | Author's manual minutes vs the Character's |
| --- | --- | --- | --- | --- |
| clinic-denials | 233× | 108× | 3 | 600 (Maribel 180, Tom 120) |
| medical-bills | 205× | 82× | 1 | 480 (Joel 180, Nadia 150) |
| medical-records-gather | 188× | 79× | 1 | 480 |
| observation-status-appeal | 128× | 83× | 1 | 240 |
| hospital-financial-assistance | 94× | 53× | 1 | 240 |
| ltc-claims | 75× | 57× | 3 | 360 |
| clinic-underpayments | 72× | 36× | 3 | 180 |
| part-d-exception | 71× | 38× | 1 | 120 |
| abn-liability-sweep | 46× | 22× | 3 | 150 |
| provider-revalidation | 46× | 16× | 1 | 120 |
| overpayment-refunds | 45× | 20× | 3 | 150 |
| prior-auth-renewals | 42× | 25× | 3 | 150 |
| out-of-network-claims | 32× | 18× | 1 | 120 |
| good-faith-estimates | 26× | 10× | 1 | 75 |

Neither column counts the person's onboarding (1 to 3 cards, plus reading the brief) or the 2 to 5 minutes the rehearsal runs. The bench runs on a portal world with no logins, timeouts or MFA. Two chores claim 8 to 10 hours by hand, which is 3 to 5 times what Joel, Nadia, Maribel and Tom each say a whole sitting of this work costs them.

## Character reviews (L1 over the designed screens, grounded in the LC dumps)

### Maribel Santos, certified biller (7 chores)

"I'll give it this: it didn't treat every denial the same. On the denials worklist it worked by reason code, left my two resubmitted claims alone and refused to guess Aetna's filing limit. That beats all three demos I sat through this year. On credit balances it understood that Medicare's money goes back to the MAC and a posting error is not a refund, and it let me own the identification date. That's the 60-day clock, and I won't let a tool set it.

What it gets wrong is how it talks about what it knows. My briefs carry 'my guess' next to things that aren't guesses. The ABN form changeover, an ABN signed after the draw, the 60-day rule: those are rules with a citation, and the playbook has the citation. Labelling them guesses makes me trust the rules less and trust its judgement less. On ABNs and good-faith estimates the whole interview was one card asking which apps I use, and two of the three names were wrong. Then it handed me five guesses to approve. Ask me about the late ABNs, not about Relaywave.

The money I can't use. '$50,400 a year, for the persona'. Which persona? Net of what my biller already reworks? The page then says $2,120 'recovered' while the run found $1,530, and the 'Falls short' verdict sits in a file nobody renders. The rehearsal says '$547 found, on invented data'. Good, it says invented. But it doesn't say 'of $565', so I can't see the $18 line it missed. On good-faith estimates the '$400 found' is eight acts priced at $50 each. That isn't money anyone recovered. And when I step through the run I see a card code and 'Right claim', never why. Would I adopt it? On a small batch, reading every card. Would I tell a peer? Not with those numbers on the screen."

### Tom Whitcomb, practice administrator (7 chores)

"The conversations were the easy part. Short, friendly, nobody made me feel stupid, and every brief promises she asks me before anything goes out. I can repeat that line to the doctors.

Almost nothing else on the page I could repeat. ABN, MUE, GZ, NCCI, sequestration, CMS-0057-F, '42 CFR 401.305', DMEPOS: none of them explained. I'm the guy who has to tell the owners. The number at the top of every chore is the same kind my vendor pitches: '$30,000 a year, for the persona', no source, '72× faster'. When I told her I didn't know something ('Dana knows', 'I don't know where the fax list is'), she wrote 'unknown' or 'my guess' and moved on. She didn't say 'ask Dana Monday' or 'it's on the payer's page'.

Then one thing actually worried me. My credit-balance brief says 'Return Medicare's $64.80 for an ECG not performed' and 'Refund three patients the $153.10'. I never said either, and neither is in our books as I described them. My revalidation brief claims a supplier enrollment I never mentioned. If I approve a brief, it should be about my clinic. The skip-and-explain list on prior auths is exactly what I need. Adopt? Maybe, with Dana checking. Take a number to the owners? No."

### Joel Martinez, family PPO (7 chores)

"Easy questions, I'll say that. It asked about the double payment, which is the refund I'm still chasing, and it never made me type in what's on the bills. Every brief says it asks before it disputes, pays or files. On observation status it went straight at the September stay and correctly left April and 2024 alone.

What I came for, one line per bill saying pay, dispute or wait and why, I didn't get. The rehearsal plays turn by turn, with a card code and a word like 'Right claim', but never the reason, and never one list I can hold up against my eleven bills. The words: EOB, deductible reset, guarantor, BFCC-QIO, superbill, 'third-party schedule'. Nobody explains them. The numbers: '$3,423 per episode', and the page tells me the family 'disputed, appealed or refunded $3,423'. That's somebody else's family. My hospital page says I'd save $6,000. My own bills are over $16,000, so I can't trace that either. On the charity-care chore it lists 'any account paid in full' as left alone. I paid one of those bills this year. Don't I get that back if we qualify? Would I adopt it? I'd try one chore. I wouldn't send anything until I'd seen the exact letter."

### Nadia Haddad, chronic pain, large text (7 chores)

"The cards were short and calm, and on the drug exception she asked about Dad's six days of pills. But I asked first thing how long setup takes, and nothing ever told me: not the page, not the studio. My cards held two, three, once four questions. I can't tell whether my answers survive if I stop halfway. I only see saved cases after I approve.

The money worries me most. '$2,400 a year' for Dad's drug, '188× faster' for my records, '$20,000 a year' and then '$26,410' and '$15,425.20' for the long-term-care claims. None of them says how sure it is. The rehearsal does say 'on invented data', which I appreciated once I found it. My records brief tells me to dispute the hospital 'down to the $6.50 flat fee'. Is that my hospital's fee, or the example's? And the charity-care brief says my son's wages don't count, as if it had read Saint Ardent's policy, when it has read nothing yet. The text was big enough everywhere I looked. Adopt? Maybe, a little at a time, once it tells me how long and lets me stop."

## Findings, ranked by impact (frequency × reachability × trust erosion)

Severity follows from impact: three highs make a blocker, two highs a major, one high or all mediums a minor, and anything else polish. The JSON carries every finding with its evidence.

### Category-wide themes

1. **health-03 (blocker): the hero states the answer key's totals as achievements and contradicts the run.** topic.tsx:160 renders `p.brief`, written as `**Claimed for her mother - $26,410:**` and `**Recovered - $2,120:**`. Those are the bench world's truth totals, with no "invented" or "example" label in the hero. The same page's flow says "Filed on the bench" $5,252 (ltc-claims, 3 of 10, verdict short) and $1,530 (clinic-denials, 6 of 10, short). `overpayment-refunds` says $866 against $838 found. `medical-bills` shows $3,423 in the hero and Value, but `usd(3423.5)` renders **$3,424** in the flow (whole dollars at 1,000 and above, lib/playbooks.ts:574-582). Four of 14 chores contradict themselves on one screen.
2. **health-02 (blocker): no dollar or time figure carries its source.** `economics.basis` is not parsed (the Economics interface at lib/playbooks.ts:43-54 has no basis; parse at :495-505). `economics.sources` is parsed (:501-504) and rendered nowhere: `grep sources scenes/chores` finds only the Portals list (flow.tsx:76). `caveat` is parsed (:522) and rendered nowhere outside fixtures. Every authored basis in this category except two says "An estimate" (numbers.json `basis_says_estimate`). Judges: Maribel c3 0/7, Tom c3 0/7, Joel c3 0/7, Nadia c4 0/7.
3. **health-01 (major): "(my guess)" sits on sourced law and on the person's own facts alike.** 65 tags across 28 briefs. The interview prompt files "a fact any public source answers (a rule, a rate) ... from the playbook with status guessed" (src/athena/adopt/prompts.py:95-96). The brief adds " (my guess)" to every slot not `confirmed` (loop.py:467, 479-487). So the 180-day appeal window, the 60-day overpayment rule, the 240-day assistance window, Part D's 24 and 72 hours and Medicare's seven-month revalidation window all read as guesses, even though each playbook cites the regulation. The guesses also reach the command (loop.py:467). This is the single most-cited trust complaint across the four Characters, raised in 24 of 28 judge verdicts.
4. **health-06 (major): briefs carry invented-world facts as the person's.** Tom's overpayment brief claims "$64.80 for an ECG not performed" and "three patients ... $153.10". Neither is in his case card (`uat/chores/cases/overpayment-refunds--tom.json`); both are bench-world amounts. Tom's revalidation brief claims "the clinic's supplier enrollment revalidation". DMEPOS is world-only, and Maribel's brief for the same chore correctly left it alone. Nadia's assistance brief states "Karim's grocery job wages are left out of your income", which is the invented policy's rule, before any policy was read. Nadia's records brief says "down to the $6.50 flat fee", the invented hospital's schedule. BRIEF_SYSTEM says "no claim the slots do not support" (prompts.py:117-120), but the legs also read the playbook brief and traps with their world amounts (prompts.py:214-227). **Instrument confound:** the case cards were written to mirror each world, so most leaks of this kind are invisible to this harness. The four above are the ones that slipped past the mirror.
5. **health-04 (major): the bench verdict and its sample size are computed and never shown.** `verdictOf` builds label, sentence, runs and `n=1` (modules/playbooks/model.ts:112-152). `grep "verdict\.(label|sentence|sample|runs)"` over scenes, components and modules finds 0 renderers. Two health chores fall short (`ltc-claims` at 20% of value, `clinic-denials` at 72%), and 8 of 14 have one bench run. The page shows them with the same confident Value tile as a chore that beat the bar. **Judge leads "the page says 'Falls short' / 'Exceeds (n=1)' with no explanation" are refuted as renderings.** The judges saw numbers.json. The real defect is the reverse: the honest hedge is hidden.
6. **health-07 (major): the rehearsal's "found" figure has no denominator, and sometimes it isn't money.** showcase.tsx:113-119 prints `usd(found_usd)` "found in the rehearsal, on invented data". The "invented" label is good, but the line lacks "of $X" and any missed items (Maribel's underpayments: $547 of $565). In 5 chores "found" is not money the person gains: `good-faith-estimates` $400 is 8 acts × $50, `provider-revalidation` $1,200 is 8 × $150, and `medical-records-gather` puts $240 of its $342.50 in such weights (all stated in each basis). `overpayment-refunds` $866 and `abn-liability-sweep` $187 of $539 are refunds paid out. **Judge leads "the rehearsal is not labelled invented" (19 rows) are refuted** at showcase.tsx:40 and :117.
7. **health-08 (major): items carry no reason, and there is no one list.** TraceTurn cards hold only `action, key, outcome, valueUsd` (lib/playbooks.ts:147). TurnView prints the key, the action and an outcome word (turn.tsx:63-75), with no "why". Joel's c4 (pay/dispute/wait with a reason) was not evaluable 6/7 and failed 1/7. Maribel's c5 (sorted with a reason) was not evaluable 7/7. The cards do exist turn by turn, so "no list at all" is refuted. "No consolidated list, no reasons" is confirmed.
8. **health-09 (major): app vocabulary on every screen.** Catalogue: "Best edge" (catalogue.tsx:38), "N of M benched exceed the bar · $X found on the bench" (model.ts:103-105). Topic: "for the persona" (topic.tsx:192), "Traps avoided ... on the bench" (:208-212), "on an invented portal world" (:220), "traps the world held" (flow.tsx:118), "Watch the run turn by turn" (:285). Studio: "Rehearsing on a world shaped like yours" (showcase.tsx:97), "draft N" (casepanel.tsx:271), "Hands the brief's command". **Health-specific collision:** the brief's heading **"What I'll claim"** sits on chores whose field term is a claim (insurance claims), so "What I'll claim: Ask for your duplicate $214.60 back" reads as a claim filing.
9. **health-10 (major): field acronyms go unexplained for the lay audience.** Tom's c2 7/7 fail, Joel's c2 7/7 fail. Promises and briefs carry ABN, MUE, GZ, EOB, NCCI, CARC, BFCC-QIO, CMS-0057-F, 42 CFR 401.305 and DMEPOS bare. Maribel's c2 passed 3/7. For a biller the terms are right. The defect is audience: one text serves both.
10. **health-16 (major): the catalogue row says what a chore does only on hover.** catalogue.tsx:87 puts the brief lead or promise in a `title` attribute. A non-technical person sees a short title, a job pill, "8h → 2m" and a dollar figure.
11. **health-05 (major): time saved leaves out the person.** See the table above. The ratio replaces the source line (topic.tsx:203), and the review minutes are computed but dropped.
12. **health-14 (minor): question cards offer the invented world's apps as defaults.** Mailnest, Carenook, Relaywave, Ledgerline, Chartleaf, Authwise, Faxline and Paylance. Characters typed corrections in about 19 of 28 pairs, and Maribel and Joel read it as "it doesn't know the real systems" (PECOS and CAQH ProView offered as "Enrollpoint" and "Credvault").
13. **health-17 (minor): the per-unit branches split.** month: Value $21,600 a year against "Worth $1,800 a month" on the same page (4 chores: abn-liability-sweep, clinic-denials, clinic-underpayments, prior-auth-renewals). episode: shown raw "per episode" and sorted against yearly figures (4 chores: hospital-financial-assistance, medical-bills, medical-records-gather, observation-status-appeal; `annualValue` default, model.ts:191-201). year: clean (6 chores). week, run and claim: no health chore uses them.
14. **health-11, -12, -13 (minor): Nadia's patience economics.** No setup duration anywhere (opening line prompts.py:385; c2 0/7). Resume exists only for approved cases (topic.tsx:268 "Last approved"; studio.tsx:216), with no resume for an interview closed before approval (c3 0/7 evaluable, needs L2). Cards held 2 to 4 questions (c5 1/7 pass). Text size passes at L1: the smallest text in chores.css and adopt.css is 12px (0.75rem at chores.css:950; 12px rules in adopt.css).
15. **health-15 (minor): an "I don't know" from Tom gets no pointer.** Tom's c5 passed 1/5 judged. The brief records "unknown; Dana's back Monday" and never says what document or person settles it.
16. **health-18 (major): two value figures are circular or gross.** `medical-bills` value_usd $3,423 is the bench world's own total ($3,423.50). Its basis says "Not an average; a typical shape" and never says "estimate". `clinic-denials` $4,200 a month is about 55% of all denials at $70k × 11% ≈ $7,700 a month, gross of what a part-time biller already reworks. Its basis also lacks "estimate", and it is exactly the "recovery figure that ignores what was going to be paid anyway" Maribel's pet peeves name.

### Chore-specific (field reliability; "offline knowledge" marks rules not checked against a live source in this pass)

- **health-19 part-d-exception (major):** no transition fill and no mid-year formulary-change protection. When a plan drops a drug a member is taking, CMS rules generally require a transition supply or continued coverage (42 CFR 423.120(b)(3) and (b)(5); offline knowledge). That is the immediate remedy for Nadia's "6 days left", and the playbook's steps and traps never mention it. The value is also suspect for her case: generic pregabalin is cheap at cash prices (offline knowledge), so $2,400 a year does not fit.
- **health-20 hospital-financial-assistance (major):** "any account ... paid in full" is left alone in both briefs. Under 501(r), a person found eligible during the 240-day window is owed a refund of what they paid above their eligible amount (26 CFR 1.501(r)-6, reasonable efforts once an application is complete; offline knowledge, verify the paragraph). Joel paid bills this year. Joel's brief also generalises the trap "an independent emergency physicians' group" into "outside physicians' groups ... left alone". Whether a group is covered is decided by the policy's provider list (1.501(r)-4), not by sharing a portal.
- **health-21 medical-records-gather (minor):** the $6.50 is HHS's *optional* flat fee for electronic copies, not a ceiling. The playbook's own source list includes "Is $6.50 the maximum? (no)". The playbook is right inside its world, where the hospital set $6.50. Nadia's real brief states "dispute ... down to the $6.50 flat fee". The correct real-world demand is a reasonable cost-based fee with no retrieval or per-page charge for an electronic copy.
- **health-22 ltc-claims (major):** the bench finds 20% of the value (3 of 10), and the steps omit the benefit-eligibility certification. A tax-qualified policy pays only while a licensed practitioner has certified 2 of 6 ADLs or a cognitive impairment within the last 12 months, under a plan of care (IRC 7702B; offline knowledge). That certification is the first thing a claims consultant checks before catching up months of claims.
- **health-23 clinic-denials (minor):** the hero's "A reconsideration citing the missed authorisation" is right only when the authorisation number was on the original claim. When the claim omitted it, the fix is a corrected claim (frequency code 7) with the number (offline knowledge). That is the exact distinction Maribel tests ("CO-197 is not an appeal"). The chore also falls short at 72%, unshown.
- **health-24 good-faith-estimates (minor):** the playbook basis states 45 CFR 149.610 correctly (within 1 or 3 business days *of scheduling*). Maribel's brief turned it into "due 1-3 business days *ahead*", the wrong direction, and marked it "(my guess)".
- **health-25 medical-bills (minor):** there is no step to request an itemized bill, and no check of hospital financial assistance before "pay only what you genuinely owe". A former hospital-billing advocate, Joel's senior bar, does both first, and Joel's case sits in both chores.
- **health-26 provider-revalidation (minor):** state Medicaid revalidation, DEA registration (3-year) and malpractice and board-certification dates are missing. A credentialing coordinator tracks all of them beside PECOS and CAQH (offline knowledge).

### Judge leads checked and refuted (kept in the JSON as `refuted`)

- "Rehearsal not labelled as invented" (19 judge rows): showcase.tsx:40, :117.
- "Page shows 'Falls short' / 'Exceeds (n=1)' unexplained" (8 rows): no renderer exists. The defect is the reverse (health-04).
- "No per-line items at all": cards render per turn (turn.tsx:63-75). Narrowed to health-08.
- "Asked for the PM system name and payers that are on the worklist" (Maribel, clinic-denials): partly refuted. Before any access, the app name is the one thing she cannot read. "Which payers do you bill" is readable, so the lead is narrowed to a minor effort point inside health-14.

## Chore fixes (edits to the playbook itself)

| Chore | Edit | Evidence |
| --- | --- | --- |
| all 14 | Rewrite each hero `brief` header as an example: "In the example practice: 15 denials, $2,120 recoverable; the last run recovered $1,530". Show the world total and the found figure together, never the total alone as achieved. | health-03 |
| all 14 | Give each `economics` a one-line `basis_short` the desktop renders under Value ("author's estimate: ~11% of $70k monthly collections denied, about half recoverable"), and render the existing `sources` as links. | health-02 |
| all 14 | Mark rule facts as `rule` with their citation, separate from case facts, so the brief prints "180 days to appeal (45 CFR 147.136)" and not "(my guess)". | health-01, prompts.py:95 |
| abn-liability-sweep | Split value into "billed rightly" and "refunded (owed back, not income)". Say in the left-alone list that a patient payment on a GZ or no-ABN line is refunded under 1842(l), so "left alone" means "not billed", not "ignored". | basis; Maribel's brief, "Lines with no ABN at all" |
| clinic-denials | Label the basis an estimate and net it of what the biller reworks today. Split "reconsideration citing the missed authorisation" into a corrected claim (auth omitted) and a reconsideration (auth on the claim, payer missed it). Add per-CARC treatment to the promise (CO-16 correct, CO-197 auth lookup, CO-29 proof of timely filing, CO-18 wait). | health-18, health-23, Maribel's c5 |
| clinic-underpayments | Add a trap or step: a Medicare Advantage 2% sequestration cut is passed through only if the contract allows it. Add state prompt-pay interest on late payments as a claim. | Tom's brief |
| good-faith-estimates | Phrase the timing as "within 1 business day of scheduling (3+ business days out) or 3 business days (10+ out)". Restate "$400 found" as "8 compliance acts done; priced at $50 each as an estimate". | health-24, health-07 |
| hospital-financial-assistance | Add the rule "a paid account inside its 240 days is still applied for, and the excess refunded". Replace "outside physicians' groups" with "providers the policy's list does not cover". Have the brief say that household and income rules come from the hospital's policy, read during the run. | health-20, health-06 |
| ltc-claims | Add step 0: confirm the benefit-trigger certification (2 of 6 ADLs or cognitive impairment, within 12 months) and the plan of care. Fix the persona or promise wording ("a parent", not "Mom") so it fits a father. Show the bench shortfall. | health-22, Nadia's judge row |
| medical-bills | Replace value_usd with a sourced estimate. Today it is the world's own total, and the basis must say "estimate". Add steps: request itemized bills, and check financial assistance before paying any hospital balance. | health-18, health-25 |
| medical-records-gather | Say "a reasonable cost-based fee; $6.50 only if that provider uses the flat fee" and keep $6.50 inside the world's text. Restate the $342.50 as $102.50 not owed plus 6 acts priced at $40. | health-21, health-07 |
| observation-status-appeal | Add a check on whether the hospital delivered the Change of Status Notice (CMS-10868) and the MOON. A missing notice strengthens the review request. | sources list; no step reads it |
| out-of-network-claims | Add a mental-health parity check (an allowed amount for out-of-network therapy far below comparable medical) as an appeal argument a patient advocate would raise (offline knowledge). | Joel's senior bar |
| overpayment-refunds | Title the value "returned or refunded on time (owed, not income)" and never "Value". | basis says "not money the practice recovers" |
| part-d-exception | Add a transition-fill and mid-year-formulary-change step before any exception, and a rule to ask for an expedited review when supply is under 7 days. | health-19 |
| prior-auth-renewals | Map each clock to its payer type in the brief (MA and Medicaid managed care 7 calendar days; employer 15 days; the invented fax-only payer's own term), never "7, 15 or 10 (my guess)". | Maribel's and Tom's briefs |
| provider-revalidation | Add Medicaid revalidation, DEA registration and malpractice certificate expiry. Make DMEPOS conditional on a confirmed enrollment in every brief. | health-26, health-06 |

## What passed (protect these)

- **Ask-first gates hold in 28 of 28 briefs.** Every brief says what she asks before. Criterion 1 ("I can say what it does and what it asks first") passed 26 of 28. Tom's c6 ("one line of what she never does without me") passed 6/7.
- **The interview refuses to invent deadlines the person flagged as unknown.** Aetna's filing limit, the 60-day identification dates, Joel's authority to file for Carmen ("Any filing until your right to file for Carmen is confirmed").
- **The left-alone lists are field-correct and specific:** pending resubmissions, 2024 stays past the retrospective window, the namesake born in 1958 or 1961, the spouse's chart, look-alike card-number notices, contingency advocates.
- **Benches avoided every trap:** 0 of 166 traps filed across the 14 benches, with no false claims.
- **The rehearsal says it is invented and claims no dollars when the shape broke the key** (showcase.tsx:102-119). That honest branch should become the model for the topic page.
- **Field rules in the playbooks are mostly current and cited:** 501(r) 240 days, the CMS-4204-F change-of-status appeal with its 2 January 2026 retrospective cutoff, the 2025 amendment to 42 CFR 401.305, CMS-0057-F scope, and Ciox v. Azar on third-party copies.
- **Text size:** no chores or studio text below 12px.
