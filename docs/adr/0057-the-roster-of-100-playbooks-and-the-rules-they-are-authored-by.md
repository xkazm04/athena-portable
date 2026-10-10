# 0057. The roster of 100 playbooks, and the rules they are authored by

Date: 2026-10-09

Follows [0040](0040-a-playbook-is-data-and-earns-its-place-on-the-bench.md),
[0051](0051-the-count-is-held-to-the-bar-and-deadlines-are-required.md),
[0055](0055-playbook-evidence-the-media-stay-local-the-index-is-committed.md) and
[0056](0056-how-the-best-use-of-athena-is-ranked.md). README section 14.

## Context

Nine playbooks are benched, in nine domains: Trucking, Clinics, Food & beverage, Family affairs,
E-commerce, Freelance, Construction, Family care and Daily life. Each one exceeds its bar
(README §14). Nine is too few to say which use of Athena is the best, and every one of them was
chosen by hand, one at a time.

Ninety-one more are planned, to be built in parallel batches. If each batch picked its own chores,
two batches would pick the same one, and the rules would loosen to fit whatever a batch found
convenient to bench. This ADR fixes both before the first new playbook is authored. It fixes the
roster, and it fixes the rules every batch follows. The ranking method is fixed in ADR 0056.

## Decision

### The shape of the roster

- **Breadth over depth.** The point is to find the best use, so the roster covers more than forty
  domains and both audiences: 41 rows are `home` and 50 are `work`, which makes 44 and 56 with the
  nine existing.
- **B1 takes the widest spread.** It has eleven rows, each in a distinct domain, and none of those
  domains is one of the nine existing.
- **B2 to B9 deepen the strongest domains.** "Strongest" is read from ADR 0056's worked table:
  Construction, then Clinics, then Family affairs and Family care, then Food & beverage. The
  domains that B1 opens follow, grouped by kind. The batches are in that order.
- **Minutes count, not only money.** Rows marked *mostly minutes* claim value that is mostly hours
  saved, because a chore that recovers nothing but takes forty hours by hand is also a candidate
  for the best use.
- **No row is the same chore in another industry.** Disputing a record that scores you, renewing a
  registration, checking a counterparty's insurance, and auditing invoices against a contract each
  appear at most once. Rows that would have repeated one of them were struck while drafting. No
  row repeats the chore of any of the nine existing playbooks.
- **Portal names are invented.** A name that turns out to collide with a real product is renamed
  before the first bench.

Each row gives an id (the directory name, kebab-case, unique), domain, audience, the chore, 2 to 6
invented portals, the public rule or programme it rests on, the value claimed with its `per`
(always from ADR 0056's table), and why only Athena can do it. *P* means portal-locked (the act
exists only in a web form), *X* cross-system (the truth is split across portals no integration
joins), and *J* judgement (the rule leaves traps that look eligible).

### B1: the widest spread (eleven rows, eleven domains)

| # | id | Domain | Aud. | Chore | Portals | Rests on | Value / per | Why only Athena |
|---|---|---|---|---|---|---|---|---|
| 1 | `eu261-flight-compensation` | Air travel | home | Claim compensation for a family's delayed and cancelled flights, and leave alone the ones the rule excludes | Aerolark claims, Skyrail claims, Mailnest, Tripfold itineraries | EU Regulation 261/2004, Art. 5–7 (€250–600 a passenger; extraordinary circumstances excluded) | $1,300 / episode | P X J: each airline's own form; the delay is in the mail, the cause on a status page; weather is a trap |
| 2 | `pslf-employment-certification` | Student loans | home | Certify every employer period for Public Service Loan Forgiveness and find the months that were miscounted | Loanbridge servicer, AidPath, Payroll Harbor (two employers), Mailnest | Public Service Loan Forgiveness, 34 CFR 685.219, and its employer certification form | $40,000 / episode | X J: the payment history against employment in two payrolls; forbearance months and non-qualifying plans |
| 3 | `property-tax-appeal` | Housing | home | Protest the home's assessed value with comparable sales before the deadline | Countyline Appraisal, Compsmith sales, Deedvault, Mailnest | The state's assessment protest (e.g. Texas Tax Code ch. 41: by May 15 or 30 days after the notice) | $1,100 / year | P X J: e-filing only; the notice, the comps and the condition evidence are in three places; not every sale is comparable |
| 4 | `recoverable-depreciation` | Home insurance | home | Collect the replacement-cost holdback after the repairs are done, inside the policy's window | Hearthguard claims, Buildmark contractor, Ledgerline bank, Mailnest | The replacement-cost policy, and California Insurance Code §2051.5(b) (at least 12 months to collect; 36 after a declared emergency) | $6,500 / episode | X J: invoices and payments against the adjuster's line items; an unrepaired line is a trap |
| 5 | `medicaid-renewal` | Public benefits | home | Answer a household's Medicaid renewal with the income proof it asks for, before coverage lapses | Statecare Benefits, Payroll Harbor, Ledgerline bank, Mailnest | Medicaid renewals, 42 CFR 435.916 (ex parte first; at least 30 days to return the form) | $7,000 / year | P X J: which income counts and who is in the household |
| 6 | `data-broker-deletion` | Privacy | home | Send and track deletion requests to data brokers, and confirm that the listings are gone | Erasepoint registry, Findwho, Lookabout, Mailnest | California Delete Act (SB 362) and its deletion mechanism; the CCPA's right to delete | $0 / year, mostly minutes (about 12 h) | P J: each broker's own form; a namesake's listing is a trap |
| 7 | `wotc-screening` | Hiring | work | Screen each new hire for the Work Opportunity Tax Credit and file Form 8850 inside 28 days | Talentry ATS, Payroll Harbor, WorkCredit Online (state), Mailnest | Work Opportunity Tax Credit, IRC §51; Form 8850 within 28 days of the start date | $9,600 / year | P X J: start dates in payroll, answers in the ATS; a late form is void |
| 8 | `duty-drawback` | Customs & trade | work | Match exports to the imports they came from and claim back 99% of the duty | Portline Entries, Forwarden broker, Ledgerline ERP, Docshelf | Duty drawback, 19 U.S.C. §1313 and 19 CFR Part 190 (99% of duties; five years from import) | $30,000 / year | X J: entry lines, export proof and the bill of materials; a line already claimed is a trap |
| 9 | `crop-insurance-notice` | Agriculture | work | Give notice of crop damage inside 72 hours and file the claim with the yield records it needs | Fieldmark agent portal, Acrelog farm records, Rainmark station, Mailnest | Common Crop Insurance Policy, 7 CFR 457.8, §14 (notice within 72 hours of discovery) | $18,000 / year | X J: weather, planting dates and yields; an uninsured cause is a trap |
| 10 | `grant-drawdown-reporting` | Nonprofit | work | Draw federal grant funds against costs already spent, and file the quarterly financial report | Grantflow Payments, Ledgerline accounting, Payroll Harbor, Docshelf | Uniform Guidance, 2 CFR 200.305 (payment) and 200.328 (financial reporting, SF-425) | $2,500 / quarter, mostly minutes | P X J: allowable costs from accounting and payroll; an unallowable cost is a trap |
| 11 | `federal-prompt-pay-interest` | Government contracting | work | Find federal invoices paid late without the interest owed, and claim the interest and the penalty | Invoicepoint, Ledgerline bank, Contractdesk, Mailnest | Prompt Payment Act, 31 U.S.C. §3901–3907, and 5 CFR Part 1315 (interest after the due date; a penalty when it is not paid) | $3,500 / year | X J: acceptance dates against deposits; a disputed invoice's clock has not started |

