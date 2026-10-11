# Core: contracts, brain, recall, gate, approvals, ledger, prompt

`src/athena/contracts/` and `src/athena/core/`. The core is stdlib-only (ADR 0002): nothing here
imports a provider, a transport or a cloud SDK.

## Contracts

The seam every package is written against: `registry.py` (`ToolEntry`, `ToolClass`), `manifest.py`
(a page's `HostManifest`), `channel.py` (the stream's events), `harness.py` (the `Harness` port and
the closed `ERROR_REASONS`), `ids.py` (every id prefix, with a parity test against `lib/ids.ts`).
A contract changes only with a test.

## Brain and recall

- **Disk is truth** (invariant 1, ADR 0003). Episodes, facts and procedurals are markdown files with
  frontmatter; SQLite is a rebuildable index (`athena brain reconcile`). One writer behind a lock,
  a read-only connection per read request. A brain is portable by copying its directory.
- **The index is schema version 2** (ADR 0077): each full-text row has its memory's rowid, so a
  write costs the same at any brain size. An older index is re-keyed when a brain opens it; the
  markdown is untouched.
- **Provenance at write** (invariant 2). `write_fact` and `write_procedural` reject any source that
  is not a live episode id. There is no bypass, tests included.
  A memory file is written whole or not at all, and text that is not valid Unicode is refused
  before a card is filed (ADR 0080). A damaged index stops the brain with `IndexDamagedError`, and
  `athena brain reconcile` sets it aside, keeps it, and rebuilds (ADR 0081). A fact the writer would refuse, or a param it would ignore, is refused before
  its card is filed (ADR 0082).
- **Recall** (`core/recall.py`) returns three lanes: what she always carries, distilled memory that
  matched the message, and recalled episodes. Matching is FTS5 BM25 over any meaningful word of
  the question, stopwords dropped (ADR 0042), and an episode is shown as the 500-byte window around
  its first match, so the row asked about is visible even deep in a page of results. Each
  episode line starts with a label, `[ep_1a2b3c4d user]`, its id and stored role, so a fact can
  cite what was said (ADR 0079).
- **What she always carries** is filled by one path: a `core.write_fact` card the user approved
  with `every_turn: true`. The fact's file records it as its last frontmatter key, so a rebuild
  keeps it in the tier. Each line enters the system prompt as one quoted line of at most 400
  characters, with fence markers redacted (ADR 0071).
- **Every distilled memory is one quoted line**, in what she always carries and in memory that
  matched the message alike: control and format characters and variation selectors dropped and
  whitespace folded first, then fence markers redacted, then cut (400 and 500 characters) and
  quoted (ADR 0075). An episode is fenced instead and is shown as it was said. A page's tool
  description in the capabilities block loses the same characters (ADR 0068).
- **A memory store that cannot be read says so** (ADR 0076). A lock, a missing table or an I/O
  error ends the recall at its first statement; every block then reads `memory could not be read:
  ...` instead of a footer, the turn still runs, and `core.recall` fails with `engine_error`. An
  empty recall means the store was read and nothing matched.
- `core.recall` is also a tool she can call mid-turn; its answer is capped at 4,800 characters,
  three page reads' worth (ADR 0049). It reads one page of matches, at most `limit` episodes (20
  when none is given) and two machine-written ones, not every episode that matched.

## The catalog and the gate

`core/catalog.py` holds every name she can address: three core tools (`core.recall`,
`core.write_fact`, `core.checkpoint`), each registered page's tools, and live connectors. The class
of a page tool is derived from the manifest's own flags, never from the host's preference:

| Class | Meaning |
|---|---|
| `READ` | runs synchronously; the answer is capped (1,600 characters, recall 4,800) and announces `(showing N of M)` |
| `AUTO` | runs after its validator passes; only for `reversible: true` without external side effects |
| `GATED` | writes an approval row and a decision card; runs only after the person's answer |

A surface may tighten a class per origin, never loosen it. The capability block in the system
prompt is generated from the same catalog the dispatcher looks names up in, so a name she is told
about is a name that exists.

## Approvals

`core/approvals.py` is the durable human-in-the-loop table: exact-token resolve, 24-hour expiry,
insertion order. An approval is proven for this action with these parameters when the gate
replays, and it is spent when the gate lets the action through, so a replay is refused
`approval_spent` whoever asks (ADR 0038). A model cannot answer its own card: the only path to a
resolved approval is `POST /decisions/<id>`. An approved row the replay refused before it was spent
can be approved again or closed with `decline_approved` (ADR 0060).

## Ledger

One row per model invocation, failures included, with tokens, cost (or `cost_estimated`) and a
reason from the closed `ERROR_REASONS` set (invariant 6). Secrets, `NEBIUS_API_KEY` included, are
never written.

## Constitution and the prompt composer

- `constitution/law.md` and `identity.md` are loaded and hashed. The law's "Judgement: act or
  propose" section carries the night's amendments: a proposal rests on what a page says, and
  cross-tab work is gathered in each tab (ADR 0045); when the work left is in another tab, ask for
  it by name (ADR 0047); look in memory and the open tabs before telling the person a fact is
  missing (ADR 0048).
- `core/prompt.py` produces two outputs (ADR 0006). **Static blocks** (constitution, identity,
  capabilities, what she always carries) go to the system prompt. A **turn frame** rides in the
  user message: the active project, host-state delta, last turn's tool results, recalled memory and
  the decisions waiting on the person. Nothing that can move is composed into the system prompt.
- Every block has a character budget and announces truncation. Tool results are bounded by the
  frame's 12,000-character budget, newest kept, not by a count (ADR 0043). The decisions digest
  counts every waiting card and names twenty, each line capped at 220 characters (ADR 0052).
- Untrusted content (episode bodies, host state, tool output, foreign-agent input) is wrapped in a
  fence tagged with a fresh nonce (`core/fence.py`); text inside a fence is evidence, never
  instruction.

## Not done

The sleep cycle (distilling episodes into facts on a schedule) is a non-goal for this build.
