# tidycrm

Halden Studio's contact list: 800 records and a campaign due. Some of the records are the same
person twice, some phone numbers were typed by hand, some contacts have not been touched since
2024, and ten companies are spelled three or four ways on one email domain. tidycrm is where you
fix that before you press send.

It is the third of the demo's three host apps (design 4.6.4), and it ships **without** Athena: every
UI action, and every slice of state an agent can ask for, is registered on `document.modelContext`
through `@athena/demo-kit/webmcp`. Athena arrives beside the page, through the bridge, as the user's
agent — never as a chat the app hosts and never through a proxy of its own. There is no API key, no
model and no network call at runtime.

The three apps are one studio's three tabs. The companies, their billing contacts, the studio itself
and the two cross-app aliases all come from one registry, `@athena/demo-kit/seed`, so a fact learned
in Ledgerbox is checkable here.

## The journey this app serves (act 3)

> "Dedupe the customer list and fix the phone numbers before the campaign."

1. **The phones.** `preview_normalize` on the 120 records whose number was typed by hand, then
   `normalize_fields` with `phone_e164`. AUTO: every change is a row in `revisions`, so `undo`
   replays it backwards.
2. **The duplicates.** `read_pairs` hands over the 60 open pairs with their confidence and the
   rules that fired. One decision, two answers: 43 confident merges through `merge_contacts`
   (**GATED** — a record stops existing), and 17 uncertain ones kept for a person through
   `resolve_pair` (AUTO, and reopenable).
3. **The memory.** In act 1, Ledgerbox showed a payment from "PINEGROVE COOP" and a person
   confirmed it was the client Pinegrove Collective. Here, `pinegrove-collective.example` is
   deterministically one of the ten conflicted domains and `Pinegrove Coop` is deterministically one
   of its spellings — both from `PINEGROVE_ALIAS` in the shared registry. `read_conflicts` shows the
   domain and its spellings, `preview_company` shows what settling it would rewrite, and
   `resolve_company` files every contact on the domain under one name. AUTO, because it writes the
   same revision rows a normalisation does and `undo` puts every one of them back.
4. **The close.** `export(clients)` downloads the campaign audience as CSV **and** returns a
   `title` and a `markdown` block summarising what changed — counts of normalised, merged and
   settled, plus every company in the segment with its domain and headcount. That is the page an
   agent appends to Notion. The app names no company it would leave out; it states who is there.

## Host manifest

Registered in `components/shell/HostCapabilities.tsx`. **A** = AUTO, **G** = GATED, computed by the
one rule design 5.1 states and `annotationsFor` (demo-kit `webmcp`) emits: AUTO iff `reversible` and
`side_effects !== "external"`.

| Tool | Class | `reversible` | `side_effects` | Notes |
|---|---|---|---|---|
| `navigate(view)` | A | true | `none` | `view` enum: `blocks` — the sheet, at `/`. The app has one screen. |
| `read_state()` | A | true | `none` | The segment the list is filtered to, and live counts per defect kind including the merge queue. |
| `export(segment)` | A | true | `data` | Downloads `/api/export?segment=` **and** returns the summary: counts, the companies in the segment, `title`, `markdown`. `data` because the export is logged. |
| `normalize_fields(ids, rules)` | A | true | `data` | `rules` enum: `phone_e164`, `trim_whitespace`, `title_case_names`, `lowercase_email`. `ids` capped at 500. One revision row per field. |
| `preview_normalize(ids, rules)` | A | true | `none` | The dry run, same parameters. Records already conforming are omitted. |
| `flag_stale(ids)` | A | true | `data` | Marks records for a human to revisit. `ids` capped at 500. |
| `read_pairs(limit?)` | A | true | `none` | The open merge queue, most confident first, with the evidence. Bounded; `footer` announces it. |
| `preview_merge(pair_id)` | A | true | `none` | Both records, the confidence and the rules that fired. Changes nothing. |
| `resolve_pair(pair_id, verdict)` | A | true | `data` | `verdict` enum: `kept_both`, `skipped`. Stores an undo payload, so a mis-keyed verdict reopens the pair. |
| `read_conflicts(domain?, limit?)` | A | true | `none` | Conflicted domains, their spellings and the contacts under each. Bounded at 20; `footer` announces it. |
| `preview_company(domain, canonical_name)` | A | true | `none` | What `resolve_company` would rewrite, with a bounded sample of the per-contact changes. |
| `resolve_company(domain, canonical_name)` | A | true | `data` | Files every live contact on a domain under one spelling, through the revision log. Undoable. |
| `merge_contacts(keep_id, drop_id)` | **G** | false | `data` | The two histories become one; the dropped record stays in the `merged` segment for the audit trail. Requires an open pair in that orientation. |
| `delete_contacts(ids)` | **G** | false | `data` | Permanent. `ids` capped at 500. |
| `undo(activity_id)` | **G** | false | `data` | Replays one reversible write backwards. Gated because the undo's own activity row is written `reversible: false`: an undo cannot itself be undone. |

The sheet registers seven more of its own in `components/blocks/tools/` — `read_view`, `open_group`,
`open_item`, `zoom_out`, `search_blocks`, `search_records`, `show_breakdown`. They look and move;
none of them writes, and none collides with a name above. There are no readables: WebMCP has no
separate readable channel, so what would have been ambient context is a read-only tool the agent
asks for.

