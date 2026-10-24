# manifest-validity

**When** a catalogue ships, **test each rule of Athena's manifest validator producer-side, and post the
real manifest to a real `athena serve` once at the seam**, **because** `HostManifest.validate` refuses
the whole manifest on any one problem, so a single bad parameter takes every tool away and the producer
sees nothing.

## The validator's rules

`src/athena/contracts/manifest.py` `HostManifest.validate` (`:220-288`); a problem is answered
`400 manifest_invalid` with a `problems` list (`daemon/routes.py:567-574`) and the desktop fails the turn.

| Rule | Value | Producer test |
|---|---|---|
| tool count | at most 96 (`MAX_TOOLS_PER_MANIFEST`, `:50`), the shell's ~10 hands included, so about 86 page tools | `tools.length <= 86` |
| properties per tool | at most 24 (`MAX_PROPERTIES_PER_TOOL`, `:51`) | per tool |
| array parameters | every top-level `type: "array"` property has `maxItems` (`:281-282`) | per property |
| names | non-empty, unique; `[A-Za-z0-9_-]{1,64}` at the catalogue merge (`catalog.py:74`); no collision with another origin's tool | per tool |
| app id | a slug | the meta tag |
| origin | admitted (`https`, or `http://localhost`) | the served URL |
| `reversible`, `side_effects` | declared, `side_effects` one of `none`/`internal`/`external` | the class table |
| schema shape | `properties` an object, `enum` a list, `type` a string or list of strings, `required` a list of strings | per tool |

Not checked at the door, but enforced at call time: nested object schemas (ADR 0121; the bridge's
`checkInput` runs the gate's subset, `inject.js:373-438`).

## House rules on top

- **Closed schemas.** `type: "object"`, `additionalProperties: false`, `required` naming only declared
  properties. A schema the handler does not read is a lie the model believes.
- **Bounds in the schema**: `maxLength` on free strings (a hash, a note), `minimum`/`maximum` on integers,
  `maxItems` on arrays. The bridge enforces them before the tool runs.
- **Guard a direct call anyway.** The handler re-checks its arguments (`argStr`, `argInt`) and refuses
  with `invalid_params: "<key>" must be ...`, because a native registry may not validate.

## Checks

- Per tool: legal name, description 41 to 240, closed schema, at most 24 properties, each property name
  at most 40 chars, every required name declared, every array with a numeric `maxItems`
  (`apps/console/src/app/agent/catalog.test.ts`).
- At the seam: the keyless harness's pairing case posts the shell's own manifest body
  (`manifestBodyOf` over the page's `list`) to the real daemon, and fails on any `problems`
  (`apps/desktop/e2e/shadowrunr/shadowrunr.e2e.test.ts`, "pairs").

## Evidence

The first scripted seam run (2026-10-23) found Athena refusing the whole 27-tool manifest because array
parameters had no `maxItems`; no console unit test could see it. Fixed in overlord `0dc125f`. The retro:
"The brief should have named the consumer's validator as an acceptance source."

## Registry

`mcp-tools/tool-schema-design`: "place each constraint on the highest rung the transport actually
carries" and "the published schema and the enforced schema must be the same artifact" (agrees). Athena
is stricter than the subject anticipates: a missing bound is not merely unenforced, it is fatal to the
catalogue.
