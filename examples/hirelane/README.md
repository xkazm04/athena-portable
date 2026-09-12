# Hirelane

Halden Studio's hiring pipeline: two open roles, one hiring manager, no recruiter (design 4.6.2).

It ships **without** Athena. Every capability she will need is already registered on
`document.modelContext` through `@athena/demo-kit/webmcp`, classified AUTO or GATED by the one rule
in design 5.1, and printed on the surface rather than hidden in a drawer (DESIGN-LAW §7.4) — the
board's foot carries the class of every capability the page has. Nothing here reaches the network,
needs a key, or sends telemetry; the two "external" actions are simulated and land in the app's own
message list.

The domain is judgment about people, which is exactly why it is a useful test of the gate: the line
between *moving someone through your process* and *telling someone the answer* is the whole design.

Hirelane is one of three tabs belonging to the same studio. Ledgerbox invoices the companies whose
staff apply here and TidyCRM holds the people who work at them; all three read one registry
(`@athena/demo-kit/seed`), so an employer name in this app resolves to the same domain the other two
file it under. That shared key is what makes a fact carried from one tab to the next checkable.

## What it does

One direction, at the root route, over three zoom levels. `/` is the whole app.

- **The board** (L0) — a column per stage (applied, screening, interview, offer, rejected) holding
  one group per role, each candidate a monogram and a name. The role filter throws the losers off
  the table while the survivors re-flow. The six borderline applicants carry the flag and the named
  gap at this level, without opening anyone.
- **The carousel** (L1) — a group opened: three candidates held at full size under the loupe with
  all five criteria on a shared 0-4 baseline, the rest angled away. Two of them side by side give
  the head-to-head — a widest-gap-first diff list, each side quoting its own evidence.
- **The dossier** (L2) — one candidate: a verdict band, the CV and short answer as they wrote them,
  the evidence behind every criterion in ruled sections, and the rest of the field ranked in a rail
  beside it, because 2.6 means nothing until you know whether the others are above or below it.

The directions that came before this one — `prime`, `lantern`, `platen`, `law`, `dials`, `scale`,
`caliper`, `token` — were reviewed out and are in git history, along with the direction index
that listed them. Their briefs are kept under `design/` as the brief-before-code record DESIGN-LAW
requires; each one says at the top that it is no longer a specification. **The binding brief is
`design/board-brief.md`.**

## The journey this app serves

Athena is asked: *"Screen this week's applicants for the backend role, and book the ones worth
talking to."*

1. **Score the pile.** `score_against_rubric` (AUTO) runs per applicant and writes a scorecard note
   with the matched sentence quoted under every criterion. It never changes a stage, and there is
   no bulk stage move in this app to reach for instead.
2. **One decision, six people.** `read_applicants(role_id: "role_backend", borderline: true)` returns
   the six borderline applicants, each with the criterion their application never mentions. The read
   carries what a decision needs and nothing else: id, name, email, employer, `employer_domain`,
   stage, `borderline`, `gap`, and a `score` only if somebody produced one.
3. **The cross-app beat.** Exactly one of those six — **Wren Okafor**, `wren.okafor@kestrel-labs.example`
   — currently works at **Kestrel Labs**, a client the sibling Ledgerbox tab is chasing an invoice
   at. It is pinned in the seed from `KESTREL_APPLICANT`, so all three apps name the same person.
   Athena may flag the relationship as context; the app cannot let it matter. No rubric criterion is
   about an employer, `lib/scoring.ts` reads only the applicant's own sentences, and no stage-setting
   action takes an employer at all.
4. **Book the ones worth talking to.** `propose_slots` (AUTO) holds up to three open slots and hands
   back their ids and start times. `send_scheduling_email(applicant_id, slot_id)` is GATED and
   returns a complete, addressable message — `to`, `subject`, `body` — because in the demo the send
   is carried by a Gmail connector outside the page. `send_rejection(applicant_id, template)` is the
   same, one person at a time.
5. **"Rank them by university."** Impossible rather than refused. See **Bias mitigations**.
6. **The close.** `read_shortlist(role_id)` (AUTO) returns `{ title, markdown, applicants }` for the
   people who were advanced, with the sentence behind every score quoted, ready to paste into a
   Notion page. Bounded, and it says `(showing N of M)` in the result and in the markdown.

## Host capability manifest

`reversible && side_effects !== "external"` is AUTO; everything else is GATED (design 5.1). Both
sets are mounted on the one route, so this table is the register the board's foot prints.

| Tool | Class | Parameters | Result |
|---|---|---|---|
| `navigate` | A | `view` (enum: `board`) | text |
| `score_against_rubric` | A | `applicant_id` | text |
| `add_note` | A | `applicant_id`, `text` | text |
| `move_stage` | A | `applicant_id`, `stage` (enum: `screening`, `interview`) | text |
| `decide_stage` | **G** | `applicant_id`, `stage` (enum: `offer`, `rejected`) | text |
| `propose_slots` | A | `applicant_id` | `{ ok, message, slots: [{ id, interviewer, start, minutes }] }` |
| `send_scheduling_email` | **G** | `applicant_id`, `slot_id` | `{ ok, message, to, subject, body }` |
| `send_rejection` | **G** | `applicant_id`, `template` (enum: `standard`, `encouraging`, `keep_in_touch`) | `{ ok, message, to, subject, body }` |
| `read_view` | A | — | level, groups, and the current level's detail |
| `open_group` | A | `id` | `{ ok, level, opened }` |
| `open_item` | A | `id`, `group?` | `{ ok, level, opened }` |
| `zoom_out` | A | — | `{ ok, level, level_name }` |
| `search_candidates` | A | `text?`, `role?`, `employer?`, `stage?`, `scored_at_least?`, `scored_at_most?`, `arguable?`, `unscored?` | `{ showing, of, items }` |
| `set_filter` | A | `role?`, `arguable?` | `{ ok, role, arguable_only }` |
| `read_applicants` | A | `role_id`, `stage?`, `borderline?` | `{ ok, role_id, role, stage, showing, of, bounded, applicants }` |
| `read_shortlist` | A | `role_id` | `{ ok, role_id, title, markdown, showing, of, bounded, applicants }` |

