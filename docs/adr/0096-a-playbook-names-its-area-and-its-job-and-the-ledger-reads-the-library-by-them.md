# 0096. A playbook names its area and its job, and the ledger reads the library by them

Date: 2026-10-14

Follows [0040](0040-a-playbook-is-data-and-earns-its-place-on-the-bench.md),
[0044](0044-a-handed-playbook-is-the-active-project-on-every-turn.md),
[0055](0055-playbook-evidence-the-media-stay-local-the-index-is-committed.md),
[0056](0056-how-the-best-use-of-athena-is-ranked.md) and
[0057](0057-the-roster-of-100-playbooks-and-the-rules-they-are-authored-by.md). README section 14.

## Context

The roster is complete: a hundred playbooks, each benched (ADR 0057). Each one says what it is in
prose, and in two short fields: `audience` (home or work) and `domain`. `domain` is free text. ADR
0057 chose breadth on purpose, so the hundred playbooks carry 49 distinct domains, and 25 of them
hold a single playbook (Credit, Privacy, Freelance, Sales tax, Tenancy and twenty more). Nothing
groups them. "Clinics" and "Patient health" are one area to a person looking for help with a
doctor's bill, and "Family care" holds a Medicare plan review, a long-term-care claim and a
household payroll, which are three different areas.

The desktop shows the library as an edge map and a grid filtered by home or work (README §14). That
was enough for nine playbooks. A hundred cannot be browsed by a filter of two values and a sort.
A person comes with one of two questions: *what is there for my area* (my clinic, my trucks, my
mother's care) and *what do I need done* (get money back, apply for something, fight a decision,
file something on time). Free text answers neither, and a new domain string per playbook means
the list of answers keeps growing.

## Decision

1. **One list.** `playbooks/taxonomy.json` is the only place the areas and jobs are defined:
   `{"categories": [{id, label}, ...], "jobs": [{id, label}, ...]}`, in the order a reader sees
   them. The bench reads it (`spec.load_taxonomy`); the desktop imports the same file
   (`apps/desktop/src/lib/playbook-taxonomy.ts`). Adding, renaming or removing an id is an
   amendment to this ADR.
2. **Ten areas.** `health` (Health & clinics), `freight` (Freight & trade), `commerce` (Commerce
   & payments), `employment` (Employment & payroll), `consumer` (Consumer & money), `benefits`
   (Benefits & aid), `housing` (Housing & vehicles), `public` (Public funding & compliance),
   `construction` (Construction & trades) and `family` (Family & estate). Each of the 49 domains
   maps to one area, except "Family care", which is split by what each playbook is about: the
   Medicare plan review, the Savings Program and the representative payee go to `benefits`, the
   long-term-care claims and the observation-status appeal to `health`, and the household employer
   to `family`.
3. **Four jobs.** What the playbook does *for the person*: `recover` (gets money owed back:
   refunds, reimbursements, underpayments, claims against a carrier, an airline or an insurer,
   unclaimed property, interest owed), `claim` (applies for or keeps an entitlement or a benefit: aid, a Medicaid renewal,
   the EITC, an exemption, enrolment timing, FEMA),
   `contest` (disputes or appeals a decision, a charge or a denial), and `comply` (meets an
   obligation on time: filings, notices, certifications, records, screenings, permits). When two
   fit, the one the person would search for first wins; the borderline calls are listed below.
4. **Both are required, for every playbook.** `playbook.json` carries `"category"` and `"job"`
   right after `"audience"`. `load_playbook` refuses a playbook that lacks either or names an id
   not in the `taxonomy.json` beside it, with every problem in the usual list. The nine that
   predate ADR 0057 are not exempt: the exemption is for authoring rules that would have meant
   rebuilding their worlds, and two fields cost nothing. `domain` stays, as the playbook's own
   finer name for its area; it is shown, never filtered on.
5. **The ranking carries them.** Every row of `playbooks/ranking.json` has `category` and `job`
   next to `domain` and `audience`. They play no part in the score (ADR 0056 is unchanged).
6. **The desktop's Chores field becomes a ledger.** A rail of the ten areas with their counts (and
   "All 100"), a row of job chips, a sortable table of the playbooks, and a preview of the
   selected one: its process as a blueprint (portals, steps, gates, result), a storyboard of
   stills captured from the real layer, and a band of before and after (the hours by hand against
   her minutes, the money). The edge map stays, as a second view of the same filtered set.
7. **Guided fit hands an adapted command to Athena.** From the preview, the person says which
   portals she really uses (or what hers is called instead) and adds a line about her case; the
   command is rewritten from those answers and handed to Athena exactly as a playbook's own
   command is (ADR 0044): drafted in her composer, the playbook made her active project. Nothing
   is saved as a new playbook.

### The distribution

At the time of this decision, after tagging all hundred:

