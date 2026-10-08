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

## The nine playbooks (latest runs, Claude Sonnet)

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

Across the latest runs: $585,243 of $594,670 found, 114 of 114 traps walked past, no false claim,
36 minutes of her time against about 95 hours by hand, $32.24 of model time. 36 runs are recorded
in the playbooks' histories.

## The desktop module

The overview: the edge map, the record (money found, traps walked past, false claims, her time
against the hours by hand, the model's cost, fixes taught), a grid filtered by home or work and
ordered by edge, money or hours. A playbook's layer: the story and the command (copy it, or hand it
to Athena, which drafts it in her composer and makes it her active project), the portals, gates and
traps; and the proof: the money, the cards, "what she was right to leave alone", **Watch the run**
(a rail of tab visits, a dot per turn coloured by what it did, play, step and arrow keys, the money
found so far), the runs over time, what it taught Athena, and the economics against the incumbent.

## Limits

A playbook's portals are a model of the real ones: the bench proves her judgement on the data and
the rules, not that a given site registers these tools; on a real site she reaches the same data
through the generic hands. Rules are fixed in each world from public sources and are not legal or
tax advice. The bench answers no card, so actions that depend on a signed card (a payment after an
allowance) are sometimes held, correctly, and scored as missed.