### B2: Construction and property

| # | id | Domain | Aud. | Chore | Portals | Rests on | Value / per | Why only Athena |
|---|---|---|---|---|---|---|---|---|
| 12 | `certified-payroll` | Construction | work | File weekly certified payroll on prevailing-wage jobs, so that progress payments are not withheld | Crewpay payroll, Wagecheck (agency), Clockyard timesheets, Docshelf | Davis-Bacon and Related Acts, 29 CFR 5.5(a)(3) (weekly certified payroll, WH-347) | $40,000 / year | P X J: hours, classes and fringes from three systems; the wage determination decides each class |
| 13 | `change-order-notices` | Construction | work | Price every field change and give notice of it inside the contract's claim window | Sitegrid, Estimato, Dailylog, Primeline GC | AIA A201–2017 §7 (changes) and §15.1.3 (claims within 21 days) | $60,000 / year | X J: daily logs, RFIs and estimates; base scope is a trap |
| 14 | `closeout-package` | Construction | work | Assemble the closeout documents the GC holds final payment for | Primeline GC, Sitegrid, Partsmith, Fixturely, Docshelf | AIA A201–2017 §9.10 (final completion and final payment) | $30,000 / year | X J: the spec says which warranties, manuals and as-builts are due |
| 15 | `inspection-scheduling` | Construction | work | Book, track and clear the city inspections on every job, and the re-inspections after corrections | Permitway, Civicdesk, Sitegrid, crew calendar | IBC §110 (required inspections), as each city adopts it | $8,000 / year, mostly minutes | P X J: each city's own portal; the sequence decides what can be booked |
| 16 | `stormwater-permit-log` | Construction | work | Keep the site's stormwater inspections and corrective actions on the permit's schedule | Rainlog, Permitflow, Sitegrid photos, Docshelf (the SWPPP) | EPA 2022 Construction General Permit, Parts 4–5 (site inspections, corrective actions) | $5,000 / year, mostly minutes | X J: rainfall triggers inspections; a finding needs a dated fix |
| 17 | `sub-insurance-certs` | Construction | work | Check each lower-tier sub's certificate and endorsements before they mobilize | Mailnest, Subhub vendor portal, Coverwell agent portal, Sitegrid | ISO additional-insured endorsements CG 20 10 and CG 20 37; an ACORD 25 certificate confers no coverage | $25,000 / year | X J: a certificate is not an endorsement |
| 18 | `homestead-exemption` | Housing | home | File the homestead, over-65 and disability exemptions the household qualifies for, and the late years the law allows | Countyline Appraisal, Deedvault, IDway, Mailnest | Texas Tax Code §11.13 (residence homestead) and §11.431 (late application) | $1,200 / year | P X J: the deed and the ID address must agree |
| 19 | `pmi-cancellation` | Mortgage | home | Ask for mortgage insurance to be cancelled as soon as the loan reaches 80% of the original value | Northgate Servicing, Ledgerline bank, Deedvault, Mailnest | Homeowners Protection Act of 1998, 12 U.S.C. §4902 (request at 80%; automatic at 78%) | $1,500 / year | X J: the schedule against extra payments; a late payment in the year is a trap |
| 20 | `escrow-analysis-check` | Mortgage | home | Check the escrow analysis against the real tax and insurance bills, and claim the surplus | Northgate Servicing, Countyline tax, Hearthguard, Mailnest | RESPA §10; Regulation X, 12 CFR 1024.17(f) (a surplus of $50 or more refunded in 30 days) and 1024.35 (notice of error) | $700 / year | X J: three bills against one analysis |
| 21 | `section8-landlord` | Rental property | work | Keep voucher payments coming: pass inspections, cure abatements, ask for rent increases on time | Landlord Link (housing authority), Rentroll, Repairly, Ledgerline bank | HUD Housing Choice Voucher programme, 24 CFR Part 982 | $9,000 / year | P X J: a failed item against tenant-caused damage |

### B3: Clinics and patients

