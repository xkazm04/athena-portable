# Playbooks and the bench

`playbooks/<id>/`, `src/athena/proving/playbooks/`, the desktop's Playbooks module. README §14;
ADR 0040.

A playbook is a chore worth real money that only an agent living in the person's own tabs can do:
it spans portals no integration reaches and ends in something irreversible that wants a signature.
Each one is data, and earns its place on the desktop by a run on the bench.

## The files

| File | Contents |
|---|---|
| `playbook.json` | the showcase: persona, chore, the command the person gives, portals, gates, traps, memory, economics with sources, edge scores, audience (home or work), the expectation it is held to, lessons, a caveat |
| `world.json` | the portals as data: apps with origins, views, aliases and tools with honest flags; tables the reads answer from (exact, `contains` or `words` matching, paging, required ids); the phases of a run |
| `truth.json` | what a perfect run files and what looks eligible but is not, per tool: eligible items with value and expected parameters (an item can be `required`), traps with the reason, fair-either-way items; only the scorer reads it |
| `bench.json` | the latest measured run, committed: score, cards, the trap ledger, the turn-by-turn trace, closing words and every earlier run's headline |

```bash
uv run python -m athena.proving.playbooks check          # every playbook loads; fails on a read the cap would cut, <2 portals, <8 traps, no times_per_year (ADR 0057 rule 1; not the nine older ones), a per outside ADR 0056's table, or $0 with no weighted truth
uv run python -m athena.proving.playbooks bench <id> --model sonnet --cap 8 --note "what changed"
uv run python -m athena.proving.playbooks rescore <id> proving-runs/<ts>/playbook-<id>/report.json
```

## The bench

A real Athena on a throwaway brain, on the person's `claude` CLI, driven through the daemon's own
routes (`proving/world.py`). Each phase is one portal, since a turn is pinned to one origin; what
carries between portals is her memory. The simulated pages (`page.py`) answer host calls the way
the desktop run loop does and know nothing of the truth. Two things a person would do are
simulated from the run loop and her words alone: "keep going" when the loop's bound stops her
mid-work, and switching tabs when she asks for one by name (at most three times).

## The score

Read from the cards the gate filed, never from her prose. Each card is right, fair either way, a
duplicate, a trap, unfounded or forbidden; exact parameters, the money found, the traps walked past
and a ledger of every trap follow. A total stated in her closing words is audited against the
cards. The verdict (exceeds, meets, short) holds both the money and the count of items to the
playbook's bar, and missing a required item is short (ADR 0051).

## The sixty-nine playbooks (latest runs, Claude Sonnet)

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

Across the latest runs: $1,092,009 of $1,101,436 found, 714 of 714 traps walked past, no false claim,
201 minutes of her time against about 293 hours by hand, $124.93 of model time. 107 runs are recorded
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

## Limits

A playbook's portals are a model of the real ones: the bench proves her judgement on the data and
the rules, not that a given site registers these tools; on a real site she reaches the same data
through the generic hands. Rules are fixed in each world from public sources and are not legal or
tax advice. The bench answers no card, so actions that depend on a signed card (a payment after an
allowance) are sometimes held, correctly, and scored as missed.

## What the panel says about its numbers

Under the header badge a standing line reads "Measured once on an invented portal world, not on your accounts." and repeats on an opened playbook's bench glance. Every measured figure says it was measured "on the bench"; the tile's value and the minutes by hand are the author's estimate and are labelled so, and each tile carries the first sentence of its playbook's caveat.
