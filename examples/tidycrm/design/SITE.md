# SITE.md — tidycrm design directions

The `stitch-utilities/stitch-loop` skill's persistent context file. It normally lives at
`.stitch/SITE.md`; it is kept here beside `brief.md` and `tokens/` so the whole design discipline for
this app sits in one visible directory rather than a hidden one.

**The Stitch MCP server is not connected in this environment.** Step 3 of the loop
(`generate_screen_from_text`) therefore has no implementation. What replaced it is recorded in
§7 — that substitution is the experiment, not a workaround.

## 1. Vision

Design directions over one seeded SQLite database of 800 contacts, so a reviewer can argue for one
against the others. **One direction is left** — `blocks`, at `/v/blocks`; the rest were reviewed out
and are listed in §9. Every direction reads the same data through `lib/db.ts` and calls the same
server actions in `app/actions.ts`. No direction may invent a number.

The subject is a **bot-governed** application: the distinction between what an agent may do
unattended (AUTO, reversible) and what needs a human to arm it first (GATED, irreversible) is the
central visual idea, not a badge. Athena is **not connected** to this app. Copy stays in the present
tense of the capability manifest.

## 2. Design system

`DESIGN.md` at the app root is the law. The values of the live direction are declared directly in
`components/blocks/style/base/tokens.css`, under `[data-variant="blocks"]`, and that file is what
DESIGN.md names as the authority.

The DTCG pipeline is **retired**: `design/tokens/*.tokens.json`, built by `design/build-tokens.mjs`.
Its three inputs belong to `signal`, `broadsheet` and `token`, all cut, the `components/<slug>/`
directories they were built into do not exist, no npm script runs it and nothing imports its output.
Each input and the emitter now say so in their own first lines.

It is marked rather than deleted, for a reason outside this app: `design/build-tokens.mjs` is the
upstream of record for two vendored copies that document their divergence from it line by line
(`examples/hirelane/design/build-tokens.mjs`, `examples/ledgerbox/design/build-tokens.mjs`),
`examples/ledgerbox/design/pass3-token-brief.md` cites this app's brief by path as the precedent
disposition, and it is the only implementation of `--refs`. It is also the `token-build` step of the
method this app was evaluating. `test/tokens.test.ts` holds both halves: that the pipeline stays
disconnected and marked, and that it still runs.

The DESIGN.md dial table in §0 is what generates a new direction — pick an unoccupied corner. The
live direction did not come from it (see DESIGN.md §0); the deleted ones did.

## 3. Stitch project

None. No project id, no `metadata.json`, no screens. This section exists to record the absence: every
field the skill's `metadata.json` schema wants is a Stitch identifier, and none of them have a
meaning outside the tool.

## 4. Sitemap

Every path this app serves. `find app -name page.tsx` is the check, and it returns exactly these
three.

- [x] `/` — no design of its own. Redirects to `/v` (`app/page.tsx`), so a bookmark and
      `navigate(dashboard)` still land somewhere real.
- [x] `/v` — the direction index.
- [x] `/v/blocks` — `blocks` / The Blocks. One check print read at three depths: the quartered cube
      of records, a zone as a ruled row list, a block as a dossier. The one surviving direction.

The routes this file used to tick are in §9. They are not 404s by accident; they were deleted.

## 5. Roadmap

- [x] Direction C (`daylight`) — dials 10/3/9/7. Built, then cut (§9).
- [x] Direction D (`lattice`) — dials 8/8/7/9. Built, then cut (§9).
- [ ] Nothing further scheduled. The `/v` experiment is a comparison, not a product backlog; the
      loop is deliberately allowed to terminate rather than invent work to stay alive.

## 6. Creative freedom

Unoccupied dial corners, if another direction is ever wanted: high Density + low Motion + low
Creativity (a deliberately plain, fast, boring instrument — the honest control case); or Creativity
10 + Density 10 (an information-dense editorial broadsheet, which would test whether density and
craft actually trade off or whether that is an excuse).

## 7. What replaced step 3

The loop's shape is: **read baton → read SITE.md + DESIGN.md → produce a design artifact → integrate
it → update SITE.md → write the next baton.** Five of those six steps never touched Stitch.

The step that did is the one that produced *an artifact the coding agent did not author*. That is
the loop's whole feedback value: something to reconcile code against that is not the code's own
author's opinion. Substituting "the agent writes the component" for step 3 keeps the loop running but
removes exactly that, leaving the agent to grade its own homework.

So step 3 was instead split in two:

1. **Author the component** (the agent).
2. **Render it and look at it** — headless Chrome over CDP at 390 / 768 / 1280 / 1920, screenshots
   read back as images, findings written into the next baton.

Step 2 is the substitute artifact. A screenshot is not a design proposal, so this is a weaker loop
than the intended one: it can only catch execution failures, never propose a direction. But it is
still an artifact the author did not write, and it is the only thing in the substituted loop that
can contradict the agent.

## 8. Iteration log

| # | Baton | Outcome |
|---|---|---|
| 1 | `daylight` shell + overview + index + review | Built. Rendered and inspected at four widths. |
| 2 | `lattice` shell + overview + index + review | Built. Rendered and inspected at four widths. |
| 3 | `/v` index updated to five directions | Built. Loop terminated deliberately (§5). |

This log is the stitch-loop's own record and stops where the loop stopped. Everything that happened
to these directions afterwards is in §9, which is not part of the loop.

## 9. History — what was cut, and where it went

This file is the first thing a future session of the loop reads, so what is no longer here has to be
recorded rather than simply removed. Two kinds of thing were removed, and they are not the same kind.

**Directions whose code this repo has held and deleted.** `git log --all --name-only -- 'examples/tidycrm/app/v/*'`
is the check.

| Direction | Route it held | What is left |
|---|---|---|
| `wild` / The Walk | `/` | The round-1 baseline: warm paper, single column, trail metaphor. Gone; `/` is now a redirect (`app/page.tsx`). |
| `law` | `/v/law` | Cut in `7a05743`. **Its brief survives at `design/pass3-law-brief.md` and is the design law `blocks` inherits** — it is cited by `components/blocks/style/base/tokens.css`, `app/v/blocks/layout.tsx` and `app/v/page.tsx`. Do not delete it along with the direction it names. |
| `drafting` | `/v/drafting` | Cut in `7a05743`. |
| `token` | `/v/token` | Pass 3, cut in `f9664e6`. Brief at `design/pass3-token-brief.md`; its DTCG input is still `design/tokens/token.tokens.json`. |
| `catalogue`, `sheet`, `spatial` | `/v/…` | Earlier explorations, cut in `f9664e6` ("the nine reviewed-out variants"). |
| `relief` | `/v/relief` | Cut in `ceff9ac`, when the surviving directions moved to WebMCP. |
| `scale` | — | Pass 3, never routed. Its stylesheet survives, imported by nothing, at `design/tc-scales.css`; its brief at `design/pass3-scale-brief.md`. |
| `dials` | — | Pass 3, never routed. Brief at `design/pass3-dials-brief.md`, which carries the dial survey §2 points at. |

**Directions this document has claimed and the repo has never carried.** `signal`, `broadsheet`,
`daylight` and `lattice` were ticked as shipped in §4 above through round 2. No component, route or
layout for any of the four appears anywhere in this repo's history; of the four, `signal` and
`broadsheet` left a DTCG token file behind and the other two left nothing. They are recorded here as
what they are — entries of this file's own, not of the tree's — because a loop that reads its own
sitemap as fact will plan against them again.

The point of keeping a brief rather than the code is that a brief says *why* a direction was shaped
the way it was, and that reasoning has outlived every direction that carried it.
