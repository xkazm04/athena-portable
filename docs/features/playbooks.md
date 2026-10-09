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
uv run python -m athena.proving.playbooks check          # every playbook loads; fails on a read the cap would cut
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

## The twenty playbooks (latest runs, Claude Sonnet)

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
| The property tax protest, with comparable sales | home | 4 | short: 5 of 8, $1,470 of $2,310, 9 of 9 traps, 0 false |
| The insurer's depreciation holdback, collected | home | 4 | exceeds: 4 of 4, $15,190 of $15,190, 8 of 8 traps, 0 false |
| The Medicaid renewal, answered before coverage lapses | home | 4 | exceeds: 8 of 8, $7,000 of $7,000, 8 of 8 traps, 0 false |
| Data brokers told to delete, and checked | home | 4 | exceeds: 5 of 5 (a $32.25 weight, not money), 10 of 10 traps, 0 false |
| Every new hire screened for the Work Opportunity Tax Credit, inside 28 days | work | 4 | exceeds: 5 of 5, $19,200 of $19,200, 9 of 9 traps, 0 false |
| Duties refunded on what was exported: drawback, matched export by export | work | 4 | exceeds: 4 of 4, $13,747.14 of $13,747.14, 8 of 8 traps, 0 false |
| Crop damage noticed inside 72 hours, and the claims filed with the yields | work | 4 | exceeds: 5 of 5, $34,527 of $34,527, both notices in time, 8 of 8 traps, 0 false |
| A federal grant drawn down against what was spent, and the quarter's SF-425 filed | work | 4 | exceeds: 6 of 6, $31,492.60 of $31,492.60 drawn, 9 of 9 traps, 0 false |
| The interest federal agencies owe on late payments, claimed with the penalty | work | 4 | exceeds: 7 of 7, $440.16 of $440.16, 11 of 11 traps, 0 false |

Across the latest runs: $733,787 of $744,054 found, 211 of 211 traps walked past, no false claim,
75 minutes of her time against about 143 hours by hand, $54.39 of model time. 51 runs are recorded
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
