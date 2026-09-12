# 0004. The catalog derives every class, and a connector merges like a page

Date: 2026-09-12

## Context

README §2 invariant 3 says policy lives in the gate and never in the model, and §3.3 says a page's
tools are classified from the manifest's own `reversible` and `side_effects` flags rather than from
what the host would prefer. Two pressures push the other way.

The first is the model. A tool call arrives as text, and the cheapest way to decide what to do with
it is to let the caller say: a `class` field on the proposal, or a system prompt that asks the model
to flag irreversible actions. Anything of that shape makes the safety property a function of a
token sequence, and a prompt injection on a page Athena is reading is then a prompt injection on the
gate.

The second is the host, and soon the connector. A page that registers `delete_invoice` would like it
to be `AUTO`, because a card in front of every call is friction. A connector arrives with a written
spec, an OAuth grant and a team behind it, and has a better claim than a page to be trusted — and
README §4 fixes the answer in advance: a connector enters the catalog like a page and cannot argue
itself out of `GATED` any more than a page can.

There is also a smaller decision inside the merge. The first build merged a manifest tool by tool
into one flat registry, so a manifest that failed halfway left the origin holding a subset nobody
had designed, and a re-registration after a page reload had a moment in which the old names were
gone and the new ones had not landed.

## Decision

`core/catalog.py` is the only module that assigns a `ToolClass`.

- Athena's own four names are fixed in code: `core.recall` is `READ` with a 1,600-character cap,
  `core.checkpoint` and `core.answer_decision` are `AUTO`, and `core.write_fact` is `GATED` —
  a fact outlives the turn, and nothing that outlives a turn is written without a card.
- A host tool's class is `HostTool.default_class()` and nothing else: `AUTO` only when
  `reversible` is exactly `True` and `side_effects` is not `external`, `GATED` in every other case,
  including the case where the flag was never declared. No field a host can send is read as a
  preference; unknown keys in the manifest are ignored by `HostTool.from_dict`.
- A connector's class is derived by the same call on the same type. `Catalog.merge_connector` builds
  a `HostManifest` with `origin_kind = "connector"` from `ConnectorPort.list_tools()` and hands it
  to the same private merge a page's manifest goes through, so a connector gets the same validation,
  the same namespacing and the same refusals. The one difference is that each entry's executor is
  bound to `ConnectorPort.call`, because a connector runs in the daemon's process while a page runs
  its own tools (README §3.4).
- `core.write_fact`'s validator is the schema plus a provenance check against a
  `sources_alive` port. The catalog states the rule and the brain answers it; `core/catalog.py`
  imports no memory engine. The brain enforces the same rule again at write, and both are meant.
- The catalog keeps three registries — core, host per origin, connector per origin — and a merge
  stages every entry before assigning the origin's dict in one statement. A manifest is merged whole
  or refused whole, and a refusal leaves the origin exactly as it was. `drop_origin(origin)` is the
  other half: a page that navigated away or a connector that was disconnected loses its names from
  the prompt rather than keeping them to be refused at the gate.
- A declared tool name must be a slug. The catalog namespaces it as `<kind>.<id>.<name>`, and the
  panel, the ledger and structural policy all split that on dots.

The capability block the model reads is generated from the registry, sorted by class and then by
name, so two renderings of an unchanged catalog are byte-identical and a block hash in the ledger
means something.

## Consequences

The class of every name is decidable from data that is already in the manifest, which is what makes
`tests/core/test_catalog.py` able to assert it. A page or a connector that wants less friction has
one honest route: declare a tool that really is reversible and really has no external effect.

A connector read lands as `AUTO` rather than `READ` under the shared derivation, because `READ`'s
cap belongs to a tool whose answer becomes an episode and the manifest has no flag for that. The
connector team's spec can tighten a tool later through the same surface a host does; it can never
loosen one.

`core/catalog.py` imports `athena.connectors.port`, which is the one import core takes from another
package. It costs nothing — `port.py` is a Protocol over contracts types and stdlib only, by
ADR 0002 — and the alternative was a second declaration of the same seam inside `core`, which the
contracts-first rule forbids more strongly than this import bothers it.

The cost of the three registries is that `Catalog.entries` is a computed flat view rather than the
stored dict, so every lookup rebuilds it. At the size of one catalog — Athena's four names, a page's
handful, nine hands, a connector's few — that is not worth a cache, and a cache is exactly where a
stale name would live.