**`open_group` takes a DATABASE id.** The survey used to be quartered into four lettered zones, so
`open_group` took `A` to `D`; it now takes one of the nine database ids — `billing`, `crm-eu`,
`crm-us`, `support`, `marketing`, `partners`, `events`, `archive`, `ops` — and `search_blocks` and
`search_records` take `database` where they took `zone`. The tool NAMES and their AUTO/GATED classes
are unchanged; what moved is the nouns the shared zoom layer builds its parameter descriptions from
(`nouns: ["database", "table"]`), so `read_view` always lists the ids that are actually accepted and
nothing has to be memorised from this file. The move is staged and `open_group` reports what it
costs (about 1.2 s), so wait before reading the view.

Every mutating action is a server action in `app/actions.ts`; each writes to the shared `activity`
table, and each reversible one stores an undo payload that `applyUndo` in `lib/mutations.ts` knows
how to replay. Merges and deletions store none — which is exactly why they are gated. All thirteen
exports of `app/actions.ts` are reachable from exactly one tool, and `test/tools.test.ts` fails if
that stops being true or if a declared class stops matching the rule.

## The seed

Deterministic, from `rngFor("tidycrm", stream)`, so the same defects land in the same rows on every
machine. `lib/seed-data.ts` builds it; `lib/db.ts` inserts it and indexes every defect flag.

| | Count |
|---|---|
| Databases | 9, holding 4 to 7 tables each |
| Tables (email domains) | 46 |
| Contacts | 800 — 724 generated, 60 re-entries of them, 16 written down |
| Near-duplicate pairs | 60 — 43 confident (≥ 0.80), 17 uncertain |
| Non-E.164 phone numbers | 120 |
| Stale (no activity in 18 months) | 135 |
| Contacts on a conflicted company domain | 179, across exactly 10 domains |
| Contacts on a client domain (the `clients` segment) | 254, across the registry's 15 companies |

The nine databases are a grouping ABOVE the seed and change nothing inside it. A table is still one
email domain; which database owns it is an FNV-1a hash of its ident (`BLK-01` upward) dealt
round-robin into the nine, in `components/blocks/model/databases.ts`, so the assignment is the same
on every machine and each database holds five or six of the 46. A hash rather than a slice of the
ident order, because idents run by descending record count and a slice would have put the ten
largest domains in one database. `test/databases.test.ts` asserts the regrouping against the
database: same record ids, same pair ids and orientations, same ten conflicted domains including
`pinegrove-collective.example` with its alias intact.

The sixteen written down are the registry's fifteen billing contacts and `KESTREL_APPLICANT` — the
people the sibling apps hold by name. They are copied verbatim (same name, title and address) and
`injectDefects` is never pointed at them, because an anchor whose email had been shouted into upper
case would no longer be the person the other tab is holding. `test/campaign.test.ts` pins it.

Duplicates are built four ways on the confident side (identical email with an initial-only first
name, a renamed domain, accents, swapped first and last name) and four ways on the uncertain side
(the "same name, different email" case the design calls out). Matching rules and their weights live
in `lib/matching.ts`; nothing is learned, so "why is this a duplicate" always has an answer.

The conflicted domains are the first ten in the registry, each sampled three or four ways from one
name's drift — except that a domain with a REMEMBERED spelling (`lib/seed-data.ts`) keeps the real
name and the alias and drifts around them, so the one spelling act 3 depends on cannot be sampled
away.

## Views

One route. `/` is **The Blocks**: the survey read at three depths — the plate (nine databases, one
dot per table), one database (its tables as cells), one table (the dossier: the checks, the identity
pair, and the two gated acts). `/api/export` is the only other route. The direction index that used
to sit at `/v`, and the AG-UI chat proxy at `/api/athena/chat`, are both gone: a host app in this
demo is a tab the user already has open, and Athena reaches it through the bridge.

**L0 is three prototypes at once, for now.** A segmented switcher at the top of the plate offers
`plate`, `slab` and `octants`; the choice is remembered in `localStorage` and reflected in the URL,
so `/?l0=slab` opens straight into one. Only one mounts at a time. They draw the same nine databases
from the same data and differ only in the picture — a 2.5D CSS plate that tilts under the pointer, a
WebGL slab, and the round-1 cube split into eight octants and a core — and two of them will be
deleted once the shape is chosen. `DESIGN.md` §1 says what each one is and what it costs.

## The design

`components/blocks/`. The list is a drawing-office check print: graphite on vellum, redline for a
deviation from the specification, greenline for a check that passed, and one declared third hue for
the thing no rule may settle — an identity pair awaiting a person. The two irreversible acts sit in
an inverted title block, the only inverted region on the sheet, so the manifest's GATED class is a
PLACE and not a badge on a button.

Its tokens are `components/blocks/style/base/tokens.css`, scoped under `[data-variant="blocks"]`,
which `components/blocks/Blocks.tsx` sets on its own wrapper — the root layout sets no variant. The
written design law it follows is `design/pass3-law-brief.md`. Every fluid value is on `cqi` and
every responsive rule is a `@container` query, so the sheet reads the width it actually has rather
than the viewport's. Motion answers an action and then stops: the L0 → L1 arrival is four named
beats over about 1.2 seconds, whose numbers all come from `components/blocks/beats.ts`, Escape
abandons it at any point, and `prefers-reduced-motion` strips it back to a cut.

## Run it

From the repository root:

```bash
pnpm --filter tidycrm typecheck && pnpm --filter tidycrm lint && pnpm --filter tidycrm test
pnpm --filter tidycrm build
pnpm --filter tidycrm dev          # http://localhost:3004
```

The database is created and seeded on first request at `examples/tidycrm/data/tidycrm.sqlite`.
Delete that file to re-seed from scratch. Node ≥ 22.5 is required for `node:sqlite`; the
`ExperimentalWarning: SQLite is an experimental feature` line on boot is expected.
