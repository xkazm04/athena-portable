# 0079. A recalled episode shows the model its id and role

Date: 2026-10-11

Implements README section 2 (invariant 2, provenance at write) and section 3.5 (recall). Closes the
full-council round 2 finding value-4 of provenance-backed-memory.

## Context

`core.write_fact` accepts only sources that are live episode ids. But `Memory.render` drew an
episode as `- <excerpt>`, and so did the `core.recall` answer, so the model never saw an id. A fact
that cites the user's own words was unreachable, and that citation is what the feature is named
for. The lane appends the user's message as an episode before the harness runs, so a recall made
during that turn can already find it.

## Decision

Every recalled episode line starts with a label, `[<id> <role>] `, for example
`- [ep_1a2b3c4d user] I chase Acme gently`. It applies in the frame's episodes block and in the
`core.recall` answer.

- The label is built only from the store: the node id and the role in its file name
  `<id>_<role>.md`. The body is never parsed. If the role cannot be read, the id alone is shown.
- The `[machine] ` marker follows the label.
- The body is not edited and stays inside its fence (ADR 0006). Distilled lines, `memory_line` and
  ADR 0075 are unchanged.
- The label counts toward `RECALL_CAP` and the frame budgets, because both measure `render()`.
- The `core.write_fact` description says a citable id is in a recalled episode's label, and that a
  `core.recall` over what the user said this turn returns it. No schema, validator, class or cap
  changed.

## Consequences

- A fact can cite the user's own words: recall them, read the id, cite it. A test does exactly that.
- An episode body can itself contain text shaped like a label. Nothing in code reads a label back,
  and the validator still accepts only a live episode id, so a forged label can at most name a real
  episode under the wrong role. That is role-blind provenance (robustness-3), not fixed here.
- Each episode line costs about 20 more characters, so fewer episodes fit a 4,800-character recall.
