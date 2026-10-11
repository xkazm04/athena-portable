# 0070. The capabilities block has a total bound, and a manifest has count caps

Date: 2026-10-11

Implements README section 3.2 (the two-output composer) and 3.3 (the catalog is the policy),
beside ADR 0006 and ADR 0068. Closes the council injection-resistance round 1 must-address,
economics-1, and its cross-reference robustness-6.

## Context

ADR 0068 caps each piece of page or connector text in the static `capabilities` block: a
description at 240 characters, a parameter name, type or enum value at 40, and 12 enum values
shown. Nothing capped how many pieces there are. `HostManifest.validate` counted neither the
tools in a manifest nor the parameters of a tool, `Catalog._merge` staged them all, and
`render_capabilities` wrote every entry of every origin the lane holds. Origins are never
evicted: `Catalog.drop_origin` has no caller. `BUDGETS["capabilities"]` (12,000) in
`core/prompt.py` is a tripwire that flags a breach and truncates nothing.

The council measured what that allows. One manifest under the daemon's 1 MiB body made a single
capability line of 1,049,540 characters. 200 origins carrying only the nine hands made a block
of 184,468 characters. The block is the system prompt of every model call.

What the repository's own manifests need, measured on 2026-10-11:

- Tools in one manifest: at most 41, Ledgerbox (32 page tools, the 4 zoom verbs among them,
  plus the 9 hands `withHands` appends). Then Tidycrm 31, Hirelane 25, Atlas 19 or 21, the
  demo-kit template 12. Connectors carry 3 (gmail) and 4 (notion). The proving
  `ledgerbox_manifest()` has 23, the most any Python test merges; no test builds a larger one.
- Parameters on one tool: at most 8, Hirelane `search_candidates`. Then Ledgerbox
  `search_invoices` 6, Tidycrm `search_blocks` 5, gmail `send_mail` and the proving schema 4.
  No hand takes more than 2.

## Decision

Two count caps at the door, and one total bound in the render.

- `MAX_TOOLS_PER_MANIFEST = 96` and `MAX_PROPERTIES_PER_TOOL = 24`, in
  `contracts/manifest.py`. `HostManifest.validate` refuses a manifest past either, naming the
  count and the cap, so the manifest is refused whole (400 `manifest_invalid` at
  `POST /manifest`, `CatalogError` for an in-process connector). Each cap stands at more than
  twice the measured maximum (41 and 8), so a page can grow without meeting it. The caps bound
  what one origin holds; they do not bound the block, which is the next rule's job.
- `CAPABILITIES_CHARS`, in `core/catalog.py`, is `BUDGETS["capabilities"]`, imported from
  `core/prompt.py` so the two cannot drift; `prompt.py` is not changed. The rendered block never
  holds more characters than that, as long as Athena's own entries fit in it (they take 1,662).
- Athena's own entries are always shown. Foreign entries are added in the block's existing
  order, by class (GATED, READ, AUTO) and then by name, until the next one would pass the bound;
  that one and every one after it are cut. The space the header, the class headings, the cut
  sentence and the footer could take is reserved first, at its longest.
- A cut is announced twice: a fixed sentence, `<k> more names from pages and connectors did not
  fit in this block and are not listed. Each is still gated as its class says.`, and the block's
  `(showing N of M)` footer, whose N counts only the names shown.
- The cut is the prompt's only. It changes no entry's class and no registration: a GATED name
  left out is still GATED, and the gate validates and classifies it exactly as before. A block
  under the bound is byte for byte what it was before this decision.

The cut is greedy over a prefix rather than a best fit, because a prefix is the only rule that
keeps the block a pure function of the registry that a reader can predict: the names shown are
the first ones in the order the block already uses.

## Consequences

- Measured after the change: 200 origins of the nine hands render 11,977 characters,
  `(showing 162 of 1803)`; 10 origins render 7,684 characters with nothing cut; one origin
  2,266. The block hash still holds for an unchanged registry.
- A daemon that has seen enough tabs now cuts names from the prompt instead of growing it. The
  order puts GATED entries first and sorts origins by app id, so once roughly 40 origins of
  hands are held, READ and AUTO page tools are the first cut, and an origin late in the sort,
  which may be the tab the user is on, can lose its names from the prompt. Pinning already
  refuses another tab's host tools, so rendering only the session's own host origin and the
  connectors is the fix that would make the cut rarely matter. It lives in the lane, not here,
  and is a separate decision.
- Origins held still grow without bound in memory: `drop_origin` has no caller. The render
  bound removes their prompt cost; their memory cost and the cost of `Catalog.entries` per
  lookup remain.
- The count caps refuse a manifest the shell would build from a page with more than 87 tools of
  its own, or with a tool of more than 24 parameters. Such a page is refused whole, with a
  problem that names the count and the cap.
