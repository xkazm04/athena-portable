# 0098. The Chores front door is an intake leg on the adopt machinery

Date: 2026-10-15

Follows [0097](0097-adopting-a-playbook-is-a-conversation-held-outside-the-turn-lock.md) (the
studio, its sessions, its legs and its tiers) and [0007](0007-engines-are-configuration.md) (every
model call is the `claude` CLI on the subscription). Reads the library as
[0096](0096-a-playbook-names-its-area-and-its-job-and-the-ledger-reads-the-library-by-them.md)
names it.

## Context

A person who opens Chores either knows which chore they want or does not. The library has about a
hundred of them, and "Make it yours" on a chore's page assumes the first. Someone who has only a
need ("my accountant keeps sending me late notices") has to read the whole library to find out
whether any chore is theirs, and when none is, there is no way in at all.

## Decision

1. **A front door, not a form.** The Chores page asks for a need. Athena asks one or two cards of
   questions and gives a verdict. `template`: a chore in the library fits; she says why, what
   would differ for this person and up to two near misses (`alternates`), and one click opens that
   chore's studio with the need as its opening message. `custom`: no chore is worth reusing; she
   hands a command, editable, to Athena's composer.
2. **The same machine, no playbook.** An intake session is an `AdoptSession` subclass
   (`IntakeSession`, `src/athena/adopt/session.py`) with no playbook, no slots and no-op hooks, so
   no research lane or showcase ever starts for it. It shares the event log, the SSE stream and
   its heartbeat, the actor, the warm process, the idle expiry, the ledger and the
   `MAX_LIVE` places: a fourth live session of either kind is refused `busy:`. The driver and
   prompt are `src/athena/adopt/intake.py` and `prompts.py`; a new module rather than a fork of
   `loop.py`, which is wholly about slots, with one shared piece extracted (`loop.card_questions`,
   the studio's question checks and caps without the slot requirement).
3. **One leg kind, `intake`.** `tiers.json` sets it by hand to the interview pick (Opus low); the
   adopt tier bench does not score it. The leg answers one JSON object: a card
   (`{say, questions}`, at most four questions and five options, the studio's checks) or
   `{verdict}`. One ledger row per invocation, the retry included.
4. **What the leg reads is fenced.** The person's words (the need and each answer) and the library
   summary are separate nonce-tagged fences; both are data. The summary is built from
   `playbooks/*/playbook.json` and `taxonomy.json` only (id, title, area, job, a one-line summary
   from `promise`). `truth.json` is a chore's answer key and is never opened.
5. **Three rounds, then a verdict.** The third model round is told to decide and a card there is a
   malformed answer. `POST /intake/<sid>/decide` forces a verdict at any round. A malformed answer
   gets the leg's one retry; one that still fails is `adopt.error` `engine_error`. A verdict is
   never fabricated, and one with no words from the person to go on is refused as malformed. `/decide`
   before the person has said anything is refused with no model call (409 `validator_failed`,
   `nothing_said:`), and the page holds "Just decide for me" until a line or a card answer is sent.
   The opening `adopt.say` greets once: while nothing has been said, the first leg's own `say` is
   dropped.
6. **The daemon holds the verdict to the library.** A template verdict's `playbook_id` must be a
   real id, else the verdict becomes `custom` (its command is the model's, or the person's own
   need when the model gave none). Alternates are real ids, never the main one, never repeated, two
   at most, titled from the library. A custom verdict has `playbook_id` `""` and a command; a
   template one has command `""`. `need` is the model's first-person need or else the person's
   words, at most 300 characters. After a verdict the session idles: a further answer is refused
   (409 `validator_failed`, "decided").
7. **Routes beside `/adopt`, outside the turn lock.** `POST /intake`, `GET /intake/<sid>/events`,
   `POST /intake/<sid>/answer`, `POST /intake/<sid>/decide`, `DELETE /intake/<sid>`; same token,
   same error shape, none takes `daemon.writing()`. An adopt id is not an intake id: each prefix
   answers 404 for the other's sessions. The wire events are the `adopt.*` contract plus
   `adopt.verdict` (`contracts/adopt.py`).
8. **The page** (`apps/desktop/src/scenes/chores/intake/`, path `chores/new`, reached from "New
   chore" at the right of the Chores header; the page h1 now reads "Chores"). It opens a session on
   arrival and reuses the studio's conversation, cards, composer and dictation. Every state is said
   with a way back: no daemon ("Athena needs the daemon for this"), connecting, reconnecting (five
   tries, then Retry), ended (Start again), busy (Try again), an engine fault (Retry with the first
   thing said as the need). The verdict card: `template` shows the chore, why, what would differ,
   Make it yours (the studio opens with `need` as its `intro`), See the chore page, Go custom
   instead, and the alternates with the same two actions; `custom` shows the command, editable, with
   Hand to Athena (`athenaOffer`), Copy and Back to the chores. The page closes the session once the
   verdict is drawn, to free its place. Escape asks first when anything typed is unsent.

## Consequences

- The Chores page can reach a chore, or a custom command, from a need alone. The chore-detail
  "Make it yours" button is unchanged.
- The front door and the studio compete for three places. Opening Chores' front door while three
  studios are open is `busy:`, as a fourth studio would be.
- The leg is told the whole library (about 10k tokens) on every round; a warm process keeps it
  cheap. A larger library would need a shortlist step.
- The intake tier is unbenched. A bench of need-to-verdict scenarios (fit, near miss, nothing fits)
  is the follow-up that earns a measured pick.
