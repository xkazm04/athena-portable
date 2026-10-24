# 0148. The Chores catalogue lists your saved cases, what is due first

Date: 2026-10-25

Extends [0123](0123-an-approved-brief-is-a-case-file-in-the-brain.md) (saved cases) and
[0131](0131-a-chore-comes-due-as-a-staged-review.md) (due reviews) to the depth's root.
Amends [0096](0096-a-playbook-names-its-area-and-its-job-and-the-ledger-reads-the-library-by-them.md),
amendment *The catalogue*.

## Context

The Chores root is the shipped library ordered by the author's scores. A person who has adopted
three chores, one of which came due yesterday, saw the same page as a first-time visitor: their
cases, what is due and what ran sat on each chore's own topic page, found one playbook at a time.
The dock's due notice is offered once and stamped seen (`stores/due-poll.ts`), so after it was
shown nothing on the root said the chore was still waiting. Until now the catalogue was handed no
daemon client at all; only the studio and the topic page asked the daemon anything.

## Decision

1. **The catalogue asks the daemon, when it is handed the deps.** `view.tsx` passes the studio's
   `AdoptDeps` and `go` to the catalogue. It asks `cases('')` once per mount (the daemon's existing
   all-cases listing, `GET /adopt/cases` with an empty `playbook_id`, cut at 20 with its
   `(showing N of M)` footer, which the band prints) and, when the chores client is there, each
   case's `review(caseId)`. No route and no contract change. A review that cannot be read is no
   review: the case is still listed, by its approval.
2. **A "Your chores" band above the area tabs, what is waiting first.** `yours.ts` (pure) joins the
   cases to the shipped set: one row per case with the chore's name (opens its page, and is picked
   on the way back like a ledger row), the case title, `Due <local day>` and `and N missed` when its
   review is open and unanswered, the last approval and the slots confirmed, and `Open your case`
   (the studio on that case, ADR 0123). Open reviews come first, oldest due first; then the latest
   approval. A case whose chore this build does not ship is counted and said, never dropped.
   Looking, none saved, the daemon not running and a refusal are each one line in words.
3. **`Yours` narrows the ledger.** A toggle beside the job chips, shown once at least one shipped
   chore has a case, keeps only those chores; the shown line says `N playbooks you have a case for`.
   It lives in `memory.ts` with the other filters, so it survives a move to a topic and back, and
   it narrows only once the cases are known (a remembered toggle never empties the ledger while the
   daemon is still answering). "Show all" turns it off.
4. **No deps, no band.** The preview, the perf gate's first fixture and a window with no daemon
   render the catalogue exactly as before: no band, no toggle, no request.

## Consequences

- The root now issues 1 + N requests per mount (N saved cases, at most 20) when a daemon is
  connected. The answers are not cached across a move; a later warm-remount read cache for the
  depth can serve the band and the topic page from one place.
- The band is drawn in the lazy view chunk; the first-paint graph is unchanged.
- `ledger-yours` is a preview fixture with a scripted client (two cases, one open review), so the
  band can be looked at without a daemon.
- Tests: `scenes/chores/yours.test.ts` (the join, the order, the words) and
  `scenes/chores/yours.test.tsx` (the band, its presses, the toggle across a move, the footer, the
  no-deps and offline cases).
