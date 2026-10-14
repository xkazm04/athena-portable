# 0097. Adopting a playbook is a conversation held outside the turn lock

Date: 2026-10-14

Follows [0007](0007-engines-are-configuration.md) by reference (every model call goes
through the `claude` CLI on the subscription), [0044](0044-a-handed-playbook-is-the-active-project-on-every-turn.md)
and [0096](0096-a-playbook-names-its-area-and-its-job-and-the-ledger-reads-the-library-by-them.md).
README section 14; `docs/features/playbooks.md`, "Adopt".

## Context

A playbook is someone else's case: Neil's packaging firm, his apps, his quarter. To run it for
another person Athena has to learn theirs, and until now that was a form (`fitCommand`) that
swapped portal names into the command and asked nothing else. The form could not ask about the
facts the rules turn on, could not tell when it knew enough, and could not research anything while
the person typed.

The daemon serialises every chat turn behind one writer lock ([ADR 0011](0011-the-daemon-is-threaded-closes-every-connection-and-checks-the-token-everywhere.md)). A conversation about
adopting a playbook that ran as ordinary turns would queue behind a chat turn and could not run
research beside its own questions. The Personas companion showed the parts that work: a batched
clarify round (an auditor checks guesses against the person's literal words and asks at most four
bundled questions; an empty list means fully specified), every model leg naming its kind so its
tier is configuration, a warm stream-json CLI session (2.2 s against 4.4 s to first text), and
draft-preview-apply (what is approved is exactly what runs).

## Decision

1. **The studio is outside the turn lock.** An adopt session lives in daemon memory
   (`src/athena/adopt/session.py`) with its own lock and its own single worker thread; no adopt
   route takes `daemon.writing()`, and a test holds the writer lock while a session starts,
   streams and takes an answer. At most three sessions are live (a fourth is refused), each
   expires after two hours idle, a reaper thread closes the expired ones, and a session's dropped
   documents live in a temp directory deleted with it. Nothing is persisted.
2. **Slots and an auditor decide when it is clear.** Slots come from the playbook (one per app,
   one per gate) and from the first audit (facts and traps, twelve slots at most). After every
   answer the auditor checks each value against the person's literal words and lists what is still
   open, while the next card is written in parallel; an empty open list is clear. "Good enough" is
   always available, and eight cards is the most. Only the person's words confirm a slot; research
   never overrules her.
3. **Legs by kind, tiers by bench.** Every model call goes through one door,
   `LegRunner.run_leg(kind, ...)`, with the kind required (`interview`, `audit`, `research`,
   `shape`, `persona`, `judge`). Which Claude 5.5 model and effort serves a kind is
   `src/athena/adopt/tiers.json`, interim until the tier bench writes it. Each invocation is one
   ledger row and one `adopt.usage` event, failures and malformed answers included; a malformed
   JSON answer is sent back once and then degrades (a plain free-text question; or the slots kept)
   so the conversation never stalls. The interviewer keeps one warm stream-json process per
   session, killed on close; a dead one is replaced by a cold call.
4. **CLI only.** A leg is `claude -p` with the API key stripped from its environment, its built-in
   tools off unless the leg names them (`--tools`, `--restricted` keeps WebFetch and code-running
   tools off unless named), settings and MCP servers ignored, nothing persisted, prompts denied.
5. **One ordered event stream.** The desktop sees a session as `adopt.*` events with a `seq`,
   replayed after any `seq` and then followed live over Server-Sent Events with heartbeats. When a
   session ends — deleted, expired or at shutdown — its last event is `adopt.error` with reason
   `session_closed` (an adopt reason beside `ERROR_REASONS`, `ADOPT_ERROR_REASONS`), then the
   streams close, so a surface stops reconnecting instead of treating the close as a drop.
6. **Draft, preview, apply.** The brief's `command` is the playbook's command plus a "My case:"
   block built mechanically from the slots, not rewritten by a model. Every brief has a `rev`, an
   answer after it makes it stale, and approval names the rev it approves.

## Consequences

- An adopt session costs nothing a chat turn waits on, and a chat turn costs it nothing; the price
  is a second concurrency model in the daemon (a per-session actor) that its tests have to cover.
- A daemon restart forgets every adopt session. That is the intended scope (no personal variant is
  stored); the desktop restarts the conversation.
- Refusal reasons stay the closed `ERROR_REASONS`: a fourth session is `budget_exhausted` with a
  detail starting `busy:`, and a stale approval is `validator_failed` with a detail starting
  `stale_rev:`. `session_closed` exists only on `adopt.error`.
- Tier choices are measurements, not taste: changing `tiers.json` by hand is an override that says
  why in its commit.
- The daemon's JSON body cap (1 MiB) bounds a dropped document today well below the studio's own
  10 MB cap; raising it for the documents route is a server change of its own.
