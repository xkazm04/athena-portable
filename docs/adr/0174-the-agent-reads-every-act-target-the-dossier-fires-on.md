# 0174. The agent reads every act target the tidycrm dossier fires on

Date: 2026-10-25

Extends ADR 0149 (the dossier's acts come from the writes' own planner). Registry: mcp-tools
(tool-schema-design), hitl-approval (oracle-before-gate).

## Context

Since ADR 0149 the Blocks dossier's AUTO bar fires `normalize_fields` and `flag_stale` on the id
lists `table.acts` carries (`examples/tidycrm/lib/acts.ts`). No read handed those lists to an agent.
`read_view` at a table sent six sample rows (`ROW_SAMPLE`), `search_records` searched only those
samples, and `normalize_fields` / `flag_stale` require explicit contact ids. On a scratch seed
(46 tables, 2026-10-25) 135 rows were stale and unflagged and 68 of them appeared in any read; 120
phones were malformed and 100 appeared. The person and the agent acted on the same writes with
different arguments: the person on the full list, the agent on whatever a sample showed. The
journey's normalise beat worked around it by previewing the first 25 sampled rows.

## Decision

1. **One projection, no new derivation.** `components/blocks/model/remedies.ts` (pure,
   client-safe) maps `table.acts` to the calls that carry them out. `remediesOf(table)` returns, in
   bar order, a `phone` and a `tidy` remedy (`preview_normalize` then `normalize_fields`, with the
   act's ids and `PHONE_RULES` / `TIDY_RULES`), a `stale` remedy (`flag_stale`, no dry run exists so
   `preview: null`), each split into batches of at most `MAX_IDS` with `batch`/`batches`, and a
   `duplicate` remedy for an open pair. A new repair is an act in `lib/acts.ts` first; this module
   decides nothing.
2. **A pair is a person's remedy.** The `duplicate` remedy carries `by: "person"`, the pair ids and
   `pairs_hidden`, and no `preview` or `act`. No remedy names `merge_contacts`, `delete_contacts` or
   `resolve_pair`; the read in `tools/read.ts` keeps deviation and adjudication apart.
3. **Both reads serve the one list.** `dossierRead` (L2 `read_view`) adds `remedies:
   remediesOf(table)`. A new read-only tool, `plan_repairs {database?, kind?, page?}`, pages every
   remedy across the sheet. Pages are packed to 12,000 characters rather than counted, so a page is
   always one whole JSON answer, and the envelope names `page`, `pages` and `next_page`. The
   partition is a pure function of the sheet.
4. **Gate.tsx is unchanged.** It already fires `acts.X.ids`, the same field the projection reads, so
   the buttons and the agent have one source without touching the gate.

## Consequences

- An agent can carry out every repair the dossier offers, on every target, from one paged read;
  every write still goes through the shell's own tool and keeps its AUTO/GATED class. No policy
  moves: the agent gains opaque contact ids, fewer fields than the sample rows already send.
- The company-spelling repair is not a remedy: it needs a chosen spelling, and the domain and the
  spellings it chooses among are already in `dossierRead`.
- A single batch whose JSON alone exceeds the page budget would sit alone on its page and could
  meet the door's 16,384-char cut. At 500 ids of the seed's form it is under 12,000; a change to the
  id form or to `MAX_IDS` should revisit the batch size.
- Pinned by `examples/tidycrm/test/remedies.test.ts` and the `plan_repairs` cases in
  `examples/tidycrm/test/spatial-model-tools.test.ts`.
