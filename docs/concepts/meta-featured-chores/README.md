# Featured chores on Meta's models - the spike program

Status: **built locally, rehearsed on fixtures** (2026-10-26; staged 2026-10-24) - see
[Where it stands](#where-it-stands-2026-10-26) and [Tomorrow, with a key](#tomorrow-with-a-key). Six concept folders that `/spark` takes one at a
time. They come from the solution contest `athena-meta-solutions` (six design reports, one Opus seat
each, owner review, no judge): the owner descoped one and fused the other five into this program.

## Where it stands (2026-10-26)

All six spikes run end to end on this PC with the Claude Code CLI as Athena's engine and recorded
fixtures where SAM, Voice Transcribe or Spark reading would be (ADRs 0226-0231).

| Spike | Chore (`playbooks/<id>`) | Sense tables | Proofs on fixtures | Status | Bench (Claude CLI, sonnet, n=1) |
|---|---|---|---|---|---|
| 00 | - (`src/athena/senses/`, `src/athena/harness/meta/`) | - | contract, guard, prices, probe tests | - | - |
| 01 | `paper-flip-through` | `sheets`, `sheet_fields` | F1 F2 F2x F3 R2 R3 pass | rehearsed | exceeds: 9/9 ($3,107), 0 false, $1.96 |
| 02 | `prior-auth-denial-appeal` | + `call_turns`, `call_log` | F1 F1k F3 F3x F4 R4 pass | rehearsed | short: 2/3, missed LT-1 (the hold letter), 0 false, $1.49 |
| 03 (descoped 2026-10-27) | `roll-call-inventory` | `inventory`, `inventory_asked` | F1 F1x F3 F4 R2 pass | rehearsed | exceeds: 20/20 ($17,885), 0 false, $2.54 |
| 04 | `renovation-witness` | `walk_counts`, `walk_promises`, `change_checks` | F2 F2d F3 F4 pass | rehearsed | short: 7/9, 2 false claims, missed CO-02 refusal and 1043-7, $0.82 |
| 05 | `care-circle` | `counter_meds`, `circle_tasks`, `signer_rules` (+ paper) | F1 F1x F3 F3a F3x F4 pass | rehearsed | exceeds: 6/6, 0 false, $1.42 |

How it works: `python -m athena.senses build <chore>` runs each sense over `senses/media.json`
and writes `senses/sensed.json`; the loader merges those tables into the world, so the bench's
Athena reads them through ordinary READ tools and acts on the real gate. `prove` scores the build
against `senses/key.json` into `senses/proofs.json`; the Chores scene's featured band shows the
computed status (`proven` needs a role on `meta`). Bench results are in each chore's `bench.json`.
Not measured anywhere yet: every V* proof (Character onboarding and rehearsal through
`proving/chores_uat`), R1-style cross-person variance, the sense Gauntlet, and anything on Meta.

**Descoped 2026-10-27 (owner):** spike 03 `roll-call-inventory` leaves the featured program - it
stays an ordinary chore with its object sense; the other four move on.

## Engines compared (2026-10-27, one run each, `--no-write`)

Athena on three engines over the same five chores, fixtures for every sense. Muse runs through
Muse Code on the plan (`--engine muse_code --model muse-spark-1.3`, Contributor mode off, session
resumed); its cost is plan allowance, not dollars.

| Chore | Claude Sonnet | Claude Opus | Muse Spark 1.3 |
|---|---|---|---|
| `paper-flip-through` | exceeds: 9/9, 0 false, 13 turns, 3.7 min, $1.96 | exceeds: 9/9, 0 false, 12 turns, 5.2 min, $5.69 | short: 6/9, 1 false, 2 dup, 17 turns, 13.1 min |
| `prior-auth-denial-appeal` | short: 2/3, 14 turns, 2.2 min, $1.49 | short: 2/3, 11 turns, 3.9 min, $4.51 | short: 2/3, 13 turns, 5.1 min |
| `roll-call-inventory` | exceeds: 20/20, 11 turns, 2.6 min, $2.54 | 20/20 then over the $4 cap ($7.06) | short: **0/20**, 13 turns, 4.4 min |
| `renovation-witness` | short: 7/9, 2 false, $0.82 | short: 9/9, 1 false, 7 turns, 2.3 min, $1.93 | short: 9/9, 1 false, 6 turns, 2.1 min |
| `care-circle` | exceeds: 6/6, 9 turns, 2.4 min, $1.42 | exceeds: 5/6, 10 turns, 3.5 min, $3.93 | exceeds: 6/6, 11 turns, 8.0 min |

Read across: all three miss 02's hold letter (LT-1) - a chore finding, not an engine one; Opus and
Muse both reach 9/9 on 04 with one false claim. Muse's failure mode is **writing one act where many are due**:
on 03 it priced all 20 lines, wrote "filing the 20 still-owned lines" and one `OP:` line, its
reasoning summary saying it chose "single-line submissions to avoid parse errors" (Muse's own
session log); on 01 it saw three bills and filed none of them. Two law lines were measured and
withdrawn: one telling it to act (03 stayed 0/20; guard 05 gained eleven duplicates) and one telling
it OP lines are parsed one by one (it then batched 4-6 per message, but 03 stayed 0/20 and 05 fell to
3/6). What still breaks 03 is the carry across a scene change: at the insurer's portal Muse recalls
its archive review, re-reads the claim and summarises, where Claude files all 20 from the same
recall. Single-shot
(no session resume) it re-read one pile 1,412 times over 79 turns.

## Tomorrow, with a key

1. `set META_API_KEY=...` then `uv run python -m athena.harness.meta probe` - one call per model
   and endpoint; the report lands in `.spark/Spark/meta/probes/` and lists every shape that
   differed from what the clients assume (`harness/meta/{sam,voice,reader,engine}.py` isolate the
   request builders and reply parsers to fix). Post each surprise as a vault finding.
2. Ask the probe whether SAM takes several prompts per request (finding 20261026-2332: one prompt
   per call prices roll-call at ~$74 a household, not ~$45).
3. Per chore: `uv run python -m athena.senses prove <chore> --reader meta` (paper first: needs
   only the rendered PDFs, `python -m athena.senses render <chore>`), then `--segmenter meta` and
   `--transcriber meta` once real media exists under `senses/media/` (local only, ADR 0055).
   A chore turns `proven` only when its proofs pass with a role on `meta`.
4. Register `MetaModel` as an engine (`engines.py`, `daemon.rs` `KNOWN_ENGINES`, `lib/engines.ts`)
   and run the Gauntlet on Athena-on-Muse (spike 00 P3) before any featured bench on Muse.

## The owner's decision

Owner, 2026-10-24:

> "lets abort, I will descope track A/1. I like the 3D printing but I see ideal investment is around
> 30 000 CZK which is too much for 'fun' side hackathon. I would fuse all other, create please spikes
> per variant into /docs/concepts in athena-portable codebase, /spark skill will take them there and
> experiment: 1. Each variant as chore in the existing app - they will become featured chores, spikes
> will try to overcome risks and confirm feasibility, realiability and brought value. 2. Each spike
> will be triggered separately, but having shared know how regarding of Meta models will help,
> include ai-registry to keep best practices after each spike, use Memory.md, or Obsidian graph
> memory to support parallel development - all spikes will be run by claude code clis in parallel,
> once one achieves breakthrough in using model or successful technique, other can benefit quickly
> 3. Techstack and UI - athena-portable will stay as baseline, UI and UX because it reached high
> quality level in both."

Descoped: **A/1 Countersign** (a trust layer for lab liquid-handling robots). It needed hardware
(a robot, or at least a printer-class machine around 30,000 CZK) for a credible demo.

## The program

```
                 ┌──────────────────── 00 Meta senses ────────────────────┐
                 │ Muse engine · SAM 3.1 · Voice · reading · prices/modes  │
                 │ featured flag + band · media worlds · sense Gauntlet     │
                 └───────┬──────────┬──────────┬──────────┬──────────┬─────┘
                         ▼          ▼          ▼          ▼          ▼
                  01 paper     02 appeal   03 roll     04 renovation 05 care
                  flip-through   kin        call        witness       circle
                  PAPER sense  CALL sense  OBJECT sense WALK sense    CIRCLE
                     │  ▲         │  ▲         │            ▲  ▲          ▲
                     └──┼─────────┘  └─────────┼────────────┘  │          │
                        └──── read by 02, 05 ──┴── counts for 04, 05 ─────┘
       shared know-how vault: .spark/Spark/meta/ (findings, feed)   ·   ai-registry after each spike
```

| Spike | From | The featured chore | Owns (others consume) | The riskiest assumption |
|---|---|---|---|---|
| [00 Meta senses](00-meta-senses/README.md) | - | none: the foundation | engine, clients, prices, featured flag, media worlds | the API is what the docs say (probe on day 1) |
| [01 Paper flip-through](01-paper-flip/README.md) | B/1 Athena Envelope | a parent's mail filmed once -> cited cards to sign | **paper sense** | SAM separates sheets and Spark reads them well enough to sign on |
| [02 Appeal a parent's denial](02-appeal-kin/README.md) | C/1 Athena Kin | the appeal built from letters, the phone call and the portal | **call sense**, packet binding | a call becomes cited turns; Voice Transcribe counts as Meta tooling |
| [03 Roll Call](03-roll-call/README.md) | D/1 Roll Call | the home inventory from the household's own photos | **object sense** | a photo archive contains the home |
| [04 Renovation witness](04-renovation-witness/README.md) | E/1 Athena Witness | promises, changes and payments of a remodel on the record | **walk sense**, vague-change validator | SAM counts installed items on a phone walk |
| [05 Care circle](05-care-circle/README.md) | F/1 Circle | a parent's care shared by the family; the parent decides | **circle** (members, signer table) | the gate can answer "whose yes" without breaking single-user Athena |

Each spike folder holds the seat's full design report (`report.html`) and a README that turns its
risks into **proofs**: feasibility (the model does it on real inputs), reliability (it does it again,
for other people, in bad light, at a price), value (Character-played onboarding and rehearsal through
`proving/chores_uat`, timed, with the answer key's money) - each with a pass bar and a kill line.

## What "featured" means

A featured chore is a normal chore (a playbook with its world, answer key and bench) that **uses a
Meta sense** and has **passed its spike's proofs**. Spike 00 adds the `featured` block to the playbook
schema and a featured band to the Chores scene; a chore earns the flag the way a playbook earns its
place on the bench (ADR 0040), never by being authored. A spike that hits a kill line ships its
fallback as an ordinary chore, or nothing, and says which.

## Order and coordination

1. **Spike 00 first.** It lands the shared Meta package and the featured contract; until a key exists
   (the hackathon opens 2026-10-26) it builds against Meta's published shapes with a fake transport.
2. **01-05 in parallel**, each in its own Claude Code session running `/spark`. Their offline work
   (fictional paper printed from worlds, recorded walks and calls, staged photos, answer keys) needs
   no key and starts at once.
3. **In the main tree, not in worktree copies** (the owner's standing rule: no full copies of a repo
   with its own build target). Each spike confines itself to new paths and commits with exact
   pathspecs; shared files have one owner:

| Shared surface | Owner | Everyone else |
|---|---|---|
| `src/athena/contracts/`, engine lists (`harness/engines.py`, `src-tauri/src/daemon.rs`, `lib/engines.ts`), playbook `featured` schema, Chores featured band | 00 | request a change through a finding, never edit |
| `src/athena/harness/meta/` (shared clients) | 00 creates | small single-file commits with a test and a `breakthrough` finding (know-how.md section 2) |
| `src/athena/senses/<sense>/` | the spike that owns the sense | consume its public functions |
| `playbooks/<new-id>/` | the chore's spike | - |
| `playbooks/ranking.json`, `CHANGELOG.md`, `docs/features/*.md` | everyone | regenerate or append in a separate commit, re-read just before writing |
| ADR numbers | **the next free number, no gaps** (2026-10-26: the reserved 0201-0230 block was taken by other sessions before the spikes began, and `tests/test_adr_numbering.py` forbids gaps). Taken: 0226 senses contract · 0227 paper · 0228 call · 0229 object · 0230 walk · 0231 circle | `ls docs/adr | tail` right before writing one; a collision fails the gate |
| media (video, audio, photo folders) | each spike, **local only** (ADR 0055) | commit the index, never the media |

## Budget

The hackathon gives each accepted participant **$150 of Meta Model API credits for ten days**
(partner credits for open weights: Baseten $100, Modal $100, Fireworks $25). Suggested split, enforced
as per-spike caps in the ledger (`proving/budget.py`): 00 probe $10 · each chore spike $20 ($100) ·
$40 held back for recorded demo runs. A spike that needs more asks the owner with its ledger total.
Contributor mode is never used on a person's data (Standard only - a test in spike 00).

## Shared know-how

[know-how.md](know-how.md) is the protocol: a live Obsidian vault in the main checkout
(`.spark/Spark/meta/`: one finding per file, an append-only feed, `breakthrough: true` for anything
others should change their calls for), the shared Meta package as the code layer, and the ai-registry
after each spike (`memory/semantic/meta-model-api-for-agents.md` for measured facts, an episodic note
per spike, technique leads in `.ai/registry-leads.jsonl`). [meta-model-facts.md](meta-model-facts.md)
is the sourced snapshot every spike starts from.

## Not in this program

- **The UI theme.** A separate contest (`athena-meta-theme`, two seats, three variants each) designs a
  Meta/Muse-derived theme on top of the current UI; spikes use the current tokens and components and
  do not restyle anything.
- **Where the hackathon submission lives.** athena-meta's ADR 0001 planned a fresh repository with
  a disclosed import of athena-portable at T0. Building the featured chores here changes that
  premise. **Open, for the owner:** submit athena-portable with the prior work disclosed, or import
  it into athena-meta at a named SHA after the spikes.

## Launching a spike

Each README ends with its `/spark` line. Start 00, then 01-05 in separate sessions. Every session
reads `know-how.md` and `tail -n 30 .spark/Spark/meta/feed.jsonl` before each phase.
