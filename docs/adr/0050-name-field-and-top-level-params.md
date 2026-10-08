# 0050. Two more repairs: a tool named in `name` or `tool`, and parameters at the top level

Date: 2026-10-08

Amends `harness/op_grammar.py` ("Repairs, and why there are only six"), after ADR 0046. Found by
the estate-settlement playbook (ADR 0040).

## Context

The grammar repairs only what has one correct reading, and refuses the rest with the shape that
works (ADR 0041). After ADR 0046, two slips still recurred in the latest benched runs, and each
cost her a round, sometimes a turn:

- **The tool in a `name` field.** In the third estate run she wrote
  `{"op":"call","name":"host.bank.list_transactions","params":{"page":1}}` in five tabs. Each one
  was dropped with the right shape, and she re-sent it a round later. In Juniper the re-sent reads
  answered after she had already reported that she could not file.
- **Parameters outside `params`.** `{"op":"propose_action","action":"core.recall","query":"date of
  death"}` reached the catalog without its query and failed as "missing required parameter
  'query'". She said so twice in one run, and each time recalled a turn late.

## Decision

Two named repairs join the four:

- `name_field_names_tool`: an envelope with no `action` whose `name` or `tool` holds a string
  shaped like a tool name (`host.<app>.<tool>`, `core.<tool>`, `connector.<id>.<tool>`) is read
  as `propose_action` on that name. A bare word (`"tool":"chase"`) is not shaped like a name and
  is still refused.
- `params_at_top`: an envelope with no `params` key and keys it does not define (anything other
  than `op`, `action`, `params`, `rationale`, `name` and `tool`) takes those keys as its
  parameters. An envelope that has `params` keeps them, and a stray key beside them is ignored.

As before, the name must still be in the catalog, the gate still classifies it, and every repair
is recorded on the op.

## Consequences

- `REPAIRS` is six names and closed. `tests/harness/test_op_grammar.py` pins them and drives both
  shapes.
- The daemon test of a dropped op now uses a bare word, the shape that is still refused.
