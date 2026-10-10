# 0059. A stray quote after a closing brace is the seventh repair

Date: 2026-10-10

Amends `harness/op_grammar.py` ("Repairs, and why there are only seven"), after ADRs 0046 and 0050.
Found by the sub-insurance-certs playbook, row 17.

## Context

Row 17 (df32a95) shipped short, with $3,200 of $7,200 found. On turn 12 five of its six
`send_deficiency` lines were dropped, and each had the same single flaw: a stray `"` after the `}`
that closes `params`, before the `,`:

    {"op":"propose_action","action":"host.subhub.send_deficiency","params":{"sub_id":"S-02","deficiency":"…Coverwell."}","rationale":"…"}

`parse_op` answered "the envelope is not JSON, and no repair rule reads it". That is a product
failure, and it would distort the ranking of any later row that hits it.

## Decision

A seventh named repair, `stray_quote`: outside string literals, a `"` whose previous significant
character is `}` or `]` and whose next significant character is `,`, `}` or `]` is dropped.
Valid JSON cannot open a string there, so the line has one reading. Reading the quote as part of
the text instead would also need a closing-brace repair and would put `rationale` inside
`params`; fewest-repairs-first already prefers the quote-drop reading.

It runs first among the text repairs in `_candidates`, before `unquoted_key` and
`trailing_comma`, because a stray quote changes which characters those two treat as inside a
string literal. Stages still accumulate, and each is still tried with zero to three appended
braces. A missing comma (`}"rationale"`) is not read: the next significant character is a letter.

## Consequences

- `REPAIRS` is seven names and closed; `tests/harness/test_op_grammar.py` pins them.
- The catalog and the gate still decide every repaired op; the repair is recorded on the op.
- Row 17's regression re-bench belongs to a later run, as f4ed37d came after ADR 0046.
