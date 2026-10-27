# 0234. Promote and erase travel as write-once records

Date: 2026-10-27

Amends ADR 0225 ("Memory wall", "The two explicit acts" and "Known limits") and ADR 0140
("Memory replication"). Owner-approved 2026-10-27 (scan-sweep Lane C card, core-brain-memory:
"Promote and erase rewrite write-once memories that replication cannot carry"). Registry:
`sync-replication` (projection security), `agent-memory` (owner and counterpart scope).

## Context

ADR 0140 replicates episodes, facts and procedurals as a pull of files, and it is honest only
because those kinds are write-once: a peer either has a memory byte for byte or does not yet.
ADR 0225 then added two acts that broke that premise. *Make core* (`Brain.unstamp`) rewrote a
stamped file in place without its `space:` line, keeping its id and `created`; *Erase*
(`Brain.erase_space`) deleted stamped files. Neither reached a paired PC:

- a peer that had already pulled the stamped copy never saw the promotion (the cursor follows
  `created`, which the rewrite kept), and one that met both copies filed a conflict;
- an erase left every peer holding the project's memories, and the next pull from any of them -
  a re-pair, a lost cursor, a third PC - wrote them back onto the PC that erased them.

## Decision

Both acts become **new write-once records** that replication carries like any other fact, and
each PC applies a received record to its own brain. Replication never ships a rewrite or a
deletion of a file; no file that has replicated is ever rewritten in place.

**Promote is a successor.** Making a project's fact or procedural core's writes a *new* core
memory through the ordinary writer (`write_fact` / `write_procedural`, so the device stamp, the
atomic write and the index are the usual ones): the same scope, key or trigger, confidence,
body, sources and `every_turn`, with `supersedes: [<old id>]` (ADR 0143's marker, reused) and
`promoted_from: "spc_<id>"`. The stamped original stays on disk with its bytes and is closed, so
recall serves the successor and never the original, in core and in every project.
`promoted_from` is the one thing that widens the wall, and only for that write: its sources may
be episodes the named space can see, and it may close memories of exactly that space. A
promotion must close at least one memory and must itself be core. `receive_file` runs the same
two gates from the file's own header, so a peer files it on the provenance it would have
written it on. The refusals stay: a memory a same-project successor closes, or a retired
marker, does not move; a memory already promoted (closed by a memory of another space - only a
promotion can do that) is answered `None` (404 `unknown_ref`). A project's memory page and
counts leave out a memory a promotion closed: it has left the project. The route still answers
the id it was asked about.

**Erase is a tombstone.** Erasing a project first writes one core fact, scope `project`, key
`erased:spc_<id>`, `erases: "spc_<id>"`, `retired: true` (importance 0, never recalled, never
counted), with an empty `sources` - the one fact allowed none, because what it records is an
absence - and the device stamp. It is written once per space (an erase pressed again finds it).
Then the local erase runs as ADR 0225 describes. A PC that receives the tombstone indexes it and
runs its own erase of that space, bounded to memories `created` at or before the tombstone,
writing no tombstone of its own (no echo). From then on `receive_file` refuses, as
`ErasedRefused` (a `ValueError` the puller counts as skipped, not as a fault), any memory stamped
with a space a held tombstone erased at or after its `created`: a re-pair, a reset cursor or a
PC that has not heard of the erase cannot bring the project back. A memory stamped with the
space and written after the tombstone is not the erase's to take, on either PC.

**Idempotent.** A record already held is skipped by id and sha, as every replicated file is; a
tombstone applied twice erases nothing the second time.

## Consequences

- The write-once premise of ADR 0140 holds again, and the cursor needs no change: a promotion
  and a tombstone are new files with new `created` stamps.
- A promoted memory has a new id. Its index-only values (importance, fade, use) are copied at
  write on the promoting PC (importance) or start fresh (fade, use); a rebuild gives the
  successor the default importance, as for any write.
- The original of a promoted memory stays on disk in the project until the project is erased,
  and then it goes with it; the successor (core) survives the erase and keeps citing the
  project's episodes, as ADR 0225 already allows for a promoted memory.
- A tombstone names the erased space's id and nothing of its content; it is shown, retired, in
  core's memory page.
- The `created` bound trusts the PCs' clocks to about the skew ADR 0140 already allows for; a
  memory written in the space on a PC whose clock runs behind could be taken by a tombstone
  written after it. Spaces do not replicate yet, so no PC but the one that made a project can
  write in it today.
- ADR 0225 "Known limits" no longer holds for erase ("erasing a project on one PC does not erase
  its copies on another"): it now does.
