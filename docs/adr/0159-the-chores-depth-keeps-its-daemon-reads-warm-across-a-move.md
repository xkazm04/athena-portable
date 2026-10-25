# 0159. The Chores depth keeps its daemon reads warm across a move

Date: 2026-10-25

Extends ADR 0123 ("Your case"), 0124 ("Your runs") and 0148 ("Your chores" on the catalogue).
Follows the reason `memory.ts` exists (ADR 0090, 0096): the stage mounts a fresh view at every move.

## Context

The Chores depth asks the daemon for a chore's saved cases (topic page), each case's runs (under
each case), and every saved case with its open review (the catalogue's "Your chores" band). Each
answer lived in the component that asked, in two hand-rolled copies of one keyed `useState` fetch
(`useCases`, `useRuns`) and a third in `useYours`. The stage remounts the view on every dive and
rise, so each return from the studio or the replay repainted "Your case" and "Your runs" from
"Looking…", collapsed the bottom of the page (where "Open your case" sits) to one status line, and
restored a scroll offset measured on the full page onto the short one. A page with N cases issued
N+1 reads on every return, and the band on the catalogue did the same on every rise.

## Decision

1. **One module-scoped read cache, `scenes/chores/reads.ts`.** `useRead(key, fetch)` returns the
   last answer synchronously on mount and asks again behind it: stale-while-revalidate, one
   revalidation per warm paint. Two asks for one key while the first is on its way share it
   (in-flight dedup).
2. **The client is part of the key.** `readKey(client, route, also?)` names the client object (and,
   for the band, the chores client too) by identity, so an answer one client gave is never shown
   for another, as the old hooks' `answer.client` check guaranteed.
3. **The state says what it is.** `looking` (nothing yet), `found` with `refreshing`, `found` with
   `refreshFailed`, or `failed` (cold). A refresh that fails keeps the last answer drawn and says
   one line under it: "... could not be refreshed: the daemon is not running. This is the last
   answer it gave." A cold failure keeps its old wording. A list being refreshed is `aria-busy`.
4. **`useCases`, `useRuns` and `useYours` are thin adapters** over `useRead`; `casesLine`,
   `runsLine` and `yoursLine` keep their words. `forgetChores()` also forgets the reads, so tests
   start cold.
5. **Bounded.** The map holds at most 64 keys (the depth's working set is a chore's cases, at most
   20 by the daemon's cut, and their runs); past that the oldest settled key goes.

`due.tsx` (owned by the tasks-and-due context) keeps its own load; moving it onto `reads.ts` is
one later commit by its owner.

## Consequences

- Back from the studio or the replay, "Your case" and "Your runs" paint as they were on the first
  frame, so the restored scroll lands on the page it was measured on; rising to the catalogue draws
  "Your chores" at once. Each read is still asked again on every mount, so nothing shown is older
  than the last move, and a stale answer is never presented as fresh.
- An answer can outlive its usefulness for the length of one revalidation; a newer approval
  replaces the older draft in place, with no "Looking" between.
- The reads are module state: a test that mounts the depth must call `forgetChores()` (every
  Chores test already does) or use its own client, which keys apart.
- The cache adds no code to the first frame: the Chores view is a lazy chunk.
