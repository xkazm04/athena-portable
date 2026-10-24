# description-budget

**When** a tool description is written, **spend its 240 chars on what the tool returns plus the one
constraint the consumer cannot infer from the line her block renders, and move the rest into
`app_map` topics**, **because** Athena cuts every description at 240 (ADR 0068) and her renderer shows
only top-level parameter types, so a constraint nested in an array's `items` is invisible to the model.

## What the model actually sees

One line per tool in the capability block (`_capability_line`, `src/athena/core/catalog.py:692-700`):

```
- `host.<app>.<tool>`(<name>: <type>, <name>?: <type>, <name>: ["v1", "v2", +N more]) — "<description>"
```

- a parameter is `name: type`, `?` when optional; an enum on the parameter itself shows up to 12 values
  (each cut to 40 chars) and "+N more" (`_params_line`, `_foreign_enum`);
- an array shows as `tags: array`: the `items` schema, its enum and its bounds are not shown;
- `description`, `minimum`, `maximum`, `maxLength` of a parameter are not shown;
- the description is whitespace-collapsed and cut at 240 with an ellipsis.

## Rules

1. **One clause of what it returns, then the constraint.** "Where the console is: hash, page, title, the
   ids in view and tools_here. Call first."
2. **Restate what the line hides.** Legal values of an array's items, which records accept the write,
   units, the id shape when ids are ambiguous. `leave_feedback`: "Marks one HOST line (Malakor's; others
   are refused) with tags (landed, flat, ...)".
3. **Say why a thing failed, in the result, when the description cannot.** `get_session` gained
   `failed_because`.
4. **Enums of at most 12 values on the parameter itself**; a longer list is a topic.
5. **No routing prose.** "Use this when..." spends chars the line already implies; put workflows in
   `app_map{topic: "recipes"}`.
6. **A description is part of the contract.** Changing it changes the SHA-256 contract (ADR 0100), and
   the tool asks for approval again until re-trusted. Batch description edits.

## Checks

- Every description is 41 to 240 chars and survives her neutraliser unchanged (`catalog.test.ts`,
  "never lets Athena's 240-char cut or the 12-value enum cut fire").
- Every enum has at most 12 values.
- A test lists the array parameters whose `items` carry an enum and asserts their description names the
  values (proposed; Shadowrunr enforces it by review).

## Evidence

- Live pilot 2026-10-23 run 2, review-walkthrough: `leave_feedback` failed `validator_failed` on its tags,
  then went through after she retagged to the legal set. The tags were an `items` enum, so her block
  showed `tags: array`. The description was rewritten to name them (overlord `dfff8f0`).
- The same fix wave added `failed_because` to `get_session`: sessions without chaos always failed
  (`chaos: unmeasured`), and nothing told her why.

## Registry

`mcp-tools/tool-schema-design` says "constrain in the schema, not the prose" and demotes a bound to the
description only when the host strips it. Athena keeps the schema (the bridge validates it at call
time, `inject.js` `checkInput`), but her renderer does not show nested constraints to the model, so the
description must carry them as well. That is the difference, and it is filed as a lead.
