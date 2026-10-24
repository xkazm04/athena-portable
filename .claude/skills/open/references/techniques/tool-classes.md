# tool-classes

**When** a tool is declared, **state its reversibility and its externality explicitly, set both
standard hints and the `athena` block from one class table, and let the class follow**, **because**
Athena's gate reads the claim (`athena` block first, then the hints), treats anything unknown as GATED,
and a page can never argue a tool out of GATED.

## The class table

| Producer class | Means | `annotations` | `athena` | Athena's class once trusted |
|---|---|---|---|---|
| READ | changes nothing | `{readOnlyHint: true, consequentialHint: false}` | `{reversible: true, side_effects: "none"}` | AUTO (runs unattended) |
| AUTO | moves or starts something inside the app that can be undone | `{readOnlyHint: false, consequentialHint: false}` | `{reversible: true, side_effects: "internal"}` | AUTO |
| GATED | cannot be undone, or reaches outside the app | `{readOnlyHint: false, consequentialHint: true}` | `{reversible: false, side_effects: "internal" \| "external"}` | GATED (a card for every call) |

Athena derives only AUTO or GATED from a page (`HostTool.default_class`, `manifest.py:152-156`; ADR 0004:
a non-core read lands as AUTO). READ is the producer's own label: it decides `show`, the result guard's
"refuse rather than report done", and which tools the pilot counts as orientation. `destructiveHint`
is not read by her gate (`gate.js` `flagsOf`), so it is never the only signal.

## Deciding the class

1. **Anything that reaches a person, a payment, a public URL or another system is `external`, hence
   GATED**, whatever the app's own undo can do (examples/README "Honest flags").
2. **Irreversible inside the app is GATED.** A file write, a delete, a settings change the app cannot
   roll back, starting work that spends quota.
3. **Reversible and internal is AUTO**: navigation (`go_to`), starting a keyless scripted run, toggling
   a view. Name the undo in the plan.
4. **Starting something that costs money or quota is GATED**, even when it is "just a run"
   (Shadowrunr: `start_sandbox` GATED; `start_sim` AUTO only because it refuses unless the daemon is
   scripted).
5. **Refuse by subtraction.** When a tool is safe only in one mode, check the mode at call time and
   refuse otherwise (`start_sim` reads `engine.status` first), rather than describing the limit.
6. **Generic routers are READ only.** A `query{method, params}` tool sends only an allowlist of read
   methods; any write goes through a named GATED tool. The allowlist is enforced at call time and
   published through `app_map{topic: "query"}`.
7. **One table, many tools.** Bind the flags from the class (Shadowrunr `tool.ts` `FLAGS`), never per tool
   by hand, and test every tool against the expected class list.

## Checks

- Every tool's `annotations` and `athena` equal the table row of its class (`catalog.test.ts`, "carries
  its class flags, both hints explicit").
- The expected class of every tool is written in the test, so a reclassification is a reviewed diff.
- The read router's allowlist holds no write method, and a write method is refused by name.

## Evidence

- Shadowrunr: 14 READ, 2 AUTO, 9 GATED across 25 tools (`docs/guide/athena.md`). On the real desktop
  after re-trust, `app_map` was AUTO and `edit_character_doc` GATED, as the table predicts
  (`apps/desktop/e2e/desktop/athena-desktop.e2e.test.ts`).
- Athena's own gate also forces GATED on first sight, on a user pin, on taint from another tab
  (ADR 0105) and for another tab's app (ADR 0106): the class here is the ceiling of what runs unattended,
  never a promise that it will.

## Registry

`mcp-tools/tool-schema-design`: "Every tool carries a verdict on every axis. An absent hint is not a
verdict" (agrees; Athena's axes are reversibility and externality). `hitl-approval`: the mandatory
triggers are irreversibility, spend, external visibility, low confidence and first exposure, and "a
correct gate map is mostly white space" (agrees). `mcp-tools/caller-differentiated-capability` (agrees:
rule 5).
