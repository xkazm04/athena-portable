# 0184. The demo kit's coverage report is the whole tree, and its gate is the pure modules

Date: 2026-10-25

## Context

`@athena/demo-kit` ran its `node --test` suite twice per `pnpm typecheck && pnpm test` and
measured it zero times. The only figure available, Node's own coverage report, is defined over
the files a run imported: on 2026-10-25 it listed 27 files at 93.1% of lines. The kit has 49
source files. The 22 it did not list are the React hooks and components (`useCameraRig.ts` 658
lines, `useSemanticZoom.ts`, `useLevelFlight.ts`, `useEcho.ts`, `zoomTools.ts`, `nav.ts`,
`ActivityLog.tsx` and more). They are not at a low percentage; they are absent, because
`node --test` cannot load a module with an extensionless value import, so they can never appear
in a report defined over what was imported. The headline was true and said nothing about them.
The pure modules say of their hooks "the thin part"; nothing measured how much of the kit sits
in the thin parts.

## Decision

1. **Two scopes that never share a number.** `scripts/coverage.ts` derives the REPORT's file
   list from the filesystem (`src/**/*.ts(x)`, `template/lib/*.ts`, the kit's root `*.ts`;
   never `test/`, `scripts/`, `*.d.ts`). A file missing from the lcov is listed unreached at 0%
   with its line count, counted the way Node counts lines. The headline is the whole-tree
   figure; the reached-only figure is printed only beside it, and each carries "N of M files".
2. **The GATE is a hand-kept set of pure modules** in `scripts/coverage-floors.json`, one line
   and one branch floor each: the zoom rules (`camera`, `echo-rule`, `escape`, `flight`,
   `gesture`, `identity`, `overlay`, `presence`, `roving`, `semantic`, `state`, `tokens`),
   `webmcp/bounded.ts`, `webmcp/door.ts`, `template/lib/acts.ts`, `template/lib/constants.ts`.
   It fails on a file below its floor, on a floored file the run did not reach, and on a floor
   naming a file that left the tree, so the gated population cannot shrink silently.
3. **A floor only rises.** `node scripts/coverage.ts --update` raises a floor to the measured
   figure rounded down to a whole percent and never lowers one; a floor above the measured figure
   is reported and left. Adding a module to the gate is a reviewed hand edit.
4. **One run.** `test` is one `node --test --experimental-test-coverage` run with a spec and an
   lcov reporter, then the CLI; `typecheck` is `tsc --noEmit` alone. CI already runs the kit's
   `test`, so the suite still runs once per CI job, now measured.

## Consequences

- Measured 2026-10-25 (Node 24.14, 221 tests): whole tree 55.4% of lines over 49 of 49 files;
  reached only 93.1% over 27 of 49. The hooks are named at 0% in every run until someone lifts
  their decisions into pure modules or gives them a harness.
- Node merges per-process V8 ranges into one lcov, and the merged branch population is not
  quite stable: in 3 of 27 runs `webmcp/door.ts` carried one extra zero-hit branch range (88
  branches, 92.05%) against 87 (93.10%) in the rest. Its branch floor is seeded at 92, the
  lowest whole figure seen, and the whole-percent rounding absorbs a one-range wobble elsewhere.
  Run `--update` and check the raised floors against a second run before committing them.
- A refactor that splits a pure module renames a floored path: the gate fails "stale floor"
  until the floors file names the new paths, which is the point.
- The lcov lands in `node_modules/.demo-kit-coverage.lcov` (Node's reporter does not create
  directories, and `node_modules` always exists after install and is ignored).
