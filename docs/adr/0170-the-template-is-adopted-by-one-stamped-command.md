# 0170. The template is adopted by one stamped command

Date: 2026-10-25

Builds on ADR 0017 (the demo kit) and ADR 0161 (the template ships one reversible act).

## Context

`examples/demo-kit/template` was adopted by hand. Its README listed seven edits across nine files,
in order, and the app's identity lived in six literals in five files (the package name, `APP_ID`,
Shell's `appName` and tagline, the layout's title, the `VARIANT` and its `[data-variant="plain"]`
block) plus a dev port the adopter had to pick against the siblings by eye. Each miss was a known
class of defect: an instance still titled "Demo app", two apps on one port, a half-copied
directory after a failed copy, and no record of which template version an app started from. The
template's author is absent at adoption, so whatever they would ask has to be carried as data, not
as prose.

## Decision

1. **One authority for the name.** `lib/constants.ts` exports `APP_ID`, `APP_NAME`, `TAGLINE` and
   `VARIANT`; `components/Shell.tsx` and `app/layout.tsx` read them. No `.ts`/`.tsx` file outside
   `lib/constants.ts` spells the name (a guard test).
2. **One command.** `node examples/demo-kit/adopt.ts <name> --port N --design D [--title T]
   [--tagline T] [--dry-run]`, over a pure-ish `adopt(answers, { root, template, dryRun })`:
   - a **readiness gate** first: Node >= 22.5, the template present, a package name, a free
     directory, a port no sibling holds (read from every `examples/*/package.json` dev script, never
     a hand list; the refusal names the holder and the first free port), a design that can name a
     `[data-variant]` block. Each refusal is `{ ok: false, prerequisite, error, remedy }` and
     nothing is written;
   - a **deterministic mapping**: eight replacements, each of which must match exactly once, then a
     scan of every payload file for the template's identity tokens (`demo-app`, `Demo app`,
     `copy me`, `"plain"`, `data-variant="plain"`). A miss or a surviving token is a template
     defect and throws before anything is written, so a new literal cannot leak silently;
   - **preview**: `--dry-run` returns the `{ file, before, after }` edits, which are exactly what
     the real adoption writes;
   - a **transaction**: the copy is staged in a dot-directory beside the target and renamed into
     place only when every file landed; any failure removes the staging copy and is rethrown;
   - a **stamp**: `.template.json` holds `{ template, digest, answers }`, the digest a sha256 over
     the sorted payload's paths and bytes. It is forensics only: the instance keeps no live link to
     the template (a divorce, not a dependency).
3. **It edits no shared file.** The root `package.json` `dev:<app>` line is printed as a next step.
   The domain work (views, types and seed, nav, palette, capabilities, actions) stays in the README
   as what to do after adoption.

## Consequences

- Same answers, same bytes: two adoptions are byte-identical, so an instance can be diffed against
  a fresh adoption of the template version its stamp names.
- A template change that adds an identity literal fails the adopter's tests
  (`examples/demo-kit/test/template-adopt.test.ts`) until the mapping learns it.
- The digest gives the still-missing template typecheck (`scripts/check-template.mjs`, which the
  README promises and the tree lacks) a target; this ADR does not build it.
- `adopt.ts` lives outside the kit's `src/`, so the kit's `tsc` does not reach it; Node runs it by
  type stripping, and its test exercises every path.
