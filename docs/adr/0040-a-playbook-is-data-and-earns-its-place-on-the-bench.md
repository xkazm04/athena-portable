# 0040. A playbook is data, and earns its place on the bench

Date: 2026-10-07

Follows [0029](0029-a-module-is-two-layers-an-overview-that-reads-and-a-layer-for-every-write.md),
[0032](0032-the-gauntlet-verdict-comes-from-the-gate-never-from-a-model.md) and
[0036](0036-the-simulated-user-decides-cards-on-the-card.md).

## Context

The owner wants Athena's use cases pushed to the edge between difficulty and usefulness: chores
that nobody else does — because they span portals no integration reaches and end in something
irreversible — and that save a person real money or hours. A list of ideas in a document proves
none of that. A preset that only pre-fills a command proves less: it shows that Athena can be
asked, not that she gets it right.

Two things already existed to build on. The Proving Ground's `World` runs a real Athena on a
throwaway brain through the daemon's own routes, with the gate's records read back. The
Characters' simulated Ledgerbox page answers host calls the way the desktop run loop does.

## Decision

1. **A playbook is a directory of data** under `playbooks/<id>/`, shared by the bench and the
   desktop:
   - `playbook.json`, the showcase: persona, chore, command, portals, gates, traps, what memory
     learns, the economics with their sources, the edge scores with a reason each, and the
     expectation the run is held to (share of the money, false claims allowed, minutes).
   - `world.json`, the portals as data: each app's origin, its tools with honest flags (the four
     kinds of `proving/manifests.py`), its view, the tables its reads answer from, and the phases.
   - `truth.json`, what a perfect run files (`eligible`, with the value and the parameters a right
     claim carries) and what looks eligible but is not (`traps`), plus `forbidden` tools.
   - `bench.json`, the latest measured run, written by the bench and committed.
2. **The truth is hidden from everything but the scorer.** The simulated portals answer from
   `world.json` alone; Athena never sees `truth.json`; nudges are decided from the run loop's
   bound, never from what is still missing.
3. **The score is read from cards, never from prose.** Each `decision.requested` on a target tool
   is `correct` (first time, with `exact` when its parameters match), `duplicate`, `trap`,
   `unfounded`, or a `forbidden` fault. A run that says it filed five claims and filed none scores
   zero (ADR 0032's rule, applied to usefulness).
4. **The verdict is against the playbook's own bar**: `exceeds` (no false claims, within time,
   and more of the money than the expectation, or every claim exact), `meets`, or `short` with the
   reasons. The default run answers no card, so nothing is ever "sent", and the claim is what
   Athena proposed for signature; `--approve all` runs the follow-through.
5. **The desktop shows playbooks as a module** beside the Browser, bundled at build time. Its
   overview is the edge map and a grid of `Tile`s; a playbook opens in a `Layer` with the story on
   the left and the proof on the right. These are the first callers of `Tile` and `Layer`.
6. **The live bench runs on the person's own `claude` CLI**, like Athena does, with a USD cap.

## Consequences

- A playbook is cheap to author (JSON) and expensive to fake: its place on the map is only as
  good as its last bench run, and the module says "not benched" rather than inventing a number.
- The simulated portals are a model of the real ones. A playbook proves Athena's judgment on the
  data and the rules, not that a given carrier's page registers these tools; the real pages are
  reached through generic hands (tier 2), and that path is proven elsewhere.
- One turn is pinned to one origin, as in the product. A playbook that spans portals runs one
  phase per portal, and what carries between them is Athena's memory — the real tier-0 path.
- `bench.json` holds model output (the closing words), committed. It is a measurement, dated,
  with the engine and model named.
