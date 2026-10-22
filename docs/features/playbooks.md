# Playbooks and the bench

`playbooks/<id>/`, `src/athena/proving/playbooks/`, the desktop's Playbooks module. README §14;
ADR 0040.

A playbook is a chore worth real money that only an agent living in the person's own tabs can do:
it spans portals no integration reaches and ends in something irreversible that wants a signature.
Each one is data, and earns its place on the desktop by a run on the bench.

## The files

| File | Contents |
|---|---|
| `playbook.json` | the showcase: persona, chore, the command the person gives, portals, gates, traps, memory, economics with sources, edge scores, audience (home or work), its area and its job (`category`, `job`), a `short_title` (at most 48 characters) and a `brief` in simple markdown (a lead line, a bold label with bullets, "Left alone" bullets) that the catalogue and topic page show instead of the long title and promise, the expectation it is held to, lessons, a caveat |
| `world.json` | the portals as data: apps with origins, views, aliases and tools with honest flags; tables the reads answer from (exact, `contains` or `words` matching, paging, required ids); the phases of a run |
| `truth.json` | what a perfect run files and what looks eligible but is not, per tool: eligible items with value and expected parameters (an item can be `required`), traps with the reason, fair-either-way items; only the scorer reads it |
| `bench.json` | the latest measured run, committed: score, cards, the trap ledger, the turn-by-turn trace, closing words and every earlier run's headline |
| `evidence.json`, `thumb.jpg` | the film's index and its still, written by `evidence` (below) |
| `followthrough.json`, `followthrough.runs.json` | the follow-through overlay (what a signed action does to the tables, session 2's observations and phases) and its append-only results; `freelancer-receivables` only (below) |

One file sits beside the directories and belongs to the whole library: `playbooks/taxonomy.json`,
the areas and jobs a playbook may name (below).

```bash
uv run python -m athena.proving.playbooks check          # every playbook loads; fails on a missing or unknown category or job (ADR 0096), a read the cap would cut, <2 portals, <8 traps, no times_per_year (ADR 0057 rule 1; not the nine older ones), a per outside ADR 0056's table, or $0 with no weighted truth
uv run python -m athena.proving.playbooks bench <id> --model sonnet --cap 8 --note "what changed"
uv run python -m athena.proving.playbooks bench <id> --runs 3   # three fresh worlds, every run kept (ADR 0128)
uv run python -m athena.proving.playbooks rescore <id> proving-runs/<ts>/playbook-<id>/report.json
```

Every run carries a comparability key (ADR [0128](../adr/0128-a-playbook-is-ranked-on-its-comparable-runs-and-a-rescore-appends.md)):
a hash of `world.json`, `truth.json`, the command, the expectation, the scorer's `SCORER_VERSION`,
the engine, the model and the approval mode. A rescore writes `report.rescored-<stamp>.json` beside
the run's report and appends the original score to `bench.json`'s history as a correction.

## Follow-through

The bench measures what she proposes; `followthrough` measures what she does with the answers
(ADR [0129](../adr/0129-follow-through-is-proved-across-an-answer-a-restart-and-a-second-run.md)).
Session 1 is the bench's run loop under one `proj_` id, each card answered through the decision
route by the branch alone (`approve`, `decline`, or `lost_answer`: signed, run, and answered
`outcome_unknown`). The overlay changes the tables an executed action touches; then a restart on
the same brain, the overlay's later observations (a payment, new work, a later date), and session 2
with nobody answering. Assertions on cards, decisions and reads: a signed action is read back and
not filed again, a declined one had no effect and is not proposed again, a lost one is not retried,
the paid invoice is not chased, the new one is. k-of-n per branch pools only runs under one key
(world, truth, brief, overlay, engine, model, driver, `ASSERTION_VERSION`); `--reassess` appends a
correction.

```bash
uv run python -m athena.proving.playbooks followthrough freelancer-receivables --branch all --repeats 3
uv run python -m athena.proving.playbooks followthrough freelancer-receivables --reassess proving-runs/<ts>/followthrough-freelancer-receivables/approve-1.json --note "why"
```

## Categories and jobs

Every playbook names one area and one job ([ADR 0096](../adr/0096-a-playbook-names-its-area-and-its-job-and-the-ledger-reads-the-library-by-them.md)),
as ids from `playbooks/taxonomy.json`, the one list the bench and the desktop both read:

```json
"audience": "work",
"category": "health",
"job": "contest",
```

- **Ten areas**: `health`, `freight`, `commerce`, `employment`, `consumer`, `benefits`,
  `housing`, `public`, `construction`, `family`, with labels in the file ("Health & clinics",
  "Freight & trade", ...). `domain` stays as the playbook's own finer name and is not grouped on.
- **Four jobs**, what it does for the person: `recover` (money owed back), `claim` (apply for or
  keep a benefit), `contest` (dispute or appeal a decision, a charge or a denial) and `comply`
  (meet an obligation on time).
- `check` refuses a playbook with either missing or not in the list, the nine older ones included,
  and a library with no `taxonomy.json` or a malformed one. The rows of `ranking.json` carry both.
- A test fails if an area or a job holds no playbook. Today: health 14, freight 12, benefits 12,
  commerce 11, employment 11, consumer 11, housing 9, public 8, construction 7, family 5; comply
  36, recover 28, claim 19, contest 17. The full table and every borderline call are in the ADR.

To add an id, amend ADR 0096 and the file together; the desktop shows a playbook whose id it does
not know under "Uncategorised" rather than hiding it, but the bench refuses it.

## The bench

A real Athena on a throwaway brain, on the person's `claude` CLI, driven through the daemon's own
routes (`proving/world.py`). Each phase is one portal, since a turn is pinned to one origin; what
carries between portals is her memory. The simulated pages (`page.py`) answer host calls the way
the desktop run loop does and know nothing of the truth. Two things a person would do are
simulated from the run loop and her words alone: "keep going" when the loop's bound stops her
mid-work, and switching tabs when she asks for one by name (at most three times). Only a phrase shaped like a
request counts: switch, go, move, head, flip or change followed by to, back to, over to or into and
the portal, or open and the portal; "the claim goes through Stallwick" is a mention, not a request.

## The score

Read from the cards the gate filed, never from her prose. Each card is right, fair either way, a
duplicate, a trap, unfounded or forbidden; exact parameters, the money found, the traps walked past
and a ledger of every trap follow. A total stated in her closing words is audited against two records, the
dollars the cards filed and the value found, and agrees when it equals either within a cent (a demand
card can already contain the dispute cards beside it, and registration cards carry no amount). The verdict (exceeds, meets, short) holds both the money and the count of items to the
playbook's bar, and missing a required item is short (ADR 0051).

## The one hundred playbooks (latest runs, Claude Sonnet)

| Playbook | Audience | Portals | Latest run |
|---|---|---|---|
| A parent's estate, settled | home | 10 | exceeds: 9 of 12, both deadline items, 11 of 11 traps, 0 false |
| A parent's long-term-care claims | home | 6 | exceeds: 10 of 10, $26,410 found, 0 false |
| Medical bills against the EOBs | home | 3 | exceeds: $3,423.50 of $3,423.50, 0 false |
| Denied claims, reworked (clinics) | work | 3 | exceeds: 9 of 10, $2,120 of $2,120, 0 false |
| The subcontractor's lien desk | work | 4 | exceeds: 10 of 10, $416,700, 0 false |
| Detention, lumper and TONU (trucking) | work | 6 | exceeds: 9 of 9, $1,580, 0 false |
| A freelancer's receivables | work | 6 | exceeds: 4 of 5, $21,100 of $21,550, 0 false |
| Distributor deductions (food brands) | work | 4 | exceeds: 7 of 7, $10,882, 0 false |
| Amazon FBA reimbursements | work | 2 | exceeds: 5 of 5, $359.78, 0 false |
| A family's delayed flights, claimed under EU 261 | home | 4 | exceeds: 4 of 4, $5,445 of $5,445, 9 of 9 traps, 0 false |
| Public Service Loan Forgiveness, every month certified | home | 4 | exceeds: 5 of 5, $20,000 of $20,000, 8 of 8 traps, 0 false |
| The property tax protest, with comparable sales | home | 4 | exceeds (re-benched after ADR 0058, 2026-10-09): 8 of 8, $2,310 of $2,310, 9 of 9 traps, 0 false, 1.8 min, $0.93; was short, 5 of 8, $1,470, 4.4 min, $2.35 |
| The insurer's depreciation holdback, collected | home | 4 | exceeds (re-benched after ADR 0058, 2026-10-09): 4 of 4, $15,190 of $15,190, 8 of 8 traps, 0 false, 2.3 min, $1.86; was 4.7 min, $3.05 |
| The Medicaid renewal, answered before coverage lapses | home | 4 | exceeds: 8 of 8, $7,000 of $7,000, 8 of 8 traps, 0 false |
| Data brokers told to delete, and checked | home | 4 | exceeds: 5 of 5 (a $32.25 weight, not money), 10 of 10 traps, 0 false |
| Every new hire screened for the Work Opportunity Tax Credit, inside 28 days | work | 4 | exceeds: 5 of 5, $19,200 of $19,200, 9 of 9 traps, 0 false |
| Duties refunded on what was exported: drawback, matched export by export | work | 4 | exceeds: 4 of 4, $13,747.14 of $13,747.14, 8 of 8 traps, 0 false |
| Crop damage noticed inside 72 hours, and the claims filed with the yields | work | 4 | exceeds: 5 of 5, $34,527 of $34,527, both notices in time, 8 of 8 traps, 0 false |
| A federal grant drawn down against what was spent, and the quarter's SF-425 filed | work | 4 | exceeds: 6 of 6, $31,492.60 of $31,492.60 drawn, 9 of 9 traps, 0 false |
| The interest federal agencies owe on late payments, claimed with the penalty | work | 4 | exceeds: 7 of 7, $440.16 of $440.16, 11 of 11 traps, 0 false |
| Weekly certified payroll filed on a prevailing-wage job, so the held pay estimates are released | work | 4 | exceeds (run 2 of 2): 10 of 10, $81,417.95 of $81,417.95 released, 9 of 9 traps, 0 false |
| Every field change priced and noticed inside the contract's claim window | work | 4 | exceeds (run 2 of 2): 6 of 6, $33,254.50 of $33,254.50, 9 of 9 traps, 0 false |
| The closeout package assembled, so the general contractor releases the retainage | work | 5 | exceeds: 10 of 10, $48,600 of $48,600 released, 10 of 10 traps, 0 false |
| City inspections booked in sequence on two cities' portals, on the first day each can happen | work | 4 | exceeds: 6 of 6 (a $400 weight a booking, mostly minutes), 9 of 9 traps, 0 false |
| The site's stormwater inspections and corrective actions kept on the permit's schedule | work | 4 | exceeds: 6 of 6, 4 exact (a $250 weight an act, mostly minutes), 9 of 9 traps, 0 false |
| Every subcontractor's insurance checked on the policy, not the certificate, before it mobilizes | work | 4 | exceeds (re-benched after ADR 0059, 2026-10-10): 9 of 9 (an $800 weight an act, protection), 11 of 11 traps, 0 false, 3.2 min, $1.96; was short, 4 of 9, five notices dropped as invalid JSON |
| The homestead and age 65 exemptions filed for every year the law still allows | home | 4 | exceeds: 4 of 4, $2,893 of $2,893, 9 of 9 traps, 0 false |
| Mortgage insurance taken off as soon as the law allows, on the household's loan and a parent's | home | 4 | exceeds: 3 of 3, $2,732 of $2,732, 9 of 9 traps, 0 false |
| The escrow analysis checked against the real tax and insurance bills, and the surplus claimed | home | 4 | exceeds: 6 of 6, $4,439.98 of $4,439.98, 12 of 12 traps, 0 false |
| Voucher payments kept coming: inspections cured, tenant damage reported, rent increases asked for on time | work | 4 | exceeds: 9 of 9, $4,970 of $4,970, 13 of 13 traps, 0 false |
| Every line paid short of the payer contract found and disputed, and the bundled lines left alone | work | 4 | exceeds: 5 of 5, $565 of $565, 12 of 12 traps, 0 false |
| Every credit balance traced to whose money it is: Medicare overpayments returned inside 60 days, patients refunded, posting errors corrected | work | 4 | exceeds: 9 of 9, $866.08 of $866.08 returned or refunded, 13 of 13 traps, 0 false |
| Every therapy authorisation renewed before visits run past it, each on its own payer's clock | work | 4 | exceeds: 5 of 5, $3,664 of $3,664 of visits covered (mostly minutes), 9 of 9 traps, 0 false |
| Every clinician's Medicare revalidation, credentialing attestation and license kept current, on four clocks in four portals | work | 4 | exceeds (run 2 of 2): 8 of 8 (a $150 weight an act, mostly minutes), 10 of 10 traps, 0 false |
| Every uninsured and self-pay patient's good faith estimate sent on time, and every bill $400 over its estimate caught before it goes out | work | 3 | exceeds: 8 of 8 (a $50 weight an act, mostly minutes), 8 of 8 traps, 0 false |
| Every Medicare denial billed to the patient only where a valid ABN was signed, and refunded where it was not | work | 4 | exceeds: 7 of 7, $539 of $539, 11 of 11 traps, 0 false |
| A nonprofit hospital's charity care applied for on every account that qualifies, with the household's income as its own policy counts it | home | 4 | exceeds: 4 of 4, $7,560 of $7,560, 9 of 9 traps, 0 false |
| A parent's drug plan asked for every formulary and tier exception his history supports, with the prescriber's statement, and none it does not | home | 3 | exceeds: 3 of 3, $799 of $799, 15 of 15 traps, 0 false |
| Every record a second opinion needs requested from five providers, at the fee the rule allows, and the late one chased | home | 5 | exceeds: 7 of 7 (a $40 weight an act, mostly minutes), 8 of 8 traps, 0 false |
| Every out-of-network therapy session claimed with the right code, every overdue claim chased, and every one processed wrong appealed in time | home | 4 | exceeds: 6 of 6, $921 of $921, 14 of 14 traps, 0 false |
| A mother's direct cremation priced at three funeral homes, every item the Funeral Rule says a home cannot require declined, and the home that is cheapest all in booked | home | 5 | exceeds: 4 of 4, $2,115 of $2,115, 10 of 10 traps, 0 false |
| A veteran father's burial allowance claimed two days before its two years run out, with the plot allowance and the government marker his cemetery allows | home | 4 | exceeds: 3 of 3, $3,196 of $3,196, 11 of 11 traps, 0 false |
| A mother's Social Security kept the way a representative payee must, and the year's report filed to the dollar | home | 4 | exceeds: 6 of 6, $315 of $315 (mostly minutes), 9 of 9 traps, 0 false |
| Two parents' drug plans tested in open enrollment on what they really take at the pharmacy they really use, and each moved to the plan that costs them least for the year | home | 4 | exceeds: 2 of 2, $1,516 of $1,516, 8 of 8 traps, 0 false |
| Part B taken up through the special period the month a job ends, with no lifetime penalty, and a spouse on retiree coverage told why she must wait | home | 4 | exceeds: 2 of 2, $487 of $487, 8 of 8 traps, 0 false |
| A father's caregivers kept on the right side of the household employer rules: a contractor made an employee, his I-9 signed on time, a W-2 number put right, and the state's third-quarter report filed and paid on the wages it covers | home | 4 | exceeds: 6 of 6, $818.17 of $818.17 (mostly minutes), 16 of 16 traps, 0 false |
| A mother's required minimum distributions taken at two custodians, each from the account it must come from, and the year she missed from an inherited IRA corrected with the waiver asked for | home | 4 | exceeds: 5 of 5, $2,900 of $2,900, 9 of 9 traps, 0 false |
| A mother living on her Social Security applied for the Medicare Savings Program her income really fits, with only the savings the rules count, and getting Extra Help with it | home | 4 | exceeds: 4 of 4, $3,797.20 of $3,797.20, 10 of 10 traps, 0 false |
| A mother's hospital stay, changed from inpatient to observation the day after she was admitted, appealed to Medicare's quality reviewers so her nursing home's private bill can fall to Part A | home | 4 | exceeds: 2 of 2, $10,200 of $10,200, 12 of 12 traps, 0 false |
| A married name carried through Social Security, the licence, the passport, the bank and payroll in the order each office needs, on the free passport form | home | 5 | exceeds: 6 of 6 (a $6.66 weight an act, mostly minutes), 9 of 9 traps, 0 false |
| A lighting maker's freight claims filed with the carriers that moved the goods, inside nine months, with concealed damage proved and a released value claimed at its limit | work | 5 | exceeds: 5 of 5, $6,920 of $6,920, 17 of 17 traps, 0 false |
| An importer's ocean demurrage and detention invoices held to the federal billing rule, with late and incomplete invoices, closed and refused days and the contract's free time disputed | work | 5 | exceeds: 6 of 6, $5,475 of $5,475, 10 of 10 traps, 0 false |
| A lens maker's late overnight parcels claimed under each carrier's money-back guarantee, inside each carrier's own window, with suspended services and excepted delays left alone | work | 4 | exceeds: 6 of 6, $269.85 of $269.85, 11 of 11 traps, 0 false |
| A kitchenware importer's misclassified entries corrected before liquidation or protested within 180 days after it, while the platters its own ruling classifies and entries out of time or too early are left alone | work | 4 | exceeds: 4 of 4, $10,998 of $10,998, 14 of 14 traps, 0 false |
| A sensor maker's export orders screened before they ship: near-matches cleared and released, listed, denied, unverified, owner-blocked and red-flagged buyers held | work | 4 | exceeds: 10 of 10 (a $1 count weight an act, mostly minutes), 10 of 10 traps, 0 false |
| A garden importer's Importer Security Filings made before each cargo is loaded, a factory named late and a new warehouse updated before arrival, while the air, bulk, carrier-filed and rolled cargo are left alone | work | 4 | exceeds: 5 of 5, $25,000 of $25,000 (a $5,000 weight an act, protection, mostly minutes), 9 of 9 traps, 0 false |
| A small Texas carrier's third-quarter IFTA return built from the ELD's miles and the fuel card, with exempt Wyoming lease-road miles, a cash fill and a duplicate receipt handled, and Mexico, two light vehicles and a brokered load left off | work | 4 | exceeds: 6 of 6, $1,844.83 of $1,844.83, 8 of 8 traps, 0 false |
| A small carrier's driver qualification files kept current: a full Clearinghouse query inside its 24 hours, an overdue annual query, three driving records ordered for the right reason and states, and a review signed, while the driver with no CDL, the driver who left and this year's work are left alone | work | 4 | exceeds: 6 of 6 (a $90 weight an act, mostly minutes), 9 of 9 traps, 0 false |
| An owner-operator's escrow got back after the lease ended: three deductions the lease does not allow disputed, a quarter's interest claimed at the Treasury bill rate and the balance demanded, while the charges the lease names are left alone | work | 4 | exceeds: 5 of 5, $1,538.77 of $1,538.77, 9 of 9 traps, 0 false |
| A heavy hauler's oversize permits bought across Oklahoma, Arkansas and Tennessee, with each state's escorts, curfews and a failed bridge kept, while divisible tanks, a load legal in Arkansas and a state the load never enters are left alone | work | 5 | exceeds: 5 of 5 (a $72.50 or $82.50 weight a permit, mostly minutes), 8 of 8 traps, 0 false |
| A candle maker's wholesale resale certificates checked before the state audits them: six requests for a fully completed certificate, and the state's request answered with the three certificates that support it, while a Texas sale, complete certificates, a taxed sale and a buyer still inside twelve months are left alone | work | 4 | exceeds (run 2 of 2, after a world fix): 9 of 9, $4,250 of $4,250, 10 of 10 traps, 0 false, 2.2 min, $1.51; was short, 4 of 9, the order list could not be paged |
| A reseller's EU listings brought up to the product-safety rule on two marketplaces: missing addresses, Union responsible persons from the makers' mail, a model number and the warnings products carry, while food, an antique, seeds, listings not offered in the EU, complete listings and a throw that needs no warning are left alone | work | 4 | exceeds: 6 of 6, $7,100 of $7,100, 9 of 9 traps, 0 false |
| A woodworker's ten open card disputes answered with the evidence each reason code needs, two valid ones accepted, and disputes the record cannot win, one past its processor's date and one already refunded left alone | work | 4 | exceeds: 7 of 7, $957 of $957 (a $25 weight on each acceptance), 9 of 9 traps, 0 false, 2.8 min, $2.12 |
| A ceramics shop's three card-processing statements checked against its contract and Visa's published rates: five overcharges credited, including a regulated debit billed as exempt and a markup raised by a notice that cannot reach back, while downgrades billed at their own rate, pass-through assessments, the fees the contract names, a credit already paid and a statement past its window are left alone | work | 3 | exceeds: 5 of 5, $118 of $118, 13 of 13 traps, 0 false, 1.8 min, $1.31 |
| A linen brand's suspect listings sorted across two marketplaces: copyright notices on four listings that copy its photographs and trademark complaints on two counterfeit aprons, while an authorised retailer, a reseller of genuine goods with its own photographs, name-only titles, a customer's photograph, a removed listing and one on another marketplace are left alone | work | 4 | exceeds: 6 of 6, $11,030 of $11,030 (each listing's 90-day sales), 14 of 14 traps, 0 false, 1.7 min, $1.35 |
| An outdoor brand's twelve trademark registrations checked against their windows: four maintained, including a renewal that deletes discontinued gloves and two in their grace period with the surcharge, while a registration not yet in its window, one already accepted, one sold, one lapsed, sleeping bags never sold and a discontinued snowshoe are left alone | work | 4 | exceeds: 4 of 4, $45,500 of $45,500 (sales under each registration), 8 of 8 traps, 0 false, 2.0 min, $1.76 |
| A songwriter's six songs registered with the collective so that their unmatched mechanical royalties reach her, each at her own share, while a namesake's recording, her cover of another's song, a work already matched, a share a publisher administers, a co-writer's song and money from radio and Germany are left alone | work | 4 | exceeds: 6 of 6, $1,338.95 of $1,338.95 (her own share), 8 of 8 traps, 0 false, 2.1 min, $1.27 |
| A business owner's twelve IRS notices sorted: first-time abatement requested on four penalties his record qualifies for, one on a tax still being paid, while a second quarter, a history with an earlier penalty, accuracy and estimated tax penalties, a second partnership year, an abated penalty and two notices that are no penalty are left alone | work | 4 | exceeds: 4 of 4, $1,850.60 of $1,850.60 (the penalties waived), 8 of 8 traps, 0 false, 1.7 min, $1.41 |
| An organic granola maker's annual update assembled: three plan changes, two suppliers no longer certified and three import certificates reported, while an old paper certificate, an exempt distributor, a lapsed grower of a non-organic mix, a change already accepted or never made, and imports that mismatch or need none are left alone | work | 4 | exceeds: 8 of 8 (a $75 weight an act, mostly minutes), 8 of 8 traps, 0 false, 1.7 min, $1.21 |
| A snack maker's recall of a supplier's almond butter traced: three lots held and five customers told, one for a batch reworked into another product, while the lots either side of the range, batches made from them, a customer given only other batches, an order not yet shipped and the distributor's own customers are left alone | work | 5 | exceeds: 8 of 8, $20,000 of $20,000 (an eighth of the roster's value an act), 10 of 10 traps, 0 false, 1.6 min, $1.18 |
| A retiree's bank account checked under Regulation E: four unauthorised transfers reported at their capped liability and a late claim chased for its credit, while a payment she sent a scammer herself, her son's fuel, a refunded and a pending charge, a subscription, a credit card charge and two claims not yet late are left alone | home | 4 | exceeds: 5 of 5, $1,312.00 of $1,312.00 (what she gets back), 12 of 12 traps, 0 false, 2.6 min, $1.11 |
| A nurse's three credit reports disputed with her proof: a late payment she made on time, an old collection and a bankruptcy past their limits, a paid collection and an account that is not hers, while an accurate late payment, a collection still in time, authorised inquiries and entries already fixed or being answered are left alone | home | 5 | exceeds: 8 of 8, $1,000 of $1,000 (125 dollars an act, mostly minutes), 8 of 8 traps, 0 false, 2.0 min, $1.03 |
| A teacher's security deposit statement checked against her lease and photos: six deductions contested for wear, a condition there at move-in, a clean oven, a rekey and a wall hole billed twice, while rent and water she owes, real damage, cleaning back to move-in level and an open estimate are left alone | home | 4 | exceeds: 6 of 6, $1,445.00 of $1,445.00 (what she gets back), 8 of 8 traps, 0 false, 2.2 min, $1.27 |
| A bookkeeper's repair invoices claimed under a fuel pump recall: the labour and shop fee of one repair and a part she bought herself, with its tax, while a relay fixed before the window opens, a valve, an oil change and a rotation, a warranty repair, a tow, a refunded deposit and her husband's car outside the recall are left alone | home | 4 | exceeds: 4 of 4, $674.02 of $674.02 (what she gets back), 8 of 8 traps, 0 false, 1.6 min, $0.87 |
| A physical therapist's lease-end statement checked against his lease's wear limits and the inspection: a dent, a tire, a chip, a scuff and a stain inside the limits are disputed, while the mileage, the fee, a long scratch, a worn tire, a cracked lens, a gouged wheel, a seat burn and the wear allowance are left alone | home | 4 | exceeds: 5 of 5, $880.00 of $880.00 (what he gets back), 8 of 8 traps, 0 false, 1.1 min, $0.69 |
| A landscape architect's delayed bag claimed from the airline in time: a pharmacy, the toiletries line of a grocery receipt, basic clothes, a charger and a shirt for her workshop, and the bag fee, while food, a jacket her card paid, a dress, a new wardrobe, a colleague's purchases, a scarf bought after delivery, roaming and a June claim past its 21 days are left alone | home | 4 | exceeds: 6 of 6, $203.30 of $203.30 (what she gets back), 10 of 10 traps, 0 false, 1.6 min, $0.92 |
| A veterinary technician's year of airline credits turned into refunds: flights moved 3 hours 55 minutes and 6 hours 30 minutes, a changed arrival airport, an added stop, a lower fare class and a seat fee, while a change she made, a credit she chose, her own cancellation, a short delay, a connecting airport, an uncovered flight and a refunded and a spent credit are left alone | home | 5 | exceeds: 6 of 6, $832.00 of $832.00 (what she gets back), 9 of 9 traps, 0 false, 1.6 min, $0.91 |
| A household's recurring charges audited under California's Automatic Renewal Law: a second streaming account on the bank, a trial that became a charge, an add-on raised without notice and an unused storage plan cancelled, with two refunds asked under the services' own terms, while a son's and a partner's weekly use, a service used this week, a one-time purchase and a plan renewed after its reminder are left alone | home | 6 | exceeds: 6 of 6, $613.50 of $613.50 (cancellations weighted at a year of the plan, mostly minutes), 8 of 8 traps, 0 false, 1.4 min, $0.84 |
| A hygienist's class action claims filed from her own records: an air fryer, bulbs only her card shows, two kettles, earbuds by a sworn claim her card supports, pet food and a topper due tomorrow, while a late claim, an exclusion, a repeat, a purchase before the class period, resale, a Toronto purchase, one she cannot show and a fee scam are left alone | home | 5 | exceeds: 6 of 6, $158.00 of $158.00 (what she gets back), 8 of 8 traps, 0 false, 1.8 min, $1.03 |
| A tester's unclaimed property claimed free from two states under both her names: a refund under her married name at an old address, two checks and a dividend under her own, a premium refund and a policy a finder wanted a quarter of, while three namesakes, an ex-husband's, a company's, a paid one and her dead mother's are left alone | home | 5 | exceeds: 6 of 6, $1,016.43 of $1,016.43 (what she gets back), 8 of 8 traps, 0 false, 2.4 min, $1.23 |
| A planner's flexible spending account claimed before its run-out ends: a crown's and physical therapy's share on the EOBs, two pharmacy items, a day camp and after-school care, and a card swipe answered with its EOB, while whitening, a gym, vitamins, a premium, an overnight camp, a teen's care and a child of 13 are left out | home | 5 | exceeds (run 2 after a world fix; run 1 was short, 1 of 7, 6 false): 7 of 7, $966.47 of $966.47 (what she gets back), 15 of 15 traps, 0 false, 1.5 min, $0.81 |
| A mother-to-be's leave for a caesarean birth lined up: a 12-week leave request, eight weeks of disability pay on the doctor's certificate and four of paid family leave from the day after it ends, while an early start, a split leave, a partner's weeks, overlapping weeks and a claim past the year are left out | home | 5 | exceeds: 3 of 3, $5,585.20 of $5,585.20 (what she gets in benefits), 9 of 9 traps, 0 false, 1.8 min, $1.00 |
| A laid-off analyst's three clocks kept in New York: unemployment filed this week, COBRA for October only to cover a scan, a marketplace plan and credit from November, and severance signed to be paid after thirty days, while a withdrawn draft, an early payment, a full COBRA, a December start and a broker's rush are left out | home | 4 | exceeds: 6 of 6, $6,025.00 of $6,025.00 (benefits kept and a bill covered), 8 of 8 traps, 0 false, 2.3 min, $0.86 |
| A surveying firm's ten unemployment claim notices answered in three states, each on its own clock: layoffs and a part-time claim with the facts, a quit and a documented discharge contested with evidence, a stranger's claim and an employee's reported, while a repeat, a late one, a layoff called a quit and a firm's offer to contest all are left alone | work | 6 | exceeds (run 2 after a world fix; run 1 was short, 7 of 7 with 2 false claims): 7 of 7, $9,880.00 of $9,880.00 (charges avoided, an upper bound), 8 of 8 traps, 0 false, 4.5 min, $1.54 |
| A manufacturer's COBRA election notices mailed inside their windows from its own plan: a layoff, a resignation, an hours cut, a death, a divorce and a child's twenty-sixth birthday reported in time, and a separated spouse at her own address, while a waiver, a cut that kept coverage, a late or missing report, a transfer, a leave, a Medicare date and a notice already mailed are left out | work | 3 | exceeds: 7 of 7, $770.00 of $770.00 (an exposure unit, not money recovered), 11 of 11 traps, 0 false, 1.9 min, $1.18 |
| A small company's third-quarter 401(k) deposits checked against the 7-business-day safe harbor, and the lost earnings paid for each late one: two deferrals and three loan repayments, one found only on the loan list, while deposits on the sixth and seventh days across Labor Day, a late match, a stopped deferral, an unfinished payroll, another plan's payroll and a recovery firm's share are left out | work | 4 | exceeds: 5 of 5, $87.93 of $87.93 (lost earnings owed to the plan), 10 of 10 traps, 0 false, 1.6 min, $0.92 |
| A New York contractor's workers' compensation audit disputed by duties and records before the carrier's window closes: a bookkeeper to clerical, a salesman to outside sales, a crew's extra overtime pay and two insured subs' costs taken off, one found only in its contract file, while an office manager on job sites, a framing estimator, a general-liability certificate and last year's audit are left out | work | 4 | exceeds: 5 of 5, $19,016.47 of $19,016.47 (premium taken off the audit), 12 of 12 traps, 0 false, 1.8 min, $0.94 |
| A machine shop's 2025 OSHA injury log closed under Part 1904: seven cases entered with their days, one a privacy case and one made recordable by a declined prescription, while first aid, a parking-lot crash, the flu and repeats are left out; the summary to certify and the 300A and 300 and 301 data to submit were held for the entries' approval | work | 4 | short: 7 of 10, $115,850.00 of $165,500.00 (an exposure unit, not money recovered), 13 of 13 traps, 0 false, 1.6 min, $0.91 |
| A software company's remote hires registered with their states before the payroll runs that pay them: Colorado withholding and unemployment accounts for a Denver engineer, Minnesota ones for a support lead whose move shows only in the HR change log, and a Texas unemployment account, while Texas withholding, Washington, Virginia, a withdrawn offer, a contractor and a service's offer to register every state are left out | work | 5 | exceeds: 5 of 5, $995.00 of $995.00 (199 dollars an account, a price avoided and not money recovered), 14 of 14 traps, 0 false, 2.0 min, $1.23 |
| A distributor's background-check rejections taken in the order the FCRA sets: four pre-adverse notices with the report and the summary of rights, final notices for three whose own wait has ended and a namesake's dispute sent on, while a candidate whose wait ends later, a skills test, a hire, a missing authorization, a corrected report, notices already sent and a vendor's offer are left out | work | 3 | exceeds: 8 of 8, $8,000.00 of $8,000.00 (1,000 dollars an act, an exposure and not money recovered), 24 of 24 traps, 0 false, 1.4 min, $0.86 |
| A student's FAFSA verification answered with the documents the college names: a notarized ID, a five-person family statement, the 2024 return transcript, her non-filer statement and two W-2s, one found only in a 2025 letter, and the family size fixed, while old forms, a paid service, the IRS's figures and the bursar are left out | home | 4 | exceeds: 7 of 7, $7,000.00 of $7,000.00 (1,000 dollars an act, an exposure and not money recovered), 16 of 16 traps, 0 false, 1.8 min, $1.37 |
| A laid-off father's and a pay-cut mother's changes sent to the college's aid office with proof and an estimated 2026 income by its deadline, while a 2024 cut, a seasonal job, a brother's other college, a tuition rise, a premium, a dependency override and an appeal service are left out | home | 4 | exceeds: 2 of 2, $4,000.00 of $4,000.00 (2,000 dollars a request, a per-act weight and not money recovered), 10 of 10 traps, 0 false, 1.9 min, $1.51 |
| A working family's 2025 return on extension claims the earned income credit for three children, a daughter, a son who moved in in March and a student of 22, with Form 8862 for the disallowed 2023 credit, while a niece her mother claims, a boy there four months, a 21-year-old, another family's child, a Form 8332, a refund advance and a maximizer are left out | home | 4 | exceeds: 4 of 4, $4,000.00 of $4,000.00 (1,000 dollars an act, an exposure and not money recovered), 8 of 8 traps, 0 false, 1.7 min, $1.51 |
| A disabled worker's earnings reported to Social Security in the month they were earned, June to September, with a second employer whose stubs came only by mail, while three months on file, October, her husband's job, a work expense, a paid advocate and a text are left out | home | 3 | exceeds: 5 of 5, $4,000.00 of $4,000.00 (800 dollars an act, an exposure and not money recovered), 8 of 8 traps, 0 false, 1.1 min, $0.84 |
| A flooded household's three FEMA appeals, filed inside the 60 days: the house's repair and the contents for what the insurer's limits left unpaid, and the car, while a furnace the insurer paid, a lake cabin, landscaping, an approved rental, a neighbour's estimate, a decision 60 days past, a claim service and a contractor are left out | home | 4 | exceeds: 3 of 3, $12,400.00 of $12,400.00 (the amounts the appeals ask FEMA to pay, an exposure and not money recovered), 8 of 8 traps, 0 false, 1.7 min, $1.61 |
| A school district's Form 471s for funding year 2026 filed with the lowest eligible bid for four services, one a switch bid that came only by mail, while the vendor that drafted a Form 470, a Form 470 posted 11 days earlier, bus Wi-Fi, Chromebooks, a service already filed, a consultant's share and a gift card are left out | work | 4 | exceeds: 4 of 4, $43,600.00 of $43,600.00 (80 percent of each bid's price, an exposure and not money recovered), 12 of 12 traps, 0 false, 1.7 min, $1.20 |
| A grain farm's 2026 acreage report filed field by field before 15 July, as farmed and not as insured or as last year: a flooded corn plan replanted to soybeans, a 60 percent share lease, prevented planting and soybeans after wheat, while rented-out, custom, sold, idle and future ground, wheat on file and a paid filing service are left out | work | 4 | exceeds: 7 of 7, $132.65 of $132.65 (18.95 dollars a field line, an hour of farm labour, a price avoided and not money recovered), 8 of 8 traps, 0 false, 2.3 min, $1.69 |
| A kitchen nonprofit's restricted funds released as their terms are met: a cooler in service, a gift whose date a mailed amendment moved up, 6,300 dollars of a meals gift and 9,400 and 5,700 dollars of two conditional grants, with two booked releases reported to funders, while a van, a gift for 2028, a date moved later, stipends, a board reserve, an endowment, a grant 104 of 150 earned, a repeat report and a consultant are left out | work | 6 | exceeds: 7 of 7, $74,600.00 of $74,600.00 (the dollars each act releases or reports, an exposure and not money recovered), 10 of 10 traps, 0 false, 2.8 min, $1.70 |
| A small firm's solicitations triaged on Friday 9 October 2026: six kept, one because a mailed amendment changed its set-aside, and four questions sent before their deadlines, while set-asides it does not hold, a size standard it exceeds, a plan over the 50 percent limit, dead notices, a local-only bid, late questions and paid services are left out | work | 4 | exceeds: 10 of 10, $10.00 of $10.00 (a 1 dollar count weight, a price avoided and not money recovered), 12 of 12 traps, 0 false, 2.4 min, $1.92 |
| A civic nonprofit's federal and city records requests on Friday 9 October 2026: three appeals inside 90 days, one for a denial that came only by mail, an overdue request chased, a narrowing, a city's search fee disputed and two new requests, while a late appeal, requests inside 20 working days, a city appeal and a records service are left out | work | 4 | exceeds: 9 of 9, $9.00 of $9.00 (a 1 dollar count weight, a price avoided and not money recovered), 15 of 15 traps, 0 false, 2.2 min, $1.38 |

Across the latest runs: $1,437,071 of $1,496,148 found, 1042 of 1042 traps walked past, no false claim,
260 minutes of her time against about 360 hours by hand, $160.98 of model time. 140 runs are recorded
in the playbooks' histories.

## The desktop module

The overview: the edge map, the record (money found, traps walked past, false claims, her time
against the hours by hand, the model's cost, fixes taught), a grid filtered by home or work and
ordered by edge, money or hours; a tile is its value and two chips, with no prose. A playbook's
layer opens on an abstract (ADR 0053): the promise, the proof at a glance, and one line per part
under *The chore* and *The proof*. Each part opens one level down: the story and the command (copy
it, or hand it to Athena, which drafts it in her composer and makes it her active project), the
portals, the method, the gates, what she filed (every card), the traps ("what she was right to
leave alone"), **Watch the run** (a rail of tab visits, a dot per turn coloured by what it did,
play, step and arrow keys, the money found so far; her closing words; the runs over time), what it
taught Athena, and the economics against the incumbent. Back steps one level.

### The catalogue and the topic page

The Chores depth has two full-width levels and the replay under them
([ADR 0096](../adr/0096-a-playbook-names-its-area-and-its-job-and-the-ledger-reads-the-library-by-them.md),
amendment *The catalogue*).

**The catalogue** (`#/chores`) heads itself "Playbooks" with the bench's totals in one line, then:

- **the area tabs**: "All" and the ten areas of `playbooks/taxonomy.json` in its order, each a line
  glyph, the area's first word (its full name is the tab's title and accessible name) and the count a
  press would show under the job in force; an area with nothing under that job is disabled. A
  playbook that names no area is listed under "All" only.
- **the job chips** (all jobs, or one of the four; pressed buttons, each in its job's hue) and **the
  order switch**: Best edge (the default: hardest for anyone else and most useful first), Most
  value (on the year's scale), Most time saved (the hours by hand).
- **the ledger**, the catalog `Table` with a line saying how many playbooks it shows and where: each
  row led by the first still of its run (or its area's glyph), its short title over the lead line
  of its brief (the promise when it has none) and, when benched, how many comparable runs it
  exceeds in ("exceeds in 2 of 3", with an "n=1" badge on a single draw; ADR 0128; an unbenched
  row says nothing), its job, up to three portals, the time by hand
  against her measured run ("3h → 6m", "not run" when unbenched) and its value. A click, Enter or
  Space on a row opens its topic page; the arrows only walk the rows. The filters, the order and
  the row last opened live in the depth's view, so coming back finds them as they were, the row in
  view and focused. Under 1060px of the page's own width the Portals column goes, under 760px Job.

**The topic page** (`#/chores/<id>`) is one playbook as a product page, with "All playbooks" and
Escape as the way back:

- **the hero**: area and job, the short title, the brief (`brief` in `playbook.json`, a lead line,
  `- ` bullets and `**bold**`, rendered as text nodes and never HTML; the promise when there is no
  brief), the first still large, and three figures: value for the persona, time by hand against her
  measured run with the speed-up, and the traps she walked past on the bench.
- **How it runs**, the playbook drawn as a blueprint from its own data: the portals she reads down
  the left, the steps as a numbered spine that wraps past three or four, each gate an amber
  "Athena asks you first" diamond before the step that shares the most words with it (only its
  place is inferred), and the result: what she filed on the bench and the traps she avoided, or,
  unbenched, the bar it will be held to.
- **See it run**: every still of the bench run (the evidence pipeline's storyboard) large in a grid
  with its caption. A still opens the lightbox: the image as large as fits, "n / N", Left and Right
  step, Escape or the backdrop closes it, and focus returns to the still.
- **Make it yours**: "Fit it to me", "Watch the run turn by turn" (where the bench kept a trace)
  and "Copy the command"; above them **Your case**, the chore's saved cases with "Open your case"
  beside "Talk it through with her" (ADR 0123), or why none can be shown (no daemon, none yet);
  under each case **When it comes due**, its cadence and any review that is open (ADR 0131), and
  **Your runs**, its receipts (ADR 0124), or "No run yet".

**The fit** asks only what differs: for each portal "I use this" or "Mine is…" with the name of the
person's own, and an optional note on their case. It hands Athena the playbook's own command with
those differences appended after it (`fitCommand`), shown live as it will be read; the command is
never rewritten, because a rewrite would be a different chore from the one the bench measured. The
value stays the author's estimate for the playbook's persona and is never rescaled.

**States.** Loading and an empty build are the `EmptyState`; a set that could not be read is a
`ProblemNote` with the reason verbatim; a filter that leaves nothing names the area and the job
("No playbook in Freight & trade whose job is to win a dispute.") and offers "Show all" in one press;
an id this build does not ship says so with "All playbooks".

## Adopt

Adopting a playbook is a conversation, not a form
([ADR 0097](../adr/0097-adopting-a-playbook-is-a-conversation-held-outside-the-turn-lock.md)).
The daemon holds an adopt session in memory (`src/athena/adopt/`), outside the turn lock, so it
runs while a chat turn runs; at most three are live, each expires after two hours idle, and its
dropped documents live in a temp directory under `$ATHENA_HOME/adopt/` deleted with it. What
outlives it is the approved case (below).

**Slots.** What the run depends on for this person: one `portal` slot per app ("Do you use
Payroll Harbor for the payroll firm, or something else?") and one `gate` slot per gate come
straight from `playbook.json`; the first audit adds `fact` slots (the dates, places, amounts and
thresholds the rules turn on) and `trap` slots, twelve at most. Each is `open`, `guessed` or
`confirmed`, with its source. Research, memory, documents and accounts may fill a slot; only the
person's own words confirm one, and nothing overrules what she confirmed.

**The loop.** The opening line and the slots arrive at once; the first card (up to four
questions, each tied to slots, with two to five options and free text) is written while the
auditor derives the fact slots. After each answer the auditor checks every value against her
literal words while the next card is written; when the auditor finds nothing open the card is
dropped and the brief is written. "Good enough" drafts the brief at any time, guesses marked "(my
guess)" and the open slots listed; eight cards is the most.

**The brief.** A lead, **Your setup** (her apps and the facts, guesses marked), **What I'll
claim** and **Left alone**, plus the command that will run: the playbook's command and a "My
case:" block built mechanically from the slots. Every brief has a `rev`; an answer after it makes
it stale; approval names the rev and only the current one is taken.

**Legs.** Every model call names its kind (`interview`, `audit`, `research`, `shape`, `persona`,
`judge`) and runs on the `claude` CLI on the subscription at the tier `src/athena/adopt/tiers.json`
gives that kind (interim values until the tier bench sets them), with no tools unless the leg
names them. The interviewer keeps one warm stream-json process per session. Each invocation is one
ledger row (surface `adopt`, trigger `adopt.<kind>`), failures and malformed answers included, and
one `adopt.usage` event with its milliseconds and time to first text. A malformed answer is sent
back once; a second one degrades (a plain free-text question, or the slots kept) and never stalls.

**Your case.** Approving a brief saves it as a case ([ADR 0123](../adr/0123-an-approved-brief-is-a-case-file-in-the-brain.md)):
`goals/<proj>.md` in the brain, one `proj_` id per case kept by every later approval, holding the
playbook id, the approved rev, the brief, the fitted command, the portal swaps and every slot with
its status, source, date and the person's words, as markdown and one JSON block after
`<!-- athena:case -->`. The approval is an episode and each slot she confirmed a fact citing it.
"Open your case" on the chore's page (`chores/<id>/case/<proj>`, `POST /adopt {playbook_id,
case_id}`) shows the approved brief at once; what she said carries over from memory, and only a
date or an amount that may have moved is asked again. `GET /adopt/cases?playbook_id=` lists the
cases, and a rebuilt index finds them again.

**Your runs.** "Start for real" carries the case's `proj_` id to Athena, and every `POST /run` (and
every spoken turn) while that playbook is active sends it as `case_id` beside `active_project`. It
routes nothing: each tab keeps its own conversation, and the daemon stamps the turn under the case
([ADR 0124](../adr/0124-your-runs-come-back-to-the-chore.md),
[ADR 0127](../adr/0127-a-cases-turns-keep-their-conversations-and-are-stamped-under-it.md)).
`GET /adopt/cases/<proj>/runs` folds those turns into a receipt, joined by turn id: the cards they
filed (approved, of them let through; declined; expired; waiting), the calls that may have
completed, the dollars the approved cards **asked** for ("asked, from N cards you approved", never
"recovered") and the ledger's cost and minutes for those turns. A run is every turn since the
case's last receipt; pressing **done** on the active playbook (`POST /adopt/cases/<proj>/done`)
closes it and appends the receipt to the case file's block, so it survives a rebuilt index.
`bench <id> --case` runs a playbook the same way and reports the case's receipt; `--project`, one
shared `conv_proj_<hex>` for every tab, stays as the experiment that measured it 1.7 to 2.5 times
dearer per run.

**An old yes is dated on the card.** Under a turn that names a case (`case_id` on `POST /run` or a
voice frame, which routes nothing, or a `project_id`) whose file holds a receipt, a card filed for a
call approved and let through since the case's last run began says so with the date ("You
approved this exact call on Oct 15 at 14:02 ..."), not only inside the last day; outside a case it
is the day-long lookback and the clock time
([ADR 0126](../adr/0126-the-second-run-starts-where-the-last-stopped.md)). The last run's receipt
does not go into the next run's prompt: a "Since last run of this chore" block that listed it was
benched and removed, because run 2 re-filed more with it (14 duplicates of run 1 over five
playbooks) than without it (6)
([ADR 0130](../adr/0130-a-chores-last-run-stays-out-of-the-next-runs-prompt.md)).
`bench <id> --second-run` is that measure: two runs of one case on one brain, the first approving
every card, the second, after a restart, scored for its duplicates of run 1 and its recall on the
rest (`--no-carry` is accepted and changes nothing).

**When it comes due.** A case can come due on its own: weekly on a weekday, monthly on a day, or
every N days, at a local time in her zone, set only by her on the topic page (the playbook's
`economics.times_per_year` suggests one, applied only when she presses it), paused and resumed
there. The cadence is `rituals/cadence/<proj>.md` in the brain (a `rit_` id, the five-key header,
a log of every fire and skip in the body). A daemon loop (`adopt/chores.py`, every 30 s under
`athena serve`) advances `next_run_at` and opens one review in the same write; occurrences missed
while it was off are folded into that one review, and none opens while one is open. The review
(`GET /adopt/cases/<proj>/review`) is assembled with no model call from the case and its last
receipt: expired cards and calls that may have completed first, then what was approved (with the
date) and declined, and the next due date. Main's dock shows one line per (case, due date), held
in quiet hours (`rituals/quiet_hours/chores.md`, default 21:00 to 08:00, `POST
/adopt/chores/quiet`), and after three unanswered the review asks "pause or slow this chore?".
**Open and prepare** opens the chore's tabs (the playbook's addresses, else the one in her case;
none is said, never guessed) and puts the case's command in Athena's composer; nothing is sent
until she presses send, and that first turn's ledger row is `trigger_kind='schedule'`
([ADR 0131](../adr/0131-a-chore-comes-due-as-a-staged-review.md)).

**The wire.** `POST /adopt`, `GET /adopt/<sid>/events?after=<seq>` (Server-Sent Events, replay
then live, heartbeats, last frame `adopt.error {reason: "session_closed"}`), `.../answer`,
`.../documents`, `.../enough`, `.../approve {rev}` (answers the `case_id`), `DELETE /adopt/<sid>`,
`GET /adopt/cases`, `GET /adopt/cases/<proj>/runs`, `POST /adopt/cases/<proj>/done`,
`GET`/`POST /adopt/cases/<proj>/cadence`, `GET`/`POST /adopt/cases/<proj>/review {due_at, answer}`,
`GET /adopt/chores/due`, `GET`/`POST /adopt/chores/quiet`. The shapes are
`contracts/adopt.py` and `apps/desktop/src/lib/adopt.ts`, kept equal by
`tests/contracts/test_adopt_parity.py`.

**Research.** While she answers, four lanes work beside the conversation, at most four at once,
each with its own timeout, a failed lane failing alone and the harvest said in one line ("3 of 4
lanes done · 1 failed (rules: timeout)"): the public rule (one leg with only web search and fetch,
every finding with its source or dropped), her connected mail or Notion (a leg plans up to three
searches and the daemon runs them itself, read-only), what Athena already remembers, and each
document she drops in (a leg that may only read that file; documents up to 10 MB, the one route
whose body cap is 14 MiB). Lanes fill slots as guesses she can correct; only her answers confirm,
and every value reaches a later prompt inside a fence.

**The showcase.** Approving the brief plays the recorded run at once with her portals' names, and
starts a rehearsal on a world shaped like her case: one `shape` leg proposes the date and up to
twenty row edits to a copy of the world, portal renames come from the approved brief and not the
model, the copy is validated by the playbook loader, and the bench runs on it in the daemon's
process (its own temp brain, lock and ledger; Sonnet 5.5, the bench's $5 cap), streaming each
turn, then replaces the recorded run. It claims dollars found only when the shape was renames
alone; a world with edited rows or a moved date is compared by cards proposed, since its answer
key was written for other rows ([ADR 0125](../adr/0125-rehearsal-dollars-only-where-the-answer-key-holds.md)).
The sidecar ships the playbooks' JSON and `tiers.json` so a
built daemon can do this.

**Which model.** Every leg names its kind, and `src/athena/adopt/tiers.json` says which Claude 5.5
tier and effort serves it. The tier bench sets that file from measurements:

```bash
uv run python -m athena.proving.adopt_tiers --dry              # the plan: 108 interviews, nothing spent
uv run python -m athena.proving.adopt_tiers run --parallel 3   # resumable; results in proving-runs/adopt-tiers/<date>/
uv run python -m athena.proving.adopt_tiers report             # report.md: a table per role
uv run python -m athena.proving.adopt_tiers pick --write       # the picks into tiers.json
```

## Evidence

A benched playbook can be filmed (ADR 0055): a narration of its latest run, spoken by the local
voice over a recording of the Playbooks layer replaying that run.

```bash
uv run python -m athena.proving.playbooks evidence <id>|--all   # narrate, speak, capture, mux, index
uv run python -m athena.proving.playbooks evidence --all --dry  # the plan; runs no tool
uv run python -m athena.proving.playbooks evidence --all --verify  # current, stale or missing
```

The narration is written from `playbook.json` and `bench.json` alone, with no model: what the chore
is and for whom, what she found of what there was, the traps she walked past, her minutes against
the manual ones, and the verdict with its reasons when it is short, in 45 to 90 seconds. Kokoro
(`af_heart`) speaks it from the engine home Personas shares (Piper only when Kokoro is absent);
`examples/journey/scripts/capture-playbook.mjs` starts the desktop's Vite on a free port and
records `preview.html?module=playbooks&fixture=shipped:<id>` walking the abstract, every turn of
*Watch the run*, then *What she filed*, paced to the narration; ffmpeg (`FFMPEG` or PATH) muxes
H.264 and AAC and shrinks a still of the result to a JPEG under 100 KB. The film, the WAV and the
capture stay in the gitignored `evidence/<id>/`; `playbooks/<id>/evidence.json` (schema 1:
narration text, engine, voice, durations, bytes and sha256, repo-relative paths, and the
`bench_run_at` it filmed) and `thumb.jpg` are committed. `--verify` calls an index stale when its
`bench_run_at` is not the bench's `run_at`, notes a narration that no longer matches what
`playbook.json` and `bench.json` say now (a rescore keeps `run_at`), and re-hashes whatever media
is on this machine; `narration.sha256` is of the spoken WAV. A
playbook without a bench is refused, and `check` does not fail one that has no evidence yet.

On the desktop the still sits on the playbook's tile with the film's length, and the layer gains
*The run, filmed*: the film where the dev server serves `evidence/` (with byte ranges, so it
seeks), the still elsewhere, its length, when it was captured, the voice, the narration's words,
and whether it is current against the bench or stale.

### Evidence: the storyboard

The film stays on the machine that made it, so a person who never ran it would see only a thumbnail
of the end. The storyboard is the process instead, committed: three to six still screens of the run
beside the index, in `playbooks/<id>/story/01.webp` to `06.webp`.

```bash
uv run python -m athena.proving.playbooks evidence <id>|--all --stills-only   # stills + index, nothing spoken
uv run python -m athena.proving.playbooks evidence --all --stills-only --dry   # the plan; runs no tool
uv run python -m athena.proving.playbooks evidence --all --stills-only --desktop <checkout>/apps/desktop
```

`capture-playbook.mjs --stills` starts the desktop's Vite on a free port and opens the Chores depth
in `preview.html` (`scene=chores`, `calm=1`, dark) at a 1280 x 800 viewport, one place at a time by
its address: the chore (`#/chores/<id>`), each sampled turn of its replay (`#/chores/<id>/run/<n>`),
and the chore opened on *What she filed* (the `shipped-proof` fixture), scrolled so the facets and
the panel stand at the top. Every still is the same element, `.stage__layer`: the scene, without the
crumbs above it or the dock below. The turns are up to four of the run's, spread evenly, always the
first and the last (`sample_turns`: nine turns give 1, 4, 6 and 9). `--desktop` serves the walk from
another checkout, so a capture never photographs somebody's half-saved edit through hot reload.

ffmpeg shrinks each still to 960 px wide (bilinear: lanczos rings around small text, and the ringing
costs bytes) and encodes WebP, stepping the quality down from 75 until the still is at most 24,000
bytes. A still that does not fit even at quality 30 is cut shorter instead, to 480, 440 or 400 px
tall at qualities 36 and 30: what goes is the tail of a long list of cards, never the legibility of
what stays. One that still does not fit fails its playbook, by name. The whole storyboard is held to
15 MB by a test.

Each still is named from the record, with no model: "The abstract"; "Turn N - <portal>: " and the
first clause of what the person said on that turn, cut at a word with an ellipsis past 80
characters; "What she filed". A turn the run loop continued has no words from the person, so it
carries the first clause of hers and says so: "Turn N - <portal>, Athena: ...".

The index is schema 2: everything schema 1 had, unchanged (`--stills-only` does not touch
`captured_at`, which stays the film's date, or `bench_run_at`), plus `story`, a list of `{path,
caption, turn, bytes, sha256}` with `turn` null for the abstract and the result. A schema 1 index
still reads and verifies. `--verify` holds every still, being committed, to its recorded bytes and
hash, and calls a schema 2 index without a story a fault.

## Ranking

`playbooks/ranking.json` ranks every playbook by the method ADR 0056 fixed before the results
existed ([0056](../adr/0056-how-the-best-use-of-athena-is-ranked.md), with its amendments of
2026-10-09 and 2026-10-10 and [0064](../adr/0064-a-flat-incumbent-fee-is-not-a-share.md)). A score
is three points of 0 to 5 added with equal weight: money (`log10` of proven dollars a year, minus
1), time (`1 + log10` of saved hours a year) and edge (the square root of difficulty times
usefulness). Proven dollars are `value_usd` over a year times the bench's `recall_value`. It is
computed from the committed `playbook.json` and `bench.json` files only: no model call, no bench.

```bash
uv run python -m athena.proving.playbooks rank           # write playbooks/ranking.json
uv run python -m athena.proving.playbooks rank --check   # exit 1 if the committed file differs
uv run python -m athena.proving.playbooks rank --tau     # run 1's scores against the rest's, Kendall tau-b
```

A row stands on every run under the key a run benched today would carry (ADR 0128): the money
takes the median recall, a trap or a false claim in any comparable run excludes the playbook, and
`bench.runs` says how many runs (`n`), how many exceeded, and the min and median recall. Every
committed row is `n: 1` today, a single draw; the desktop's ledger shows it as "n=1".

The file carries no timestamp, so the same inputs give the same bytes. All 100 are listed: 99 ranked
and 1 unranked. The top ten:

| # | Playbook | Score | Proven $ a year | Saved hours a year | Edge (d/u) |
|---|---|---|---|---|---|
| 1 | lien-desk | 11.98 | 380,000 | 24.9 | 5/5 |
| 2 | clinic-denials | 10.70 | 50,400 | 9.9 | 5/5 |
| 3 | estate-settlement | 10.56 | 18,400 | 19.8 | 5/5 |
| 4 | change-order-notices | 10.45 | 60,000 | 46.9 | 4/4 |
| 5 | customs-protests | 10.24 | 30,000 | 19.7 | 5/4 |
| 6 | certified-payroll | 10.07 | 40,000 | 29.2 | 4/4 |
| 7 | ltc-claims | 10.07 | 20,000 | 5.8 | 5/5 |
| 8 | clinic-underpayments | 10.02 | 30,000 | 34.8 | 4/4 |
| 9 | cpg-deductions | 9.95 | 60,000 | 14.9 | 4/4 |
| 10 | duty-drawback | 9.94 | 30,000 | 9.8 | 5/4 |

**The best use is lien-desk**, a Construction chore for a subcontractor: $380,000 a year proven (a
value of $380,000 a year at recall 1.0), 1,491 minutes saved a pass against 8.8 of the person's
own, about 24.9 hours a year at the default frequency of one pass, and an edge of 5/5. That is
4.58 money points, 2.40 time points and 5.00 edge points, 11.98 in all, 1.28 ahead of the second.
Its value is protection and not recovery: what a missed day would put at risk (ADR 0056 (f)).
ltc-claims and certified-payroll tie at 10.07 and the tie-break (more proven dollars) puts
certified-payroll first.

Unranked, with the reason: **osha-300-log**, short: found 7 of 10 items, expected 75%. Four ranked
rows are worth $0 a year (their truth is weighted by a count, ADR 0056's 2026-10-09 amendment) and
score 0 money points: bid-opportunity-triage (90), denied-party-screening (93),
name-change-everywhere (96) and data-broker-deletion (99).

### What the ranking cannot claim

From ADR 0056 (f):

- The worlds are simulated portals with invented actors; no ranked figure is any real person's
  money. Recall is one run with one model (Sonnet), extrapolated to a year; each row's
  `bench.runs.n` says so until the playbooks are benched again (ADR 0128).
- The economics are sourced estimates, several of them vendor figures. The money is not all of one
  kind: lien-desk's is protection, estate-settlement's is fees avoided, most of the rest is money
  recovered, and the ranking adds them as though they were one.
- The default frequency understates: the nine original playbooks have no `times_per_year`, so
  they are ranked on one pass of their world.
- The edge is the author's judgement, the only input set without a source.
- `incumbent_fee_pct` is a contingency share only and is reported, never scored (ADR 0064);
  household-employer-tax keeps the one converted flat fee, so its reported fee avoided is the
  flat $708.

## Limits

A playbook's portals are a model of the real ones: the bench proves her judgement on the data and
the rules, not that a given site registers these tools; on a real site she reaches the same data
through the generic hands. Rules are fixed in each world from public sources and are not legal or
tax advice. The bench answers no card, so actions that depend on a signed card (a payment after an
allowance) are sometimes held, correctly, and scored as missed.

## What the panel says about its numbers

Under the header badge a standing line reads "Measured once on an invented portal world, not on your accounts." and repeats on an opened playbook's bench glance. Every measured figure says it was measured "on the bench"; the tile's value and the minutes by hand are the author's estimate and are labelled so, and each tile carries the first sentence of its playbook's caveat.
