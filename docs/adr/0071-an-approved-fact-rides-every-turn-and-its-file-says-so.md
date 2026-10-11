# 0071. An approved fact rides every turn, and its file says so

Date: 2026-10-11

Amends [0003](0003-disk-is-truth-one-writer-many-readers.md) (what a rebuild restores). Keeps
[0004](0004-the-gate-is-the-policy.md) (`core.write_fact` is `GATED`) and
applies the rule of [0068](0068-page-text-in-the-capabilities-block-is-neutralised-not-fenced.md)
to a second static block. Closes the council-lite round 1 must-address on provenance-backed
memory, value-1: "The always tier recall promises has no product path that fills it".

## Context

`core/recall.py` promises an always tier: a fact or procedural at importance 4 or above is in
the system prompt every turn, query or no query. Act 4 of the demo depends on it, because the fact
Athena wrote about the late-paying client should reach the next day's turn without anyone asking
for it. Nothing in the product could put a fact there:

- `wiring.write_fact_executor`, the one product writer, never passed an importance, so every fact
  was written at 3;
- `WRITE_FACT_SCHEMA` had no field for it, and nothing promoted a fact later;
- a rebuild reset every memory to its writer default (ADR 0003), so even a test's importance-5
  fact was in lane `always` before `reconcile_from_disk` and gone after it.

ADR 0003 kept importance in the index for format parity with the Personas writer. Its last
paragraph left open where state that must survive a machine move should live. This ADR answers
that question for one piece of state.

The tier also has a safety gap. `memory.always` is a static, unfenced block of the system prompt
(ADR 0006), and a resumed CLI session keeps it for the whole conversation. Its lines were the raw
500-byte excerpt. The user approves a fact, but its words can still come from a page. A newline,
a `## heading` or a forged fence close in the value would then become structure in the system
prompt.

## Decision

**1. The way in is the card.** `WRITE_FACT_SCHEMA` gains one optional field,
`every_turn: boolean`. `wiring.write_fact_executor` passes `every_turn=True` to `Brain.write_fact`
only for the literal `true`. The decision card lists every param as a key and a value, so it shows
`every_turn  true`. The approval matches the canonical params, so the flag the user approved is
the flag that runs. `core.write_fact` stays `GATED`, its validator is still the schema plus
`live_sources`, and a wrong type (`"true"`, `1`, `null`) is refused as `validator_failed` before
a card is filed. With the field omitted the call works as before: importance 3, not in the tier.
The tool description gains one sentence on when to ask for it: "Set every_turn only for a standing
fact every later conversation needs, such as how a client pays; it then rides every turn."

Three other paths were considered and rejected:

- **Promotion by use** has no use history to stand on yet, and it would decide without the user:
  page-shaped text that the model recalled often would reach the system prompt with no card.
- **A scope rule** (an `always` scope or directory) mixes two questions. Scope says what a fact is
  about (user, project, world) and the tier says how often it is carried. It would also add a
  directory to `WALK` that the Personas tree does not have.
- **Raising importance in the index from the model's own call** leaves the rebuild problem
  unsolved.

The card is the one path where the user sees, before anything is written, that the fact will
ride every turn.

**2. The flag lives in the fact's own frontmatter, and importance stays in the index.** A fact
written with `every_turn` gets one more header line, last, after `sources`:

```
sources:
  - "ep_0a1b2c3d"
every_turn: true
---
```

Its row is written at `ALWAYS_IMPORTANCE` = 4, the tier's floor (`recall.ALWAYS_IMPORTANCE_FLOOR`
is now this constant). `every_turn` overrides any `importance` argument, so the writer and a
rebuild always agree. `reconcile_from_disk` restores 4 for a fact whose `every_turn` is the
literal `true`. Any other value (`"true"`, `1`, `yes`, `false`) and an absent key give the writer
default, as before. The key is written only when true, so a fact without it is the same seven
keys in the same order, byte for byte. `frontmatter.py` is unchanged: it renders and parses the
key like any other scalar, and a file without it round-trips through `parse` and `render`
unchanged.

