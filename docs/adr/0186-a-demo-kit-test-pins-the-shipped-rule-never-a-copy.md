# 0186. A demo-kit test pins the shipped rule, never a copy of it

Date: 2026-10-25

## Context

Two of the kit's tests pinned a hand-kept copy of the rule they named. `abort.test.ts` carried
`escapeMeans`, "what nav.ts's listener does, so the composition is pinned": the listener could
swap `abort` and `up` and the file stayed green, because the composition (ownership by
`escapeLeavesLevel`, then `escapeAbortsFlight`) lived only inside a React effect `node --test`
cannot load, and the order was a caller obligation the README stated. `template-navigate.test.ts`
read routes back through a local `viewFor` "kept in step" with the template, using a prefix test
on `/activity`; the shipped `viewFor` is exact-match precisely because a prefix test calls the
record page `/activity-log` the log. The oracle had drifted to the rejected rule and stayed green
because no case asked. Separately, `tsconfig.json` included `src/**` only, so `typecheck` never
checked the test files: `door-outcome.test.ts` carried seven type errors the gate passed.

## Decision

1. **`escapeIntent(event, level, moving, holds = 0): "abort" | "up" | null`** in `zoom/escape.ts`
   is the composition. `nav.ts`'s listener calls it and dispatches its answer as-is. The two
   predicates and `MODAL_SELECTOR` keep their exported signatures; `escapeIntent` is additive.
2. **`test/oracle-reach.test.ts`** uses the TypeScript compiler API (not text): no file under
   `test/` may declare, at top level, a name exported by a module under `src/` or
   `template/lib/` (a static import or `const { f } = await import(...)` is an import, not a
   declaration); and `useWorldNav`'s `window` keydown handler must call `escapeIntent` once,
   neither predicate directly, and dispatch the value it returned. Each check carries a negative
   control run over an in-memory source, so the scanner is proven able to go red.
3. **The tests are type-checked.** `tsconfig.json` includes `test/**/*.ts` with
   `allowImportingTsExtensions` (the suite imports by `.ts` path for node), and a `paths` entry
   maps `@athena/demo-kit/*` to `./src/*/index.ts`, because the template (which the tests reach by
   relative path) imports the kit by name and sits under its own `package.json`, so the
   package's self-reference does not resolve from there.

## Consequences

- Swapping `abort` and `up` in `escapeIntent` turns `abort.test.ts` red; before, the same
  mutation in `nav.ts` left it green. A test-local copy of `viewFor` fails the suite, naming the
  file and the module that exports the name.
- The reach scan is by name: a test helper that happens to share a shipped export's name must be
  renamed or imported. That is the point; a coincidence is cheap to rename.
- `escape.ts` stays at 100/100 under the coverage floors (ADR 0184), since `escapeIntent` is
  exercised by the Escape tests.
- The `paths` mapping only affects the kit's own typecheck; apps resolve `@athena/demo-kit`
  through the workspace as before. Shared test helpers live in `test/support/`, outside the
  `*.test.ts` glob.
