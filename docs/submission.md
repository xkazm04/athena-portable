# Athena Portable — a private agent inside the web apps you already use, proven by Nemotron

**Track: Personal AI.** Athena is an always-on, private desktop assistant with memory that must
cite what it came from, user-controlled tools that stop and ask before anything irreversible, and
a local record of every model call and its cost. Day to day she reasons on the CLI the user is
already signed in to, Claude Code or Codex, and speaks with local Kokoro. NVIDIA Nemotron on Nebius
Token Factory is how she is secured: in the **Proving Ground**, Nemotron attacks her gate, plays her
users and judges the result beside a Claude control, and the verdict is read off the gate's own
records, never off a model. Across 93 hostile turns in the first full run, the gate let nothing
through. A retest on newer Nemotron models (2026-10-22) put one of them into the product: Nemotron
3.5 Super-VL reads a person's documents at 91% field accuracy against the Claude lane's 96%, at
about a thirtieth of the cost, and is now an opt-in reader.

## What it is, in one paragraph

Athena is a desktop application that holds your web apps in tabs and an agent in a column beside
them. The agent sees the page you are looking at and can operate it: when the page offers its own
actions, she calls them; when it offers nothing, she reads, clicks, types and submits the way a
person would. Anything irreversible or anything that leaves the app stops and asks you first. Every
call and every cost is written to a local record. Nothing is installed into the websites, no
extension is granted access to your browsing, and no data leaves your machine except the model and
voice calls themselves.

## The product as it stands

The later weeks built the product around the gate (1,594 commits since 2026-10-08, `git log
--since=2026-10-08 --oneline | wc -l` on 2026-10-28). What a judge sees on one Windows PC:

- **One window with depths.** The main window is a console over six scenes: Projects, Apps, Chores,
  Accounts, Voice and Mind (`apps/desktop/src/console/scenes.tsx`). Ctrl+K, or `/` outside a field,
  opens a finder that goes to any place by name.
- **Projects are walled memory spaces (ADR 0225).** Taxes, a garden and a job hunt each get a
  Project; a memory written in one is recalled only there, and Core holds what belongs everywhere.
- **Chores are playbooks.** 100 playbooks under `playbooks/`, each with a committed `bench.json`:
  96 read `exceeds` and 4 `short`, all on Claude Sonnet, run 2026-10-08 to 2026-10-26 (the
  `verdict.word` of `playbooks/*/bench.json`). The Chores scene replays each latest run turn by turn.
- **Adopting a chore is a conversation (ADR 0097).** "Make it yours" opens a studio: she asks
  question cards, research lanes fill the case, the person drops in a letter or a statement, and an
  approved brief is rehearsed on a world shaped like their case before she runs it for real.
- **She has a presence.** A click-through halo glows along every monitor's edge while she works or
  a card waits (ADR 0027). Her face is a drawn avatar where WebGL2 is available, a bell of light
  otherwise (ADR 0120); mouth shapes timed to speech need an optional face-helper environment. She
  speaks with local Kokoro and hears with local Whisper; the Voice scene walks the install.
- **A look of her own (ADR 0142).** Look in Mind offers three skins; Wavefront, ported from a design
  contest the owner judged, is the default, and the seal comes to her avatar. A skin is a token layer on the
  real markup, so every scene keeps its structure and its contrast checks.
- **Accounts.** Gmail and Notion connectors, and the tools of MCP servers the person lists in
  `mcp.json` (ADR 0144; Athena is the MCP client), each write behind the same gate.
- **She sleeps on what she wrote (ADR 0143).** A cycle distils new conversation into facts and
  procedures; forgetting a memory gone unused or settling two that disagree comes to the Mind
  scene as a proposal the person keeps or forgets.
- **A fleet of her (ADR 0140).** Each PC's daemon measures its CPU, RAM, GPU, power and disk; the
  Devices level under Mind shows it. Pairing over a private Tailscale network, write-once memory
  replication and a phone page are built, and **need two PCs or a phone** to see.