One applicant in `read_applicants` is `{ id, name, email, employer, employer_domain, stage,
borderline, gap, scored, score? }`. `score` is **absent** until somebody scored them — never a zero,
because an unread application must not be rankable against a read one. A shortlist applicant adds
`headline` and `evidence: [{ criterion, score, quote }]`.

The list is `SHIPPED_CAPABILITIES` and `BOARD_CAPABILITIES` in `lib/manifest.ts`, and the
registrations spread from it, so there is one list rather than three. The class is never typed out:
the rule above is applied by `isAuto()`, and the same two flags become the standard `readOnlyHint` /
`consequentialHint` annotations through `annotationsFor` in the kit. `test/tools.test.ts` asserts the
annotations a browser agent actually reads.

The two sets used to be mutually exclusive — `components/HostCapabilities.tsx` returned null on the
board route — because the board was one of several directions and would otherwise have been handed a
second overlapping set from a route it did not own. There is one route now, and screening means
reading the pipeline and acting on it in the same breath, so both are mounted together. They do not
collide: `components/HostCapabilities.tsx` registers verbs on a person,
`components/board/tools/BoardTools.tsx` registers verbs on the view.

Design 4.6.2 writes this as `move_stage(id, stage)` "G when stage ∈ {rejected, offer}, A otherwise".
A manifest classifies a *tool*, not a call, so the same rule is expressed here as two tools with two
stage enums. The UI keeps the split visible: moves sit on the cards, decisions sit behind a
confirmation step that names the candidate and says what cannot be undone.

## Bias mitigations

These are the design's own mitigations, implemented rather than promised.

- **No protected attributes in the schema.** The `applicants` table has a name, an email, an
  employer, a headline, years of experience, the CV text and the short answer. There is no age,
  gender, nationality, photograph, school, university or graduation year, and no column that could
  carry one. `test/tools.test.ts` reads the table and asserts it.
- **Nothing to rank by, either.** No registered tool takes such a parameter. `search_candidates`,
  `set_filter`, `read_applicants` and `read_shortlist` accept exactly the parameters listed above and
  the same test pins each list, so a new one is a deliberate act somebody has to defend.
- **No prestige signals in the seed.** No universities — company names come from the shared client
  registry and applicant names from `Rng.fullName()`, with no demographic meaning attached to any of
  them.
- **An employer is context, never an input.** The one cross-app applicant is readable as working at
  Kestrel Labs, and that fact reaches no score and no stage: no criterion is about an employer, every
  score quotes the applicant's own sentence, and no stage-setting action accepts one.
- **Rubric-only scoring.** `lib/scoring.ts` reads the candidate's own sentences about their work,
  matches criterion keywords, and returns the matched sentences with the score. Every number on
  screen can be traced to a quote; a criterion with nothing behind it says so in words rather than
  scoring zero silently.
- **Score is not a decision.** `score_against_rubric` can never change a stage. Advancing, offering
  and rejecting are separate acts, and two of them are gated.
- **No bulk decisions.** Bulk actions cover scoring and moves. Offers and rejections are taken one
  person at a time, and each logs its own activity row.

## The design

One direction, shipped: **the Board** — a lit contact sheet in a dark room. A near-black ground with
a few soft grey blooms, every panel a dull sheet of glass over it, and the three levels above as one
object in three states rather than three pages: a group grows into the carousel and a card grows
into the dossier, matched by id.

It lives in `components/board/`. `data-variant="board"` is set on the direction's own wrapper in
`components/board/Board.tsx`, not on `<html>` — the root layout owns html/body, the providers, the
four `next/font` faces and the manifest, and nothing visual. The stylesheet tree is
`components/board/style/`, whose token block is `components/board/style/base/tokens.css`.

The design notes — metaphor, type pairing, colour lock, icon inventory, container model, divergence
— are `design/board-brief.md`, written before any component file existed, as DESIGN-LAW §6 requires.
`design/hl-scales.css` is the repo-wide scale set every direction reads from, imported once by
`app/globals.css`.

## Run it

```bash
pnpm --filter hirelane dev            # http://localhost:3002
pnpm --filter hirelane typecheck && pnpm --filter hirelane lint && pnpm --filter hirelane test
pnpm --filter hirelane build
```

The database is created and seeded on first request at `data/hirelane.sqlite`. It is deterministic:
delete the file and the same 40 applicants, the same six borderline cases, the same gaps and the same
one Kestrel Labs applicant come back. There is no health-check endpoint and no API route — the app
hosts no chat, and what it offers an agent is registered on `document.modelContext`
(see DESIGN-LAW §8).

## Layout

```
lib/          constants, the capability manifest, row types, the seed content pools, the seed,
              reads, the two letters, the scoring heuristic, and lib/board/, the one payload the
              board reads
app/          / (the board), the root layout, and the server actions
components/   HostCapabilities (the acts) and board/ (the direction, and its own tool layer)
design/       the binding brief, the repo-wide scale set, and the reviewed-out briefs
test/         node --test over the seed, the server actions, the board payload, the two agent
              reads, the capability register and the briefs
```
