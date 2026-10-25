"""The sleep cycle: each PC distils the episodes it wrote itself (ADR 0143).

Between conversations, Athena consolidates. One **cycle** reads the episodes this PC wrote since
the last one, distils them into facts and procedures, judges each against what she already knows,
and lets what nobody has used fade. It is hosted work, not a loop that happens to be running, and
four rules from the registry's *autonomous-cycle-hosting* and *consolidation* techniques shape it:

- **One owner admits.** :class:`~athena.core.sleep.admission.SleepAdmission` is the only thing
  that decides whether a cycle may start, in one fixed ladder, and every refusal is a named reason
  with a sentence for a person. The interval floor keys on the last *completed* cycle, never on a
  ``running`` row: a row a crashed process left behind is evidence, not a lock. Liveness is the
  in-process claim (:class:`~athena.core.sleep.admission.SleepClaim`), released on every exit path,
  so process death releases it by construction.
- **One read, drained forward.** The measurement that admits a cycle and the window the cycle
  reads are the same read (:class:`~athena.core.sleep.window.Window`). Caps take the oldest first,
  the cycle records exactly how far it read, and the residue is the next cycle's oldest material.
  What a cap dropped is counted against the whole window, never against the capped fetch.
- **Every ceiling is declared here**, not configured: how much a cycle reads, how many memories it
  writes, how many links it may close, how long a leg may take, how many proposals may wait.
- **Repeated failure is a state** (ADR 0190). Failures in a row over one boundary double the
  backoff up to a cap; a content-shaped one (``parse_error``, ``timeout``) halves the next take to
  isolate the bad material, and a single episode that fails alone twice is walked past - parked,
  never deleted: it stays indexed and recallable, and only goes undistilled.
- **Structural output is proposed, never applied.** A cycle writes new facts and procedures
  (additive, each through the brain's own provenance gate) and records supersedence the merge leg
  judged. Forgetting and contradictions wait as proposals a person keeps or forgets.

The modules:

- :mod:`~athena.core.sleep.window` - the one read: this PC's episodes since the boundary;
- :mod:`~athena.core.sleep.book` - the runtime tables: cycles, proposals, use and fade;
- :mod:`~athena.core.sleep.admission` - the claim and the ladder;
- :mod:`~athena.core.sleep.legs` - the two model legs, their prompts and schemas, and the check of
  every id a model returns;
- :mod:`~athena.core.sleep.cycle` - one cycle, phase by phase, and its journal;
- :mod:`~athena.core.sleep.proposals` - a person's keep or forget.

The daemon hosts it: :mod:`athena.daemon.sleep` holds the routes and the check thread.
"""

from __future__ import annotations

__all__ = [
    "CHECK_EVERY_S",
    "COMPRESS_CHARS",
    "COMPRESS_EPISODES",
    "EPISODE_CHARS",
    "EPISODE_FETCH",
    "EXCERPT_CHARS",
    "FACTS_CAP",
    "FADE_AFTER_D",
    "FADE_BATCH",
    "FADE_MAX",
    "FAILED_BACKOFF_CAP_H",
    "FAILED_BACKOFF_H",
    "FAILED_RUN_ROWS",
    "FIRST_WINDOW_D",
    "FLOOR_H",
    "FORGOTTEN_PREFIX",
    "LEG_TIMEOUT_S",
    "MIN_CHARS",
    "OPEN_PROPOSALS_CAP",
    "PRESSURE_CHARS",
    "PROCEDURALS_CAP",
    "PROPOSAL_EXPIRE_D",
    "QUIET_AFTER_TURN_S",
    "SCAN_ROWS",
    "SHORTLIST",
    "STALE_H",
    "SUPERSEDES_CAP",
]

# -- admission (copied from Personas' sleep cycle; adapted, not measured here) -------------------

#: Characters of this PC's unconsolidated episodes that make a cycle worth its cost.
PRESSURE_CHARS = 40_000
#: Below this a cycle is not admitted at all, whatever the clock says (only a person's force is).
MIN_CHARS = 2_000
#: Hours after a completed (or partial) cycle before the next may start: a burst never sleeps twice.
FLOOR_H = 6
#: Hours after which a cycle runs on whatever has piled up, if it is at least :data:`MIN_CHARS`.
STALE_H = 72
#: Hours a failed cycle holds the next one back, so a leg that keeps failing is not retried hot.
#: Each further failure in a row over the same boundary doubles it, up to
#: :data:`FAILED_BACKOFF_CAP_H` (ADR 0190); a settled cycle starts the count again.
FAILED_BACKOFF_H = 1
FAILED_BACKOFF_CAP_H = 24
#: Failed rows one count of "failures in a row" reads, newest first: past the cap's doubling.
FAILED_RUN_ROWS = 64
#: How often the daemon's check thread asks admission.
CHECK_EVERY_S = 600
#: Seconds after the last turn on this PC ended before a cycle may start.
QUIET_AFTER_TURN_S = 120

# -- the window ----------------------------------------------------------------------------------

#: The first cycle looks back this many days; every later one starts where the last one stopped.
FIRST_WINDOW_D = 7
#: This PC's episodes one measurement counts, oldest first. Past it, the count says "at least".
EPISODE_FETCH = 480
#: Episode rows one measurement walks, this PC's and every peer's, oldest first. The device of an
#: episode is in its file, not the index, so a walk past this would be a header read per row.
SCAN_ROWS = 20_000

# -- the compress leg ------------------------------------------------------------------------------

#: At most this many episodes, this many characters in all and this many of any one, oldest first.
COMPRESS_EPISODES = 120
COMPRESS_CHARS = 30_000
EPISODE_CHARS = 2_000
#: At most this many facts and procedures are written from one cycle; the rest are counted dropped.
FACTS_CAP = 12
PROCEDURALS_CAP = 6

# -- the merge leg ---------------------------------------------------------------------------------

#: Existing memories shortlisted per candidate, and the characters of each shown to the judge.
SHORTLIST = 4
EXCERPT_CHARS = 200
#: At most this many supersede links from one cycle; past it a candidate is written as new.
SUPERSEDES_CAP = 8

#: How long either leg may take.
LEG_TIMEOUT_S = 300.0

# -- fade and proposals ----------------------------------------------------------------------------

#: A memory older than this and not recalled for this long fades one step - at most once per this
#: long, so a step is a month of disuse and not one cycle's.
FADE_AFTER_D = 30
#: Steps a memory may fade; at the last, a forget proposal is offered (never applied).
FADE_MAX = 3
#: Memories one cycle may fade a step: a ceiling on one statement's work.
FADE_BATCH = 500
#: Open proposals at most, and how long one stays open before it expires.
OPEN_PROPOSALS_CAP = 20
PROPOSAL_EXPIRE_D = 14
#: The key prefix of the marker a person's "forget" writes. A model may not mint one, and the
#: marker is also the bar a cycle consults before it learns that key again (``SleepBook.bars``).
FORGOTTEN_PREFIX = "forgotten:"