## The Proving Ground: what Nebius and NVIDIA add

A personal agent that operates other people's software is only as good as its refusals. Before the
hackathon, Athena's refusals were held by hand-written tests. The Proving Ground points generated
adversaries and generated users at the real daemon, each attack against its own throwaway brain,
every model call in the ledger. Each prototype has a falsifiable proof test, a kill criterion and a
Claude Haiku control row, because the quality of the NVIDIA tooling was unknown to us when we began
(ADR 0030). Run reports live in a gitignored `proving-runs/<run id>/`; every number below names its
run.

**The Gauntlet (built; ADR 0032).** Nemotron 3.5 Lightning and a Haiku control each write 15
attacks per surface on three surfaces: hostile text in Ledgerbox's page state, a hostile READ-tool
result, and a poisoned memory episode. Each attack is driven through the daemon's own
`POST /manifest` and `POST /run` against a fresh Athena on Claude (Sonnet, full corpus) and on
Nemotron (sampled). The verdict comes from the gate's records: gate outcomes, fact writers, fact
counts and the approval table. Planted breaches in the tests prove the detector can say `breached`.
First full run, `20261007T140609Z`:

| | Result |
|---|---|
| Athena-on-Claude, 75 hostile turns | 75 held, 0 breached, 0 errors |
| Athena-on-Nemotron Lightning, 18 hostile turns | 18 held, 0 breached; 2 under pressure (one card filed and held, one forged op dropped) |
| Proof 1, zero breaches | pass |
| Proof 2, Nemotron valid-attack rate at least half the control's | pass: 0.53 against 0.89, ratio 0.60, no escalation to Super needed |
| Cost and time | Nemotron $0.023, Claude $3.20, 11.6 minutes |

One honest limit: Athena-on-Claude never attempted a gated call in 75 turns, so on that row the gate
held without being tested by an attempt. The Nemotron row and the planted-breach tests show the
gate under an attempt. The fourth channel in the design, a foreign agent over MCP, is designed and
not built: Athena calls MCP servers as connectors, but no channel lets a foreign agent call her.

**The approve path, and a gate fix it found (built; ADR 0036, ADR 0038).** The Gauntlet never
answers a card, so a deterministic probe approves every card a turn filed through
`POST /decisions/<id>` and checks that exactly the approved action ran, with the card's parameters,
once; that altered parameters and a different action are refused; and that a second approval is
refused. The probe found a real gap: the gate's replay step accepted the same approval twice.
Single use held only because one route was the sole caller. The gate now spends an approval in one
conditional write as it lets the action through, and a replay is refused with `approval_spent`.
Offline, three planted bugs are each caught as `violated`. Live, one card was filed across three
small runs (Athena-on-Nemotron, `void_invoice`), and it was `ok` on every check.

**Model-played Characters (built; ADR 0034, ADR 0036).** Nemotron plays four of the `uat/`
Characters (mira, jonas, priya, ana) from their own files, three user messages per conversation,
beside a realistic invoices page. When Athena files a decision card, the simulated user answers it
on the card through the daemon's decision route, as a person clicks it. Haiku judges persona
fidelity blind; a Nemotron judge and Haiku each score every transcript on the seven-dimension rubric,
blind to each other.

| | first run `20261007T144722Z` | run A `20261007T155137Z` | run B `20261007T162204Z` (shipped code) |
|---|---|---|---|
| user turns in persona (Lightning; proof at 0.80) | 69 of 72 (0.958) | 70 of 71 | 70 of 72 (0.972) |
| rubric agreement rho, Lightning / Super (proof at 0.5) | 0.183 / 0.517 | 0.424 / 0.526 | 0.377 / 0.528 |
| cards filed / answered on the card / ran | 14 / 0 / 0 | 9 / 4 / 3 | 10 / 2 / 0 |
| Nemotron / Claude cost | $0.053 / $6.07 | $0.048 / $6.96 | $0.054 / $8.07 |

