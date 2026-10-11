# 0084. The frontmatter dialect types a bare scalar and keeps a quoted one text

Date: 2026-10-12

Implements README section 2 invariant 1. Closes the full-council round 2 finding craft-2 of
provenance-backed-memory. Builds on ADRs 0002, 0003 and 0082.

## Context

A memory file is the truth and the index is a cache (ADR 0003), so `frontmatter.parse` has to read
every file a person or a foreign tool may have left in the brain directory. The parser guesses a
type from unquoted text, and no ADR wrote down how. The council found two surprises. A hand-edited
`key: 00123` comes back as the integer 123. A hand-edited `confidence: "0.9"`, quoted, is text, so
the file is left out of the index and named in `ReconcileStats.skipped`.

Athena's own writer quotes every scalar that is not a bare key, so its own files round-trip. Only
foreign or hand-edited files are exposed. The rules were real but unrecorded, so a later reader
could take them for accidents.

## Decision

Keep the dialect as it is and leave `_coerce` alone. A rebuild restores what the writers emitted.
It does not guess what a hand editor meant. The rules, checked against `frontmatter.parse`:

1. **Quoting.** A value is quoted only when its first and last characters are the same quote, `'`
   or `"`. The two quotes are stripped, nothing inside is unescaped, and the result is text. A
   value that opens a quote and does not close it stays as its raw text, quote included: `"abc`
   parses to `"abc`.
2. **Booleans.** Bare `true` and `false` are booleans. No other casing is: `True` and `TRUE` are
   the text `True` and `TRUE`.
3. **Numbers and text.** Any other bare value that `int()` accepts is an integer, so `00123`, `+5`
   and `1_000` become 123, 5 and 1000. Otherwise a value that `float()` accepts is a float: `1e5`,
   `nan`, `inf` and `Infinity`. Anything else is the bare text itself, so `0x10` and `plain text`
   stay text.
4. **Sequences.** An empty value opens a block sequence. Each `  - ` item is unquoted to text and
   never typed.
5. **The writer.** `BARE_KEYS` (`type`, `role`) are written bare. Elsewhere a bool is written as
   `true` or `false`, an int or float with `str()`, and every other scalar and every sequence item
   in double quotes. So every file Athena writes parses back to the values it rendered.
6. **The one reader that needs a type checks it by name.** `reconcile._confidence` takes only a
   non-bool finite number. Anything else, a quoted `"0.9"` included, puts the file in
   `ReconcileStats.skipped` as `<path>: confidence <value> is not a number`, and the rebuild goes
   on.

Two tests pin the rules: one parametrized test in `tests/core/test_brain_frontmatter.py` asserts
each row's value and type, and one in `tests/core/test_brain_reconcile.py` asserts the quoted
confidence is skipped by name. `_coerce` gets a docstring naming this ADR and no other change.

## Alternatives considered

- **A YAML library, or the YAML 1.2 core schema.** ADR 0002 keeps the core stdlib-only, so the
  dependency is refused. It would also type more values, not fewer.
- **Typing by key (confidence a float, every other key text).** `frontmatter.py` knows nothing of
  what a key means; that is how `every_turn` stayed out of it. This would move key meaning into
  the format layer.
- **Reading a quoted number as a number for confidence.** It guesses a hand editor's intent, and
  no writer needs it because no writer emits a quoted confidence.
- **Refusing any bare value that is not a number or a boolean.** It would refuse files that parse
  today.

## Consequences

- Athena's own files round-trip. `test_render_then_parse_round_trips_scalars_and_a_list` already
  pins it.
- A foreign or hand-edited file gets the dialect's reading. A bare `key: 00123` becomes the fact
  key `'123'`, because reconcile stores `str(meta.get('key') or node_id)`.
- Known and not fixed: for the same reason a bare `key: 0` or `key: false` is falsy and falls back
  to the node id as the fact key. Athena's writer quotes the key, so only a hand edit reaches it.
- A quoted confidence is skipped by name and never read.
- Changing the dialect needs a new ADR that supersedes this one, and the pinning tests change with
  it.