| # | id | Domain | Aud. | Chore | Portals | Rests on | Value / per | Why only Athena |
|---|---|---|---|---|---|---|---|---|
| 22 | `clinic-underpayments` | Clinics | work | Compare what payers paid with the contracted fee schedule, and appeal the lines paid short | Chartmend PM, Relaywave, Paylance payer hub, Docshelf | The payer agreement's fee schedule; CMS NCCI edits say what is bundled, not short | $2,500 / month | X J: remittances against a contract PDF; a bundled line is a trap |
| 23 | `overpayment-refunds` | Clinics | work | Find credit balances owed back to payers and patients, and refund them inside 60 days | Chartmend PM, Ledgerline bank, Novabridge MAC, Carenook | Social Security Act §1128J(d) and 42 CFR 401.305 (report and return within 60 days) | $8,000 / year | X J: a posting error is not an overpayment |
| 24 | `prior-auth-renewals` | Clinics | work | Renew expiring prior authorisations for ongoing therapy before visits run past them | Chartleaf EHR, Authgate, Authwise, Faxline | CMS Interoperability and Prior Authorization Final Rule, CMS-0057-F (72 hours urgent, 7 days standard) | $1,500 / month, mostly minutes | P X: each payer's portal; visits used against units authorised |
| 25 | `provider-revalidation` | Clinics | work | Keep each clinician's Medicare revalidation, CAQH attestation and licence current | Enrollpoint, Credvault, Boardline, Docshelf | 42 CFR 424.515 (revalidation every five years); CAQH ProView re-attestation every 120 days | $3,000 / year, mostly minutes | P X: four clocks in four portals |
| 26 | `good-faith-estimates` | Clinics | work | Send uninsured patients their good-faith estimate on time, and catch bills that run $400 over it | Chartleaf scheduling, Chartmend PM, Mailnest | No Surprises Act, 45 CFR 149.610 (good-faith estimates) and 149.620 (dispute at $400 over) | $1,200 / year, mostly minutes | X J: co-provider items belong on the estimate |
| 27 | `abn-liability-sweep` | Clinics | work | Bill a patient only where a valid ABN was signed, and refund where it was not | Chartmend PM, Chartleaf EHR, Relaywave, Carenook | Medicare Advance Beneficiary Notice (CMS-R-131), modifiers GA and GZ, Social Security Act §1879 | $1,800 / month | X J: a generic or late ABN is not valid |
| 28 | `hospital-financial-assistance` | Patient health | home | Apply for a hospital's charity care under its published policy, with the household's income proof | Saint Ardent billing, Payroll Harbor, Ledgerline bank, Mailnest | IRC §501(r) and 26 CFR 1.501(r)-1 to -6 (a published policy; 240-day application period) | $6,000 / episode | X J: household income as the policy defines it |
| 29 | `part-d-exception` | Patient health | home | Ask the drug plan for a formulary or tier exception, with the prescriber's statement | Rxmeadow plan, Corner Pharmacy, Carenook | 42 CFR 423.578 (exceptions) and 423.568 (decision within 72 hours) | $2,400 / year | X J: which alternatives were tried and failed |
| 30 | `medical-records-gather` | Patient health | home | Request and assemble records from every provider before a second opinion, at the fee the rule allows | Carenook, Clinora, Patientry, Faxline, Mailnest | HIPAA right of access, 45 CFR 164.524 (30 days; a reasonable, cost-based fee) | $150 / episode, mostly minutes (about 8 h) | P J: three portals; an excessive fee is a trap |
| 31 | `out-of-network-claims` | Patient health | home | Submit superbills for out-of-network therapy and chase each one to payment | Paylance member portal, Sessionly, Ledgerline bank, Mailnest | ERISA claims procedure, 29 CFR 2560.503-1 (decision within 30 days); the plan's out-of-network benefit | $3,000 / year | X J: the deductible's state and the codes |

*Note, 2026-10-10.* Row 26's "Why only Athena" cell reads "co-provider items belong on the
estimate". Its playbook does not author that as an obligation. HHS's enforcement discretion on
co-provider and co-facility items in a convening provider's estimate for uninsured and self-pay
individuals (FAQ Part 3, 2 December 2022, pending further rulemaking) still stands on the world's
date, 9 October 2026, so row 26's trap was authored as a co-provider's bill counted against the
clinic's estimate instead (8e2b997). The row stands as written; only its trap follows the rule in
force. Under rule 9, a row that a batch cannot author honestly is struck by its own amendment,
with the reason, and is never replaced. No row of B3 was struck: rows 27 to 31 were each
authored against their rules as they stand on that date.

### B4: Family affairs and care

| # | id | Domain | Aud. | Chore | Portals | Rests on | Value / per | Why only Athena |
|---|---|---|---|---|---|---|---|---|
| 32 | `funeral-price-check` | Family affairs | home | Compare funeral homes' price lists, and decline the items the rule says are optional | Hollis & Rowe, Greenmeadow, Calder, Mailnest, Docshelf | FTC Funeral Rule, 16 CFR Part 453 (General Price List; no required bundle) | $2,500 / episode | X J: three price lists in a week of grief; a "required" item that is not |
| 33 | `veteran-burial-benefits` | Family affairs | home | Claim the burial allowance, plot allowance and headstone owed for a veteran parent | Vetserve, the funeral home's portal, Docshelf (DD-214), Ledgerline bank | 38 U.S.C. §2302; 38 CFR 3.1700–3.1713 (burial benefits) | $2,000 / episode | X J: service-connected or not decides the amount |
| 34 | `rep-payee-accounting` | Family care | home | Keep a representative payee's records and answer the annual accounting | Benefitline, Ledgerline bank, Oakview Care, Docshelf | SSA representative payee programme, 20 CFR 404.2035 and 416.635; Form SSA-623 | $500 / year, mostly minutes | X J: what counts as the beneficiary's own use |
| 35 | `medicare-plan-review` | Family care | home | In open enrollment, test a parent's drug plan against their real prescriptions and pharmacies | PlanCompass, Corner Pharmacy, Rxmeadow, Carenook | Medicare's annual election period, 42 CFR 423.38(b) (Oct 15 – Dec 7) | $1,200 / year | X J: network pharmacies and prior-auth rules, not the premium alone |
| 36 | `medicare-enrollment-timing` | Retirement & Medicare | home | Enrol in Part B at the right moment, through the employer-coverage special period, without a lifetime penalty | Benefitline, Staffnest HR, the current insurer's portal, Mailnest | 42 CFR 408.22 (late penalty, 10% for each 12 months); the special enrollment period with Form CMS-L564 | $1,000 / year | X J: whether the coverage counts as creditable |
| 37 | `household-employer-tax` | Family care | home | Run a home caregiver's payroll taxes: registration, quarterly payments, Schedule H and the W-2 | Hearthpay, Taxline State, Ledgerline bank, a timesheet app | IRS Publication 926 (household employer's tax guide; Schedule H) | $800 / year, mostly minutes | X J: employee or contractor |
| 38 | `rmd-check` | Retirement & Medicare | home | Make sure a parent takes every required minimum distribution across custodians, and correct a missed one in time | Pinebrook Investments, Harborline IRA, Docshelf, Mailnest | IRC §401(a)(9) and §4974 (25% excise, 10% when corrected in time; SECURE 2.0 §302) | $2,000 / year | X J: the Dec 31 balances at each custodian; an inherited IRA has other rules |
| 39 | `msp-extra-help` | Family care | home | Apply a parent with a low income for a Medicare Savings Program and for Extra Help | Statecare Benefits, Benefitline, Ledgerline bank, Mailnest | Medicare Savings Programs, Social Security Act §1905(p); Extra Help, §1860D-14 | $2,500 / year | X J: which assets count against the limit |
| 40 | `observation-status-appeal` | Family care | home | Catch a hospital stay billed as observation, and appeal for the inpatient days that skilled-nursing coverage needs | Saint Ardent billing, Carenook, Myline Medicare, Oakview Care | NOTICE Act (MOON, CMS-10611); 42 CFR 409.30 (three inpatient days); Medicare's observation-status appeal (Alexander v. Azar) | $10,000 / episode | X J: deadlines; the status, not the bed, decides coverage |
| 41 | `name-change-everywhere` | Family affairs | home | Carry a name change through Social Security, the licence, the passport, the banks and payroll, in the order each requires | Benefitline, IDway, Passdesk, Ledgerline bank, Staffnest | The Social Security name change (Form SS-5) first; REAL ID documents; the State Department's passport name change | $0 / episode, mostly minutes (about 10 h) | P X J: the order matters; each office accepts different documents |

