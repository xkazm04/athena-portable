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
- **Provenance at write** (invariant 2). `write_fact` and `write_procedural` reject any source that
  is not a live episode id. There is no bypass, tests included.
- **Recall** (`core/recall.py`) returns three lanes: what she always carries, distilled memory that
  matched the message, and recalled episodes. Matching is FTS5 BM25 over any meaningful word of
  the question, stopwords dropped (ADR 0042), and an episode is shown as the 500-byte window around
  its first match, so the row asked about is visible even deep in a page of results.
- `core.recall` is also a tool she can call mid-turn; its answer is capped at 4,800 characters,
  three page reads' worth (ADR 0049).

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
resolved approval is `POST /decisions/<id>`.

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
