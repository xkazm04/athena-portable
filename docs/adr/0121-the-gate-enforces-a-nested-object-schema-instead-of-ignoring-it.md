# 0121. The gate enforces a nested object schema instead of ignoring it

Date: 2026-10-18

Amends [0002](0002-stdlib-only-core.md): the
subset grows by one case.

## Context

`core/validators.py` checked a parameter's own `type`, `enum` and bounds and recursed only through
`items`. A parameter of `type: object` whose schema declared `properties`, `required` or
`additionalProperties: false` was accepted whatever it held, so a constraint a page or connector
declared was published to the model and never enforced at the gate (scan-sweep, core-gate-and-ledger).

## Decision

Two arms were weighed. (A) Recurse into an object value's `properties`, `required` and
`additionalProperties: false`. (B) Refuse every call against a nested object schema as unenforceable.
We take A: it is about thirty lines of stdlib, it makes the published schema and the enforced schema
one artifact, and no manifest in the tree declares a nested object schema, so nothing in-tree changes.
A nested `required` or `properties` of the wrong shape fails closed with `validator_failed`, since the
manifest door inspects only the top level. Top-level sentences are unchanged; nested ones are prefixed
with the dotted path.

## Consequences

A third-party page whose nested schema is stricter than the calls it makes now has those calls
refused. The subset is still hand-written and stdlib only; other nested keywords are still ignored.