### B5: Freight, trade and trucking

| # | id | Domain | Aud. | Chore | Portals | Rests on | Value / per | Why only Athena |
|---|---|---|---|---|---|---|---|---|
| 42 | `freight-claims` | Logistics | work | File loss and damage claims against carriers inside nine months, with the proof each claim needs | Ridgeway Freight claims, Bluepeak LTL claims, Tracklog TMS, Mailnest, Docshelf | Carmack Amendment, 49 U.S.C. §14706; 49 CFR Part 370 (acknowledged in 30 days, decided in 120) | $18,000 / year | P X J: a clean delivery receipt against concealed damage |
| 43 | `ocean-demurrage-disputes` | Logistics | work | Dispute ocean demurrage and detention invoices that fail the federal billing rule | Meridian Lines, Trident Ocean, Portwatch terminal, Forwarden, Mailnest | FMC Demurrage and Detention Billing Requirements, 46 CFR Part 541 (invoice within 30 days; required contents) | $20,000 / year | P X J: the terminal's availability against the days charged |
| 44 | `parcel-guarantee-refunds` | Logistics | work | Claim late-delivery refunds where the carrier's guarantee is in force, and skip the services where it is suspended | Swiftpost, Lanecourier, Shipdesk, Mailnest | Each carrier's published service guide: its money-back guarantee, the claim window and its suspensions | $4,000 / year | P J: a suspended service or a weather exception is a trap |
| 45 | `customs-protests` | Customs & trade | work | Correct misclassified entries before liquidation, or protest them within 180 days after | Portline Entries, Forwarden, Docshelf (rulings, specs), Ledgerline ERP | 19 U.S.C. §1514 and 19 CFR Part 174 (protest within 180 days); post-summary corrections, 19 CFR 101.9(b) | $30,000 / year | X J: the classification itself is the trap field |
| 46 | `denied-party-screening` | Customs & trade | work | Screen every new order and consignee against the export denied-party lists before it ships | Orderloft storefront, Screenlist, Ledgerline ERP, Mailnest | Export Administration Regulations, 15 CFR Part 744 (Entity List); the Consolidated Screening List; OFAC's SDN list | $0 / year, mostly minutes (about 60 h) | X J: a near-match is not a match, and a true match must not ship |
| 47 | `isf-filings` | Customs & trade | work | Get each Importer Security Filing in 24 hours before loading, from supplier and forwarder data | Factora supplier portal, Forwarden, Portline, Mailnest | Importer Security Filing, 19 CFR Part 149 (24 hours before lading; liquidated damages per violation) | $10,000 / year, mostly minutes | X: the deadline runs on another party's vessel schedule |
| 48 | `ifta-quarterly` | Trucking | work | Build the quarterly fuel-tax return from ELD miles by jurisdiction and the fuel receipts | Roadlog ELD, Pumpline fuel card, Fueltax Online, Docshelf | International Fuel Tax Agreement (quarterly return by the last day of the following month) | $1,200 / quarter | X J: a missing receipt and off-road miles |
| 49 | `driver-qualification-files` | Trucking | work | Keep each driver's qualification file current: medical card, annual record review, Clearinghouse query | Roadlog ELD, Drivecheck, Testline, Staffnest | 49 CFR 391.51 and 391.25 (the file; annual review); 49 CFR 382.701 (annual Clearinghouse query) | $3,000 / year, mostly minutes | X: four clocks per driver in four systems |
| 50 | `lease-operator-escrow` | Trucking | work | Get an owner-operator's escrow back, with interest, after the lease ends | Haulledger settlements, Ledgerline bank, Docshelf (the lease), Mailnest | Truth-in-Leasing, 49 CFR 376.12(k) (escrow accounting and interest; returned within 45 days) | $2,500 / episode | X J: which deductions the lease allows |
| 51 | `oversize-permits` | Trucking | work | Route an oversize load and buy its permit in each jurisdiction on the way | Oversize Online, Wideload Desk, Statepermit, Routeplan, dispatch inbox | Each jurisdiction's oversize and overweight permit rules within 23 CFR Part 658 | $1,500 / year, mostly minutes | P J: each portal's own form; bridge and curfew restrictions |

