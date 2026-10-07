# 0046. A tool named in `op` is the OP grammar's fourth repair

Date: 2026-10-07

Amends `harness/op_grammar.py` ("Repairs, and why there are only three"). Found by the lien-desk
playbook (ADR 0040).

## Context

The grammar repairs exactly what has one correct reading — a trailing comma, an unquoted key,
missing closing braces — and refuses everything else, because an op is a request to act and a
guess that parses is worse than a refusal that explains.

In the second lien-desk run Athena wrote her ops as `{"op":"host.gcpay.list_pay_apps",
"params":{}}`: the tool's name in `op`, no `action`. Each was refused with the shape that works
(the grammar fix of the same night); she re-sent them correctly, a round or a turn later. Across
the run that cost three phases a turn each, and in Textura the delay meant a time-critical notice
was argued about rather than filed early.

## Decision

An envelope with no `action` whose `op` is shaped like a tool name — `host.<app>.<tool>`,
`core.<tool>` or `connector.<id>.<tool>` — is read as `propose_action` on that name, and the op
records the repair `op_names_tool`. It has one reading: no other field could hold the name, and
the verb `propose_action` is the only one the grammar has.

The name still has to be in the catalog: an unknown one is dropped as `unknown_ref`, as before.
A verb that is not shaped like a name (`call`, `read`) is still refused with the shape that works.

## Consequences

- A whole class of dead rounds goes. The repair is counted in the op's `repairs` like the other
  three, so how often a model needs it is visible.
- The grammar is a little more forgiving, never more permissive: the gate, the catalog and the
  class of every name are unchanged.