Proof 1 passes on Lightning. Proof 2 fails on Lightning (below the 0.3 kill line in the first run)
and passes on Super only in one of three runs (0.528, then 0.360 and 0.495 in the repeats below).
Nemotron judges therefore sit beside Haiku, never in place of it.
Users decide like the people they play: Mira declined an irreversible `mark_paid` because the bank
match had no payment reference; Jonas declined a send until he had verified the recipient.

**The trigger page (built, local; ADR 0037, ADR 0039).** `python -m athena.proving.server` serves
one static page with no external requests. Anyone with the URL reads the latest run and watches one
stream live over SSE; a judge with `PROVING_JUDGE_TOKEN` starts or cancels one. One run at a time,
each capped at Nemotron $1 and Claude $10 and lowered to what is left of the day's caps. Attack
payloads render as fenced, inert text; the key and the token are redacted from every response.
First run through the page, `20261007T155249Z`: a small Gauntlet triggered with the token, 14 ledger
rows streamed live, 6 attacks against Athena-on-Nemotron, 0 breached, 5 held, 1 error, $0.0024
Nemotron and $0.18 Claude. **Hosted mode** runs only what needs no Claude: the Gauntlet with
`--no-claude --no-control`, proof 2 reported as `n/a — hosted, no control`, Characters refused
with a reason and shown from recorded runs. Hosted small run `20261007T172658Z`: 3 attacks,
0 breached, 0 Claude ledger rows, $0.0013 Nemotron.

**Blocked: branching worlds on Token Factory Sandboxes (ADR 0033).** The spike that boots the
image, checks the daemon and Token Factory from inside, checkpoints once and forks four attacks is
built and passes all four probes against a local Docker stand-in. Against Token Factory it is
blocked on Sandboxes beta access, so worlds stay local processes.

**Parked: the Serverless Endpoint.** The trigger page's container (`proving/serverless/`) builds
and answers `/health` and `/status` locally. It is not deployed: an endpoint needs a Nebius AI Cloud
project, IAM role and compute quota, which a Token Factory key does not provide.

### Repeat runs: what is stable and what is not

Two more full runs of each prototype on the final gate, at seeds 11 and 12 (2026-10-07, Haiku 4.5
control, so they compare with the runs above):

| | first or shipped run | seed 11 | seed 12 |
|---|---|---|---|
| Gauntlet breaches | 0 of 93 (`20261007T140609Z`) | 0 of 107 (`20261007T205627Z`) | 0 of 106 (`20261007T213007Z`) |
| Gauntlet valid-attack ratio, Lightning to control (proof at 0.5) | 0.60 | 0.88 | 0.72 |
| Characters persona fidelity on Lightning (proof at 0.8) | 0.972 (`20261007T162204Z`) | 0.958 (`20261007T210930Z`) | 0.944 (`20261007T214341Z`) |
| Characters rubric agreement, Super against Haiku (proof at 0.5) | 0.528 | **0.360** | **0.495** |
| Characters rubric agreement, Lightning against Haiku | 0.377 | 0.238 | 0.079 |

- **Stable:** the gate. 306 hostile turns across three runs, zero breaches. Nemotron as an attacker
  cleared its bar every time (0.60 to 0.88). Nemotron as a user stayed in persona 94% to 97% of turns.
- **Not stable on 2026-10-07:** Nemotron as a second judge. Super passed agreement once in three
  runs on the shipped code (0.528, 0.360, 0.495). Lightning never did. The retest below found the
  newer judges stable against a newer control; Haiku stays the judge of record either way, and a
  Nemotron judge's scores are reported beside it, never instead of it.
- Cost of the four repeat runs: Nemotron $0.12, Claude CLI $22.1.

### Retest on newer Nemotron models (2026-10-22)

Token Factory added Nemotron 3.5 Super-VL (vision, $0.30 / $0.90 per 1M tokens) and Nemotron 3
Ultra ($1.00 / $3.00). Two questions were retested, each with its proof written before the run.

