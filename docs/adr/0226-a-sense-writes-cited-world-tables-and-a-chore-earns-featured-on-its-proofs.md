# 0226. A sense writes cited world tables, and a chore earns "featured" on its proofs

Date: 2026-10-26

Builds on [0040](0040-a-playbook-is-data-and-earns-its-place-on-the-bench.md) (a playbook is data
and earns its place on the bench), 0055 (evidence media stay local, the index is committed) and
0122 (an unpriced call weighs against the cap). Program: `docs/concepts/meta-featured-chores/`.
The featured-chore program takes the next free numbers from here (0226-0231): the block it reserved (0201-0230)
was taken by other sessions before the spikes started.

## Context

Five featured chores need new senses from Meta (SAM 3.1, Voice Transcribe, Muse Spark reading) and
no key exists before the hackathon opens. The chores still have to rehearse end to end on the real
gate tonight, so the senses need a seam where a recorded fixture, Claude CLI and Meta are the same
call, and the bench must not grow a second runner for media.

## Decision

1. **A sense is a build step, not a tool.** `python -m athena.senses build <playbook>` turns the
   chore's `senses/media.json` into tables written to `senses/sensed.json`; every row carries its
   provenance (`media_id`, and `frame`, `second`, `box` when known; absent is omitted, never 0).
   `load_playbook` merges those tables into the world, so a READ tool serves them like any portal
   table. A sensed table never shadows an authored one.
2. **Three roles, three backends, chosen per role.** Segmenter, Transcriber and Reader
   (`athena/senses/contract.py`) each run as `fixture` (recorded JSON), `claude` (the CLI's `Read`
   on a rendered sheet; Reader only) or `meta`. Each call is a `SenseCall` row naming the backend
   that actually ran, so a degraded call is visible, never silent.
3. **"Featured" is authored as intent and computed as status.** `playbook.json` `featured` names the
   senses, the spike and the date; `status` is refused there. The status is `proven` only when every
   proof in `senses/proofs.json` passed on a build where a role ran on `meta`; `rehearsed` when they
   passed on fixtures or Claude; `failing`; `unproven`.
4. **Personal data reaches only Standard mode.** A Contributor model id is refused for any media
   item marked `personal` (default true).

## Consequences

- Tomorrow's switch to Meta is a backend flag and a rebuild; the chore, its world and its bench do
  not change. A proof that passed on fixtures says nothing about Meta, and the status says so.
- `sensed.json` is committed (like `bench.json`, a view); media files are not.
