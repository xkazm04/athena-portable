# 0127. A playbook is ranked on its comparable runs, and a rescore appends a correction

Date: 2026-10-22

Amends [0056](0056-how-the-best-use-of-athena-is-ranked.md) (what a row's recall is, and what
excludes it) and follows [0040](0040-a-playbook-is-data-and-earns-its-place-on-the-bench.md)
for the bench. README section 14; `docs/features/playbooks.md`, "Ranking".

## Context

`ranking.json` sorted the playbooks by one bench run each. The bench is a model on a simulated
world, so a run is a draw: the same playbook benched twice finds a different share of the items,
and a single draw that lands high or low moves a playbook several places. Nothing in the file said
how many runs a row stood on, so a reader could not tell a sorted draw from a measured order. The
registry's eval-harness standard (reliability aggregation, selection over noise) records this as a
deviation: N travels with the number, the aggregation rule is declared, and no maximum is taken.

`bench.json` kept the earlier runs' headlines, but nothing said whether two runs measured the same
thing. A run before a truth edit, a scorer change or a switch of model is not the same measurement
as one after it, and pooling them averages two instruments.

`rescore` scored a saved run again and wrote the result over the run's own `report.json` and over
the line `bench.json` held, so the original score was gone. The audit-logging standard records
that as a deviation too: a correction is appended and refers to what it corrects.

## Decision

1. **Every run carries a comparability key.** `comparable` is a hash of the playbook's
   `content_digest` (`world.json` and `truth.json` whole, `playbook.json`'s `command` and
   `expectation`, and `SCORER_VERSION` in `bench.py`), the engine, the model and the approval mode.
   The files are parsed and re-serialised before hashing, so line endings and formatting change
   nothing. `SCORER_VERSION` is raised by hand in the same commit as any change to `score` or
   `verdict` that measures the same cards differently.
2. **`bench --runs k`** runs `k` fresh worlds one after the other. Each run writes its own report,
   becomes the latest run of `bench.json` and pushes the one before into the history, so every run
   is kept; nothing is picked. The exit is 1 when any of them was short.
3. **The ranking pools the comparable set.** A playbook's runs are its latest run and every history
   line under the same key; when the playbook's files today give another key, the set is empty and
   the playbook is unranked ("no comparable run"). A latest run with no key (benched before keys
   were kept) is a set of one, and nothing is pooled with it.
   - The money takes the **median** recall of the set; the minutes stay the latest run's.
   - One false claim or one trap filed in **any** comparable run excludes the playbook; short in
     half the runs or more is short.
   - Every row carries `bench.runs`: `n`, the key, how many runs exceeded, the min and median
     recall, the most false claims and the most traps filed. Tie-breaks are unchanged.
4. **A rescore appends.** `rescore` writes `report.rescored-<stamp>.json` beside the run's
   `report.json`, which stays as it was. In `bench.json` the run it replaced becomes a history line
   with its original score and a `superseded_by` (when, the note, the new key and the new score);
   the history grows by one and the line is never counted as a second run. The rescored run takes
   today's key, so it pools with runs benched now.
5. **`rank --tau`** prints each ranked playbook's score on its oldest comparable run alone against
   the median of the rest, and their Kendall tau-b: whether a second draw keeps the first draw's
   order. It writes nothing.
6. **The desktop says the count.** A benched verdict says "exceeds in k of n", and a row standing on
   one comparable run wears an "n=1" badge. An unbenched row claims nothing. The desktop counts the
   runs under the latest run's key; it cannot hash today's files, which only the ranking checks.

## Consequences

- With the committed data every playbook has one comparable run (no run carried a key), so every
  row is `n: 1` and the order is the order of ADR 0056 exactly. `ranking.json` gained the
  `bench.runs` block on each row and was regenerated; nothing else in it changed.
- A comparable set is bounded by `bench.json`'s history (`HISTORY`, twelve lines), and a rescore's
  correction takes a line; a playbook benched more than that loses its oldest runs from the pool.
- Editing a playbook's world, truth, command or expectation after a keyed run unranks it until it is
  rescored or benched again. That is the point; it is also a cost a small typo fix now pays.
- The key covers the model string only as written (`sonnet`): two runs on the alias at different
  times are pooled though the alias may have moved. The bench's hard-coded default model is the
  model-routing deviation recorded separately; this ADR does not change it.
- A median of one run is that run: the ranking is still a draw until the playbooks are benched
  again, and the "n=1" badge says so where a person reads it.
