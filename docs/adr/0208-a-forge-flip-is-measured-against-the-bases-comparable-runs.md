# 0208. A forge flip is measured against the base's comparable runs

Date: 2026-10-25

Applies ADR 0128 to the world forge (README §14); amends nothing. Registry: eval-harness
(reliability-aggregation, selection-over-noise), measurement-honesty (noise-band-and-hysteresis).

## Context

The forge's headline, proof-2, is "at least one audited exceeds->short flip, or a recall drop of
0.2 or more". It compared ONE variant draw with the base playbook's LATEST bench draw: `Base`
read `bench.json`'s top-level `verdict.word` and `score.recall_value`, `report.py` flagged a flip
when that word was exceeds/meets and the variant's was short, and measured the drop as
`latest recall - variant recall`. `pick.py` chose short and exceeds bases by the same latest word.

ADR 0128 had already decided that a playbook is judged on its comparable set (every run under the
key a run benched today would carry: content digest, engine, model, approval mode; short in half
or more is short; the median recall), and `rank.runs_of` / `ledger.comparable_runs` implement it.
The forge used none of it, so:

- clinic-denials' latest run says exceeds while its comparable set is short in 2 of 4: any short
  variant of it was reported as a flip, and the pick drew it as an exceeds base.
- ltc-claims' comparable recalls spread 0.801, duty-drawback's 0.317, clinic-denials' 0.278: a
  0.2 drop from the latest draw on those is inside the base's own run-to-run band.
- nothing checked that the base was benched by the instrument the variants are benched with, or
  against today's files.

## Decision

1. **A base is read as a `Baseline`** (`forge/base.py`): the runs `ledger.comparable_runs` pools
   under `comparability_key(content_digest(<base dir>), engine, model, approve)` of the forge's
   own bench config. It carries `n`, the pooled word (short when short in half or more, else the
   most common verdict, latest first on a tie), the median and the minimum recall. An unkeyed
   bench (benched before keys were kept) is a set of one, as the ranking reads it, unless it names
   another engine, model or approval mode. No comparable run -> `comparable: false` and a reason.
2. **One `BenchConfig`** (`Forge.bench_config`) is threaded to the pick, the bench and the report,
   so the baseline and the variant runs are the same instrument.
3. **The pick draws by the pooled word** and leaves out a base with no comparable run, with a note
   naming how many and under which `engine/model/approve`.
4. **A flip needs a base that held over its comparable set; a drop is measured from the base's
   minimum comparable recall**, so a variant must leave the base's observed range to count.
   Median-based drops were rejected: a base that once scored 0.2 could then "drop" to 0.7.
5. **Every benched variant row carries its `baseline`** (`n`, word, median, min, or `comparable:
   false` and the reason); a variant whose base is not comparable carries no `raw_flip`, no
   audited `flip` and no `recall_drop`, and counts towards no proof.
6. **proof-2 is `n-a` when no benched variant stands on a comparable base**, naming how many bases
   were not comparable; a PASS names the smallest baseline n it stands on.

## Consequences

- 75 of the 95 benched bases stand on one comparable run today: their baseline is still one draw,
  and the row says so (`n: 1`). The rule gets stronger as `bench --runs k` adds runs; nothing
  migrates.
- The real library's pick changes: clinic-denials moves from the exceeds pool to the short pool.
- A base whose files changed since its bench drops out of the pick until it is re-benched, instead
  of being compared with a world it no longer has.
- The forge writes only under the gitignored `proving-runs/`; reverting restores the latest-draw
  comparison with no data to undo.