*Note, 2026-10-10:* these portal names were changed before a first bench, because the roster's name
belongs to a real business (rule 4: every portal is invented). The rows above keep the roster's
names; each playbook carries the new one.
- Row 46, `denied-party-screening`: "Orderloft storefront" became "Orderwick storefront", because
  orderloft.com is a real ordering site (a6abe56).
- Row 47, `isf-filings`: "Factora supplier portal" became "Sourcewick supplier portal", because
  Factora is a real e-invoicing and supplier-finance software name; "Portline" became "Quayloft ISF
  desk", because Portline is a real Lisbon shipping line; and "Mailnest" became "Postwren", because
  mailnest.io is a real email service.
- Row 48, `ifta-quarterly`: "Roadlog ELD" became "Odowren ELD", because VDO RoadLog is a real ELD;
  "Fueltax Online" became "Tallyquart IFTA filing", because FuelTaxOnline is a real IFTA reporting
  product; and "Docshelf" became "Binderwell", because DocShelf is a real document management app.
- Row 49, `driver-qualification-files`: "Roadlog ELD" became "Logmarrow ELD", because VDO RoadLog is
  a real ELD; "Drivecheck" became "Screenmoor MVR", because DriveCheck is a real inspection app and
  DriverCheck a real drug-testing administrator; "Testline" became "Specimoor Clearinghouse desk",
  because TestLine is a real maker of diagnostic tests; and "Staffnest" became "Crewmarrow HR",
  because StaffNest is a real HR service.
- Row 50, `lease-operator-escrow`: "Haulledger settlements" became "Settlewick settlements", because
  HaulLedger is a real IFTA trip-log app for owner-operators; "Ledgerline bank" became "Ledgerwren
  bank", because Ledgerline is the name of several real accounting and invoicing products;
  "Docshelf" became "Sheafbox", because DocShelf is a real document management app; and "Mailnest"
  became "Postwren", because mailnest.io is a real email service.
- Row 51, `oversize-permits`: "Oversize Online" became "Tarnwide Oversize (Oklahoma)", because
  oversizeonline.com is a real clothing brand; "Wideload Desk" became "Halvern Permit Desk
  (Arkansas)", because Wide Load Permits is a real permit service; "Statepermit" became "Fernaby
  Permits (Tennessee)", because State Permits is a real permit service; and "Routeplan" became
  "Pathcairn route planner", because Routeplanner is the name of real route-planning products.

### B6: Small-business money, food, and selling online

| # | id | Domain | Aud. | Chore | Portals | Rests on | Value / per | Why only Athena |
|---|---|---|---|---|---|---|---|---|
| 52 | `sales-tax-exemption-certs` | Sales tax | work | Collect and check resale and exemption certificates from wholesale buyers before an audit asks for them | Storeline admin, Taxline State, Clientry CRM, Mailnest | Streamlined Sales and Use Tax Agreement certificate of exemption (Form F0003) and its 90-day rule | $15,000 / year | X J: an expired or out-of-state certificate |
| 53 | `gpsr-listings` | E-commerce | work | Bring every EU listing up to the product-safety rule: responsible person, warnings, identifiers | Marketora seller, Bazaarly seller, Docshelf (test reports), Mailnest | EU General Product Safety Regulation (EU) 2023/988, Art. 19 (information in distance sales) | $10,000 / year, mostly minutes | P J: two marketplaces, two forms; a missing warning that the product does not need |
| 54 | `chargeback-representment` | Payments | work | Answer card chargebacks with the evidence each reason code needs, and accept the ones that are right | Paycurrent dashboard, Storeline, Shipdesk, Mailnest | Visa Core Rules and Visa Product and Service Rules (dispute resolution); Mastercard Chargeback Guide | $8,000 / year | P X J: a valid dispute is a trap to contest |
| 55 | `merchant-fee-audit` | Payments | work | Check card-processing statements against the contract and the networks' interchange tables | Paycurrent, Docshelf (the contract), Ledgerline bank | Visa and Mastercard published U.S. interchange reimbursement fee schedules | $4,000 / year | X J: a downgrade is not a markup |
| 56 | `counterfeit-takedowns` | E-commerce | work | Find listings that copy the brand's products, and file takedowns with the proof each marketplace asks for | Marketora, Bazaarly, Brandledger, Docshelf | DMCA, 17 U.S.C. §512(c)(3), for copied images; each marketplace's published IP complaint policy | $10,000 / year, mostly minutes | P J: a reseller of genuine goods is a trap |
| 57 | `trademark-maintenance` | Intellectual property | work | File the declarations of use and renewals each registration needs, with specimens only for goods still sold | Markfile, Storeline, Docshelf, Mailnest | Lanham Act §8 and §9 (15 U.S.C. §1058, §1059); 37 CFR 2.161 (specimens) | $5,000 / year, mostly minutes | X J: declaring use for a discontinued good is a false statement |
| 58 | `mlc-unmatched-royalties` | Music & creative | work | Register a songwriter's works so that unmatched mechanical royalties reach them | Royaltyline, Tunecast distributor, Songguild, Docshelf (split sheets) | Music Modernization Act of 2018, 17 U.S.C. §115(d) (the mechanical licensing collective; unmatched royalties) | $1,500 / year | X J: splits and code matching across three catalogues |
| 59 | `first-time-abate` | Tax notices | work | Answer IRS penalty notices with the first-time abatement the record qualifies for | Taxline Federal, Ledgerline, Docshelf (notices), Mailnest | IRS First Time Abate, IRM 20.1.1.3.3.2.1 | $1,200 / episode | X J: a clean three-year history, and which penalties qualify |
| 60 | `organic-annual-update` | Food & beverage | work | Assemble the certifier's annual update: plan changes, supplier certificates, import certificates | Certifield Organic, Organicheck, Ledgerline ERP, Docshelf | USDA National Organic Program, 7 CFR 205.406 (annual update); the Strengthening Organic Enforcement rule (import certificates) | $2,000 / year, mostly minutes | X J: a supplier whose certificate lapsed |
| 61 | `food-recall-trace` | Food & beverage | work | When a supplier recalls an ingredient, trace its lots to finished goods and customers, and no further | Ledgerline ERP, Mailnest (the notice), Freshroute, Pantrylink, Docshelf (lot records) | FDA Food Traceability Rule, FSMA §204 and 21 CFR Part 1 Subpart S | $20,000 / episode | X J: unaffected lots are traps, and so is a missed one |

