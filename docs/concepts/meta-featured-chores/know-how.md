# Shared know-how across the parallel spikes

Five spikes run at the same time, each as its own Claude Code session. They all call the same
unfamiliar models, so a working technique found by one should reach the others within minutes, not
after a merge. This file is the protocol. It has a fast layer (the vault, live), a code layer (the
shared Meta package, in the main tree) and a durable layer (the ai-registry, after each spike).

```
 spike session ──(finding)──► vault: .spark/Spark/meta/findings/*.md  ──► every other session reads
       │                         + one line in meta/feed.jsonl         at each phase and each brief
       │
       ├──(better helper)──► src/athena/harness/meta/  (exact-pathspec commit, test included)
       │
       └──(retro)──► ai-registry: memory/semantic/meta-model-api-for-agents.md   (facts, measured)
                                  memory/episodic/<date>-meta-spike-<slug>.md     (what happened)
                     athena-portable: .ai/registry-leads.jsonl                    (techniques)
```

## 1. The vault: live, shared, never edited by two sessions

Location: the **main checkout's** `.spark/Spark/meta/` (Obsidian-openable, not version-controlled).
A session working anywhere else resolves it with
`git rev-parse --path-format=absolute --git-common-dir` minus `/.git`, then `.spark/Spark/meta/`.

| Path | Who writes | Rule |
|---|---|---|
| `Meta.md` | written once (2026-10-24) | the home: this protocol in short, links to the facts snapshot and to each spike's idea note. Never edited by a spike. |
| `findings/<YYYYMMDD-HHMM>-<spike>-<slug>.md` | the spike that learnt it | **create-only**. One finding per file. Never open another session's note for writing; disagree by writing a new note that `supersedes:` it. |
| `feed.jsonl` | every spike | **append-only**, one line per finding, so `tail` shows what is new. |

A finding note:

```markdown
---
kind: fact | technique | failure | cost | latency | prompt | schema
model: sam-3.1                       # exact id, or "glimmer@<quant>", or "-" for a method
confidence: measured | press | unverified
spike: 01-paper-flip
breakthrough: false                  # true = other spikes should change how they call this model
supersedes: []                       # [[findings/...]] this one replaces
evidence: "run 20261027T101500Z, ledger rows 412-430, n=40 pages"
date: 2026-10-27
---
# One sentence that a builder can act on.

What was tried, what was measured (numbers with n), and how to apply it.
Links: [[ideas/<spark-slug>]] [[findings/<related>]]
```

The feed line: `{"ts":"...Z","spike":"01-paper-flip","kind":"technique","model":"sam-3.1","breakthrough":true,"claim":"<the sentence>","note":"findings/<file>.md"}`.

**When to read:** at the start of every spark phase, before writing every builder brief, and
whenever a builder reports a model failure. `tail -n 30 .spark/Spark/meta/feed.jsonl` is the
cheapest check; open the notes it names. A `breakthrough: true` line that touches a model your
spike calls is a reason to re-plan the current work package, said out loud in the spark's build record.

**When to write:** the moment something is measured, not at the end. A failure is a finding (a
schema the docs did not mention, a refusal, a latency cliff, a price that differs from the page).
Every number names its run and its n. No personal data in a finding: describe the shape, never
the content.

## 2. The code layer: one Meta package, many callers

Spike 00 lands `src/athena/harness/meta/` (engine, SAM, voice and image clients, price table, the
Standard-only guard). A spike that improves a shared client lands that change as **its own small
commit touching only that file and its test**, posts a `breakthrough: true` finding, and does not
reshape the client's contract without a contract test (AGENTS.md: contracts first). Everything else
a spike builds lives in its own paths (see the README's coordination table).

## 3. The registry: what outlives the spikes

At each spike's retro (spark Phase 6), before the spike is called done:

1. **Facts** - for each finding with `confidence: measured` that is not already there, update
   `ai-registry/memory/semantic/meta-model-api-for-agents.md`: re-read the file first, edit only
   the rows you measured, keep date, n and run id on the row, raise the note's `confidence` only
   when every row it rests on is measured. Commit in the registry with an exact pathspec.
2. **What happened** - one note `ai-registry/memory/episodic/<YYYY-MM-DD>-meta-spike-<slug>.md`
   (`kind: episodic`): the bet, the proofs and their results, what was cut, cost.
3. **Techniques** - every finding that generalises beyond Meta ("when X, do Y, because Z") becomes
   one line in athena-portable's `.ai/registry-leads.jsonl`, the existing channel the registry's
   librarian harvests. Do not write knowledge bundles directly.
4. **The spark skill** improves itself through its own retro; nothing extra here.