| Area | recover | claim | contest | comply | Total |
|---|---|---|---|---|---|
| health | 3 | 3 | 3 | 5 | 14 |
| freight | 5 | 0 | 2 | 5 | 12 |
| commerce | 3 | 0 | 3 | 5 | 11 |
| employment | 1 | 3 | 1 | 6 | 11 |
| consumer | 7 | 1 | 3 | 0 | 11 |
| benefits | 1 | 8 | 0 | 3 | 12 |
| housing | 3 | 2 | 3 | 1 | 9 |
| public | 3 | 1 | 1 | 3 | 8 |
| construction | 2 | 0 | 0 | 5 | 7 |
| family | 0 | 1 | 1 | 3 | 5 |
| **Total** | **28** | **19** | **17** | **36** | **100** |

Every area and every job holds at least one playbook, and a test keeps it so: a dead id would be a
rail entry or a chip that always shows nothing.

### The borderline calls

Chosen first, the runner-up second, and why.

| Playbook | Job | Runner-up | Why |
|---|---|---|---|
| 401k-late-deposits | comply | recover | the owner corrects his own late deposits; the money goes to the plan, not to him |
| abn-liability-sweep | comply | recover | the rule decides who may be billed; refunds follow from it |
| bid-opportunity-triage | comply | claim | no job fits closely; the work is set-aside rules and question deadlines |
| certified-payroll | comply | recover | the filing is the act; the released pay estimates are why it is urgent |
| change-order-notices | recover | comply | the notice is on a clock, but a contractor searches for being paid for changed work |
| closeout-package | recover | comply | the package is paperwork; what she wants is the retainage |
| crop-insurance-notice | recover | comply | a 72-hour notice, but the claims against the insurer are the money |
| estate-settlement | comply | recover | an executor's duties in order; claiming what is owed is one of them |
| grant-drawdown-reporting | recover | comply | the drawdown reimburses spent costs; the SF-425 comes with it |
| lien-desk | comply | recover | deadlines served and recorded; what they protect is payment |
| overpayment-refunds | comply | recover | money is returned, not got back: Medicare's 60 days |
| section8-landlord | comply | recover | inspections cured on time are what keep the payments coming |
| ssdi-work-reporting | comply | claim | a reporting duty, done to keep a benefit |
| ui-claim-responses | comply | contest | answered by each state's deadline; contesting is two of ten |
| fafsa-verification | claim | comply | the documents are asked for, but the aid is what is held |
| erate-applications | claim | comply | a filing window, for funding |
| wotc-screening | claim | comply | a 28-day clock, for a tax credit |
| fema-individual-assistance | claim | contest | appeals, but of aid applied for; the job definitions name FEMA under claim |
| medical-records-gather | claim | comply | a right of access exercised, at the fee the rule allows |
| medicare-plan-review | claim | recover | an enrolment choice, though what it moves is money |
| part-d-exception | claim | contest | an exception requested from the plan, not an appeal of one |
| pmi-cancellation | claim | recover | a right the law gives; it stops a charge rather than refunding one |
| ltc-claims | recover | claim | claims against an insurer for care already paid |
| fsa-claims-substantiation | recover | claim | reimbursement of money she already set aside |
| mlc-unmatched-royalties | recover | claim | royalties held for her, registered to reach her |
| clinic-underpayments | recover | contest | short-paid lines disputed to be paid in full |
| escrow-analysis-check | recover | contest | the surplus is the point; the analysis is challenged to get it |
| merchant-fee-audit | recover | contest | overcharges credited |
| out-of-network-claims | recover | contest | claims and chases lead; appeals are a part |
| reg-e-fraud-claims | recover | contest | unauthorised transfers got back |
| subscription-audit | recover | contest | cancellations and refunds |
| clinic-denials | contest | recover | denials reworked and appealed |
| cpg-deductions | contest | recover | deductions are the named case of `contest` |
| customs-protests | contest | recover | protests, by name |
| medical-bills | contest | recover | bills disputed and denials appealed against the EOBs |
| tenant-deposit-return | contest | recover | deductions contested |
| lease-end-wear-charges | contest | recover | charges disputed |
| workers-comp-premium-audit | contest | recover | an audit disputed by duties and records |
| first-time-abate | contest | claim | a penalty asked to be waived |
| public-records-requests | contest | claim | three appeals and a fee dispute lead the day |
| counterfeit-takedowns | contest | comply | notices against listings; no job fits closely |
| data-broker-deletion | contest | claim | the brokers that did not delete are pressed; no money moves |
| funeral-price-check | contest | recover | charges a home cannot require are declined |

### The storyboard, an amendment to ADR 0055