*Note, 2026-10-10:* these portal names were changed before a first bench, because the roster's name
belongs to a real business (rule 4: every portal is invented). The rows above keep the roster's
names; each playbook carries the new one.
- Row 52, `sales-tax-exemption-certs`: "Clientry CRM" became "Clientwren CRM", because Clientry is a real CRM
  (useclientry.com); and "Mailnest" became "Postwren", because mailnest.io is a real email service.
- Row 53, `gpsr-listings`: "Marketora seller" became "Stallwick seller", because Marketora is the name of
  several real businesses (a marketing agency, a product-review site); "Bazaarly seller" became
  "Hawkerbrook seller", because Bazaarly is a real online-shop name; "Docshelf" became "Binderwell",
  because DocShelf is a real document management app; and "Mailnest" became "Postwren", because
  mailnest.io is a real email service.
- Row 54, `chargeback-representment`: "Shipdesk" became "Parcelwick", because ShipDesk is a real shipping
  software company; and "Mailnest" became "Postwren", because mailnest.io is a real email service.
- Row 55, `merchant-fee-audit`: "Docshelf" became "Binderwell", because DocShelf is a real document
  management app; and "Ledgerline bank" became "Ledgerwren bank", because Ledgerline is the name of
  several real accounting and invoicing products.
- Row 56, `counterfeit-takedowns`: "Marketora" became "Stallwick seller", because Marketora is the name of
  several real businesses (a marketing agency, a product-review site); "Bazaarly" became "Hawkerbrook
  seller", because Bazaarly is a real online-shop name; "Brandledger" became "Brandwick registry",
  because BrandLedger is a real app for brand deals and invoices; and "Docshelf" became "Binderwell",
  because DocShelf is a real document management app.