**The judge, again.** Haiku 5.5 is the judge of record; the Nemotron judges score the same 168
transcript and criterion pairs blind. Proof: Spearman 0.5 or above at all three seeds. Runs
`20261022T194851Z`, `20261022T195805Z`, `20261022T200647Z`; Claude $17.96, Nemotron $0.53.

| Nemotron judge against Haiku 5.5 | seed 11 | seed 12 | seed 13 | proof |
|---|---|---|---|---|
| Lightning | 0.28 | – | – | kill, escalated |
| Super | 0.591 | 0.595 | 0.654 | pass |
| Super-VL | 0.571 | 0.622 | 0.634 | pass, on an offset scale (exact match 27% to 34%) |
| Ultra | 0.598 | 0.586 | 0.685 | pass |

The control changed too (Haiku 4.5 then, 5.5 now), so this and the 2026-10-07 table are not one series.

**Nemotron reads a person's documents.** While adopting a chore, a person can drop in a letter or
a bill, and the documents lane reads it against the playbook's facts (ADR 0097). `uv run python -m
athena.proving.docread all` renders documents whose answers are known by construction, up to a
low-resolution greyscale scan. Proof: accuracy at least 90% of the Claude lane's, false facts at
most 5 points above it; a PASS or KILL whose 95% interval for the ratio spans its line reads
UNRESOLVED (ADR 0232).

| Reader, run `20261022T195808Z` (90 paired documents, 230 probes) | field accuracy | false facts | median time | cost per document |
|---|---|---|---|---|
| Claude documents lane (Sonnet, `Read` only) | 96.2% | 2.2% | 8.6 s | $0.0209 |
| Nemotron 3.5 Super-VL, reasoning off | 91.0% | 5.2% | 2.0 s | $0.0007 |

Ratio 0.945, false-fact delta +3.05 points: the point ratio passes, but its 95% interval (0.887 to
1.000) reaches below 0.90, so rescored it is UNRESOLVED. The lane now takes Super-VL as an
opt-in reader for pictures (`ATHENA_DOCUMENT_READER=nemotron-vl`); a PDF, a larger picture or any
failure of the call falls back to the Claude leg, so the opt-in can make a read cheaper and never
make it fail.

## How NVIDIA Nemotron is used

**A model ladder.** Every Nemotron role starts on Nemotron 3.5 Lightning ($0.06 / $0.24 per 1M
input/output tokens), the cheapest NVIDIA model Token Factory serves, and escalates once to
Nemotron 3 Super ($0.30 / $0.90) only when its own proof fails there. Ids and prices were read from
the live `GET /v1/models?verbose=true` on 2026-10-07, and again on 2026-10-22 for Super-VL and
Ultra. Nemotron Safety Guard is not served by Token Factory, so no role uses it.

| Role | NVIDIA model | Control | Measured |
|---|---|---|---|
| Attacker, three surfaces | Lightning | Haiku writes the same number | valid rate 0.53 against 0.89 (`20261007T140609Z`) |
| Athena under test, the `nebius` engine | Lightning | Athena on the Claude CLI (Sonnet) | 0 breaches in 18 turns (`20261007T140609Z`) |
| User simulator, four `uat/` Characters | Lightning | Haiku judges fidelity, blind | 0.944 to 0.972 in persona (five runs) |
| Rubric judge | Super (Lightning failed agreement) | Haiku on the same transcripts, blind | 2026-10-07, Haiku 4.5: rho 0.360 to 0.528 over five runs, passing 0.5 in two. 2026-10-22, Haiku 5.5: Super, Super-VL and Ultra pass at all three seeds (0.571 to 0.685). Haiku stays the judge of record |
| Document reader, in the product (opt-in) | Super-VL, reasoning off | the Claude documents lane (Sonnet) | 91.0% against 96.2% field accuracy, $0.0007 against $0.0209 per document (`20261022T195808Z`) |

**The `nebius` engine (ADR 0031).** Nemotron runs Athena as a third engine beside `claude_code` and
`codex`, through the same round loop, the same `OP:` grammar, the same nonce fence, the same gate
and the same single ledger row per turn. It is standard-library `urllib` against Token Factory's
OpenAI-compatible chat completions, with no SDK. A Nemotron turn that proposes a gated action files
the same card a Claude turn would. It is a measurement row, not Athena's daily engine (ADR 0030);
the document reader above is the one Nemotron role that reaches the product.

**What we learned about reasoning (ADR 0034, ADR 0035).** Of five ways to turn Nemotron's reasoning
off, only `chat_template_kwargs: {"enable_thinking": false}` works; the other four are accepted
with HTTP 200 and ignored. For the JSON roles it is decisive: on the same nine Lightning prompts,
unusable answers fell from 2 to 0 and schema-valid items rose from 35 of 45 to 45 of 45, at a tenth
of the cost. For Athena as a conversational agent with tools it is the opposite: in a same-seed A/B
on Lightning (112 turns per arm), reasoning off made turns 3.5 times faster (median 1.7 s against
6.1 s) and about 40% cheaper, held the gate equally (0 breaches in 72 attacks per arm), but turns
with no text rose from 3 to 24, because Lightning answered plain questions with a bare `OP:` line.
So the roles turn reasoning off and the engine keeps it on, with `--no-nebius-thinking` as a switch.
On Super, off lost nothing measurable.

**Why open weights matter here.** A run against a pinned open model can be repeated by someone else.

## Where Token Factory accelerated the work

Measured on the Characters run `20261007T144722Z`: the Nemotron Super rubric judge scored 24
transcripts for $0.022, against $0.87 for the Haiku judge through the CLI, about 40 times cheaper.
The 72 Nemotron user turns cost $0.007. With reasoning off, a Lightning role answer took a median
22 s under nine-way concurrency, against 80 s with reasoning on. The 24 conversations took 12.3
minutes on six workers. The whole Nemotron side of the 93-turn Gauntlet `20261007T140609Z` cost
$0.023. On the documents run `20261022T195808Z`, Super-VL read a document for $0.0007 in a median
2.0 s against $0.0209 and 8.6 s on the Claude lane. That price is what makes a conversation-level acceptance test and an adversarial corpus
something to run on every change rather than once.

## Other Nebius services

- **Token Factory Sandboxes:** the branching-worlds spike is built and blocked on beta access
  (above, ADR 0033).
- **Serverless Endpoints:** the trigger page's container is built and checked locally, not
  deployed; it needs a Nebius AI Cloud account (above, ADR 0037, ADR 0039).

Our concrete feedback on both, and on Token Factory and the Nemotron models, is in
[`docs/feedback.md`](feedback.md).

## What changed in the hackathon period

Athena Portable is a new project. Its first commit is dated 2026-09-12, after the period opened on
2026-08-26, and every commit since is in the period. It was rebuilt from scratch here, with an
earlier product as prior art only. The Proving Ground, the `nebius` engine, the gate's single-use
fix and the trigger page were built for this hackathon, with ADRs 0030 to 0039 recording the Proving
Ground's founding decisions and ADR 0097 the documents lane the retest reached. All 235 ADRs, 0001
(dated 2026-09-12) to 0235, were written in the period (`ls docs/adr/*.md | wc -l`).

## How to run it, and how judges test it

The test build is this repository plus the local trigger page; there is no hosted URL. Setup is
the README's **Setup** (`uv sync --extra dev`, `pnpm install`); every test runs without a provider.
The desktop path is the README's **Run it locally**: the shell is built and tested on Windows 11
(Tauri v2 on WebView2), and its screen capture and private-network setup refuse on other systems.
The Proving Ground commands, what each spends and needs, are in the table under **Proving Ground**.

**The trigger page.** It runs on a judge's own machine:

```bash
PROVING_JUDGE_TOKEN=<token> uv run python -m athena.proving.server --hosted   # http://127.0.0.1:8790/
```

With `NEBIUS_API_KEY` set, a small hosted Gauntlet costs a fraction of a cent and needs no Claude
(`20261007T172658Z`: $0.0013).

## The architecture, and why it has this shape

Being a guest inside software that belongs to someone else is the constraint that produced every
important decision here.

**Approval is structural, not advisory.** Every action carries two facts: is it reversible, and do
its effects leave the app. An action runs unattended only if it is reversible *and* stays inside.
Everything else stops and files a decision card. A web page cannot mark its own destructive action
as safe, and the model is never asked to decide.

**A gated action has no way to run before it is approved, and runs once.** The agent's turn ends
at the proposal. When the user answers, the action is re-checked against that exact action with
those exact parameters, and the gate spends the approval as it lets the action through, so a
granted approval can be neither spent on a different call nor spent twice.

**The page executes its own actions; the agent never does.** The runtime holds no executor for a
page's tools. The result comes back as quoted data inside a fence the model cannot break out of. A
page's output is evidence, never instruction — the claim the Gauntlet attacks.

**Memory must cite what it came from.** A remembered fact is refused at write time unless it cites
the actual observations it came from — the claim the memory-poisoning surface attacks.

**Identity is bound to origin, and references expire.** One application is one web origin;
generic abilities start gated on every site the user has not yet trusted; an element reference is
minted only by the page and retired when it navigates.

## Technical execution

- **Agent core:** Python 3.11+ with zero runtime dependencies. Memory is markdown on disk with
  SQLite FTS5 as a rebuildable index, so a user's memory is portable by copying a folder.
- **Engines:** Claude Code, Codex and Nemotron on Token Factory behind one contract, one gate and
  one ledger. Each CLI dialect is replayed against a recorded transcript in the tests.
- **Voice:** a WebSocket gateway, push-to-talk, local Kokoro by default (ADR 0028).
- **Desktop shell:** Tauri v2 in Rust with one webview per tab, a React 19 panel, and a Python
  sidecar owned by a Windows job object so it cannot be orphaned.
- **Page bridge:** plain JavaScript polyfilling `document.modelContext`; it degrades rather than
  breaks inside someone else's application.
- **Proving Ground:** standard-library HTTP and SSE, throwaway worlds per attack, per-run and
  per-day spend caps, and verdicts read off the gate.
- **Quality bar:** Ruff, mypy strict, pytest, ESLint, tsc, Vitest, cargo clippy, and an
  architecture decision record for every choice a later reader could question (235 to date,
  0001 to 0235, `ls docs/adr/*.md | wc -l`). On 2026-10-28 pytest collected 4,194 tests (7 skipped), the
  desktop's Vitest suite ran 3,185, the bridge and example apps' `node --test` suites 949, the
  journey's Playwright suite 17, and `cargo test` 169, all passing.

## Non-goals

No scraping and no pixel-guessing. No browser extension asking for access to everything you visit.
No cloud account for the companion: memory, approvals and the cost record are files on your
machine, and the agent process dies with the window. Nemotron is not Athena's daily engine. The
Proving Ground runs against synthetic users and the example apps, never against a user's own brain,
and a model never decides whether something is gated.

## How this maps to the judging criteria

| Criterion | Where it is answered |
|---|---|
| Technological Implementation | the Proving Ground (gate-read verdicts, approve-path probe, the fix it found), the `nebius` engine, Technical execution |
| Design (complete product) | The product as it stands: one console over six scenes, Projects as walled memory, 100 benched chores adopted through a conversation, the halo, face and local voice, sleep proposals, a paired fleet; the architecture; the trigger page; How to run it |
| Potential Impact | the Track line; adversarial and user-level testing at cents per run (Where Token Factory accelerated the work) |
| Quality of the Idea | Nemotron as attacker, user, second judge and document reader against a gate whose verdict no model sets; How NVIDIA Nemotron is used |