ADR 0003's promises still hold. The file is still written first, then the index, in one write.
A file written before this change rebuilds to exactly the rows it rebuilt to before:
`tests/core/test_brain_reconcile.py` pins the full fingerprint of a fixture file in that format.

Why a flag on disk and not importance:

- Importance is a score. The forgetting sweep will move it, and writing every move back to the
  file would be the parity cost ADR 0003 refused.
- `every_turn` is a decision the user made once, on a card. That is the kind of thing a file
  already records, alongside `sources`.
- It is written with the fact, in the same file and the same write. A sidecar list of always ids
  would be a second file that a partial copy loses and that can drift from the tree. So the
  sidecar was rejected.

**What this does to format parity with the Personas writer.** A brain the Personas writer wrote
never carries the key, so it rebuilds exactly as before. A fact Athena wrote with the flag has one
key the Rust writer does not emit. Athena's own reader ignores keys it does not know. Whether the
Personas reader does as well was not checked from this repository. So the cost is: on one side,
one extra trailing line on the facts the user explicitly approved for every turn; on the other,
nothing. The machine marker and `MACHINE_IMPORTANCE` are untouched. Every other importance is
still an index column, and a demotion that was never written to disk is still lost on a rebuild,
including the demotion of an always fact, which comes back at 4.

**3. Each always-tier line is one capped, quoted line.** `Memory.render` in the always lane
writes `- ` and then `recall.always_line(excerpt)`. That function does three things, in order:

1. `fence.neutralise(text)` redacts any fence marker of the default label, deterministically,
   because no nonce is passed.
2. `catalog.neutralise_text(text, ALWAYS_LINE_CAP)` (ADR 0068's rule, unchanged) makes it one
   line. CR, LF, U+2028 and U+2029 become spaces, control and format characters are dropped, and
   a cut ends in an ellipsis.
3. `json.dumps(..., ensure_ascii=False)` makes it a quoted string that cannot start a line, a
   heading or an `OP:` line.

`ALWAYS_LINE_CAP` = 400 characters. That fits a standing fact of a sentence or two, and it bounds
the block. At the two caps (`ALWAYS_FACTS` 8 and `ALWAYS_PROCEDURALS` 6), with every character
one that JSON must escape, the block is 14 × (2·400 + 5) ≈ 11,300 characters including its
heading and footer, inside the 12,000 budget in `prompt.BUDGETS`. A test pins this through
`prompt.compose`. The `(showing N of M)` footer and both caps are unchanged.

The fence redaction is the one step beyond ADR 0068. A capabilities description cannot carry a
fence marker into a turn. A stored fact can carry one forever, and it would sit in the prompt that
frames every fenced block of every later turn. Redacting is deterministic, so the block's hash
moves only when the tier does. The memory itself is not changed: `Memory.excerpt`, `as_dict` and
the file keep the user's text as written.

## Consequences

- The always tier is reachable in the product, only through an approved card, and it survives
  copying the brain to another machine.
- The capabilities line for `core.write_fact` now lists `every_turn?: boolean` and the sentence
  on when to ask for it, so the capabilities block's hash changes once.
- An always-tier line now reads `- "text"` instead of `- text`. No product path filled the tier
  before, so this changes no prompt a user has seen.
- The flag can be set but not cleared through the product. Clearing it means removing the line or
  the file and running a reconcile. Clearing it on a card would be a later tool, and gated.
- `every_turn` is for facts only. Procedurals have no product writer, so none carries the key.
- The keyword lane (`frame.memory`) is also unfenced and still renders raw excerpts. It is in the
  per-turn frame, not the static prompt, and this ADR does not change it.

## Amended 2026-10-11

By [0075](0075-every-distilled-memory-enters-a-prompt-as-one-quoted-neutralised-line.md) (council
full r1 robustness-5). The three steps of decision 3 now run canonicalise first: control and
format characters are dropped and whitespace is folded before `fence.neutralise` sweeps, then the
cut and the quoting. In the order above, a marker split by U+200B passed the sweep and was made
whole by the drop. `always_line` is now an alias of `recall.memory_line`, which also renders the
keyword lane, so the last consequence above no longer holds.