- Row 57, `trademark-maintenance`: "Markfile" became "Markwick filing desk", because markfile.com is a real
  site (a travel-marketing consultant's, in another field) and Markfile is a name worth not sharing
  with a filing product; "Docshelf" became "Binderwell", because DocShelf is a real document
  management app; and "Mailnest" became "Postwren", because mailnest.io is a real email service.

### B7: Household money

| # | id | Domain | Aud. | Chore | Portals | Rests on | Value / per | Why only Athena |
|---|---|---|---|---|---|---|---|---|
| 62 | `reg-e-fraud-claims` | Consumer banking | home | Report unauthorised transfers inside the windows that cap liability, and follow each investigation | Ledgerline bank, Zipcash, Cardwell, Mailnest | Regulation E, 12 CFR 1005.6 (liability by notice time) and 1005.11 (error resolution) | $900 / episode | P X J: a payment she authorised to a scammer is not an unauthorised transfer |
| 63 | `credit-report-disputes` | Credit | home | Dispute the wrong entries on three credit reports with the proof, and check each result | Ledgerscore, Creditaire, Scorewell, Ledgerline bank, Mailnest | Fair Credit Reporting Act §611, 15 U.S.C. §1681i (reinvestigation within 30 days) | $1,000 / year, mostly minutes | P X J: an accurate negative entry is a trap |
| 64 | `tenant-deposit-return` | Tenancy | home | Get a security deposit back, itemised and on time, with the move-in and move-out evidence | Rentroll tenant portal, Snapshelf photos, Courtfile, Mailnest | California Civil Code §1950.5 (itemised within 21 days; ordinary wear not deductible) | $1,500 / episode | X J: wear or damage |
| 65 | `vehicle-recall-reimbursement` | Vehicles | home | Claim the manufacturer's reimbursement for a repair paid before the recall was announced | Recallcheck, Autopoint Service, Motorvia Owners, Mailnest | 49 CFR 573.13 (reimbursement for remedies before notification) | $700 / episode | X J: the repair must match the recall and fall in its window |
| 66 | `lease-end-wear-charges` | Vehicles | home | Contest lease-end excess-wear charges against the inspection and the lease's own standard | Motorvia Finance, Checkpoint Inspect, Snapshelf, Mailnest | Consumer Leasing Act; Regulation M, 12 CFR 1013.4(l) (wear standards must be reasonable) | $900 / episode | X J: a real excess is a trap to contest |
| 67 | `baggage-delay-claims` | Air travel | home | Claim delayed-baggage expenses inside 21 days, with the receipts that qualify | Aerolark baggage claims, Cardwell, Tripfold, Mailnest | Montreal Convention 1999, Art. 19, 22 and 31 (written complaint within 21 days) | $500 / episode | P J: which purchases were reasonable in the interim |
| 68 | `travel-credit-refunds` | Air travel | home | Turn credits from cancelled or significantly changed flights into the cash refunds the rule requires | Aerolark, Skyrail, Tripfold, Cardwell | DOT refunds rule, 14 CFR Part 260 (automatic refunds for cancelled or significantly changed flights) | $800 / year | P J: a change she made herself is a trap |
| 69 | `subscription-audit` | Subscriptions | home | Find every recurring charge, cancel the unused ones online, and claim refunds where renewal rules were broken | Cardwell, Ledgerline bank, Streamora, Fitloop, Cloudnest, Mailnest | California Automatic Renewal Law, Bus. & Prof. Code §17600–17606 | $600 / year, mostly minutes | P X J: a family member's active use is a trap |
| 70 | `class-action-claims` | Consumer settlements | home | File claims in open settlements the household qualifies for, and only with proof of purchase | Claimsadmin, Cardwell, Storeline orders, Mailnest | Federal Rule of Civil Procedure 23(e) (court-approved settlements) and each settlement's claim form | $200 / year, mostly minutes | X J: the claim is signed under penalty of perjury; no proof means no claim |
| 71 | `unclaimed-property-sweep` | Personal finance | home | Search every state the household lived in for unclaimed property, and file the claims with proof | Claimit State, Lostfunds, Docshelf (old addresses), Mailnest | State unclaimed-property programmes under the Revised Uniform Unclaimed Property Act (2016) | $400 / episode | P X J: a namesake is a trap |

### B8: Work, pay and benefits

| # | id | Domain | Aud. | Chore | Portals | Rests on | Value / per | Why only Athena |
|---|---|---|---|---|---|---|---|---|
| 72 | `fsa-claims-substantiation` | Benefits | home | Claim every eligible FSA expense before the run-out ends, with the substantiation the plan asks for | Flexwell, Corner Pharmacy, Paylance member portal (EOBs), Ledgerline bank | IRC §125 and §129; Prop. Treas. Reg. §1.125-6 (substantiation); the plan's run-out | $900 / year | X J: an ineligible expense is a trap; the deadline is the plan's |
| 73 | `parental-leave-claims` | Employment | home | Line up job-protected leave, state paid family leave and disability pay for a birth, with no gap and no overlap | Staffnest, Familyleave State, Shieldline, Carenook | FMLA, 29 CFR Part 825; the state's paid family leave law (e.g. New York Paid Family Leave) | $8,000 / episode | X J: an overlap of benefits is a trap |
| 74 | `layoff-sixty-days` | Employment | home | After a layoff, file for unemployment, choose COBRA or a marketplace plan inside 60 days, and keep to the severance terms | Staffnest, Joblink State, Coverfind, Mailnest | 45 CFR 155.420 (60-day special enrollment); COBRA election, 29 CFR 2590.606-4; the state's UI law | $3,000 / episode | X J: three clocks that start on different days |
| 75 | `ui-claim-responses` | Unemployment insurance | work | Answer each state's notice of a former employee's claim on time, with the facts of the separation | Joblink employer portal, Staffnest, Docshelf, Mailnest | The state's UI law; Social Security Act §303(a)(10) (no relief of charges after a late or inadequate response) | $3,000 / year | P X J: contesting a valid claim is a trap |
| 76 | `cobra-notices` | Benefits administration | work | Send a COBRA election notice inside the window for every qualifying event | Staffnest, Carriercore, Mailnest | ERISA §606; 29 CFR 2590.606-4 (notice within 44 days); ERISA §502(c)(1) penalties | $2,000 / year, mostly minutes | X J: which events qualify |
| 77 | `401k-late-deposits` | Benefits administration | work | Find employee 401(k) deferrals deposited late, and correct them with the lost earnings | Payroll Harbor, Retireline, Ledgerline bank, Correctcalc | 29 CFR 2510.3-102(a) (seven-business-day safe harbor for small plans); DOL Voluntary Fiduciary Correction Program | $2,500 / year | X J: pay dates against deposit dates |
| 78 | `workers-comp-premium-audit` | Business insurance | work | Answer the annual premium audit with the right class codes and the subs' certificates | Auditwell, Payroll Harbor, Coverwell, Docshelf | NCCI Basic Manual and Scopes of Basic Manual Classifications; the state's audit dispute process | $5,000 / year | X J: classification by duty, not by title |
| 79 | `osha-300-log` | Workplace safety | work | Keep the injury log, post the annual summary, and submit it electronically by March 2 | Mailnest (incident reports), Staffnest, Injurylog ITA, Docshelf | 29 CFR Part 1904 (1904.7 recordability; 1904.32 posting; 1904.41 electronic submission) | $3,000 / year, mostly minutes | X J: first aid is not recordable |
| 80 | `remote-payroll-registration` | Payroll | work | Register withholding and unemployment accounts in each state where a remote employee works, before the first payroll there | Payroll Harbor, Taxline State, Revenuedesk, Staffnest | Each state's employer registration for withholding and unemployment insurance (UI localization under state law) | $2,000 / year, mostly minutes | P J: where the work is localized |
| 81 | `adverse-action-notices` | Hiring | work | Send the pre-adverse-action notice, and wait, before rejecting a candidate on a background check | Talentry ATS, Clearcheck, Mailnest | FCRA §604(b)(3) and §615, 15 U.S.C. §1681b(b)(3) and §1681m | $1,500 / year, mostly minutes | X J: the order and the waiting period |

### B9: Public programmes, schools, farms and nonprofits

| # | id | Domain | Aud. | Chore | Portals | Rests on | Value / per | Why only Athena |
|---|---|---|---|---|---|---|---|---|
| 82 | `fafsa-verification` | Student aid | home | Answer a college's verification request with the documents it names, before the aid is held | Aidcenter, AidPath, Taxline Federal, Mailnest | 34 CFR Part 668 Subpart E (verification) | $5,000 / year | P X: the transcript and the household in three places |
| 83 | `aid-professional-judgment` | Student aid | home | Ask a college to recompute aid after a job loss, with the proof of the change | Aidcenter, Joblink State, Payroll Harbor, Mailnest | Higher Education Act §479A, 20 U.S.C. §1087tt (professional judgement) | $4,000 / year | X J: what counts as a change in circumstances |
| 84 | `eitc-claim` | Household tax | home | Claim the Earned Income Tax Credit with the residency proof that the qualifying-child tests ask for | Taxfold, Payroll Harbor, Schoolbook, Mailnest | IRC §32 (EITC) and Schedule EIC; Form 8862 after a disallowance | $3,000 / year | X J: the qualifying-child tests |
| 85 | `ssdi-work-reporting` | Public benefits | home | Report earnings to Social Security month by month, so trial-work months are counted and no overpayment builds | Benefitline, Payroll Harbor, Mailnest | 20 CFR 404.1592 (trial work period) and 404.1592a (extended period of eligibility) | $4,000 / year | X J: which months are trial-work months |
| 86 | `fema-individual-assistance` | Disaster aid | home | Register for disaster assistance, document the losses, and appeal within 60 days | Reliefline, Hearthguard (the settlement), Snapshelf, Mailnest | Stafford Act §408, 42 U.S.C. §5174; 44 CFR 206.110–206.120 (appeal within 60 days) | $8,000 / episode | X J: insurance comes first; a duplicated benefit is a trap |
| 87 | `erate-applications` | Schools & libraries | work | File a school's E-Rate forms in their windows, and match the bids to the eligible services list | Rateline EPC, Ledgerline, Mailnest (bids), Docshelf | Schools and Libraries Universal Service Support, 47 CFR Part 54 Subpart F (Form 470 posted 28 days before Form 471) | $40,000 / year | P J: an ineligible service is a trap |
| 88 | `fsa-acreage-reporting` | Agriculture | work | File the acreage report by crop and field, by the deadline that keeps programme eligibility | Farmgate, Acrelog, Fieldmark | 7 CFR Part 718 (acreage reports; FSA-578, July 15 for most spring crops) | $10,000 / year, mostly minutes | P X: the fields as farmed against the fields as insured |
| 89 | `restricted-funds-release` | Nonprofit | work | Release donor-restricted funds when their conditions are met, and report the release to each funder | Grantpoint, Fundergate, Ledgerline, Docshelf (agreements), Donorbook | FASB ASC 958-605 (conditions and restrictions on contributions); each grant agreement | $30,000 / year | X J: a condition met in part is not met |
| 90 | `bid-opportunity-triage` | Government contracting | work | Read new solicitations, keep the ones the firm can win under its set-aside, and send questions before the Q&A deadline | Bidline, Procurenet, Contractdesk, Mailnest | FAR Part 19 (small-business set-asides) and each solicitation's Sections L and M | $0 / year, mostly minutes (about 100 h) | X J: eligibility for the set-aside, read from the solicitation |
| 91 | `public-records-requests` | Government transparency | work | File, track and narrow public-records requests across agencies, and appeal the late answers | Filerecords, Agencydesk, Docshelf, Mailnest | FOIA, 5 U.S.C. §552(a)(6)(A) (20 working days); the state's public-records act (e.g. California Public Records Act, Gov. Code §7920.000 ff.) | $500 / year, mostly minutes | P J: scope and fee waivers |

### The rules every batch follows

1. **A world is a real chore, at its smallest.** At least 2 portals (`world.json` apps) and at
   least 8 traps (`truth.json` traps across all targets). `uv run python -m athena.proving.playbooks
   check` exits 0, including the read cap.
2. **The bar is set before the bench.** `expectation` is `recall >= 0.75`, `false_claims: 0` and
   `minutes <= 60`. It is written before the first bench and never edited after it. `edge` is fixed
   at the same moment, because ADR 0056 ranks on it. Every `bench.json` records the bar it was
   held to (`verdict.expected`), so a later edit shows.
3. **The truth is frozen at the first bench.** After that, `truth.json` does not change. An
   authoring error that a bench reveals (a fact the world left unstated, a page the cap would cut)
   is fixed in `world.json` only, and re-benched at most twice, each time with `--note` saying what
   changed. A playbook that is still short after that ships short, with its reasons
   (`verdict.reasons`), and ADR 0056 lists it under `unranked`. Weakening a gate, the scorer or
   `truth.json` to make a bench pass is never the fix.
4. **Public rules, invented actors.** Every person, business and portal is invented. The rule is
   real and named in `economics.sources` with a URL. A playbook never gives legal, tax or medical
   advice. It applies a stated rule to stated facts and says so, and it carries a `caveat`
   wherever real use needs one (rows 35, 36, 38, 40, 44, 45, 59, 62, 74, 81, 84 and 86 among them).
   *Note, 2026-10-10:* `check` now enforces the caveat for every playbook, including the three written
   before the roster (`cpg-deductions`, `fba-reimbursements`, `medical-bills`), which now carry one.
5. **Economics per ADR 0056.** `value_usd` with a `per` from its table, `manual_minutes` for the
   chore the world holds, `economics.times_per_year` on every new playbook with its basis,
   `incumbent_fee_pct` wherever an incumbent takes a share, and `sources`. The roster's value is a
   proposal. The sourced figure written before the first bench is the one that counts, and it is
   not edited after the bench.
6. **The showcase is complete.** `domain` and `audience` as in the roster, edge scores with a reason
   each, and the files ADR 0040 names. The README §14 table and `docs/features/playbooks.md` gain
   the playbook's line in the same commit, per AGENTS.md.
7. **The bench is the subscription CLI.** `bench <id> --model sonnet` on the person's own `claude`
   CLI, with a cap. Nothing runs on a paid API. Evidence follows ADR 0055 once the playbook is
   benched.
8. **One playbook, one commit.** AGENTS.md's one commit per feature, applied: the four files, the
   doc lines and the bench together, with the bench's result in the body.
9. **The roster is closed.** A batch builds only its own rows, so batches can run in parallel
   without colliding. An id may be renamed only before the first bench. A row that cannot be
   authored honestly, because its rule was repealed or nothing public sources it, is struck by
   an amendment to this ADR with the reason. It is not replaced, and the total says how many are
   left. No row is added, swapped or moved between batches because a result came in.

## Consequences

- With the nine existing playbooks, the roster makes 100: B1 has eleven rows, and B2 to B9 have
  ten each. It spans more than forty domains, against the fifteen asked for, and 29 rows claim
  value that is mostly minutes.
- What a row proves is still bounded by ADR 0056 (f): mock worlds, invented actors, sourced
  estimates. A row's proposed value is not a finding.
- Several rules carry dates or recent changes that the world has to pin: CMS-0057-F's timelines
  start in 2026, the Food Traceability Rule's compliance date was extended to 2028, and many
  parcel guarantees are suspended. Each world states the rule as of the date it fixes, in its
  `basis` and its caveat.
- Rule 3 can leave a playbook short for good. That is the cost of a bar that cannot move after
  the result. The ranking shows it as unranked, with its reasons, rather than hiding it.
- `check` does not yet enforce 2 portals, 8 traps, `times_per_year` or the ADR 0056 `per` table.
  Until a later change adds that, with tests, each batch's review checks them by hand.

## Alternatives that lost

- **Depth in the nine existing domains.** More trucking, clinic and estate playbooks would sharpen
  what is already known, and could not find a better use that lies elsewhere. The nine already
  exceed their bars. The open question is breadth.
- **Free choice per batch.** It is cheap to start, but parallel batches would pick the same chores,
  and a batch could choose what benches well rather than what matters. That is the fitting that
  ADR 0056 exists to prevent, moved from the method to the roster.