The index also commits a storyboard: three to six WebP stills of the run
(`playbooks/<id>/story/NN.webp`: the abstract, up to four replay turns spread evenly, *What she
filed*), each 960 px wide and at most 24,000 bytes, about 14 MB across the hundred playbooks, and
indexed as `story` in `evidence.json` schema 2 with a caption written from the record and each
file's bytes and sha256. This does not reverse "the media stay local": the film, the WAV and the
capture are still uncommitted; a still is the size of a thumbnail and is the only view of the process
a fresh clone has. It is captured from the Chores depth (ADR 0090), whose layer replaced the one the
film was recorded from, so the stills frame `.stage__layer`, not the old `.layer__sheet`.

### The ledger, as built

- The edge is the ledger's default order and has no column; Value and Time saved are sortable heads
  that cycle most-first, reversed, then back to the edge.
- Time saved reads as the hours the chore takes by hand with the measured speed-up under it; the
  before-and-after band's "With Athena" figure is her measured run, so the ratio matches the table.
- The blueprint ends its spine with the result rather than a third column: at the pane's ~440px a
  third column leaves about twenty characters a step. It draws at most six steps, five portals and
  four gates, each with "and N more".
- The rail, the ledger and the preview scroll on their own inside the depth frame; the adopt row is
  held at the foot of the preview.
- Job and Portals hide under 1560px of field width, because the preview says both; under 1100px the
  preview goes, Job returns, and a row opens the chore.
- The bench-numbers block is one totals line now; the audience filter is gone, the areas replace it.

### Amendment (catalogue)

The ledger above (rail, ledger and preview side by side, with a map view and the old chore page
under it) was compared with two other layouts behind a prototype switch and replaced by the first
of them, a catalogue and a topic page, each full width:

- **The catalogue** puts the areas in a tab bar (a line glyph, the area's first word and its count
  under the job in force), the jobs in chips under it and the order in a three-way switch: Best
  edge (still the default), Most value, Most time saved. Its rows are led by the first still of the
  run and read the playbook's `short_title` and the lead line of its `brief`, two optional fields of
  `playbook.json` (`title` and the promise when absent). A press on a row opens the topic page; the
  arrows only walk. The filters and the last row opened are kept in the depth's view, so the way
  back finds them. There is no map view and no preview pane, and no `LEDGER_WIDE`: the page is a
  size container and its narrow rules only drop columns.
- **The topic page** replaces the chore's own scene and its facets: a hero (the brief as simple
  markdown, the first still, value, time by hand against her run, traps avoided), *How it runs*
  (portals, a numbered spine, each gate as an "asks you first" diamond before the step it guards,
  the result), every still of the run in a grid that opens a lightbox, and *Make it yours* (fit,
  the replay, copy). The replay of a run (`#/chores/<id>/run/<n>`) is unchanged.
- A playbook that names no area is listed under "All" only; the "Uncategorised" rail entry went with
  the rail. Nothing is hidden from "All", and the bench still refuses an untagged playbook.

## Consequences

- A person can find a playbook by area and by what she needs done, and the counts in the rail
  say at a glance where the library is deep (health, freight, benefits) and thin (family,
  construction).
- The desktop parses a missing or unknown id to `null` and shows it under "Uncategorised" rather
  than hiding the playbook, so a library mid-edit still renders. The bench is stricter: it refuses
  the playbook, so nothing untagged ships.
- A playbook copied out of the library alone (a test fixture, a scratch directory) is refused until
  `taxonomy.json` travels with it. There is no default list in the code; a fixture that builds a
  library copies the shipped file beside it.
- The tagging is a judgement, made once, by a table of domain to area and per playbook for
  jobs, and shipped without a second review by decision. Forty-odd calls were borderline and are
  listed above, so a reader who disagrees can see what was weighed. Changing one is a one-line
  edit to a `playbook.json`; the tests and the ranking follow.
- `domain` and `category` now say overlapping things. `domain` is kept because it is finer and
  already appears across the docs and the ranking; it is no longer the field anything groups by.
- The distribution leans to `comply` and `recover` (64 of 100). That is what the roster is: the
  chores worth an agent are mostly deadlines and money owed. Benefits holds no `contest` and
  freight, commerce and construction hold no `claim`; that is a fact about the roster, not a gap
  in the list.

## Alternatives that lost

- **Keep `domain` and group it in the desktop.** A mapping table in TypeScript would have
  duplicated the judgement in a second language and left the bench unable to check it. One file
  read by both sides cannot drift.
- **Tags, several per playbook.** A playbook that is "recover" and "contest" at once is the
  borderline case above, not the common one, and a rail of multi-tagged rows counts some twice.
  One area and one job each, with the runner-up written down here, is plainer.
- **More areas.** Fourteen or fifteen would have split health and freight finer, at the cost of
  areas of two or three playbooks. Ten keeps every area at five or more.
- **Job as a sort, not a filter.** People arrive with the job in mind ("get my money back"); a
  sort would not let them see only those.
