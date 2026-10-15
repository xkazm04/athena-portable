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
   never overrules her. Their words need not answer a card: what they say before the first card
   (`POST /adopt` `intro`) or beside one (`question_id` `""`) is kept as an answer to no question,
   and both legs read it. A portal slot is read for the app it names (`portal_value`: "Gmail, not
   Postwren" is Gmail, "RTS Pro, as you said" is the playbook's own), so a sentence never becomes
   a rename.
3. **Legs by kind, tiers by bench.** Every model call goes through one door,
   `LegRunner.run_leg(kind, ...)`, with the kind required (`interview`, `audit`, `research`,
   `shape`, `persona`, `judge`). Which Claude 5.5 model and effort serves a kind is
   `src/athena/adopt/tiers.json`, written from the tier bench (item 9). Each invocation is one
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

7. **Research lanes beside the conversation.** Four kinds fill slots while she answers — rules
   (only WebSearch and WebFetch; a finding without an http(s) source is dropped and counted),
   accounts (a leg plans at most three searches; the daemon runs them through the connector
   service's READ tools, so the model never holds a connector), memory (`core.recall`, distilled
   facts only) and document (only `Read`, in the session temp dir). `lanes.run_lanes` is a bounded
   fan-out: four at once, a per-lane timeout, a lane's failure is its own, results harvested in
   order with one harvest line, stopped by `session.cancelled`. Research never confirms a slot, and
   slot values reach later prompts only inside a `slot-values` fence. The hooks bind to each
   daemon's session store, not process-wide, because the showcase builds a second Athena in the
   same process. The documents route alone has a 14 MiB body cap (`server.BodyCap`).
8. **The showcase is a rehearsal, not a replay.** `showcase.shape_world` copies the playbook, takes
   a `shape` leg's spec (the date, at most twenty row edits on existing columns, checked against
   the world before it is applied) and applies it mechanically; portal renames come from the
   approved brief, and truth changes only by those renames because the rehearsal is unscored.
   `run_bench(approve="none")` runs it on a background thread in the daemon process — `World` is
   its own temp brain, daemon, lock and ledger — with every turn streamed and its ledger row copied
   to the live ledger under the session's conversation.

9. **Tiers are measured, not chosen.** `proving/adopt_tiers` runs 9 scenarios (3 easy, 3
   typical, 3 hard, each a hidden fact sheet for a person unlike the playbook's own) against 6
   configs (Haiku, Sonnet and Opus 5.5 at low and medium effort), 2 reps each, with a fixed Sonnet
   person and a fixed, blind Opus judge. One config drives `interview` and `audit` together; `shape`
   is benched on its own. A config is out on any false clear or repeated question, accuracy more
   than 5 points under the best, or a judge mean under 3.5; of the rest the fastest p50 wins (first
   text for the interviewer), usage breaking ties within 5%. `pick --write` rewrites `tiers.json`.
   The first full run (2026-10-14) disqualified every config, mostly on scorer and studio defects
   since fixed (portal values read literally, a deferred slot losing its value, the up-front
   statement riding on the first answer); `tiers.json` holds its hand-confirmed picks: Opus low for
   `interview` and `audit` (within 5 points of the best accuracy and the fastest), Haiku low for
   `shape` (every world valid; the one rename miss was the shaper's name lookup, now fuzzy).

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

See also [0098](0098-the-chores-front-door-is-an-intake-leg-on-the-adopt-machinery.md): the Chores front door is this machine with no playbook.
